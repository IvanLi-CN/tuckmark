use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex},
};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use thiserror::Error;
use time::{Duration, OffsetDateTime, format_description::well_known::Rfc3339};
use tuckmark_contracts::{
    AgentImportItem, AgentImportItemKind, AgentImportProposal, AgentImportSession,
    AgentImportTemplate, ContractError, InventoryAdjustment, InventoryMaterial, JsonWrite,
    LabelBinding, TemplateRecord, TemplateVersion,
};
use uuid::Uuid;

use crate::{Clock, CommitRequest, DataAuthority, DataAuthorityError, RevisionEvent, SystemClock};

const MINIMUM_SESSION_SECRET_BYTES: usize = 32;
const SESSION_TTL: Duration = Duration::minutes(30);

#[derive(Debug, Error)]
pub enum AgentImportError {
    #[error("agent import data authority failed: {0}")]
    Authority(#[from] DataAuthorityError),
    #[error("agent import contract failed: {0}")]
    Contract(#[from] ContractError),
    #[error("agent import JSON failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("agent import session was not found")]
    SessionNotFound,
    #[error("agent import session key is invalid")]
    InvalidSecret,
    #[error("agent import session is not open")]
    SessionClosed,
    #[error("agent import session is already being confirmed")]
    SessionCommitting,
    #[error("agent import session id already exists")]
    DuplicateSession,
    #[error("agent import session key is too short")]
    SecretTooShort,
    #[error("agent import input is invalid: {0}")]
    Validation(String),
}

#[derive(Clone, Debug)]
pub struct CreateAgentImportSession {
    pub id: String,
    pub secret: String,
    pub proposal: AgentImportProposal,
}

#[derive(Clone, Debug)]
pub struct SessionCommitResult {
    pub session: AgentImportSession,
    pub event: Option<RevisionEvent>,
}

/// The bounded system template set available to agent-import confirmation.
///
/// User templates are resolved from the active data directory at confirmation
/// time so archived and superseded versions cannot be accepted from a session
/// payload.
#[derive(Clone, Debug)]
pub struct AgentImportCatalog {
    system_templates: BTreeMap<String, AgentImportTemplate>,
}

impl AgentImportCatalog {
    pub fn builtin() -> Self {
        Self::from_system_templates(vec![
            system_template(
                "shipping-compact",
                "Compact Shipping Label",
                "shipping",
                vec![
                    ("recipient", "Recipient", true, false),
                    ("address", "Address", true, true),
                    ("orderId", "Order ID", true, false),
                    ("note", "Note", false, true),
                ],
            ),
            system_template(
                "cable-tag",
                "Cable Tag",
                "electronics and cable labeling",
                vec![
                    ("name", "Name", true, false),
                    ("port", "Port", false, false),
                    ("location", "Location", false, false),
                ],
            ),
        ])
        .expect("the built-in agent import template catalog is valid")
    }

    pub fn from_system_templates(
        templates: impl IntoIterator<Item = AgentImportTemplate>,
    ) -> Result<Self, AgentImportError> {
        let mut system_templates = BTreeMap::new();
        for template in templates {
            validate_catalog_template(&template, "system")?;
            if system_templates
                .insert(template.id.clone(), template)
                .is_some()
            {
                return Err(AgentImportError::Validation(
                    "agent import system template ids must be unique".into(),
                ));
            }
        }
        Ok(Self { system_templates })
    }

    fn resolve_system(&self, id: &str) -> Option<AgentImportTemplate> {
        self.system_templates.get(id).cloned()
    }
}

impl Default for AgentImportCatalog {
    fn default() -> Self {
        Self::builtin()
    }
}

#[derive(Clone)]
pub struct AgentImportManager {
    authority: DataAuthority,
    clock: Arc<dyn Clock>,
    catalog: AgentImportCatalog,
    commit_lock: Arc<Mutex<()>>,
    sessions: Arc<Mutex<BTreeMap<String, ManagedSession>>>,
}

#[derive(Clone)]
struct ManagedSession {
    session: AgentImportSession,
    secret_hash: [u8; 32],
    committing: bool,
}

impl AgentImportManager {
    pub fn new(authority: DataAuthority) -> Self {
        Self::with_clock(authority, Arc::new(SystemClock))
    }

    pub fn with_clock(authority: DataAuthority, clock: Arc<dyn Clock>) -> Self {
        Self::with_clock_and_catalog(authority, clock, AgentImportCatalog::default())
    }

    pub fn with_catalog(authority: DataAuthority, catalog: AgentImportCatalog) -> Self {
        Self::with_clock_and_catalog(authority, Arc::new(SystemClock), catalog)
    }

    pub fn with_clock_and_catalog(
        authority: DataAuthority,
        clock: Arc<dyn Clock>,
        catalog: AgentImportCatalog,
    ) -> Self {
        Self {
            authority,
            clock,
            catalog,
            commit_lock: Arc::new(Mutex::new(())),
            sessions: Arc::new(Mutex::new(BTreeMap::new())),
        }
    }

    pub fn create_session(
        &self,
        input: CreateAgentImportSession,
    ) -> Result<AgentImportSession, AgentImportError> {
        if input.id.trim().is_empty() {
            return Err(AgentImportError::Validation(
                "session id is required".into(),
            ));
        }
        if input.secret.len() < MINIMUM_SESSION_SECRET_BYTES {
            return Err(AgentImportError::SecretTooShort);
        }
        let mut proposal = input.proposal;
        proposal.validate()?;
        normalize_proposal_defaults(&mut proposal)?;
        for item in &mut proposal.items {
            // Session-local coordination state is never accepted from the caller.
            item.revision = 0;
            item.pending_template_event_id = None;
        }
        let now = self.clock.now();
        let session = AgentImportSession {
            id: input.id.clone(),
            state: "open".into(),
            created_at: now.clone(),
            expires_at: session_expiry(&now)?,
            proposal,
            events: vec![],
            extra: Default::default(),
        };
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AgentImportError::Validation("session lock is poisoned".into()))?;
        cleanup_expired_sessions(&mut sessions, &now);
        if sessions.contains_key(&input.id) {
            return Err(AgentImportError::DuplicateSession);
        }
        sessions.insert(
            input.id,
            ManagedSession {
                session: session.clone(),
                secret_hash: hash_secret(&input.secret),
                committing: false,
            },
        );
        Ok(session)
    }

    pub fn get_session(
        &self,
        session_id: &str,
        secret: &str,
    ) -> Result<AgentImportSession, AgentImportError> {
        let now = self.clock.now();
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AgentImportError::Validation("session lock is poisoned".into()))?;
        cleanup_expired_sessions(&mut sessions, &now);
        let session = sessions
            .get(session_id)
            .ok_or(AgentImportError::SessionNotFound)?;
        assert_secret(session, secret)?;
        Ok(session.session.clone())
    }

    pub fn confirm(
        &self,
        session_id: &str,
        secret: &str,
    ) -> Result<AgentImportSession, AgentImportError> {
        Ok(self.confirm_with_result(session_id, secret)?.session)
    }

    pub fn confirm_with_result(
        &self,
        session_id: &str,
        secret: &str,
    ) -> Result<SessionCommitResult, AgentImportError> {
        let pending = {
            let now = self.clock.now();
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|_| AgentImportError::Validation("session lock is poisoned".into()))?;
            cleanup_expired_sessions(&mut sessions, &now);
            let managed = sessions
                .get_mut(session_id)
                .ok_or(AgentImportError::SessionNotFound)?;
            assert_secret(managed, secret)?;
            if managed.session.state != "open" {
                return Err(AgentImportError::SessionClosed);
            }
            if managed.committing {
                return Err(AgentImportError::SessionCommitting);
            }
            managed.committing = true;
            managed.session.clone()
        };

        let result = {
            // Match the runtime's global import queue without holding the
            // session map lock during filesystem work.
            match self.commit_lock.lock() {
                Ok(_commit) => self.commit_proposal(&pending.proposal),
                Err(_) => Err(AgentImportError::Validation(
                    "commit lock is poisoned".into(),
                )),
            }
        };
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AgentImportError::Validation("session lock is poisoned".into()))?;
        let managed = sessions
            .get_mut(session_id)
            .ok_or(AgentImportError::SessionNotFound)?;
        managed.committing = false;
        match result {
            Ok(event) => {
                managed.session.state = "completed".into();
                Ok(SessionCommitResult {
                    session: managed.session.clone(),
                    event,
                })
            }
            Err(error) => Err(error),
        }
    }

    fn commit_proposal(
        &self,
        proposal: &AgentImportProposal,
    ) -> Result<Option<RevisionEvent>, AgentImportError> {
        proposal.validate()?;
        let expected_revision = self.authority.revision()?;
        let mut materials = self.read_materials()?;
        let now = self.clock.now();
        let selected = proposal
            .items
            .iter()
            .filter(|item| item.selected)
            .collect::<Vec<_>>();
        if selected.is_empty() {
            return Ok(None);
        }

        let initial_material_updated_at = materials
            .iter()
            .map(|material| (material.id.clone(), material.updated_at.clone()))
            .collect::<BTreeMap<_, _>>();
        let mut changed_material_ids = BTreeSet::new();
        let mut adjustments = Vec::new();
        for item in selected {
            if item.pending_template_event_id.is_some() {
                return Err(AgentImportError::Validation(format!(
                    "template input is still pending for item {}",
                    item.id
                )));
            }
            if item.quantity <= 0 {
                return Err(AgentImportError::Validation(format!(
                    "item {} must have a positive quantity",
                    item.id
                )));
            }
            let material = match item.kind {
                AgentImportItemKind::New => self.new_material(item, &materials, &now)?,
                AgentImportItemKind::Restock => {
                    self.restock_material(item, &materials, &initial_material_updated_at, &now)?
                }
            };
            let material_id = material.id.clone();
            let material_index = materials
                .iter()
                .position(|candidate| candidate.id == material_id);
            if let Some(index) = material_index {
                materials[index] = material.clone();
            } else {
                materials.push(material.clone());
            }
            changed_material_ids.insert(material_id.clone());
            adjustments.push(InventoryAdjustment {
                id: format!("inventory-adjustment-{}", Uuid::new_v4()),
                material_id,
                kind: "in".into(),
                quantity_delta: Some(item.quantity),
                target_quantity: None,
                quantity_after: Some(material.current_quantity),
                note: item
                    .source_note
                    .as_deref()
                    .filter(|note| !note.is_empty())
                    .map(str::to_owned)
                    .or_else(|| proposal.source_note.clone()),
                actor: Some("agent-import".into()),
                created_at: Some(now.clone()),
                extra: Default::default(),
            });
        }

        let mut writes = materials
            .iter()
            .filter(|material| changed_material_ids.contains(&material.id))
            .map(|material| {
                Ok(JsonWrite::new(
                    format!("inventory/materials/{}.json", safe_segment(&material.id)?),
                    serde_json::to_value(material)?,
                ))
            })
            .collect::<Result<Vec<_>, AgentImportError>>()?;
        writes.extend(
            adjustments
                .iter()
                .map(|adjustment| {
                    Ok(JsonWrite::new(
                        format!(
                            "inventory/adjustments/{}.json",
                            safe_segment(&adjustment.id)?
                        ),
                        serde_json::to_value(adjustment)?,
                    ))
                })
                .collect::<Result<Vec<_>, AgentImportError>>()?,
        );
        writes.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        let event = self.authority.commit(CommitRequest {
            expected_revision,
            writes,
            deletes: vec![],
            domains: vec!["inventory".into(), "templates".into()],
            reason: "agent-import-confirmed".into(),
        })?;
        Ok(Some(event))
    }

    fn read_materials(&self) -> Result<Vec<InventoryMaterial>, AgentImportError> {
        self.authority
            .list_json_files("inventory/materials")?
            .into_iter()
            .map(|path| {
                let relative = path
                    .strip_prefix(self.authority.root())
                    .map_err(|_| AgentImportError::Validation("material path escaped root".into()))?
                    .to_string_lossy()
                    .replace('\\', "/");
                let value = self
                    .authority
                    .read_json(&relative)?
                    .ok_or_else(|| AgentImportError::Validation("material disappeared".into()))?;
                Ok(serde_json::from_value(value)?)
            })
            .collect()
    }

    fn new_material(
        &self,
        item: &AgentImportItem,
        materials: &[InventoryMaterial],
        now: &str,
    ) -> Result<InventoryMaterial, AgentImportError> {
        let mut value = item.material.as_object().cloned().ok_or_else(|| {
            AgentImportError::Validation(format!("new item {} material must be an object", item.id))
        })?;
        let full_name = value
            .get("fullName")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                AgentImportError::Validation(format!("new item {} needs fullName", item.id))
            })?;
        if materials
            .iter()
            .any(|material| material.full_name == full_name)
        {
            return Err(AgentImportError::Validation(format!(
                "material {full_name} already exists"
            )));
        }
        let matrix_code = value
            .get("matrixCode")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
        if let Some(matrix_code) = matrix_code.as_deref()
            && materials
                .iter()
                .any(|material| material.matrix_code.as_deref() == Some(matrix_code))
        {
            return Err(AgentImportError::Validation(format!(
                "matrix code {matrix_code} already exists"
            )));
        }
        match matrix_code {
            Some(matrix_code) => {
                value.insert("matrixCode".into(), Value::String(matrix_code));
            }
            None => {
                value.remove("matrixCode");
            }
        }
        let material_id = format!("inventory-material-{}", Uuid::new_v4());
        value.insert("id".into(), Value::String(material_id));
        value.insert("currentQuantity".into(), Value::Number(0.into()));
        value.insert("createdAt".into(), Value::String(now.into()));
        value.insert("updatedAt".into(), Value::String(now.into()));
        value.insert("archivedAt".into(), Value::Null);
        let template = item.template.as_ref().ok_or_else(|| {
            AgentImportError::Validation(format!("new item {} needs a label template", item.id))
        })?;
        let catalog_template = self.resolve_template(template)?;
        ensure_required_template_input(&catalog_template, &item.template_input)?;
        value.insert(
            "labelBindings".into(),
            Value::Array(vec![serde_json::to_value(LabelBinding {
                id: format!("inventory-label-binding-{}", Uuid::new_v4()),
                template_source: catalog_template.source.clone(),
                template_id: catalog_template.id.clone(),
                extra: BTreeMap::from([
                    (
                        "templateName".into(),
                        Value::String(catalog_template.name.clone()),
                    ),
                    (
                        "printQuantity".into(),
                        json!(item.label_print_quantity.unwrap_or(1)),
                    ),
                    (
                        "fieldOverrides".into(),
                        serde_json::to_value(&item.template_input)?,
                    ),
                    ("createdAt".into(), Value::String(now.into())),
                    ("updatedAt".into(), Value::String(now.into())),
                ]),
            })?]),
        );
        let mut material = serde_json::from_value::<InventoryMaterial>(Value::Object(value))?;
        material.current_quantity = material
            .current_quantity
            .checked_add(item.quantity)
            .ok_or_else(|| {
                AgentImportError::Validation(format!("new item {} quantity overflowed", item.id))
            })?;
        material.updated_at = Some(now.into());
        Ok(material)
    }

    fn restock_material(
        &self,
        item: &AgentImportItem,
        materials: &[InventoryMaterial],
        initial_material_updated_at: &BTreeMap<String, Option<String>>,
        now: &str,
    ) -> Result<InventoryMaterial, AgentImportError> {
        let target_id = item.target_material_id.as_deref().ok_or_else(|| {
            AgentImportError::Validation(format!("restock item {} needs targetMaterialId", item.id))
        })?;
        let mut material = materials
            .iter()
            .find(|material| material.id == target_id)
            .cloned()
            .ok_or_else(|| {
                AgentImportError::Validation(format!("restock target {target_id} was not found"))
            })?;
        if material.archived_at.is_some() {
            return Err(AgentImportError::Validation(format!(
                "restock target {} is archived",
                material.id
            )));
        }
        let expected_updated_at = item.target_material_updated_at.as_deref().ok_or_else(|| {
            AgentImportError::Validation(format!(
                "restock target {} is missing its session timestamp",
                material.id
            ))
        })?;
        if initial_material_updated_at
            .get(&material.id)
            .and_then(Option::as_deref)
            != Some(expected_updated_at)
        {
            return Err(AgentImportError::Validation(format!(
                "restock target {} changed while the session was open",
                material.id
            )));
        }
        material.current_quantity = material
            .current_quantity
            .checked_add(item.quantity)
            .ok_or_else(|| {
                AgentImportError::Validation(format!(
                    "restock target {} quantity overflowed",
                    material.id
                ))
            })?;
        material.updated_at = Some(now.into());
        Ok(material)
    }

    fn resolve_template(
        &self,
        submitted: &AgentImportTemplate,
    ) -> Result<AgentImportTemplate, AgentImportError> {
        match submitted.source.as_str() {
            "system" => self.catalog.resolve_system(&submitted.id).ok_or_else(|| {
                AgentImportError::Validation(format!(
                    "label template system:{} was not found",
                    submitted.id
                ))
            }),
            "user-template" => self.resolve_user_template(&submitted.id),
            source => Err(AgentImportError::Validation(format!(
                "label template source {source} is invalid"
            ))),
        }
    }

    fn resolve_user_template(&self, id: &str) -> Result<AgentImportTemplate, AgentImportError> {
        let path = format!("templates/{}/template.json", safe_segment(id)?);
        let record = self.authority.read_json(&path)?.ok_or_else(|| {
            AgentImportError::Validation(format!("label template user-template:{id} was not found"))
        })?;
        let record: TemplateRecord = serde_json::from_value(record)?;
        if record.id != id {
            return Err(AgentImportError::Validation(format!(
                "label template user-template:{id} has a mismatched record id {}",
                record.id
            )));
        }
        if record.archived_at.is_some() {
            return Err(AgentImportError::Validation(format!(
                "label template user-template:{id} is archived"
            )));
        }
        let current_version_id = record.current_version_id.as_deref().ok_or_else(|| {
            AgentImportError::Validation(format!(
                "label template user-template:{id} has no current version"
            ))
        })?;
        let version_path = format!(
            "templates/{}/versions/{}.json",
            safe_segment(id)?,
            safe_segment(current_version_id)?
        );
        let version = self.authority.read_json(&version_path)?.ok_or_else(|| {
            AgentImportError::Validation(format!(
                "label template user-template:{id} current version {current_version_id} was not found"
            ))
        })?;
        let version: TemplateVersion = serde_json::from_value(version)?;
        if version.id != current_version_id || version.template_id != record.id {
            return Err(AgentImportError::Validation(format!(
                "label template user-template:{id} has an invalid current version"
            )));
        }
        let document = version
            .document
            .as_ref()
            .and_then(Value::as_object)
            .ok_or_else(|| {
                AgentImportError::Validation(format!(
                    "label template user-template:{id} current version has no document"
                ))
            })?;
        let fields = document
            .get("fields")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                AgentImportError::Validation(format!(
                    "label template user-template:{id} current version has no fields"
                ))
            })?
            .iter()
            .map(normalize_user_template_field)
            .collect::<Result<Vec<_>, _>>()?;
        let template = AgentImportTemplate {
            source: "user-template".into(),
            id: record.id,
            name: record.name,
            fields,
            extra: Default::default(),
        };
        validate_catalog_template(&template, "user-template")?;
        Ok(template)
    }
}

fn normalize_proposal_defaults(proposal: &mut AgentImportProposal) -> Result<(), AgentImportError> {
    proposal.source_note.get_or_insert_with(String::new);
    for item in &mut proposal.items {
        item.source_note.get_or_insert_with(String::new);
        let material = item.material.as_object_mut().ok_or_else(|| {
            AgentImportError::Validation(format!("item {} material must be an object", item.id))
        })?;
        for key in ["description", "deviceDetails", "packagingRemark"] {
            material
                .entry(key)
                .or_insert_with(|| Value::String(String::new()));
        }
    }
    Ok(())
}

fn system_template(
    id: &str,
    name: &str,
    recommended_use: &str,
    fields: Vec<(&str, &str, bool, bool)>,
) -> AgentImportTemplate {
    AgentImportTemplate {
        source: "system".into(),
        id: id.into(),
        name: name.into(),
        fields: fields
            .into_iter()
            .map(|(key, label, required, multiline)| {
                json!({
                    "key": key,
                    "label": label,
                    "required": required,
                    "multiline": multiline,
                })
            })
            .collect(),
        extra: BTreeMap::from([(
            "recommendedUse".into(),
            Value::String(recommended_use.into()),
        )]),
    }
}

fn normalize_user_template_field(field: &Value) -> Result<Value, AgentImportError> {
    let mut field = field.as_object().cloned().ok_or_else(|| {
        AgentImportError::Validation("user template field must be an object".into())
    })?;
    let key = field.get("key").and_then(Value::as_str).unwrap_or_default();
    let label = field
        .get("label")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if key.trim().is_empty() || label.trim().is_empty() {
        return Err(AgentImportError::Validation(
            "user template field key and label are required".into(),
        ));
    }
    // Shared template fields are optional when exposed through agent import,
    // matching the TypeScript catalog's listTemplates() normalization.
    field.insert("required".into(), Value::Bool(false));
    Ok(Value::Object(field))
}

fn validate_catalog_template(
    template: &AgentImportTemplate,
    expected_source: &str,
) -> Result<(), AgentImportError> {
    if template.source != expected_source {
        return Err(AgentImportError::Validation(format!(
            "agent import catalog template {} must use source {expected_source}",
            template.id
        )));
    }
    if template.id.trim().is_empty() || template.name.trim().is_empty() {
        return Err(AgentImportError::Validation(
            "agent import catalog template id and name are required".into(),
        ));
    }
    let mut field_keys = BTreeSet::new();
    for field in &template.fields {
        let field = field.as_object().ok_or_else(|| {
            AgentImportError::Validation("agent import catalog field must be an object".into())
        })?;
        let key = field.get("key").and_then(Value::as_str).unwrap_or_default();
        let label = field
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if key.trim().is_empty() || label.trim().is_empty() {
            return Err(AgentImportError::Validation(
                "agent import catalog field key and label are required".into(),
            ));
        }
        if !field_keys.insert(key) {
            return Err(AgentImportError::Validation(format!(
                "agent import catalog template {} has duplicate field {key}",
                template.id
            )));
        }
        if field
            .get("required")
            .is_some_and(|required| !required.is_boolean())
        {
            return Err(AgentImportError::Validation(format!(
                "agent import catalog template {} field {key} has invalid required flag",
                template.id
            )));
        }
    }
    Ok(())
}

fn session_expiry(now: &str) -> Result<String, AgentImportError> {
    let timestamp = OffsetDateTime::parse(now, &Rfc3339).map_err(|_| {
        AgentImportError::Validation("clock returned an invalid RFC 3339 timestamp".into())
    })?;
    timestamp
        .checked_add(SESSION_TTL)
        .ok_or_else(|| AgentImportError::Validation("session expiry overflowed".into()))?
        .format(&Rfc3339)
        .map_err(|_| AgentImportError::Validation("session expiry could not be formatted".into()))
}

fn cleanup_expired_sessions(sessions: &mut BTreeMap<String, ManagedSession>, now: &str) {
    let Ok(now) = OffsetDateTime::parse(now, &Rfc3339) else {
        return;
    };
    sessions.retain(|_, managed| {
        OffsetDateTime::parse(&managed.session.expires_at, &Rfc3339)
            .map(|expires_at| expires_at > now)
            .unwrap_or(false)
    });
}

fn hash_secret(secret: &str) -> [u8; 32] {
    Sha256::digest(secret.as_bytes()).into()
}

fn assert_secret(session: &ManagedSession, secret: &str) -> Result<(), AgentImportError> {
    if !constant_time_hash_eq(&session.secret_hash, &hash_secret(secret)) {
        return Err(AgentImportError::InvalidSecret);
    }
    Ok(())
}

fn constant_time_hash_eq(left: &[u8; 32], right: &[u8; 32]) -> bool {
    left.iter()
        .zip(right)
        .fold(0u8, |difference, (left, right)| difference | (left ^ right))
        == 0
}

fn ensure_required_template_input(
    template: &tuckmark_contracts::AgentImportTemplate,
    input: &BTreeMap<String, String>,
) -> Result<(), AgentImportError> {
    let missing = template
        .fields
        .iter()
        .filter_map(|field| {
            let field = field.as_object()?;
            let required = field
                .get("required")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let key = field.get("key")?.as_str()?;
            let label = field.get("label").and_then(Value::as_str).unwrap_or(key);
            (required && input.get(key).is_none_or(|value| value.trim().is_empty()))
                .then_some(label.to_owned())
        })
        .collect::<Vec<_>>();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(AgentImportError::Validation(format!(
            "template input is missing required fields: {}",
            missing.join(", ")
        )))
    }
}

fn safe_segment(value: &str) -> Result<&str, AgentImportError> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err(AgentImportError::Validation(format!(
            "invalid data identifier {value}"
        )));
    }
    Ok(value)
}
