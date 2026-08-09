use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
    sync::{Arc, Mutex},
};

use serde_json::{Map, Value, json};
use thiserror::Error;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::sync::broadcast;
use tuckmark_contracts::{DevdDataArchive, JsonWrite, RevisionEvent};
use tuckmark_engine::{ArchiveImportMode, DataAuthority, DataAuthorityError, DataAuthorityOptions};
use uuid::Uuid;

const RUNTIME_SCHEMA: &str = "tuckmark.runtime-export.v1";
const DEFAULT_SETTINGS: &str = r#"{
  "version": 2,
  "updatedAt": "1970-01-01T00:00:00.000Z",
  "documentDefaults": {
    "printerDpi": 203,
    "printWidthDots": 384,
    "paperType": "continuous",
    "threshold": 150,
    "xOffsetMm": 0,
    "yOffsetMm": 0,
    "printStrengthLevel": 0
  },
  "printerModelPresets": {},
  "printerDeviceCalibrations": {},
  "permissionNudgeSeen": false,
  "showTextBoundingBoxes": false
}"#;

#[derive(Debug, Error)]
pub enum DataError {
    #[error("Expected revision {expected} but current revision is {actual}.")]
    RevisionConflict { expected: u64, actual: u64 },
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    Unavailable(String),
    #[error("DEVD data authority failed: {0}")]
    Authority(#[from] DataAuthorityError),
    #[error("DEVD JSON failed: {0}")]
    Json(#[from] serde_json::Error),
}

impl DataError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::RevisionConflict { .. } => "revision_conflict",
            Self::NotFound(_) => "not_found",
            Self::Unavailable(_) => "data_directory_unavailable",
            Self::Validation(_) | Self::Authority(_) | Self::Json(_) => "validation_error",
        }
    }
}

#[derive(Clone)]
pub struct DataFacade {
    authority: DataAuthority,
    mutation: Arc<Mutex<()>>,
    events: broadcast::Sender<RevisionEvent>,
}

#[derive(Debug)]
pub struct InventoryPrintSnapshot {
    pub revision: u64,
    pub materials: Vec<Value>,
    pub runtime: Value,
}

impl DataFacade {
    pub fn open(root: impl AsRef<Path>) -> Result<Self, DataError> {
        Self::open_with_options(root, DataAuthorityOptions::default())
    }

    pub fn open_with_options(
        root: impl AsRef<Path>,
        options: DataAuthorityOptions,
    ) -> Result<Self, DataError> {
        let authority = DataAuthority::open_with_options(root, options)?;
        let (events, _) = broadcast::channel(128);
        Ok(Self {
            authority,
            mutation: Arc::new(Mutex::new(())),
            events,
        })
    }

    pub fn authority(&self) -> &DataAuthority {
        &self.authority
    }

    /// A process-local gate shared with adapters that perform multi-file authority work.
    /// Keeping agent-import confirmation behind this gate preserves the snapshot/revision
    /// ordering that the HTTP data facade guarantees for its own read-modify-commit calls.
    pub fn mutation_gate(&self) -> Arc<Mutex<()>> {
        Arc::clone(&self.mutation)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<RevisionEvent> {
        self.events.subscribe()
    }

    /// Publishes a revision committed by another domain facade sharing this authority.
    pub fn publish_event(&self, event: RevisionEvent) {
        let _ = self.events.send(event);
    }

    pub fn status(&self) -> Result<Value, DataError> {
        let _guard = self.lock_mutation()?;
        let revision = self.authority.revision()?;
        let snapshot = self.runtime_snapshot_locked()?;
        let materials = self.materials_locked("", true)?;
        let adjustments = self.adjustments_locked(None)?;
        Ok(json!({
            "configured": true,
            "health": "healthy",
            "directoryName": self.authority.root().file_name().and_then(|name| name.to_str()).unwrap_or(""),
            "revision": revision,
            "counts": {
                "templates": snapshot_array_len(&snapshot, "templates"),
                "versions": snapshot_array_len(&snapshot, "versions"),
                "workingCopies": snapshot_array_len(&snapshot, "workingCopies"),
                "materials": materials.len(),
                "adjustments": adjustments.len(),
            },
        }))
    }

    pub fn read_runtime_snapshot(&self) -> Result<Value, DataError> {
        let _guard = self.lock_mutation()?;
        Ok(json!({
            "revision": self.authority.revision()?,
            "data": self.runtime_snapshot_locked()?,
        }))
    }

    pub fn read_materials(&self, query: &str, include_archived: bool) -> Result<Value, DataError> {
        let _guard = self.lock_mutation()?;
        Ok(json!({
            "revision": self.authority.revision()?,
            "data": self.materials_locked(query, include_archived)?,
        }))
    }

    pub fn read_adjustments(&self, material_id: Option<&str>) -> Result<Value, DataError> {
        let _guard = self.lock_mutation()?;
        Ok(json!({
            "revision": self.authority.revision()?,
            "data": self.adjustments_locked(material_id)?,
        }))
    }

    pub fn read_inventory_print_snapshot(&self) -> Result<InventoryPrintSnapshot, DataError> {
        let _guard = self.lock_mutation()?;
        Ok(InventoryPrintSnapshot {
            revision: self.authority.revision()?,
            materials: self.materials_locked("", true)?,
            runtime: self.runtime_snapshot_locked()?,
        })
    }

    pub fn mutate_runtime(
        &self,
        command: &str,
        expected_revision: u64,
        args: Value,
    ) -> Result<Value, DataError> {
        let _guard = self.lock_mutation()?;
        self.assert_revision(expected_revision)?;
        let snapshot = self.runtime_snapshot_locked()?;
        let materials = self.materials_locked("", true)?;
        let (next, data) = apply_runtime_command(snapshot.clone(), &materials, command, args)?;
        let (writes, deletes) = write_delta(snapshot_writes(&snapshot)?, snapshot_writes(&next)?);
        let domains = if command == "save-settings" {
            vec!["settings".into()]
        } else {
            vec!["templates".into()]
        };
        let event = self.commit(expected_revision, writes, deletes, domains, command)?;
        Ok(json!({ "revision": event.revision, "data": data }))
    }

    pub fn mutate_inventory(
        &self,
        command: &str,
        expected_revision: u64,
        args: Value,
    ) -> Result<Value, DataError> {
        let _guard = self.lock_mutation()?;
        self.assert_revision(expected_revision)?;
        let materials = self.materials_locked("", true)?;
        let adjustments = self.adjustments_locked(None)?;
        let (next_materials, next_adjustments, data) =
            apply_inventory_command(materials.clone(), adjustments.clone(), command, args)?;
        let (writes, deletes) = write_delta(
            inventory_writes(&materials, &adjustments)?,
            inventory_writes(&next_materials, &next_adjustments)?,
        );
        let event = self.commit(
            expected_revision,
            writes,
            deletes,
            vec!["inventory".into()],
            command,
        )?;
        Ok(json!({ "revision": event.revision, "data": data }))
    }

    pub fn read_archive(&self) -> Result<Value, DataError> {
        let _guard = self.lock_mutation()?;
        let revision = self.authority.revision()?;
        let archive = self.authority.export_archive()?;
        Ok(json!({ "revision": revision, "data": archive }))
    }

    pub fn inspect_archive(&self, archive: Value) -> Result<Value, DataError> {
        let _guard = self.lock_mutation()?;
        let archive = serde_json::from_value::<DevdDataArchive>(archive)?;
        let inspection = self.authority.inspect_archive(&archive)?;
        Ok(json!({
            "archiveHash": inspection.archive_hash,
            "summary": {
                "templates": inspection.summary.templates,
                "versions": inspection.summary.versions,
                "workingCopies": inspection.summary.working_copies,
                "materials": inspection.summary.materials,
                "adjustments": inspection.summary.adjustments,
            },
            "conflicts": inspection.conflicts,
        }))
    }

    pub fn import_archive(
        &self,
        expected_revision: u64,
        archive_hash: &str,
        mode: &str,
        archive: Value,
    ) -> Result<Value, DataError> {
        let _guard = self.lock_mutation()?;
        let archive = serde_json::from_value::<DevdDataArchive>(archive)?;
        let mode = match mode {
            "merge" => ArchiveImportMode::Merge,
            "replace" => ArchiveImportMode::Replace,
            _ => {
                return Err(DataError::Validation(
                    "Archive mode must be merge or replace.".into(),
                ));
            }
        };
        let result = self
            .authority
            .import_archive(&archive, archive_hash, mode, expected_revision)
            .map_err(map_authority_error)?;
        let event = RevisionEvent::new(
            result.revision,
            vec!["templates".into(), "inventory".into(), "archive".into()],
            match mode {
                ArchiveImportMode::Merge => "archive-merge",
                ArchiveImportMode::Replace => "archive-replace",
            },
        );
        let _ = self.events.send(event);
        Ok(json!({
            "revision": result.revision,
            "data": {
                "archiveHash": result.inspection.archive_hash,
                "summary": {
                    "templates": result.inspection.summary.templates,
                    "versions": result.inspection.summary.versions,
                    "workingCopies": result.inspection.summary.working_copies,
                    "materials": result.inspection.summary.materials,
                    "adjustments": result.inspection.summary.adjustments,
                },
                "conflicts": result.inspection.conflicts,
            }
        }))
    }

    pub fn create_backup(&self, expected_revision: u64) -> Result<Value, DataError> {
        let _guard = self.lock_mutation()?;
        let backup = self
            .authority
            .create_backup(expected_revision)
            .map_err(map_authority_error)?;
        let event = RevisionEvent::new(backup.revision, vec!["archive".into()], "backup-created");
        let _ = self.events.send(event);
        Ok(json!({ "revision": backup.revision, "data": { "name": backup.name } }))
    }

    fn lock_mutation(&self) -> Result<std::sync::MutexGuard<'_, ()>, DataError> {
        self.mutation
            .lock()
            .map_err(|_| DataError::Unavailable("DEVD mutation queue is poisoned.".into()))
    }

    fn assert_revision(&self, expected: u64) -> Result<(), DataError> {
        let actual = self.authority.revision()?;
        if actual != expected {
            return Err(DataError::RevisionConflict { expected, actual });
        }
        Ok(())
    }

    fn commit(
        &self,
        expected_revision: u64,
        writes: Vec<JsonWrite>,
        deletes: Vec<String>,
        domains: Vec<String>,
        reason: &str,
    ) -> Result<RevisionEvent, DataError> {
        let event = self
            .authority
            .commit(tuckmark_engine::CommitRequest {
                expected_revision,
                writes,
                deletes,
                domains,
                reason: reason.into(),
            })
            .map_err(map_authority_error)?;
        let _ = self.events.send(event.clone());
        Ok(event)
    }

    fn runtime_snapshot_locked(&self) -> Result<Value, DataError> {
        let mut templates = Vec::new();
        let mut versions = Vec::new();
        let mut working_copies = Vec::new();
        for template_id in list_directories(self.authority.root().join("templates"))? {
            if !safe_segment(&template_id) {
                continue;
            }
            let base = format!("templates/{template_id}");
            let Some(template) = self.authority.read_json(&format!("{base}/template.json"))? else {
                continue;
            };
            templates.push(template);
            for path in self
                .authority
                .list_json_files(&format!("{base}/versions"))?
            {
                if let Some(relative) = relative_path(self.authority.root(), &path)
                    && let Some(version) = self.authority.read_json(&relative)?
                {
                    versions.push(version);
                }
            }
            if let Some(working_copy) = self
                .authority
                .read_json(&format!("{base}/working-copy.json"))?
            {
                working_copies.push(working_copy);
            }
        }
        for kind in ["scratch", "preset-template"] {
            for path in self.authority.list_json_files(&format!("drafts/{kind}"))? {
                if let Some(relative) = relative_path(self.authority.root(), &path)
                    && let Some(working_copy) = self.authority.read_json(&relative)?
                {
                    working_copies.push(working_copy);
                }
            }
        }
        if let Some(legacy) = self.authority.read_json("drafts/scratch.json")? {
            working_copies.push(legacy);
        }
        templates.sort_by(value_id_compare);
        versions.sort_by(value_id_compare);
        working_copies.sort_by(value_source_key_compare);
        let settings = self
            .authority
            .read_json("settings/app-settings.json")?
            .unwrap_or_else(default_settings);
        let snapshot_updated_at = timestamps(&settings, &templates, &versions, &working_copies);
        Ok(json!({
            "schema": RUNTIME_SCHEMA,
            "exportedAt": now(),
            "snapshotUpdatedAt": snapshot_updated_at,
            "settings": settings,
            "templates": templates,
            "versions": versions,
            "workingCopies": working_copies,
        }))
    }

    fn materials_locked(
        &self,
        query: &str,
        include_archived: bool,
    ) -> Result<Vec<Value>, DataError> {
        let mut values = self.read_value_directory("inventory/materials")?;
        let query = query.trim().to_ascii_lowercase();
        values.retain(|material| {
            let archived = material
                .get("archivedAt")
                .is_some_and(|value| !value.is_null());
            let matches = query.is_empty()
                || [
                    "fullName",
                    "baseName",
                    "variantName",
                    "packageName",
                    "description",
                    "matrixCode",
                ]
                .into_iter()
                .filter_map(|key| material.get(key).and_then(Value::as_str))
                .any(|value| value.to_ascii_lowercase().contains(&query));
            (include_archived || !archived) && matches
        });
        values.sort_by(|left, right| {
            string_field(left, "fullName")
                .to_ascii_lowercase()
                .cmp(&string_field(right, "fullName").to_ascii_lowercase())
                .then_with(|| string_field(left, "id").cmp(string_field(right, "id")))
        });
        Ok(values)
    }

    fn adjustments_locked(&self, material_id: Option<&str>) -> Result<Vec<Value>, DataError> {
        let mut values = self.read_value_directory("inventory/adjustments")?;
        if let Some(material_id) = material_id {
            values.retain(|value| {
                value.get("materialId").and_then(Value::as_str) == Some(material_id)
            });
        }
        values.sort_by(|left, right| {
            string_field(right, "createdAt")
                .cmp(string_field(left, "createdAt"))
                .then_with(|| string_field(right, "id").cmp(string_field(left, "id")))
        });
        Ok(values)
    }

    fn read_value_directory(&self, directory: &str) -> Result<Vec<Value>, DataError> {
        self.authority
            .list_json_files(directory)?
            .into_iter()
            .filter_map(|path| relative_path(self.authority.root(), &path))
            .map(|relative| {
                self.authority.read_json(&relative)?.ok_or_else(|| {
                    DataError::Unavailable(format!("Managed data file disappeared: {relative}"))
                })
            })
            .collect()
    }
}

fn map_authority_error(error: DataAuthorityError) -> DataError {
    match error {
        DataAuthorityError::RevisionConflict { expected, actual } => {
            DataError::RevisionConflict { expected, actual }
        }
        error => DataError::Authority(error),
    }
}

fn relative_path(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|path| path.to_string_lossy().replace('\\', "/"))
}

fn list_directories(path: impl AsRef<Path>) -> Result<Vec<String>, DataError> {
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(DataError::Authority(error.into())),
    };
    let mut directories = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            entry
                .file_type()
                .ok()
                .filter(|file_type| file_type.is_dir())
                .and_then(|_| entry.file_name().into_string().ok())
        })
        .collect::<Vec<_>>();
    directories.sort();
    Ok(directories)
}

fn default_settings() -> Value {
    serde_json::from_str(DEFAULT_SETTINGS).expect("default settings are valid JSON")
}

fn snapshot_array_len(snapshot: &Value, key: &str) -> usize {
    snapshot
        .get(key)
        .and_then(Value::as_array)
        .map_or(0, Vec::len)
}

fn value_id_compare(left: &Value, right: &Value) -> std::cmp::Ordering {
    string_field(left, "id").cmp(string_field(right, "id"))
}

fn value_source_key_compare(left: &Value, right: &Value) -> std::cmp::Ordering {
    string_field(left, "sourceKey").cmp(string_field(right, "sourceKey"))
}

fn string_field<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}

fn timestamps(
    settings: &Value,
    templates: &[Value],
    versions: &[Value],
    working_copies: &[Value],
) -> Option<String> {
    let mut values = Vec::new();
    if let Some(value) = settings.get("updatedAt").and_then(Value::as_str) {
        values.push(value);
    }
    values.extend(
        templates
            .iter()
            .filter_map(|value| value.get("updatedAt").and_then(Value::as_str)),
    );
    values.extend(
        versions
            .iter()
            .filter_map(|value| value.get("createdAt").and_then(Value::as_str)),
    );
    values.extend(
        working_copies
            .iter()
            .filter_map(|value| value.get("updatedAt").and_then(Value::as_str)),
    );
    values.into_iter().max().map(str::to_owned)
}

fn now() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())
}

fn safe_segment(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn require_object(value: Value, label: &str) -> Result<Map<String, Value>, DataError> {
    value
        .as_object()
        .cloned()
        .ok_or_else(|| DataError::Validation(format!("{label} must be an object.")))
}

fn required_string(object: &Map<String, Value>, key: &str) -> Result<String, DataError> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| DataError::Validation(format!("{key} is required.")))
}

fn optional_string(object: &Map<String, Value>, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn value_array(snapshot: &Value, key: &str) -> Result<Vec<Value>, DataError> {
    snapshot
        .get(key)
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| DataError::Validation(format!("Runtime snapshot {key} must be an array.")))
}

fn snapshot_writes(snapshot: &Value) -> Result<Vec<JsonWrite>, DataError> {
    let settings = snapshot
        .get("settings")
        .cloned()
        .ok_or_else(|| DataError::Validation("Runtime snapshot settings are required.".into()))?;
    let mut writes = vec![JsonWrite::new("settings/app-settings.json", settings)];
    for template in value_array(snapshot, "templates")? {
        let object = require_object(template.clone(), "Template")?;
        let id = required_string(&object, "id")?;
        if !safe_segment(&id) {
            return Err(DataError::Validation("Invalid data identifier.".into()));
        }
        writes.push(JsonWrite::new(
            format!("templates/{id}/template.json"),
            template,
        ));
    }
    for version in value_array(snapshot, "versions")? {
        let object = require_object(version.clone(), "Template version")?;
        let id = required_string(&object, "id")?;
        let template_id = required_string(&object, "templateId")?;
        if !safe_segment(&id) || !safe_segment(&template_id) {
            return Err(DataError::Validation("Invalid data identifier.".into()));
        }
        writes.push(JsonWrite::new(
            format!("templates/{template_id}/versions/{id}.json"),
            version,
        ));
    }
    for working in value_array(snapshot, "workingCopies")? {
        let object = require_object(working.clone(), "Working copy")?;
        let source = object
            .get("source")
            .and_then(Value::as_object)
            .ok_or_else(|| DataError::Validation("Working copy source is required.".into()))?;
        let kind = required_string(source, "kind")?;
        let path = match kind.as_str() {
            "user-template" => {
                let template_id = required_string(source, "templateId")?;
                if !safe_segment(&template_id) {
                    return Err(DataError::Validation("Invalid data identifier.".into()));
                }
                format!("templates/{template_id}/working-copy.json")
            }
            "scratch" | "preset-template" => {
                let preset_id = required_string(source, "presetId")?;
                if !safe_segment(&preset_id) {
                    return Err(DataError::Validation("Invalid data identifier.".into()));
                }
                format!("drafts/{kind}/{preset_id}.json")
            }
            _ => {
                return Err(DataError::Validation(
                    "Working copy source kind is invalid.".into(),
                ));
            }
        };
        writes.push(JsonWrite::new(path, working));
    }
    writes.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(writes)
}

fn inventory_writes(
    materials: &[Value],
    adjustments: &[Value],
) -> Result<Vec<JsonWrite>, DataError> {
    let mut writes = Vec::new();
    for material in materials {
        let object = require_object(material.clone(), "Material")?;
        let id = required_string(&object, "id")?;
        if !safe_segment(&id) {
            return Err(DataError::Validation("Invalid data identifier.".into()));
        }
        writes.push(JsonWrite::new(
            format!("inventory/materials/{id}.json"),
            material.clone(),
        ));
    }
    for adjustment in adjustments {
        let object = require_object(adjustment.clone(), "Adjustment")?;
        let id = required_string(&object, "id")?;
        if !safe_segment(&id) {
            return Err(DataError::Validation("Invalid data identifier.".into()));
        }
        writes.push(JsonWrite::new(
            format!("inventory/adjustments/{id}.json"),
            adjustment.clone(),
        ));
    }
    writes.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(writes)
}

fn write_delta(current: Vec<JsonWrite>, next: Vec<JsonWrite>) -> (Vec<JsonWrite>, Vec<String>) {
    let current = current
        .into_iter()
        .map(|write| (write.relative_path.clone(), write.value))
        .collect::<BTreeMap<_, _>>();
    let next = next
        .into_iter()
        .map(|write| (write.relative_path.clone(), write.value))
        .collect::<BTreeMap<_, _>>();
    let writes = next
        .iter()
        .filter(|(path, value)| current.get(*path) != Some(*value))
        .map(|(path, value)| JsonWrite::new(path, value.clone()))
        .collect();
    let deletes = current
        .keys()
        .filter(|path| !next.contains_key(*path))
        .cloned()
        .collect();
    (writes, deletes)
}

fn apply_runtime_command(
    snapshot: Value,
    materials: &[Value],
    command: &str,
    args: Value,
) -> Result<(Value, Value), DataError> {
    let args = require_object(args, "Runtime command arguments")?;
    if command == "replace-snapshot" {
        let replacement = args
            .get("snapshot")
            .cloned()
            .ok_or_else(|| DataError::Validation("snapshot is required.".into()))?;
        validate_runtime_snapshot(&replacement)?;
        return Ok((replacement, Value::Null));
    }

    let mut snapshot = require_object(snapshot, "Runtime snapshot")?;
    let mut templates = value_array(&Value::Object(snapshot.clone()), "templates")?;
    let mut versions = value_array(&Value::Object(snapshot.clone()), "versions")?;
    let mut working_copies = value_array(&Value::Object(snapshot.clone()), "workingCopies")?;
    let timestamp = now();
    let mut data = Value::Null;

    match command {
        "save-template" => {
            let name = required_string(&args, "name")?;
            let template_id = optional_string(&args, "templateId")
                .unwrap_or_else(|| format!("user-template-{}", Uuid::new_v4()));
            if !safe_segment(&template_id) {
                return Err(DataError::Validation("Invalid data identifier.".into()));
            }
            let document = args
                .get("document")
                .cloned()
                .ok_or_else(|| DataError::Validation("document is required.".into()))?;
            let mut document = require_object(document, "document")?;
            let width = positive_number(&document, "width")?;
            let height = positive_number(&document, "height")?;
            let existing_index = templates
                .iter()
                .position(|template| string_field(template, "id") == template_id);
            let existing = existing_index
                .and_then(|index| templates.get(index))
                .cloned();
            let next_version = versions
                .iter()
                .filter(|version| string_field(version, "templateId") == template_id)
                .filter_map(|version| version.get("version").and_then(Value::as_u64))
                .max()
                .unwrap_or(0)
                + 1;
            let version_id = format!("user-template-version-{}", Uuid::new_v4());
            document.insert("templateId".into(), Value::String(template_id.clone()));
            document.insert(
                "source".into(),
                json!({ "kind": "user-template", "templateId": template_id }),
            );
            document.remove("baseVersionId");
            document.insert("lastSavedAt".into(), Value::String(timestamp.clone()));
            document.insert("name".into(), Value::String(name.clone()));
            let document = Value::Object(document);
            let version = json!({
                "id": version_id,
                "templateId": template_id,
                "version": next_version,
                "kind": "saved",
                "createdAt": timestamp,
                "label": format!("已保存版本 {next_version}"),
                "sourceVersionId": args.get("sourceVersionId").cloned().unwrap_or(Value::Null),
                "document": document,
            });
            versions.push(version.clone());
            versions.retain(|candidate| {
                !(string_field(candidate, "templateId") == template_id
                    && candidate.get("kind").and_then(Value::as_str) == Some("autosave"))
            });
            prune_versions(&mut versions, &template_id, "saved", 20);
            let mut template = existing
                .as_ref()
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            template.insert("id".into(), Value::String(template_id.clone()));
            template.insert("name".into(), Value::String(name));
            template.insert(
                "description".into(),
                args.get("description")
                    .and_then(Value::as_str)
                    .map(|value| Value::String(value.to_owned()))
                    .or_else(|| template.get("description").cloned())
                    .unwrap_or_else(|| Value::String(String::new())),
            );
            template.insert("width".into(), json!(width));
            template.insert("height".into(), json!(height));
            template
                .entry("createdAt")
                .or_insert_with(|| Value::String(now()));
            template.insert("updatedAt".into(), Value::String(now()));
            template.entry("archivedAt").or_insert(Value::Null);
            template.insert("currentVersionId".into(), Value::String(version_id));
            template.insert(
                "fieldOrder".into(),
                Value::Array(
                    document_fields(&version)
                        .iter()
                        .filter_map(|field| field.get("key").and_then(Value::as_str))
                        .map(|key| Value::String(key.to_owned()))
                        .collect(),
                ),
            );
            if document_has_recommended_use(&version) {
                if let Some(recommended_use) = document_recommended_use(&version) {
                    template.insert("recommendedUse".into(), Value::String(recommended_use));
                } else {
                    template.remove("recommendedUse");
                }
            }
            let template = Value::Object(template);
            match existing_index {
                Some(index) => templates[index] = template.clone(),
                None => templates.push(template.clone()),
            }
            let working_copy = json!({
                "sourceKey": format!("user:{template_id}"),
                "source": { "kind": "user-template", "templateId": template_id },
                "templateId": template_id,
                "draft": version.get("document").cloned().unwrap_or(Value::Null),
                "updatedAt": timestamp,
                "baseVersionId": version.get("id").cloned().unwrap_or(Value::Null),
            });
            upsert_by_key(&mut working_copies, "sourceKey", working_copy.clone());
            data = json!({
                "template": template_summary(&template, &versions, &working_copies),
                "version": version,
                "workingCopy": working_copy,
            });
        }
        "update-template-metadata" => {
            let template_id = required_string(&args, "templateId")?;
            let patch = args
                .get("patch")
                .and_then(Value::as_object)
                .ok_or_else(|| DataError::Validation("patch is required.".into()))?;
            if patch.is_empty() {
                return Err(DataError::Validation(
                    "Template metadata patch is empty.".into(),
                ));
            }
            let template = find_by_id_mut(&mut templates, &template_id)
                .ok_or_else(|| DataError::NotFound("Template was not found.".into()))?;
            let object = template
                .as_object_mut()
                .ok_or_else(|| DataError::Validation("Template is invalid.".into()))?;
            if let Some(name) = patch.get("name").and_then(Value::as_str) {
                if name.trim().is_empty() {
                    return Err(DataError::Validation("name is required.".into()));
                }
                object.insert("name".into(), Value::String(name.trim().into()));
            }
            if let Some(description) = patch.get("description").and_then(Value::as_str) {
                object.insert(
                    "description".into(),
                    Value::String(description.trim().into()),
                );
            }
            if let Some(recommended_use) = patch.get("recommendedUse").and_then(Value::as_str) {
                if recommended_use.trim().is_empty() {
                    object.remove("recommendedUse");
                } else {
                    object.insert(
                        "recommendedUse".into(),
                        Value::String(recommended_use.trim().into()),
                    );
                }
            }
            object.insert("updatedAt".into(), Value::String(now()));
            update_working_copy_metadata(&mut working_copies, &template_id, patch);
            data = template_summary(template, &versions, &working_copies);
        }
        "rename-template" => {
            let template_id = required_string(&args, "templateId")?;
            let name = required_string(&args, "name")?;
            let template = find_by_id_mut(&mut templates, &template_id)
                .ok_or_else(|| DataError::NotFound("Template was not found.".into()))?;
            let object = template
                .as_object_mut()
                .ok_or_else(|| DataError::Validation("Template is invalid.".into()))?;
            object.insert("name".into(), Value::String(name.clone()));
            object.insert("updatedAt".into(), Value::String(now()));
            update_working_copy_name(&mut working_copies, &template_id, &name);
            data = template_summary(template, &versions, &working_copies);
        }
        "archive-template" | "restore-template" => {
            let template_id = required_string(&args, "templateId")?;
            let template = find_by_id_mut(&mut templates, &template_id)
                .ok_or_else(|| DataError::NotFound("Template was not found.".into()))?;
            let object = template
                .as_object_mut()
                .ok_or_else(|| DataError::Validation("Template is invalid.".into()))?;
            object.insert(
                "archivedAt".into(),
                if command == "archive-template" {
                    Value::String(now())
                } else {
                    Value::Null
                },
            );
            object.insert("updatedAt".into(), Value::String(now()));
            data = template_summary(template, &versions, &working_copies);
        }
        "purge-template" => {
            let template_id = required_string(&args, "templateId")?;
            if materials.iter().any(|material| {
                material
                    .get("labelBindings")
                    .and_then(Value::as_array)
                    .is_some_and(|bindings| {
                        bindings.iter().any(|binding| {
                            binding.get("templateSource").and_then(Value::as_str)
                                == Some("user-template")
                                && binding.get("templateId").and_then(Value::as_str)
                                    == Some(&template_id)
                        })
                    })
            }) {
                return Err(DataError::Validation(
                    "Template is still referenced by an inventory material.".into(),
                ));
            }
            let previous_len = templates.len();
            templates.retain(|template| string_field(template, "id") != template_id);
            if templates.len() == previous_len {
                return Err(DataError::NotFound("Template was not found.".into()));
            }
            versions.retain(|version| string_field(version, "templateId") != template_id);
            working_copies.retain(|copy| {
                copy.get("templateId").and_then(Value::as_str) != Some(&template_id)
            });
        }
        "save-autosave" | "replace-working-copy" => {
            let source = args
                .get("source")
                .cloned()
                .ok_or_else(|| DataError::Validation("source is required.".into()))?;
            let source = require_object(source, "source")?;
            let source_key = source_key(&source)?;
            let document = args
                .get("document")
                .cloned()
                .ok_or_else(|| DataError::Validation("document is required.".into()))?;
            if !document.is_object() {
                return Err(DataError::Validation("document must be an object.".into()));
            }
            let template_id = optional_string(&args, "templateId");
            let working_copy = json!({
                "sourceKey": source_key,
                "source": source,
                "templateId": template_id,
                "draft": document,
                "updatedAt": timestamp,
                "baseVersionId": args.get("sourceVersionId").cloned().unwrap_or(Value::Null),
            });
            upsert_by_key(&mut working_copies, "sourceKey", working_copy.clone());
            if command == "save-autosave"
                && let Some(template_id) = template_id
                && should_create_autosave(&versions, &template_id, &timestamp)
            {
                let version_number = versions
                    .iter()
                    .filter(|version| string_field(version, "templateId") == template_id)
                    .filter_map(|version| version.get("version").and_then(Value::as_u64))
                    .max()
                    .unwrap_or(0)
                    + 1;
                versions.push(json!({
                    "id": format!("user-template-autosave-{}", Uuid::new_v4()),
                    "templateId": template_id,
                    "version": version_number,
                    "kind": "autosave",
                    "createdAt": timestamp.clone(),
                    "label": "未保存草稿",
                    "sourceVersionId": args.get("sourceVersionId").cloned().unwrap_or(Value::Null),
                    "document": working_copy.get("draft").cloned().unwrap_or(Value::Null),
                }));
                prune_versions(&mut versions, &template_id, "autosave", 10);
            }
            data = working_copy;
        }
        "clear-working-copy" => {
            let source = args
                .get("source")
                .and_then(Value::as_object)
                .ok_or_else(|| DataError::Validation("source is required.".into()))?;
            let source_key = source_key(source)?;
            working_copies.retain(|copy| string_field(copy, "sourceKey") != source_key);
        }
        "clear-template-autosaves" => {
            let template_id = required_string(&args, "templateId")?;
            versions.retain(|version| {
                !(string_field(version, "templateId") == template_id
                    && version.get("kind").and_then(Value::as_str) == Some("autosave"))
            });
        }
        "save-settings" => {
            let patch = args
                .get("patch")
                .and_then(Value::as_object)
                .ok_or_else(|| DataError::Validation("patch is required.".into()))?;
            let settings = snapshot
                .entry("settings")
                .or_insert_with(default_settings)
                .as_object_mut()
                .ok_or_else(|| DataError::Validation("settings must be an object.".into()))?;
            for (key, value) in patch {
                settings.insert(key.clone(), value.clone());
            }
            settings.insert("version".into(), json!(2));
            settings.insert("updatedAt".into(), Value::String(now()));
            data = Value::Object(settings.clone());
        }
        _ => {
            return Err(DataError::Validation(
                "Unknown DEVD runtime command.".into(),
            ));
        }
    }

    snapshot.insert("templates".into(), Value::Array(templates));
    snapshot.insert("versions".into(), Value::Array(versions));
    snapshot.insert("workingCopies".into(), Value::Array(working_copies));
    snapshot.insert("schema".into(), Value::String(RUNTIME_SCHEMA.into()));
    snapshot.insert("exportedAt".into(), Value::String(now()));
    snapshot.insert(
        "snapshotUpdatedAt".into(),
        timestamps(
            snapshot.get("settings").unwrap_or(&Value::Null),
            snapshot
                .get("templates")
                .and_then(Value::as_array)
                .map_or(&[], Vec::as_slice),
            snapshot
                .get("versions")
                .and_then(Value::as_array)
                .map_or(&[], Vec::as_slice),
            snapshot
                .get("workingCopies")
                .and_then(Value::as_array)
                .map_or(&[], Vec::as_slice),
        )
        .map(Value::String)
        .unwrap_or(Value::Null),
    );
    Ok((Value::Object(snapshot), data))
}

fn apply_inventory_command(
    current_materials: Vec<Value>,
    current_adjustments: Vec<Value>,
    command: &str,
    args: Value,
) -> Result<(Vec<Value>, Vec<Value>, Value), DataError> {
    let args = require_object(args, "Inventory command arguments")?;
    let mut materials = current_materials;
    let mut adjustments = current_adjustments;
    let id = optional_string(&args, "materialId").or_else(|| optional_string(&args, "id"));
    let existing_index = id.as_deref().and_then(|id| {
        materials
            .iter()
            .position(|material| string_field(material, "id") == id)
    });
    let timestamp = now();
    let mut data = Value::Null;

    match command {
        "save-material" => {
            let full_name = required_string(&args, "fullName")?;
            let material_id = optional_string(&args, "id")
                .or_else(|| {
                    existing_index
                        .and_then(|index| materials.get(index))
                        .map(|value| string_field(value, "id").to_owned())
                })
                .unwrap_or_else(|| format!("inventory-material-{}", Uuid::new_v4()));
            if !safe_segment(&material_id) {
                return Err(DataError::Validation("Invalid data identifier.".into()));
            }
            let mut material = existing_index
                .and_then(|index| materials.get(index))
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            if material
                .get("archivedAt")
                .is_some_and(|value| !value.is_null())
            {
                return Err(DataError::Validation(
                    "Cannot edit an archived material.".into(),
                ));
            }
            material.insert("id".into(), Value::String(material_id.clone()));
            material.insert("fullName".into(), Value::String(full_name));
            for key in [
                "baseName",
                "variantName",
                "packageName",
                "description",
                "deviceDetails",
                "packagingRemark",
            ] {
                if let Some(value) = args.get(key).and_then(Value::as_str) {
                    material.insert(key.into(), Value::String(value.trim().into()));
                }
            }
            match optional_string(&args, "matrixCode") {
                Some(matrix_code) => {
                    material.insert("matrixCode".into(), Value::String(matrix_code));
                }
                None if args.contains_key("matrixCode") => {
                    material.remove("matrixCode");
                }
                None => {}
            }
            if let Some(bindings) = args.get("labelBindings") {
                if !bindings.is_array() {
                    return Err(DataError::Validation(
                        "labelBindings must be an array.".into(),
                    ));
                }
                material.insert("labelBindings".into(), bindings.clone());
            } else {
                material
                    .entry("labelBindings")
                    .or_insert_with(|| Value::Array(Vec::new()));
            }
            material
                .entry("currentQuantity")
                .or_insert_with(|| json!(0));
            material
                .entry("createdAt")
                .or_insert_with(|| Value::String(timestamp.clone()));
            material.entry("archivedAt").or_insert(Value::Null);
            material.insert("updatedAt".into(), Value::String(timestamp));
            let material = Value::Object(material);
            ensure_unique_material(&materials, &material)?;
            match existing_index {
                Some(index) => materials[index] = material.clone(),
                None => materials.push(material.clone()),
            }
            data = material;
        }
        "archive-material" | "restore-material" => {
            let index = existing_index
                .ok_or_else(|| DataError::NotFound("Material was not found.".into()))?;
            let material = materials[index]
                .as_object_mut()
                .ok_or_else(|| DataError::Validation("Material is invalid.".into()))?;
            material.insert(
                "archivedAt".into(),
                if command == "archive-material" {
                    Value::String(timestamp.clone())
                } else {
                    Value::Null
                },
            );
            material.insert("updatedAt".into(), Value::String(timestamp));
            let value = Value::Object(material.clone());
            if command == "restore-material" {
                ensure_unique_material(&materials, &value)?;
            }
            data = value;
        }
        "delete-material" => {
            let index = existing_index
                .ok_or_else(|| DataError::NotFound("Material was not found.".into()))?;
            let material_id = string_field(&materials[index], "id").to_owned();
            if adjustments.iter().any(|adjustment| {
                adjustment.get("materialId").and_then(Value::as_str) == Some(&material_id)
            }) {
                return Err(DataError::Validation(
                    "Materials with adjustment history cannot be deleted.".into(),
                ));
            }
            materials.remove(index);
        }
        "apply-adjustment" => {
            let material_id = required_string(&args, "materialId")?;
            let index = materials
                .iter()
                .position(|material| string_field(material, "id") == material_id)
                .ok_or_else(|| DataError::NotFound("Material was not found.".into()))?;
            if materials[index]
                .get("archivedAt")
                .is_some_and(|value| !value.is_null())
            {
                return Err(DataError::Validation(
                    "Cannot adjust an archived material.".into(),
                ));
            }
            let input = args
                .get("input")
                .and_then(Value::as_object)
                .ok_or_else(|| DataError::Validation("input is required.".into()))?;
            let kind = required_string(input, "kind")?;
            let quantity_before = integer_field(&materials[index], "currentQuantity").unwrap_or(0);
            let (quantity_after, quantity_delta, target_quantity) = match kind.as_str() {
                "in" => {
                    let quantity = positive_integer(input, "quantity")?;
                    (quantity_before.saturating_add(quantity), quantity, None)
                }
                "out" => {
                    let quantity = positive_integer(input, "quantity")?;
                    if quantity > quantity_before {
                        return Err(DataError::Validation(
                            "Stock cannot become negative.".into(),
                        ));
                    }
                    (quantity_before - quantity, -quantity, None)
                }
                "correction" => {
                    let target = non_negative_integer(input, "targetQuantity")?;
                    (target, target - quantity_before, Some(target))
                }
                _ => return Err(DataError::Validation("Adjustment kind is invalid.".into())),
            };
            let material = materials[index]
                .as_object_mut()
                .ok_or_else(|| DataError::Validation("Material is invalid.".into()))?;
            material.insert("currentQuantity".into(), json!(quantity_after));
            material.insert("updatedAt".into(), Value::String(timestamp.clone()));
            let material = Value::Object(material.clone());
            let adjustment = json!({
                "id": format!("inventory-adjustment-{}", Uuid::new_v4()),
                "materialId": material_id,
                "kind": kind,
                "quantityDelta": quantity_delta,
                "targetQuantity": target_quantity,
                "quantityAfter": quantity_after,
                "note": input.get("note").cloned().unwrap_or(Value::Null),
                "actor": input.get("actor").cloned().unwrap_or(Value::Null),
                "createdAt": input.get("createdAt").cloned().unwrap_or_else(|| Value::String(timestamp)),
            });
            adjustments.push(adjustment.clone());
            data = json!({ "material": material, "adjustment": adjustment });
        }
        _ => {
            return Err(DataError::Validation(
                "Unknown DEVD inventory command.".into(),
            ));
        }
    }
    Ok((materials, adjustments, data))
}

fn validate_runtime_snapshot(snapshot: &Value) -> Result<(), DataError> {
    let object = snapshot
        .as_object()
        .ok_or_else(|| DataError::Validation("snapshot must be an object.".into()))?;
    for key in ["templates", "versions", "workingCopies"] {
        if !object.get(key).is_some_and(Value::is_array) {
            return Err(DataError::Validation(format!(
                "snapshot.{key} must be an array."
            )));
        }
    }
    if !object.get("settings").is_some_and(Value::is_object) {
        return Err(DataError::Validation(
            "snapshot.settings must be an object.".into(),
        ));
    }
    let mut template_ids = BTreeSet::new();
    for template in value_array(snapshot, "templates")? {
        let object = require_object(template, "Template")?;
        let id = required_string(&object, "id")?;
        if !safe_segment(&id) || !template_ids.insert(id) {
            return Err(DataError::Validation(
                "Runtime snapshot contains duplicate or invalid template identifiers.".into(),
            ));
        }
    }
    let mut version_ids = BTreeSet::new();
    let mut template_versions = BTreeSet::new();
    for version in value_array(snapshot, "versions")? {
        let object = require_object(version, "Template version")?;
        let id = required_string(&object, "id")?;
        let template_id = required_string(&object, "templateId")?;
        let number = object
            .get("version")
            .and_then(Value::as_u64)
            .ok_or_else(|| DataError::Validation("Template version number is required.".into()))?;
        if !safe_segment(&id)
            || !safe_segment(&template_id)
            || !version_ids.insert(id)
            || !template_versions.insert((template_id, number))
        {
            return Err(DataError::Validation(
                "Runtime snapshot contains duplicate or invalid version identifiers.".into(),
            ));
        }
    }
    let mut source_keys = BTreeSet::new();
    for working_copy in value_array(snapshot, "workingCopies")? {
        let object = require_object(working_copy, "Working copy")?;
        let source_key = required_string(&object, "sourceKey")?;
        if !source_keys.insert(source_key) {
            return Err(DataError::Validation(
                "Runtime snapshot contains duplicate working-copy keys.".into(),
            ));
        }
    }
    Ok(())
}

fn positive_number(object: &Map<String, Value>, key: &str) -> Result<f64, DataError> {
    let value = object
        .get(key)
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
        .ok_or_else(|| DataError::Validation(format!("{key} must be a positive number.")))?;
    Ok(value)
}

fn document_fields(version: &Value) -> Vec<Value> {
    version
        .pointer("/document/fields")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn document_recommended_use(version: &Value) -> Option<String> {
    version
        .pointer("/document/recommendedUse")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn document_has_recommended_use(version: &Value) -> bool {
    version
        .pointer("/document")
        .and_then(Value::as_object)
        .is_some_and(|document| document.contains_key("recommendedUse"))
}

fn should_create_autosave(versions: &[Value], template_id: &str, timestamp: &str) -> bool {
    let Ok(timestamp) = OffsetDateTime::parse(timestamp, &Rfc3339) else {
        return true;
    };
    let latest = versions
        .iter()
        .filter(|version| {
            string_field(version, "templateId") == template_id
                && version.get("kind").and_then(Value::as_str) == Some("autosave")
        })
        .filter_map(|version| version.get("createdAt").and_then(Value::as_str))
        .filter_map(|created_at| OffsetDateTime::parse(created_at, &Rfc3339).ok())
        .max();
    latest.is_none_or(|latest| timestamp - latest >= time::Duration::minutes(5))
}

fn upsert_by_key(values: &mut Vec<Value>, key: &str, value: Value) {
    if let Some(index) = values
        .iter()
        .position(|candidate| candidate.get(key) == value.get(key))
    {
        values[index] = value;
    } else {
        values.push(value);
    }
}

fn template_summary(template: &Value, versions: &[Value], working_copies: &[Value]) -> Value {
    let mut value = template.clone();
    let template_id = string_field(template, "id");
    let working_copy = working_copies
        .iter()
        .find(|copy| string_field(copy, "sourceKey") == format!("user:{template_id}"));
    let current_version = template
        .get("currentVersionId")
        .and_then(Value::as_str)
        .and_then(|id| {
            versions
                .iter()
                .find(|version| string_field(version, "id") == id)
        });
    let document = working_copy
        .and_then(|copy| copy.get("draft"))
        .or_else(|| current_version.and_then(|version| version.get("document")))
        .cloned()
        .unwrap_or(Value::Null);
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "fields".into(),
            document
                .get("fields")
                .cloned()
                .unwrap_or_else(|| Value::Array(Vec::new())),
        );
        object.insert("document".into(), document);
    }
    value
}

fn find_by_id_mut<'a>(values: &'a mut [Value], id: &str) -> Option<&'a mut Value> {
    values
        .iter_mut()
        .find(|value| string_field(value, "id") == id)
}

fn update_working_copy_metadata(
    working_copies: &mut [Value],
    template_id: &str,
    patch: &Map<String, Value>,
) {
    let Some(working_copy) = working_copies
        .iter_mut()
        .find(|copy| string_field(copy, "sourceKey") == format!("user:{template_id}"))
    else {
        return;
    };
    let Some(draft) = working_copy.get_mut("draft").and_then(Value::as_object_mut) else {
        return;
    };
    for key in ["name", "description", "recommendedUse"] {
        if let Some(value) = patch.get(key) {
            if key == "recommendedUse"
                && value.as_str().is_some_and(|value| value.trim().is_empty())
            {
                draft.remove(key);
            } else {
                draft.insert(key.into(), value.clone());
            }
        }
    }
    if let Some(object) = working_copy.as_object_mut() {
        object.insert("updatedAt".into(), Value::String(now()));
    }
}

fn update_working_copy_name(working_copies: &mut [Value], template_id: &str, name: &str) {
    let patch = Map::from_iter([(String::from("name"), Value::String(name.to_owned()))]);
    update_working_copy_metadata(working_copies, template_id, &patch);
}

fn prune_versions(versions: &mut Vec<Value>, template_id: &str, kind: &str, maximum: usize) {
    let mut candidates = versions
        .iter()
        .enumerate()
        .filter(|(_, version)| {
            string_field(version, "templateId") == template_id
                && version.get("kind").and_then(Value::as_str) == Some(kind)
        })
        .map(|(index, version)| (index, string_field(version, "createdAt").to_owned()))
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| left.1.cmp(&right.1));
    let remove = candidates.len().saturating_sub(maximum);
    let indices = candidates
        .into_iter()
        .take(remove)
        .map(|(index, _)| index)
        .collect::<BTreeSet<_>>();
    if !indices.is_empty() {
        let mut position = 0;
        versions.retain(|_| {
            let keep = !indices.contains(&position);
            position += 1;
            keep
        });
    }
}

fn source_key(source: &Map<String, Value>) -> Result<String, DataError> {
    match required_string(source, "kind")?.as_str() {
        "user-template" => Ok(format!("user:{}", required_string(source, "templateId")?)),
        "preset-template" => Ok(format!("preset:{}", required_string(source, "presetId")?)),
        "scratch" => Ok(format!("scratch:{}", required_string(source, "presetId")?)),
        _ => Err(DataError::Validation(
            "Working copy source kind is invalid.".into(),
        )),
    }
}

fn ensure_unique_material(materials: &[Value], draft: &Value) -> Result<(), DataError> {
    let id = string_field(draft, "id");
    let full_name = string_field(draft, "fullName");
    if materials.iter().any(|material| {
        string_field(material, "id") != id && string_field(material, "fullName") == full_name
    }) {
        return Err(DataError::Validation(format!(
            "Material model {full_name} already exists."
        )));
    }
    if let Some(matrix_code) = draft
        .get("matrixCode")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        && materials.iter().any(|material| {
            string_field(material, "id") != id
                && material.get("matrixCode").and_then(Value::as_str) == Some(matrix_code)
        })
    {
        return Err(DataError::Validation(format!(
            "Matrix code {matrix_code} is already in use."
        )));
    }
    Ok(())
}

fn integer_field(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(Value::as_i64)
}

fn positive_integer(object: &Map<String, Value>, key: &str) -> Result<i64, DataError> {
    let value = object
        .get(key)
        .and_then(Value::as_i64)
        .filter(|value| *value > 0)
        .ok_or_else(|| DataError::Validation(format!("{key} must be a positive integer.")))?;
    Ok(value)
}

fn non_negative_integer(object: &Map<String, Value>, key: &str) -> Result<i64, DataError> {
    let value = object
        .get(key)
        .and_then(Value::as_i64)
        .filter(|value| *value >= 0)
        .ok_or_else(|| DataError::Validation(format!("{key} must be a non-negative integer.")))?;
    Ok(value)
}
