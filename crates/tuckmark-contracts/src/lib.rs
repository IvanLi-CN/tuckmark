//! Language-neutral wire and persistence contracts for the native Tuckmark engine.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

pub mod render;
pub use render::*;

pub const DATA_DIRECTORY_MANIFEST_SCHEMA: &str = "tuckmark.data-dir-manifest.v1";
pub const DEVD_DATA_ARCHIVE_SCHEMA: &str = "tuckmark.devd-data-archive.v1";
pub const DEVD_DATA_STATE_SCHEMA: &str = "tuckmark.devd-data-state.v1";
pub const DEVD_DATA_TRANSACTION_SCHEMA: &str = "tuckmark.devd-data-transaction.v1";
pub const DEVD_LIVE_LOCK_SCHEMA: &str = "tuckmark.devd-live-lock.v1";
pub const DEVD_OWNER_SCHEMA: &str = "tuckmark.devd-owner.v1";
pub const RUNTIME_EXPORT_SCHEMA: &str = "tuckmark.runtime-export.v1";

pub type ExtraFields = BTreeMap<String, Value>;

#[derive(Debug, Error)]
pub enum ContractError {
    #[error("JSON serialization failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid contract: {0}")]
    Validation(String),
}

fn non_empty(value: &str, name: &str) -> Result<(), ContractError> {
    if value.trim().is_empty() {
        return Err(ContractError::Validation(format!(
            "{name} must not be empty"
        )));
    }
    Ok(())
}

fn default_true() -> bool {
    true
}

fn expected_schema(actual: &str, expected: &str) -> Result<(), ContractError> {
    if actual != expected {
        return Err(ContractError::Validation(format!(
            "expected schema {expected}, received {actual}"
        )));
    }
    Ok(())
}

/// Recursively sorts JSON object keys. Arrays retain their defined order.
pub fn canonicalize_json(value: Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.into_iter().map(canonicalize_json).collect()),
        Value::Object(values) => Value::Object(
            values
                .into_iter()
                .map(|(key, value)| (key, canonicalize_json(value)))
                .collect(),
        ),
        value => value,
    }
}

/// Tuckmark's file-backed JSON uses stable, pretty JSON with one trailing newline.
pub fn canonical_json_string<T: Serialize>(value: &T) -> Result<String, ContractError> {
    let value = canonicalize_json(serde_json::to_value(value)?);
    Ok(format!("{}\n", serde_json::to_string_pretty(&value)?))
}

pub fn canonical_json_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, ContractError> {
    Ok(canonical_json_string(value)?.into_bytes())
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataDirectoryFiles {
    pub settings: String,
    pub templates_dir: String,
    pub drafts_dir: String,
    pub inventory_dir: String,
    pub backups_dir: String,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataDirectoryCounts {
    pub templates: u64,
    pub versions: u64,
    pub working_copies: u64,
    pub materials: u64,
    pub adjustments: u64,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataDirectoryManifest {
    pub schema: String,
    pub generated_at: String,
    pub snapshot_updated_at: Option<String>,
    pub source: String,
    pub files: DataDirectoryFiles,
    pub counts: DataDirectoryCounts,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

impl DataDirectoryManifest {
    pub fn new(source: impl Into<String>, generated_at: impl Into<String>) -> Self {
        Self {
            schema: DATA_DIRECTORY_MANIFEST_SCHEMA.into(),
            generated_at: generated_at.into(),
            snapshot_updated_at: None,
            source: source.into(),
            files: DataDirectoryFiles {
                settings: "settings/app-settings.json".into(),
                templates_dir: "templates".into(),
                drafts_dir: "drafts".into(),
                inventory_dir: "inventory".into(),
                backups_dir: "backups".into(),
                extra: ExtraFields::new(),
            },
            counts: DataDirectoryCounts::default(),
            extra: ExtraFields::new(),
        }
    }

    pub fn validate(&self) -> Result<(), ContractError> {
        expected_schema(&self.schema, DATA_DIRECTORY_MANIFEST_SCHEMA)?;
        non_empty(&self.generated_at, "manifest.generatedAt")?;
        non_empty(&self.source, "manifest.source")?;
        for (name, path) in [
            ("manifest.files.settings", &self.files.settings),
            ("manifest.files.templatesDir", &self.files.templates_dir),
            ("manifest.files.draftsDir", &self.files.drafts_dir),
            ("manifest.files.inventoryDir", &self.files.inventory_dir),
            ("manifest.files.backupsDir", &self.files.backups_dir),
        ] {
            non_empty(path, name)?;
            validate_relative_path(path)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionEvent {
    pub revision: u64,
    #[serde(default)]
    pub domains: Vec<String>,
    pub reason: String,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

impl RevisionEvent {
    pub fn new(revision: u64, domains: Vec<String>, reason: impl Into<String>) -> Self {
        Self {
            revision,
            domains,
            reason: reason.into(),
            extra: ExtraFields::new(),
        }
    }

    pub fn validate(&self) -> Result<(), ContractError> {
        non_empty(&self.reason, "transaction.event.reason")?;
        if self.domains.iter().any(|domain| domain.trim().is_empty()) {
            return Err(ContractError::Validation(
                "transaction.event.domains contains an empty domain".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonWrite {
    pub relative_path: String,
    pub value: Value,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

impl JsonWrite {
    pub fn new(relative_path: impl Into<String>, value: Value) -> Self {
        Self {
            relative_path: relative_path.into(),
            value,
            extra: ExtraFields::new(),
        }
    }

    pub fn validate(&self) -> Result<(), ContractError> {
        validate_relative_path(&self.relative_path)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevdDataTransaction {
    pub schema: String,
    pub revision: u64,
    #[serde(default)]
    pub writes: Vec<JsonWrite>,
    #[serde(default)]
    pub deletes: Vec<String>,
    pub event: RevisionEvent,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

impl DevdDataTransaction {
    pub fn new(
        revision: u64,
        writes: Vec<JsonWrite>,
        deletes: Vec<String>,
        event: RevisionEvent,
    ) -> Self {
        Self {
            schema: DEVD_DATA_TRANSACTION_SCHEMA.into(),
            revision,
            writes,
            deletes,
            event,
            extra: ExtraFields::new(),
        }
    }

    pub fn validate(&self) -> Result<(), ContractError> {
        expected_schema(&self.schema, DEVD_DATA_TRANSACTION_SCHEMA)?;
        if self.event.revision != self.revision {
            return Err(ContractError::Validation(format!(
                "transaction event revision {} differs from journal revision {}",
                self.event.revision, self.revision
            )));
        }
        self.event.validate()?;
        let mut paths = BTreeSet::new();
        for write in &self.writes {
            write.validate()?;
            if !paths.insert(write.relative_path.clone()) {
                return Err(ContractError::Validation(format!(
                    "transaction contains duplicate write path {}",
                    write.relative_path
                )));
            }
        }
        for path in &self.deletes {
            validate_relative_path(path)?;
            if !paths.insert(path.clone()) {
                return Err(ContractError::Validation(format!(
                    "transaction writes and deletes the same path {path}"
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevdDataState {
    pub schema: String,
    pub revision: u64,
    pub updated_at: String,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

impl DevdDataState {
    pub fn new(revision: u64, updated_at: impl Into<String>) -> Self {
        Self {
            schema: DEVD_DATA_STATE_SCHEMA.into(),
            revision,
            updated_at: updated_at.into(),
            extra: ExtraFields::new(),
        }
    }

    pub fn validate(&self) -> Result<(), ContractError> {
        expected_schema(&self.schema, DEVD_DATA_STATE_SCHEMA)?;
        non_empty(&self.updated_at, "state.updatedAt")
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevdLiveLock {
    pub schema: String,
    pub pid: u32,
    pub token: String,
    pub claimed_at: String,
    pub process_start_identity: Option<String>,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

impl DevdLiveLock {
    pub fn validate(&self) -> Result<(), ContractError> {
        expected_schema(&self.schema, DEVD_LIVE_LOCK_SCHEMA)?;
        if self.pid == 0 {
            return Err(ContractError::Validation(
                "live lock pid must be positive".into(),
            ));
        }
        non_empty(&self.token, "live lock token")?;
        non_empty(&self.claimed_at, "live lock claimedAt")
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevdOwner {
    pub schema: String,
    pub claimed_at: String,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelBinding {
    pub id: String,
    pub template_source: String,
    pub template_id: String,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryMaterial {
    pub id: String,
    pub full_name: String,
    #[serde(default)]
    pub current_quantity: i64,
    #[serde(default)]
    pub matrix_code: Option<String>,
    #[serde(default)]
    pub label_bindings: Vec<LabelBinding>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub archived_at: Option<String>,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryAdjustment {
    pub id: String,
    pub material_id: String,
    pub kind: String,
    #[serde(default)]
    pub quantity_delta: Option<i64>,
    #[serde(default)]
    pub target_quantity: Option<i64>,
    #[serde(default)]
    pub quantity_after: Option<i64>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub actor: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateRecord {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub current_version_id: Option<String>,
    #[serde(default)]
    pub archived_at: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub field_order: Vec<String>,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateVersion {
    pub id: String,
    pub template_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_version_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document: Option<Value>,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingCopyRecord {
    pub source_key: String,
    #[serde(default)]
    pub source: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_version_id: Option<String>,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    #[serde(default)]
    pub schema: String,
    #[serde(default)]
    pub exported_at: String,
    #[serde(default)]
    pub snapshot_updated_at: Option<String>,
    #[serde(default)]
    pub settings: Value,
    #[serde(default)]
    pub templates: Vec<TemplateRecord>,
    #[serde(default)]
    pub versions: Vec<TemplateVersion>,
    #[serde(default)]
    pub working_copies: Vec<WorkingCopyRecord>,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

impl RuntimeSnapshot {
    pub fn validate(&self) -> Result<(), ContractError> {
        expected_schema(&self.schema, RUNTIME_EXPORT_SCHEMA)?;
        non_empty(&self.exported_at, "runtime.exportedAt")
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventorySnapshot {
    #[serde(default)]
    pub materials: Vec<InventoryMaterial>,
    #[serde(default)]
    pub adjustments: Vec<InventoryAdjustment>,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevdDataArchive {
    pub schema: String,
    pub exported_at: String,
    #[serde(default)]
    pub runtime: RuntimeSnapshot,
    #[serde(default)]
    pub inventory: InventorySnapshot,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

impl DevdDataArchive {
    pub fn validate(&self) -> Result<(), ContractError> {
        expected_schema(&self.schema, DEVD_DATA_ARCHIVE_SCHEMA)?;
        non_empty(&self.exported_at, "archive.exportedAt")?;
        self.runtime.validate()?;
        validate_referential_integrity(
            &self.runtime.templates,
            &self.runtime.versions,
            &self.runtime.working_copies,
            &self.inventory.materials,
            &self.inventory.adjustments,
        )
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentImportItemKind {
    New,
    Restock,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentImportTemplate {
    pub source: String,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub fields: Vec<Value>,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentImportItem {
    pub id: String,
    pub kind: AgentImportItemKind,
    #[serde(default = "default_true")]
    pub selected: bool,
    #[serde(default)]
    pub material: Value,
    #[serde(default)]
    pub target_material_id: Option<String>,
    #[serde(default)]
    pub target_material_updated_at: Option<String>,
    #[serde(default)]
    pub quantity: i64,
    #[serde(default)]
    pub source_note: Option<String>,
    #[serde(default)]
    pub template: Option<AgentImportTemplate>,
    #[serde(default)]
    pub template_input: BTreeMap<String, String>,
    #[serde(default)]
    pub pending_template_event_id: Option<String>,
    #[serde(default)]
    pub label_print_quantity: Option<u32>,
    #[serde(default)]
    pub revision: u64,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentImportProposal {
    pub schema: String,
    #[serde(default)]
    pub source_note: Option<String>,
    #[serde(default)]
    pub items: Vec<AgentImportItem>,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

impl AgentImportProposal {
    pub fn validate(&self) -> Result<(), ContractError> {
        expected_schema(&self.schema, "tuckmark.agent-import.v1")?;
        if self.items.is_empty() {
            return Err(ContractError::Validation(
                "agent import proposal must include at least one item".into(),
            ));
        }
        let mut ids = BTreeSet::new();
        for item in &self.items {
            non_empty(&item.id, "agent import item id")?;
            if !ids.insert(item.id.clone()) {
                return Err(ContractError::Validation(format!(
                    "agent import has duplicate item id {}",
                    item.id
                )));
            }
            if item.quantity <= 0 {
                return Err(ContractError::Validation(format!(
                    "agent import item {} must have a positive quantity",
                    item.id
                )));
            }
            validate_agent_import_material(&item.material, &item.id)?;
            if item.kind == AgentImportItemKind::Restock {
                non_empty(
                    item.target_material_id.as_deref().unwrap_or_default(),
                    "agent import restock targetMaterialId",
                )?;
            }
            if item.label_print_quantity == Some(0) {
                return Err(ContractError::Validation(format!(
                    "agent import item {} labelPrintQuantity must be positive",
                    item.id
                )));
            }
            if let Some(template) = &item.template {
                validate_agent_import_template(template)?;
            }
            if item
                .pending_template_event_id
                .as_deref()
                .is_some_and(str::is_empty)
            {
                return Err(ContractError::Validation(format!(
                    "agent import item {} has an empty pending template event id",
                    item.id
                )));
            }
        }
        Ok(())
    }
}

fn validate_agent_import_material(value: &Value, item_id: &str) -> Result<(), ContractError> {
    let material = value.as_object().ok_or_else(|| {
        ContractError::Validation(format!(
            "agent import item {item_id} material must be an object"
        ))
    })?;
    non_empty(
        material
            .get("fullName")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        "agent import material fullName",
    )
}

fn validate_agent_import_template(template: &AgentImportTemplate) -> Result<(), ContractError> {
    if !matches!(template.source.as_str(), "system" | "user-template") {
        return Err(ContractError::Validation(format!(
            "agent import template source {} is invalid",
            template.source
        )));
    }
    non_empty(&template.id, "agent import template id")?;
    non_empty(&template.name, "agent import template name")?;
    for field in &template.fields {
        let object = field.as_object().ok_or_else(|| {
            ContractError::Validation("agent import template field must be an object".into())
        })?;
        non_empty(
            object
                .get("key")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            "agent import template field key",
        )?;
        non_empty(
            object
                .get("label")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            "agent import template field label",
        )?;
        if object
            .get("required")
            .is_some_and(|required| !required.is_boolean())
        {
            return Err(ContractError::Validation(
                "agent import template field required must be a boolean".into(),
            ));
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentImportSession {
    pub id: String,
    pub state: String,
    pub created_at: String,
    pub expires_at: String,
    pub proposal: AgentImportProposal,
    #[serde(default)]
    pub events: Vec<Value>,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

pub fn validate_relative_path(path: &str) -> Result<(), ContractError> {
    let normalized = path.replace('\\', "/");
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(ContractError::Validation(format!(
            "invalid relative path {path}"
        )));
    }
    Ok(())
}

pub fn validate_referential_integrity(
    templates: &[TemplateRecord],
    versions: &[TemplateVersion],
    working_copies: &[WorkingCopyRecord],
    materials: &[InventoryMaterial],
    adjustments: &[InventoryAdjustment],
) -> Result<(), ContractError> {
    let template_ids: BTreeSet<_> = templates
        .iter()
        .map(|template| template.id.as_str())
        .collect();
    let mut ids = BTreeSet::new();
    for template in templates {
        non_empty(&template.id, "template id")?;
        non_empty(&template.name, "template name")?;
        for (field, value) in [
            ("template width", template.width),
            ("template height", template.height),
        ] {
            if value.is_some_and(|value| !value.is_finite() || value <= 0.0) {
                return Err(ContractError::Validation(format!(
                    "{field} must be positive and finite"
                )));
            }
        }
        if !ids.insert(template.id.as_str()) {
            return Err(ContractError::Validation(format!(
                "duplicate template {}",
                template.id
            )));
        }
    }
    let mut version_ids = BTreeSet::new();
    let mut template_versions = BTreeSet::new();
    for version in versions {
        non_empty(&version.id, "template version id")?;
        non_empty(&version.template_id, "template version templateId")?;
        if !version_ids.insert(version.id.as_str()) {
            return Err(ContractError::Validation(format!(
                "duplicate template version {}",
                version.id
            )));
        }
        if !template_ids.contains(version.template_id.as_str()) {
            return Err(ContractError::Validation(format!(
                "template version {} references unknown template {}",
                version.id, version.template_id
            )));
        }
        if let Some(number) = version.version {
            if number == 0 {
                return Err(ContractError::Validation(format!(
                    "template version {} must be positive",
                    version.id
                )));
            }
            if !template_versions.insert((version.template_id.as_str(), number)) {
                return Err(ContractError::Validation(format!(
                    "duplicate template version {}:{}",
                    version.template_id, number
                )));
            }
        }
        if let Some(kind) = version.kind.as_deref()
            && !matches!(kind, "saved" | "autosave")
        {
            return Err(ContractError::Validation(format!(
                "template version {} has invalid kind {kind}",
                version.id
            )));
        }
    }
    for template in templates {
        if let Some(current_version_id) = template.current_version_id.as_deref() {
            let current_version = versions
                .iter()
                .find(|version| version.id == current_version_id);
            if current_version.is_none_or(|version| version.template_id != template.id) {
                return Err(ContractError::Validation(format!(
                    "template {} references unknown current version {}",
                    template.id, current_version_id
                )));
            }
        }
    }
    let mut working_copy_keys = BTreeSet::new();
    for copy in working_copies {
        non_empty(&copy.source_key, "working copy sourceKey")?;
        if !working_copy_keys.insert(copy.source_key.as_str()) {
            return Err(ContractError::Validation(format!(
                "duplicate working copy {}",
                copy.source_key
            )));
        }
        if let Some(template_id) = copy.source_key.strip_prefix("user:")
            && !template_ids.contains(template_id)
        {
            return Err(ContractError::Validation(format!(
                "working copy {} references unknown template {}",
                copy.source_key, template_id
            )));
        }
        if let Some(template_id) = copy.template_id.as_deref()
            && !template_ids.contains(template_id)
        {
            return Err(ContractError::Validation(format!(
                "working copy {} references unknown template {}",
                copy.source_key, template_id
            )));
        }
        if let Some(source) = copy.source.as_ref() {
            let source = source.as_object().ok_or_else(|| {
                ContractError::Validation(format!(
                    "working copy {} source must be an object",
                    copy.source_key
                ))
            })?;
            if source.get("kind").and_then(Value::as_str) == Some("user-template") {
                let source_template_id = source
                    .get("templateId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        ContractError::Validation(format!(
                            "working copy {} has an invalid template source",
                            copy.source_key
                        ))
                    })?;
                if copy.template_id.as_deref() != Some(source_template_id)
                    || !template_ids.contains(source_template_id)
                {
                    return Err(ContractError::Validation(format!(
                        "working copy {} has an invalid template source",
                        copy.source_key
                    )));
                }
            }
        }
    }
    let mut material_ids = BTreeSet::new();
    let mut material_names = BTreeSet::new();
    let mut matrix_codes = BTreeSet::new();
    for material in materials {
        non_empty(&material.id, "material id")?;
        non_empty(&material.full_name, "material fullName")?;
        if !material_ids.insert(material.id.as_str()) {
            return Err(ContractError::Validation(format!(
                "duplicate material {}",
                material.id
            )));
        }
        if !material_names.insert(material.full_name.as_str()) {
            return Err(ContractError::Validation(format!(
                "duplicate material fullName {}",
                material.full_name
            )));
        }
        if let Some(matrix_code) = material
            .matrix_code
            .as_deref()
            .filter(|value| !value.is_empty())
            && !matrix_codes.insert(matrix_code)
        {
            return Err(ContractError::Validation(format!(
                "duplicate matrix code {matrix_code}"
            )));
        }
        for binding in &material.label_bindings {
            if binding.template_source == "user-template"
                && !template_ids.contains(binding.template_id.as_str())
            {
                return Err(ContractError::Validation(format!(
                    "material {} references unknown user template {}",
                    material.id, binding.template_id
                )));
            }
        }
    }
    let mut adjustment_ids = BTreeSet::new();
    for adjustment in adjustments {
        if !adjustment_ids.insert(adjustment.id.as_str()) {
            return Err(ContractError::Validation(format!(
                "duplicate adjustment {}",
                adjustment.id
            )));
        }
        if !material_ids.contains(adjustment.material_id.as_str()) {
            return Err(ContractError::Validation(format!(
                "adjustment {} references unknown material {}",
                adjustment.id, adjustment.material_id
            )));
        }
    }
    Ok(())
}

/// Converts legacy read formats to the canonical, already-existing DEVD v1 archive shape.
/// This only normalizes in-memory values; it never mutates source files or upgrades schemas.
pub fn normalize_legacy_value(value: Value) -> Result<Value, ContractError> {
    let mut object = value.as_object().cloned().ok_or_else(|| {
        ContractError::Validation("persisted contract must be a JSON object".into())
    })?;
    let schema = object
        .get("schema")
        .and_then(Value::as_str)
        .ok_or_else(|| ContractError::Validation("persisted contract schema is missing".into()))?;

    match schema {
        "tuckmark.data-archive.v1" => {
            let exported_at = object
                .get("exportedAt")
                .cloned()
                .unwrap_or_else(|| Value::String(String::new()));
            object.insert(
                "schema".into(),
                Value::String(DEVD_DATA_ARCHIVE_SCHEMA.into()),
            );
            let runtime = object
                .entry("runtime")
                .or_insert_with(|| Value::Object(Default::default()));
            let runtime = runtime.as_object_mut().ok_or_else(|| {
                ContractError::Validation("legacy archive runtime must be an object".into())
            })?;
            runtime
                .entry("schema")
                .or_insert_with(|| Value::String(RUNTIME_EXPORT_SCHEMA.into()));
            runtime.entry("exportedAt").or_insert(exported_at);
            for key in ["templates", "versions", "workingCopies"] {
                runtime.entry(key).or_insert_with(|| Value::Array(vec![]));
            }
            let inventory = object
                .entry("inventory")
                .or_insert_with(|| Value::Object(Default::default()));
            let inventory = inventory.as_object_mut().ok_or_else(|| {
                ContractError::Validation("legacy archive inventory must be an object".into())
            })?;
            for key in ["materials", "adjustments"] {
                inventory.entry(key).or_insert_with(|| Value::Array(vec![]));
            }
        }
        "tuckmark.devd-data-archive.v1" => {}
        _ => {}
    }

    let mut normalized = Value::Object(object);
    normalize_legacy_tree(&mut normalized);
    Ok(canonicalize_json(normalized))
}

fn normalize_legacy_tree(value: &mut Value) {
    match value {
        Value::Array(values) => {
            for value in values {
                normalize_legacy_tree(value);
            }
        }
        Value::Object(object) => {
            normalize_recommended_use(object);
            if object.get("kind").and_then(Value::as_str) == Some("text") {
                normalize_stretch_aliases(object);
            }
            for value in object.values_mut() {
                normalize_legacy_tree(value);
            }
        }
        _ => {}
    }
}

fn normalize_recommended_use(object: &mut serde_json::Map<String, Value>) {
    let current = object
        .get("recommendedUse")
        .and_then(normalize_recommended_value);
    let legacy = object
        .get("recommendedUses")
        .and_then(normalize_recommended_value);
    object.remove("recommendedUses");
    match current.or(legacy) {
        Some(value) => {
            object.insert("recommendedUse".into(), Value::String(value));
        }
        None => {
            object.remove("recommendedUse");
        }
    }
}

fn normalize_recommended_value(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => non_empty_recommended_use(value),
        Value::Object(value) => value
            .get("scope")
            .and_then(Value::as_str)
            .and_then(non_empty_recommended_use),
        Value::Array(values) => {
            let joined = values
                .iter()
                .filter_map(normalize_recommended_value)
                .collect::<Vec<_>>()
                .join("；");
            non_empty_recommended_use(&joined)
        }
        _ => None,
    }
}

fn non_empty_recommended_use(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.into())
}

fn normalize_stretch_aliases(object: &mut serde_json::Map<String, Value>) {
    for (legacy, grow, shrink) in [
        ("stretchX", "stretchXGrow", "stretchXShrink"),
        ("stretchY", "stretchYGrow", "stretchYShrink"),
    ] {
        let Some(value) = object.get(legacy).and_then(Value::as_bool) else {
            continue;
        };
        object.entry(grow).or_insert(Value::Bool(value));
        object.entry(shrink).or_insert(Value::Bool(value));
    }
}
