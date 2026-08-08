use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex},
};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use thiserror::Error;
use time::{Duration, OffsetDateTime, format_description::well_known::Rfc3339};
use tuckmark_contracts::{
    AgentImportItem, AgentImportItemKind, AgentImportProposal, AgentImportSession, ContractError,
    InventoryAdjustment, InventoryMaterial, JsonWrite, LabelBinding,
};
use uuid::Uuid;

use crate::{Clock, CommitRequest, DataAuthority, DataAuthorityError, RevisionEvent, SystemClock};

const MINIMUM_SESSION_SECRET_BYTES: usize = 16;
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

#[derive(Clone)]
pub struct AgentImportManager {
    authority: DataAuthority,
    clock: Arc<dyn Clock>,
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
        Self {
            authority,
            clock,
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
        input.proposal.validate()?;
        let now = self.clock.now();
        let session = AgentImportSession {
            id: input.id.clone(),
            state: "open".into(),
            created_at: now.clone(),
            expires_at: session_expiry(&now)?,
            proposal: input.proposal,
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

        let result = self.commit_proposal(&pending.proposal);
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
                AgentImportItemKind::Restock => self.restock_material(item, &materials, &now)?,
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
                    .clone()
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
        if let Some(matrix_code) = value
            .get("matrixCode")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
        {
            if materials
                .iter()
                .any(|material| material.matrix_code.as_deref() == Some(matrix_code))
            {
                return Err(AgentImportError::Validation(format!(
                    "matrix code {matrix_code} already exists"
                )));
            }
        }
        let material_id = format!("inventory-material-{}", Uuid::new_v4());
        value.insert("id".into(), Value::String(material_id));
        value.insert("currentQuantity".into(), Value::Number(0.into()));
        value.insert("createdAt".into(), Value::String(now.into()));
        value.insert("updatedAt".into(), Value::String(now.into()));
        value.insert("archivedAt".into(), Value::Null);
        if let Some(template) = &item.template {
            value.insert(
                "labelBindings".into(),
                Value::Array(vec![serde_json::to_value(LabelBinding {
                    id: format!("inventory-label-binding-{}", Uuid::new_v4()),
                    template_source: template.source.clone(),
                    template_id: template.id.clone(),
                    extra: BTreeMap::from([
                        ("templateName".into(), Value::String(template.name.clone())),
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
        } else {
            value
                .entry("labelBindings")
                .or_insert_with(|| Value::Array(vec![]));
        }
        let mut material = serde_json::from_value::<InventoryMaterial>(Value::Object(value))?;
        material.current_quantity += item.quantity;
        material.updated_at = Some(now.into());
        Ok(material)
    }

    fn restock_material(
        &self,
        item: &AgentImportItem,
        materials: &[InventoryMaterial],
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
        if let Some(expected_updated_at) = item.target_material_updated_at.as_deref() {
            if material.updated_at.as_deref() != Some(expected_updated_at) {
                return Err(AgentImportError::Validation(format!(
                    "restock target {} changed while the session was open",
                    material.id
                )));
            }
        }
        material.current_quantity += item.quantity;
        material.updated_at = Some(now.into());
        Ok(material)
    }
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
    if session.secret_hash != hash_secret(secret) {
        return Err(AgentImportError::InvalidSecret);
    }
    Ok(())
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
