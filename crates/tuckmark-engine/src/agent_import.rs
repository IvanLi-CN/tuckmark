use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
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

const MINIMUM_SESSION_ID_CODE_UNITS: usize = 24;
const MAXIMUM_SESSION_ID_CODE_UNITS: usize = 200;
const MINIMUM_SESSION_SECRET_CODE_UNITS: usize = 32;
const MAXIMUM_SESSION_SECRET_CODE_UNITS: usize = 1000;
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
    #[error("agent import session key is too long")]
    SecretTooLong,
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

/// The serializable agent-import template catalog exposed by the DEVD adapters.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentImportCatalogResponse {
    pub templates: Vec<AgentImportTemplate>,
}

/// An active inventory material referenced by a restock item in a session.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentImportRestockTarget {
    pub item_id: String,
    pub material: InventoryMaterial,
}

/// A pending request for an agent to supply label-template field values.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentImportTemplateInputEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub item_id: String,
    pub revision: u64,
    pub template: AgentImportTemplate,
    pub created_at: String,
    pub status: String,
}

#[derive(Clone, Debug)]
pub struct UpdateAgentImportItem {
    pub session_id: String,
    pub secret: String,
    pub item_id: String,
    pub expected_revision: u64,
    pub item: AgentImportItem,
}

#[derive(Clone, Debug)]
pub struct RequestAgentImportTemplateInput {
    pub session_id: String,
    pub secret: String,
    pub item_id: String,
    pub expected_revision: u64,
    pub template: AgentImportTemplate,
}

#[derive(Clone, Debug)]
pub struct FulfillAgentImportTemplateInput {
    pub session_id: String,
    pub secret: String,
    pub event_id: String,
    pub expected_revision: u64,
    pub input: BTreeMap<String, String>,
}

/// The bounded system template set available to agent-import confirmation.
///
/// User templates are resolved from the active data directory at confirmation
/// time so archived and superseded versions cannot be accepted from a session
/// payload.
#[derive(Clone, Debug)]
pub struct AgentImportCatalog {
    system_templates: BTreeMap<String, AgentImportTemplate>,
    system_template_order: Vec<String>,
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
        let mut system_template_order = Vec::new();
        for mut template in templates {
            normalize_agent_import_template(&mut template, "system catalog template")?;
            validate_catalog_template(&template, "system")?;
            if system_templates.contains_key(&template.id) {
                return Err(AgentImportError::Validation(
                    "agent import system template ids must be unique".into(),
                ));
            }
            system_template_order.push(template.id.clone());
            system_templates.insert(template.id.clone(), template);
        }
        Ok(Self {
            system_templates,
            system_template_order,
        })
    }

    fn resolve_system(&self, id: &str) -> Option<AgentImportTemplate> {
        self.system_templates.get(id).cloned()
    }

    fn list_system(&self) -> Vec<AgentImportTemplate> {
        self.system_template_order
            .iter()
            .filter_map(|id| self.system_templates.get(id).cloned())
            .collect()
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
        validate_session_id(&input.id)?;
        validate_session_secret(&input.secret)?;
        let mut proposal = input.proposal;
        normalize_proposal_defaults(&mut proposal)?;
        proposal.validate()?;
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

    /// Returns the system and active user-template catalog for an agent-import client.
    pub fn catalog(&self) -> Result<AgentImportCatalogResponse, AgentImportError> {
        Ok(AgentImportCatalogResponse {
            templates: self.list_templates()?,
        })
    }

    /// Lists active inventory materials that an agent may search while preparing an import.
    pub fn list_inventory(
        &self,
        query: Option<&str>,
    ) -> Result<Vec<InventoryMaterial>, AgentImportError> {
        let query = query.unwrap_or_default().trim().to_lowercase();
        let mut materials = self
            .read_materials()?
            .into_iter()
            .filter(|material| !has_archived_timestamp(material.archived_at.as_deref()))
            .filter(|material| material_matches_query(material, &query))
            .collect::<Vec<_>>();
        materials.sort_by(|left, right| {
            left.full_name
                .to_lowercase()
                .cmp(&right.full_name.to_lowercase())
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(materials)
    }

    /// Resolves each active material still referenced by a restock item in a session.
    pub fn resolve_restock_targets(
        &self,
        session_id: &str,
        secret: &str,
    ) -> Result<Vec<AgentImportRestockTarget>, AgentImportError> {
        let session = self.get_session(session_id, secret)?;
        let materials = self
            .read_materials()?
            .into_iter()
            .map(|material| (material.id.clone(), material))
            .collect::<BTreeMap<_, _>>();
        Ok(session
            .proposal
            .items
            .into_iter()
            .filter(|item| item.kind == AgentImportItemKind::Restock)
            .filter_map(|item| {
                let material = materials.get(item.target_material_id.as_deref()?)?;
                (!has_archived_timestamp(material.archived_at.as_deref())).then(|| {
                    AgentImportRestockTarget {
                        item_id: item.id,
                        material: material.clone(),
                    }
                })
            })
            .collect())
    }

    /// Lists template-input requests that remain actionable for an agent.
    pub fn list_events(
        &self,
        session_id: &str,
        secret: &str,
    ) -> Result<Vec<AgentImportTemplateInputEvent>, AgentImportError> {
        let session = self.get_session(session_id, secret)?;
        session
            .events
            .iter()
            .map(parse_template_input_event)
            .filter_map(|event| match event {
                Ok(event) if event.status == "open" => Some(Ok(event)),
                Ok(_) => None,
                Err(error) => Some(Err(error)),
            })
            .collect()
    }

    /// Applies a client edit to a session item, enforcing its optimistic revision.
    pub fn update_item(
        &self,
        input: UpdateAgentImportItem,
    ) -> Result<AgentImportSession, AgentImportError> {
        let now = self.clock.now();
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AgentImportError::Validation("session lock is poisoned".into()))?;
        cleanup_expired_sessions(&mut sessions, &now);
        let managed = sessions
            .get_mut(&input.session_id)
            .ok_or(AgentImportError::SessionNotFound)?;
        assert_secret(managed, &input.secret)?;
        ensure_open_session(managed)?;
        let item_index = session_item_index(&managed.session, &input.item_id)?;
        let current = managed.session.proposal.items[item_index].clone();
        if current.revision != input.expected_revision {
            return Err(AgentImportError::Validation(
                "This import item changed. Refresh before saving it again.".into(),
            ));
        }

        let pending_event = current
            .pending_template_event_id
            .as_deref()
            .map(|event_id| find_open_event(&managed.session.events, event_id, &current.id))
            .transpose()?
            .flatten();
        if current.pending_template_event_id.is_some() && pending_event.is_none() {
            return Err(AgentImportError::Validation(
                "Template input event is no longer open.".into(),
            ));
        }

        let mut next = match current.kind {
            AgentImportItemKind::Restock => AgentImportItem {
                selected: input.item.selected,
                quantity: input.item.quantity,
                source_note: input.item.source_note,
                revision: current.revision + 1,
                ..current.clone()
            },
            AgentImportItemKind::New => AgentImportItem {
                id: current.id.clone(),
                kind: current.kind.clone(),
                revision: current.revision + 1,
                template: current.template.clone(),
                template_input: pending_event.as_ref().map_or_else(
                    || input.item.template_input.clone(),
                    |_| current.template_input.clone(),
                ),
                pending_template_event_id: current.pending_template_event_id.clone(),
                ..input.item
            },
        };
        normalize_agent_import_item(&mut next)?;
        validate_agent_import_item(&next)?;

        if let Some((event_index, mut event)) = pending_event {
            event.revision = next.revision;
            managed.session.events[event_index] = encode_template_input_event(&event)?;
        }
        managed.session.proposal.items[item_index] = next;
        Ok(managed.session.clone())
    }

    /// Selects a catalog template and opens a request for its required field values.
    pub fn request_template_input(
        &self,
        input: RequestAgentImportTemplateInput,
    ) -> Result<AgentImportSession, AgentImportError> {
        let mut requested = input.template.clone();
        normalize_agent_import_template(&mut requested, "requested label template")?;
        let requested_key = template_key(&requested);
        let template = self
            .list_templates()?
            .into_iter()
            .find(|candidate| template_key(candidate) == requested_key)
            .ok_or_else(|| {
                AgentImportError::Validation(format!(
                    "Label template {requested_key} was not found."
                ))
            })?;
        let now = self.clock.now();
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AgentImportError::Validation("session lock is poisoned".into()))?;
        cleanup_expired_sessions(&mut sessions, &now);
        let managed = sessions
            .get_mut(&input.session_id)
            .ok_or(AgentImportError::SessionNotFound)?;
        assert_secret(managed, &input.secret)?;
        ensure_open_session(managed)?;
        let item_index = session_item_index(&managed.session, &input.item_id)?;
        let current = managed.session.proposal.items[item_index].clone();
        if current.kind != AgentImportItemKind::New {
            return Err(AgentImportError::Validation(
                "Only new materials accept an import template change.".into(),
            ));
        }
        if current.revision != input.expected_revision {
            return Err(AgentImportError::Validation(
                "This import item changed. Refresh before changing its template.".into(),
            ));
        }

        for value in &mut managed.session.events {
            let mut event = parse_template_input_event(value)?;
            if event.item_id == current.id && event.status == "open" {
                event.status = "superseded".into();
                *value = encode_template_input_event(&event)?;
            }
        }
        let event = AgentImportTemplateInputEvent {
            id: format!("agent-import-event-{}", Uuid::new_v4()),
            event_type: "template-input-requested".into(),
            item_id: current.id.clone(),
            revision: current.revision + 1,
            template: template.clone(),
            created_at: now,
            status: "open".into(),
        };
        managed.session.proposal.items[item_index] = AgentImportItem {
            template: Some(template),
            template_input: BTreeMap::new(),
            pending_template_event_id: Some(event.id.clone()),
            revision: event.revision,
            ..current
        };
        managed
            .session
            .events
            .push(encode_template_input_event(&event)?);
        Ok(managed.session.clone())
    }

    /// Records an agent's response to a pending template-input request.
    pub fn fulfill_template_input(
        &self,
        input: FulfillAgentImportTemplateInput,
    ) -> Result<AgentImportSession, AgentImportError> {
        let now = self.clock.now();
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AgentImportError::Validation("session lock is poisoned".into()))?;
        cleanup_expired_sessions(&mut sessions, &now);
        let managed = sessions
            .get_mut(&input.session_id)
            .ok_or(AgentImportError::SessionNotFound)?;
        assert_secret(managed, &input.secret)?;
        ensure_open_session(managed)?;
        let event_index = managed
            .session
            .events
            .iter()
            .position(|value| {
                parse_template_input_event(value)
                    .map(|event| event.id == input.event_id)
                    .unwrap_or(false)
            })
            .ok_or_else(|| {
                AgentImportError::Validation("Template input event is no longer open.".into())
            })?;
        let mut event = parse_template_input_event(&managed.session.events[event_index])?;
        if event.status != "open" {
            return Err(AgentImportError::Validation(
                "Template input event is no longer open.".into(),
            ));
        }
        if event.revision != input.expected_revision {
            return Err(AgentImportError::Validation(
                "Template input event revision does not match.".into(),
            ));
        }
        let item_index = match session_item_index(&managed.session, &event.item_id) {
            Ok(item_index) => item_index,
            Err(error) => {
                event.status = "superseded".into();
                managed.session.events[event_index] = encode_template_input_event(&event)?;
                return Err(error);
            }
        };
        let current = managed.session.proposal.items[item_index].clone();
        if current.revision != event.revision
            || current.pending_template_event_id.as_deref() != Some(event.id.as_str())
        {
            event.status = "superseded".into();
            managed.session.events[event_index] = encode_template_input_event(&event)?;
            return Err(AgentImportError::Validation(
                "Template input event was superseded by a user edit.".into(),
            ));
        }
        ensure_required_template_input(&event.template, &input.input)?;
        managed.session.proposal.items[item_index] = AgentImportItem {
            template_input: input.input,
            pending_template_event_id: None,
            revision: current.revision + 1,
            ..current
        };
        event.status = "fulfilled".into();
        managed.session.events[event_index] = encode_template_input_event(&event)?;
        Ok(managed.session.clone())
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
                note: Some(
                    item.source_note
                        .as_deref()
                        .filter(|note| !note.is_empty())
                        .or(proposal.source_note.as_deref())
                        .unwrap_or_default()
                        .to_owned(),
                ),
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
                Ok(serde_json::from_value(
                    normalize_agent_import_inventory_material(value)?,
                )?)
            })
            .collect()
    }

    fn list_templates(&self) -> Result<Vec<AgentImportTemplate>, AgentImportError> {
        let mut templates = self.catalog.list_system();
        let archive = self.authority.export_archive()?;
        let versions = archive
            .runtime
            .versions
            .into_iter()
            .map(|version| (version.id.clone(), version))
            .collect::<BTreeMap<_, _>>();
        for record in archive.runtime.templates {
            if has_archived_timestamp(record.archived_at.as_deref()) {
                continue;
            }
            let Some(version_id) = record.current_version_id.as_deref() else {
                continue;
            };
            let Some(version) = versions.get(version_id) else {
                return Err(AgentImportError::Validation(format!(
                    "user template {} current version {version_id} was not found",
                    record.id
                )));
            };
            if version.template_id != record.id {
                return Err(AgentImportError::Validation(format!(
                    "user template {} current version has a mismatched template id",
                    record.id
                )));
            }
            let document = version
                .document
                .as_ref()
                .and_then(Value::as_object)
                .ok_or_else(|| {
                    AgentImportError::Validation(format!(
                        "user template {} current version has no document",
                        record.id
                    ))
                })?;
            let fields = document
                .get("fields")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    AgentImportError::Validation(format!(
                        "user template {} current version has no fields",
                        record.id
                    ))
                })?
                .iter()
                .map(normalize_user_template_field)
                .collect::<Result<Vec<_>, _>>()?;
            let mut extra = BTreeMap::new();
            if let Some(recommended_use) = record
                .extra
                .get("recommendedUse")
                .and_then(normalize_recommended_use)
            {
                extra.insert("recommendedUse".into(), Value::String(recommended_use));
            } else if let Some(recommended_use) = record
                .extra
                .get("recommendedUses")
                .and_then(normalize_recommended_uses)
            {
                extra.insert("recommendedUse".into(), Value::String(recommended_use));
            }
            let template = AgentImportTemplate {
                source: "user-template".into(),
                id: record.id,
                name: record.name,
                fields,
                extra,
            };
            validate_catalog_template(&template, "user-template")?;
            templates.push(template);
        }
        Ok(templates)
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
        let mut material = serde_json::from_value::<InventoryMaterial>(
            normalize_agent_import_inventory_material(Value::Object(value))?,
        )?;
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
        if has_archived_timestamp(material.archived_at.as_deref()) {
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
        if has_archived_timestamp(record.archived_at.as_deref()) {
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
    proposal.extra.clear();
    for item in &mut proposal.items {
        normalize_agent_import_item(item)?;
    }
    Ok(())
}

fn normalize_agent_import_inventory_material(value: Value) -> Result<Value, AgentImportError> {
    let mut material = value.as_object().cloned().ok_or_else(|| {
        AgentImportError::Validation("inventory material must be an object".into())
    })?;
    for key in ["id", "fullName", "createdAt", "updatedAt"] {
        if material
            .get(key)
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        {
            return Err(AgentImportError::Validation(format!(
                "inventory material {key} must be a non-empty string"
            )));
        }
    }
    for key in ["baseName", "variantName", "packageName"] {
        if material.get(key).is_some_and(|value| !value.is_string()) {
            return Err(AgentImportError::Validation(format!(
                "inventory material {key} must be a string"
            )));
        }
    }
    match material.get("matrixCode") {
        Some(Value::Null) => {
            material.remove("matrixCode");
        }
        Some(Value::String(_)) | None => {}
        Some(_) => {
            return Err(AgentImportError::Validation(
                "inventory material matrixCode must be a string".into(),
            ));
        }
    }
    for key in ["description", "deviceDetails", "packagingRemark"] {
        match material.get(key) {
            None => {
                material.insert(key.into(), Value::String(String::new()));
            }
            Some(Value::String(_)) => {}
            Some(_) => {
                return Err(AgentImportError::Validation(format!(
                    "inventory material {key} must be a string"
                )));
            }
        }
    }
    let current_quantity = match material.get("currentQuantity") {
        None => 0,
        Some(value) => non_negative_inventory_quantity(value)?,
    };
    material.insert("currentQuantity".into(), json!(current_quantity));
    if material
        .get("archivedAt")
        .is_some_and(|value| !value.is_null() && !value.is_string())
    {
        return Err(AgentImportError::Validation(
            "inventory material archivedAt must be a string or null".into(),
        ));
    }
    let bindings = match material.remove("labelBindings") {
        None => vec![],
        Some(Value::Array(bindings)) => bindings,
        Some(_) => {
            return Err(AgentImportError::Validation(
                "inventory material labelBindings must be an array".into(),
            ));
        }
    };
    let bindings = bindings
        .into_iter()
        .enumerate()
        .map(|(index, binding)| normalize_agent_import_label_binding(binding, index))
        .collect::<Result<Vec<_>, _>>()?;
    material.insert("labelBindings".into(), Value::Array(bindings));
    Ok(Value::Object(material))
}

fn normalize_agent_import_label_binding(
    value: Value,
    index: usize,
) -> Result<Value, AgentImportError> {
    let binding = value.as_object().ok_or_else(|| {
        AgentImportError::Validation(format!(
            "inventory material labelBindings[{index}] must be an object"
        ))
    })?;
    let id = required_label_binding_string(binding, "id", index)?;
    let template_source = required_label_binding_string(binding, "templateSource", index)?;
    if !matches!(template_source.as_str(), "system" | "user-template") {
        return Err(AgentImportError::Validation(format!(
            "inventory material labelBindings[{index}].templateSource is invalid"
        )));
    }
    let template_id = required_label_binding_string(binding, "templateId", index)?;
    let template_name = required_label_binding_string(binding, "templateName", index)?;
    let created_at = required_label_binding_string(binding, "createdAt", index)?;
    let updated_at = required_label_binding_string(binding, "updatedAt", index)?;
    let print_quantity = binding
        .get("printQuantity")
        .map(|value| positive_inventory_quantity(value, "printQuantity"))
        .transpose()?
        .unwrap_or(1);
    let field_overrides = match binding.get("fieldOverrides") {
        None => Map::new(),
        Some(Value::Object(overrides)) => overrides
            .iter()
            .map(|(key, value)| {
                value.as_str().map_or_else(
                    || {
                        Err(AgentImportError::Validation(format!(
                            "inventory material labelBindings[{index}].fieldOverrides.{key} must be a string"
                        )))
                    },
                    |value| Ok((key.clone(), Value::String(value.to_owned()))),
                )
            })
            .collect::<Result<Map<_, _>, _>>()?,
        Some(_) => {
            return Err(AgentImportError::Validation(format!(
                "inventory material labelBindings[{index}].fieldOverrides must be an object"
            )));
        }
    };
    Ok(json!({
        "id": id,
        "templateSource": template_source,
        "templateId": template_id,
        "templateName": template_name,
        "printQuantity": print_quantity,
        "fieldOverrides": field_overrides,
        "createdAt": created_at,
        "updatedAt": updated_at,
    }))
}

fn required_label_binding_string(
    binding: &Map<String, Value>,
    field: &str,
    index: usize,
) -> Result<String, AgentImportError> {
    binding
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| {
            AgentImportError::Validation(format!(
                "inventory material labelBindings[{index}].{field} must be a non-empty string"
            ))
        })
}

fn non_negative_inventory_quantity(value: &Value) -> Result<i64, AgentImportError> {
    value
        .as_i64()
        .filter(|quantity| *quantity >= 0)
        .or_else(|| {
            value
                .as_f64()
                .filter(|quantity| {
                    quantity.is_finite()
                        && *quantity >= 0.0
                        && quantity.fract() == 0.0
                        && *quantity <= i64::MAX as f64
                })
                .map(|quantity| quantity as i64)
        })
        .ok_or_else(|| {
            AgentImportError::Validation(
                "inventory material currentQuantity must be a non-negative integer".into(),
            )
        })
}

fn positive_inventory_quantity(value: &Value, field: &str) -> Result<i64, AgentImportError> {
    let quantity = non_negative_inventory_quantity(value).map_err(|_| {
        AgentImportError::Validation(format!(
            "inventory material labelBindings {field} must be a positive integer"
        ))
    })?;
    if quantity == 0 {
        return Err(AgentImportError::Validation(format!(
            "inventory material labelBindings {field} must be a positive integer"
        )));
    }
    Ok(quantity)
}

fn normalize_agent_import_item(item: &mut AgentImportItem) -> Result<(), AgentImportError> {
    item.source_note.get_or_insert_with(String::new);
    for (field, value) in [
        ("targetMaterialId", item.target_material_id.as_deref()),
        (
            "targetMaterialUpdatedAt",
            item.target_material_updated_at.as_deref(),
        ),
    ] {
        if value.is_some_and(str::is_empty) {
            return Err(AgentImportError::Validation(format!(
                "item {} {field} must be a non-empty string",
                item.id
            )));
        }
    }
    normalize_agent_import_material(item)?;
    if let Some(template) = &mut item.template {
        normalize_agent_import_template(template, "agent import item template")?;
    }
    normalize_template_alternatives(item)?;
    let needs_attention = match item.extra.get("needsAttention") {
        None => None,
        Some(Value::String(value)) if !value.is_empty() => Some(value.clone()),
        Some(_) => {
            return Err(AgentImportError::Validation(format!(
                "item {} needsAttention must be a non-empty string",
                item.id
            )));
        }
    };
    let template_alternatives = item.extra.remove("templateAlternatives").ok_or_else(|| {
        AgentImportError::Validation(format!(
            "item {} templateAlternatives could not be normalized",
            item.id
        ))
    })?;
    item.extra.clear();
    if let Some(needs_attention) = needs_attention {
        item.extra
            .insert("needsAttention".into(), Value::String(needs_attention));
    }
    item.extra
        .insert("templateAlternatives".into(), template_alternatives);
    Ok(())
}

fn normalize_agent_import_material(item: &mut AgentImportItem) -> Result<(), AgentImportError> {
    let item_id = item.id.clone();
    let material = item.material.as_object().ok_or_else(|| {
        AgentImportError::Validation(format!("item {item_id} material must be an object"))
    })?;
    let full_name = material
        .get("fullName")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AgentImportError::Validation(format!(
                "item {item_id} material fullName must be a non-empty string"
            ))
        })?;
    let mut normalized = Map::new();
    normalized.insert("fullName".into(), Value::String(full_name.to_owned()));
    for key in ["baseName", "variantName", "packageName", "matrixCode"] {
        if let Some(value) = material.get(key) {
            let value = value.as_str().ok_or_else(|| {
                AgentImportError::Validation(format!(
                    "item {item_id} material {key} must be a string"
                ))
            })?;
            normalized.insert(key.into(), Value::String(value.to_owned()));
        }
    }
    for key in ["description", "deviceDetails", "packagingRemark"] {
        let value = material.get(key).map_or(Ok(""), |value| {
            value.as_str().ok_or_else(|| {
                AgentImportError::Validation(format!(
                    "item {item_id} material {key} must be a string"
                ))
            })
        })?;
        normalized.insert(key.into(), Value::String(value.to_owned()));
    }
    item.material = Value::Object(normalized);
    Ok(())
}

fn normalize_template_alternatives(item: &mut AgentImportItem) -> Result<(), AgentImportError> {
    let alternatives = match item.extra.get("templateAlternatives") {
        None => vec![],
        Some(Value::Array(alternatives)) => alternatives.clone(),
        Some(_) => {
            return Err(AgentImportError::Validation(format!(
                "item {} templateAlternatives must be an array",
                item.id
            )));
        }
    };
    let mut normalized = Vec::with_capacity(alternatives.len());
    for (index, value) in alternatives.into_iter().enumerate() {
        let mut template =
            serde_json::from_value::<AgentImportTemplate>(value).map_err(|error| {
                AgentImportError::Validation(format!(
                    "item {} templateAlternatives[{index}] is invalid: {error}",
                    item.id
                ))
            })?;
        normalize_agent_import_template(
            &mut template,
            &format!("item {} templateAlternatives[{index}]", item.id),
        )?;
        normalized.push(serde_json::to_value(template)?);
    }
    item.extra
        .insert("templateAlternatives".into(), Value::Array(normalized));
    Ok(())
}

fn normalize_agent_import_template(
    template: &mut AgentImportTemplate,
    context: &str,
) -> Result<(), AgentImportError> {
    if !matches!(template.source.as_str(), "system" | "user-template") {
        return Err(AgentImportError::Validation(format!(
            "{context} source is invalid"
        )));
    }
    if template.id.is_empty() || template.name.is_empty() {
        return Err(AgentImportError::Validation(format!(
            "{context} id and name must be non-empty strings"
        )));
    }
    for field in &mut template.fields {
        normalize_agent_import_template_field(field, context)?;
    }
    let recommended_use = template.extra.remove("recommendedUse");
    template.extra.clear();
    if let Some(recommended_use) = recommended_use {
        template.extra.insert(
            "recommendedUse".into(),
            Value::String(normalize_recommended_use_input(&recommended_use, context)?),
        );
    }
    Ok(())
}

fn normalize_agent_import_template_field(
    field: &mut Value,
    context: &str,
) -> Result<(), AgentImportError> {
    let field_object = field.as_object().ok_or_else(|| {
        AgentImportError::Validation(format!("{context} field must be an object"))
    })?;
    let key = required_template_field_string(field_object, "key", context)?;
    let label = required_template_field_string(field_object, "label", context)?;
    let required = optional_template_field_boolean(field_object, "required", context)?;
    let multiline = optional_template_field_boolean(field_object, "multiline", context)?;
    *field = json!({
        "key": key,
        "label": label,
        "required": required,
        "multiline": multiline,
    });
    Ok(())
}

fn required_template_field_string(
    field: &Map<String, Value>,
    key: &str,
    context: &str,
) -> Result<String, AgentImportError> {
    field
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| {
            AgentImportError::Validation(format!(
                "{context} field {key} must be a non-empty string"
            ))
        })
}

fn optional_template_field_boolean(
    field: &Map<String, Value>,
    key: &str,
    context: &str,
) -> Result<bool, AgentImportError> {
    match field.get(key) {
        None => Ok(false),
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(AgentImportError::Validation(format!(
            "{context} field {key} must be a boolean"
        ))),
    }
}

fn normalize_recommended_use_input(
    value: &Value,
    context: &str,
) -> Result<String, AgentImportError> {
    match value {
        Value::String(value) if !value.trim().is_empty() => Ok(value.trim().to_owned()),
        Value::Object(value) => value
            .get("scope")
            .and_then(Value::as_str)
            .and_then(|scope| (!scope.trim().is_empty()).then(|| scope.trim().to_owned()))
            .ok_or_else(|| {
                AgentImportError::Validation(format!(
                    "{context} recommendedUse must be a non-empty string or scope object"
                ))
            }),
        _ => Err(AgentImportError::Validation(format!(
            "{context} recommendedUse must be a non-empty string or scope object"
        ))),
    }
}

fn template_key(template: &AgentImportTemplate) -> String {
    format!("{}:{}", template.source, template.id)
}

fn normalize_recommended_use(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => (!value.trim().is_empty()).then(|| value.trim().to_owned()),
        Value::Object(value) => value
            .get("scope")
            .and_then(Value::as_str)
            .and_then(|scope| (!scope.trim().is_empty()).then(|| scope.trim().to_owned())),
        _ => None,
    }
}

fn normalize_recommended_uses(value: &Value) -> Option<String> {
    let values = value.as_array()?;
    let joined = values
        .iter()
        .filter_map(normalize_recommended_use)
        .collect::<Vec<_>>()
        .join("；");
    (!joined.is_empty()).then_some(joined)
}

fn has_archived_timestamp(value: Option<&str>) -> bool {
    value.is_some_and(|value| !value.is_empty())
}

fn material_matches_query(material: &InventoryMaterial, query: &str) -> bool {
    if query.is_empty() {
        return true;
    }
    let mut fields = vec![
        material.full_name.clone(),
        material.matrix_code.clone().unwrap_or_default(),
    ];
    for key in [
        "baseName",
        "variantName",
        "packageName",
        "description",
        "deviceDetails",
        "packagingRemark",
    ] {
        if let Some(value) = material.extra.get(key).and_then(Value::as_str) {
            fields.push(value.to_owned());
        }
    }
    fields
        .into_iter()
        .any(|field| field.to_lowercase().contains(query))
}

fn parse_template_input_event(
    value: &Value,
) -> Result<AgentImportTemplateInputEvent, AgentImportError> {
    let event = serde_json::from_value::<AgentImportTemplateInputEvent>(value.clone())?;
    if event.event_type != "template-input-requested" {
        return Err(AgentImportError::Validation(
            "agent import event type is invalid".into(),
        ));
    }
    Ok(event)
}

fn encode_template_input_event(
    event: &AgentImportTemplateInputEvent,
) -> Result<Value, AgentImportError> {
    Ok(serde_json::to_value(event)?)
}

fn find_open_event(
    events: &[Value],
    event_id: &str,
    item_id: &str,
) -> Result<Option<(usize, AgentImportTemplateInputEvent)>, AgentImportError> {
    for (index, value) in events.iter().enumerate() {
        let event = parse_template_input_event(value)?;
        if event.id == event_id && event.item_id == item_id && event.status == "open" {
            return Ok(Some((index, event)));
        }
    }
    Ok(None)
}

fn session_item_index(
    session: &AgentImportSession,
    item_id: &str,
) -> Result<usize, AgentImportError> {
    session
        .proposal
        .items
        .iter()
        .position(|item| item.id == item_id)
        .ok_or_else(|| AgentImportError::Validation("Agent import item was not found.".into()))
}

fn ensure_open_session(session: &ManagedSession) -> Result<(), AgentImportError> {
    if session.session.state != "open" {
        return Err(AgentImportError::SessionClosed);
    }
    if session.committing {
        return Err(AgentImportError::SessionCommitting);
    }
    Ok(())
}

fn validate_agent_import_item(item: &AgentImportItem) -> Result<(), AgentImportError> {
    AgentImportProposal {
        schema: "tuckmark.agent-import.v1".into(),
        source_note: Some(String::new()),
        items: vec![item.clone()],
        extra: Default::default(),
    }
    .validate()?;
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
    match field.get("multiline") {
        None => {
            field.insert("multiline".into(), Value::Bool(false));
        }
        Some(Value::Bool(_)) => {}
        Some(_) => {
            return Err(AgentImportError::Validation(
                "user template field multiline must be a boolean".into(),
            ));
        }
    }
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
        if !field.get("required").is_some_and(Value::is_boolean) {
            return Err(AgentImportError::Validation(format!(
                "agent import catalog template {} field {key} has invalid required flag",
                template.id
            )));
        }
        if !field.get("multiline").is_some_and(Value::is_boolean) {
            return Err(AgentImportError::Validation(format!(
                "agent import catalog template {} field {key} has invalid multiline flag",
                template.id
            )));
        }
    }
    Ok(())
}

fn validate_session_id(id: &str) -> Result<(), AgentImportError> {
    let length = javascript_string_code_units(id);
    if !(MINIMUM_SESSION_ID_CODE_UNITS..=MAXIMUM_SESSION_ID_CODE_UNITS).contains(&length) {
        return Err(AgentImportError::Validation(format!(
            "session id must contain {MINIMUM_SESSION_ID_CODE_UNITS} to {MAXIMUM_SESSION_ID_CODE_UNITS} UTF-16 code units"
        )));
    }
    Ok(())
}

fn validate_session_secret(secret: &str) -> Result<(), AgentImportError> {
    let length = javascript_string_code_units(secret);
    if length < MINIMUM_SESSION_SECRET_CODE_UNITS {
        return Err(AgentImportError::SecretTooShort);
    }
    if length > MAXIMUM_SESSION_SECRET_CODE_UNITS {
        return Err(AgentImportError::SecretTooLong);
    }
    Ok(())
}

fn javascript_string_code_units(value: &str) -> usize {
    value.encode_utf16().count()
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
