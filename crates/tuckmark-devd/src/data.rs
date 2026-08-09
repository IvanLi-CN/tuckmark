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
use tuckmark_contracts::{
    DEVD_DATA_ARCHIVE_SCHEMA, DevdDataArchive, JsonWrite, RevisionEvent, normalize_legacy_value,
};
use tuckmark_engine::{ArchiveImportMode, DataAuthority, DataAuthorityError, DataAuthorityOptions};
use uuid::Uuid;

const RUNTIME_SCHEMA: &str = "tuckmark.runtime-export.v1";
#[derive(Clone, Copy, Eq, PartialEq)]
enum ArchiveNormalizationSource {
    Incoming,
    Persisted,
}

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
        let archive = self.archive_locked()?;
        Ok(json!({ "revision": revision, "data": archive }))
    }

    pub fn inspect_archive(&self, archive: Value) -> Result<Value, DataError> {
        let _guard = self.lock_mutation()?;
        let archive = parse_data_archive(archive, ArchiveNormalizationSource::Incoming)?;
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
        let archive = parse_data_archive(archive, ArchiveNormalizationSource::Incoming)?;
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

    fn archive_locked(&self) -> Result<Value, DataError> {
        // Keep the authority's single-lock archive snapshot while applying the
        // same persisted-data canonicalization used by the archive endpoints.
        let archive = serde_json::to_value(self.authority.export_archive()?)?;
        canonicalize_data_archive(archive, ArchiveNormalizationSource::Persisted)
    }

    fn materials_locked(
        &self,
        query: &str,
        include_archived: bool,
    ) -> Result<Vec<Value>, DataError> {
        let mut values = self
            .read_value_directory("inventory/materials")?
            .into_iter()
            .map(normalize_persisted_inventory_material)
            .collect::<Result<Vec<_>, _>>()?;
        let query = query.trim().to_ascii_lowercase();
        values.retain(|material| {
            let archived = material_is_archived(material);
            let matches = query.is_empty()
                || [
                    "fullName",
                    "baseName",
                    "variantName",
                    "packageName",
                    "description",
                    "deviceDetails",
                    "matrixCode",
                    "packagingRemark",
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
        let mut values = self
            .read_value_directory("inventory/adjustments")?
            .into_iter()
            .map(normalize_persisted_inventory_adjustment)
            .collect::<Result<Vec<_>, _>>()?;
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

fn material_is_archived(material: &Value) -> bool {
    archived_at_has_timestamp(material.get("archivedAt"))
}

fn archived_at_has_timestamp(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty())
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

fn optional_input_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> Result<Option<&'a str>, DataError> {
    match object.get(key) {
        None => Ok(None),
        Some(Value::String(value)) => Ok(Some(value)),
        Some(_) => Err(DataError::Validation(format!("{key} must be a string."))),
    }
}

fn required_input_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a str, DataError> {
    optional_input_string(object, key)?
        .ok_or_else(|| DataError::Validation(format!("{key} is required.")))
}

fn optional_identifier(
    object: &Map<String, Value>,
    key: &str,
) -> Result<Option<String>, DataError> {
    let Some(value) = optional_input_string(object, key)? else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Err(DataError::Validation(format!("{key} is required.")));
    }
    Ok(Some(value.into()))
}

fn adjustment_created_at(input: &Map<String, Value>, fallback: &str) -> Result<String, DataError> {
    match optional_input_string(input, "createdAt")? {
        Some(value) if !value.trim().is_empty() => Ok(value.into()),
        Some(_) | None => Ok(fallback.into()),
    }
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
        let replacement = normalize_runtime_snapshot(replacement)?;
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
            let template_id = optional_identifier(&args, "templateId")?
                .unwrap_or_else(|| format!("user-template-{}", Uuid::new_v4()));
            if !safe_segment(&template_id) {
                return Err(DataError::Validation("Invalid data identifier.".into()));
            }
            let document = args
                .get("document")
                .cloned()
                .ok_or_else(|| DataError::Validation("document is required.".into()))?;
            let mut document = require_object(document, "document")?;
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
            let saved_source = json!({ "kind": "user-template", "templateId": template_id });
            let source_version_id = optional_identifier(&args, "sourceVersionId")?;
            let has_explicit_recommended_use = document.contains_key("recommendedUse");
            document.insert("templateId".into(), Value::String(template_id.clone()));
            document.remove("baseVersionId");
            document.insert("lastSavedAt".into(), Value::String(timestamp.clone()));
            document.insert("name".into(), Value::String(name.clone()));
            let document = normalize_canvas_document(Value::Object(document), "document")?;
            let mut document = require_object(document, "document")?;
            document.insert("source".into(), saved_source);
            let document = Value::Object(document);
            let document_object = require_object(document.clone(), "document")?;
            let width = positive_number(&document_object, "width")?;
            let height = positive_number(&document_object, "height")?;
            let mut version = json!({
                "id": version_id,
                "templateId": template_id,
                "version": next_version,
                "kind": "saved",
                "createdAt": timestamp,
                "label": format!("已保存版本 {next_version}"),
                "document": document,
            });
            if let Some(source_version_id) = source_version_id {
                version
                    .as_object_mut()
                    .unwrap()
                    .insert("sourceVersionId".into(), Value::String(source_version_id));
            }
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
                optional_input_string(&args, "description")?
                    .map(|value| Value::String(value.into()))
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
            if has_explicit_recommended_use || document_has_recommended_use(&version) {
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
            let patch = normalize_template_metadata_patch(&args)?;
            let template = find_by_id_mut(&mut templates, &template_id)
                .ok_or_else(|| DataError::NotFound("Template was not found.".into()))?;
            let object = template
                .as_object_mut()
                .ok_or_else(|| DataError::Validation("Template is invalid.".into()))?;
            if let Some(name) = patch.get("name").and_then(Value::as_str) {
                object.insert("name".into(), Value::String(name.into()));
            }
            if let Some(description) = patch.get("description").and_then(Value::as_str) {
                object.insert("description".into(), Value::String(description.into()));
            }
            if let Some(recommended_use) = patch.get("recommendedUse").and_then(Value::as_str) {
                if recommended_use.is_empty() {
                    object.remove("recommendedUse");
                } else {
                    object.insert(
                        "recommendedUse".into(),
                        Value::String(recommended_use.into()),
                    );
                }
            }
            object.insert("updatedAt".into(), Value::String(now()));
            update_working_copy_metadata(&mut working_copies, &template_id, &patch);
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
            let mut source = require_object(source, "source")?;
            normalize_canvas_source(&mut source);
            let source_key = source_key(&source)?;
            let document = args
                .get("document")
                .cloned()
                .ok_or_else(|| DataError::Validation("document is required.".into()))?;
            let document = normalize_canvas_document(document, "document")?;
            let template_id = optional_identifier(&args, "templateId")?;
            let source_version_id = optional_identifier(&args, "sourceVersionId")?;
            let mut working_copy = json!({
                "sourceKey": source_key,
                "source": source,
                "draft": document,
                "updatedAt": timestamp,
            });
            let working_copy_object = working_copy.as_object_mut().unwrap();
            if let Some(template_id) = template_id.as_ref() {
                working_copy_object.insert("templateId".into(), Value::String(template_id.clone()));
            }
            if let Some(source_version_id) = source_version_id.as_ref() {
                working_copy_object.insert(
                    "baseVersionId".into(),
                    Value::String(source_version_id.clone()),
                );
            }
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
                let mut version = json!({
                    "id": format!("user-template-autosave-{}", Uuid::new_v4()),
                    "templateId": template_id,
                    "version": version_number,
                    "kind": "autosave",
                    "createdAt": timestamp.clone(),
                    "label": "未保存草稿",
                    "document": working_copy.get("draft").cloned().unwrap_or(Value::Null),
                });
                if let Some(source_version_id) = source_version_id {
                    version
                        .as_object_mut()
                        .unwrap()
                        .insert("sourceVersionId".into(), Value::String(source_version_id));
                }
                versions.push(version);
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
    let id = if command == "save-material" {
        optional_identifier(&args, "id")?
    } else {
        optional_identifier(&args, "materialId")?.or(optional_identifier(&args, "id")?)
    };
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
            let material_id = optional_identifier(&args, "id")?
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
            if archived_at_has_timestamp(material.get("archivedAt")) {
                return Err(DataError::Validation(
                    "Cannot edit an archived material.".into(),
                ));
            }
            material.insert("id".into(), Value::String(material_id.clone()));
            material.insert("fullName".into(), Value::String(full_name));
            for key in ["baseName", "variantName", "packageName"] {
                match optional_input_string(&args, key)?
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                {
                    Some(value) => {
                        material.insert(key.into(), Value::String(value.into()));
                    }
                    None => {
                        material.remove(key);
                    }
                }
            }
            let description = optional_input_string(&args, "description")?
                .map(|value| value.trim().to_owned())
                .unwrap_or_default();
            material.insert("description".into(), Value::String(description));
            let device_details = optional_input_string(&args, "deviceDetails")?
                .map(|value| value.trim().to_owned())
                .or_else(|| {
                    material
                        .get("deviceDetails")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .unwrap_or_default();
            material.insert("deviceDetails".into(), Value::String(device_details));
            let packaging_remark = optional_input_string(&args, "packagingRemark")?
                .map(|value| value.trim().to_owned())
                .unwrap_or_default();
            material.insert("packagingRemark".into(), Value::String(packaging_remark));
            match optional_input_string(&args, "matrixCode")?
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
            {
                Some(matrix_code) => {
                    material.insert("matrixCode".into(), Value::String(matrix_code.into()));
                }
                None => {
                    material.remove("matrixCode");
                }
            }
            let bindings = args
                .get("labelBindings")
                .cloned()
                .or_else(|| material.get("labelBindings").cloned())
                .unwrap_or_else(|| Value::Array(Vec::new()));
            material.insert("labelBindings".into(), normalize_label_bindings(bindings)?);
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
            if material_is_archived(&materials[index]) {
                return Err(DataError::Validation(
                    "Cannot adjust an archived material.".into(),
                ));
            }
            let input = args
                .get("input")
                .and_then(Value::as_object)
                .ok_or_else(|| DataError::Validation("input is required.".into()))?;
            let kind = required_input_string(input, "kind")?.to_owned();
            let note = optional_input_string(input, "note")?
                .unwrap_or_default()
                .to_owned();
            let actor = optional_input_string(input, "actor")?.unwrap_or("unknown");
            if actor.is_empty() {
                return Err(DataError::Validation("actor is required.".into()));
            }
            let actor = actor.to_owned();
            let created_at = adjustment_created_at(input, &timestamp)?;
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
            material.insert("updatedAt".into(), Value::String(created_at.clone()));
            let material = Value::Object(material.clone());
            let adjustment = json!({
                "id": format!("inventory-adjustment-{}", Uuid::new_v4()),
                "materialId": material_id,
                "kind": kind,
                "quantityDelta": quantity_delta,
                "targetQuantity": target_quantity,
                "quantityAfter": quantity_after,
                "note": note,
                "actor": actor,
                "createdAt": created_at,
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

fn normalize_persisted_inventory_material(value: Value) -> Result<Value, DataError> {
    let mut material = require_object(value, "Material")?;
    // InventoryMaterial serializes this optional field as null even though the
    // TypeScript schema represents an absent matrix code by omitting it.
    if material.get("matrixCode").is_some_and(Value::is_null) {
        material.remove("matrixCode");
    }
    normalize_inventory_material(Value::Object(material))
}

fn normalize_inventory_material(value: Value) -> Result<Value, DataError> {
    let mut material = require_object(value, "Material")?;
    required_nonempty_string(&material, "id", "Material")?;
    required_nonempty_string(&material, "fullName", "Material")?;

    for key in ["baseName", "variantName", "packageName", "matrixCode"] {
        validate_optional_string_field(&material, key, "Material")?;
    }
    for (key, default) in [
        ("description", ""),
        ("deviceDetails", ""),
        ("packagingRemark", ""),
    ] {
        match material.get(key) {
            None => {
                material.insert(key.into(), Value::String(default.into()));
            }
            Some(Value::String(_)) => {}
            Some(_) => {
                return Err(DataError::Validation(format!(
                    "Material {key} must be a string."
                )));
            }
        }
    }

    let current_quantity = match material.get("currentQuantity") {
        Some(value) => non_negative_i64(value, "Material currentQuantity")?,
        None => 0,
    };
    material.insert("currentQuantity".into(), json!(current_quantity));

    required_nonempty_string(&material, "createdAt", "Material")?;
    required_nonempty_string(&material, "updatedAt", "Material")?;
    if material
        .get("archivedAt")
        .is_some_and(|value| !value.is_null() && !value.is_string())
    {
        return Err(DataError::Validation(
            "Material archivedAt must be a string or null.".into(),
        ));
    }

    let bindings = material
        .get("labelBindings")
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    material.insert("labelBindings".into(), normalize_label_bindings(bindings)?);
    Ok(Value::Object(material))
}

fn normalize_persisted_inventory_adjustment(value: Value) -> Result<Value, DataError> {
    let mut adjustment = require_object(value, "Inventory adjustment")?;
    // InventoryAdjustment likewise emits null for defaulted Option<String>
    // fields, while Zod produces their string defaults during reads.
    for key in ["note", "actor"] {
        if adjustment.get(key).is_some_and(Value::is_null) {
            adjustment.remove(key);
        }
    }
    normalize_inventory_adjustment(Value::Object(adjustment))
}

fn normalize_inventory_adjustment(value: Value) -> Result<Value, DataError> {
    let mut adjustment = require_object(value, "Inventory adjustment")?;
    required_nonempty_string(&adjustment, "id", "Inventory adjustment")?;
    required_nonempty_string(&adjustment, "materialId", "Inventory adjustment")?;
    required_nonempty_string(&adjustment, "createdAt", "Inventory adjustment")?;
    let kind = required_input_string(&adjustment, "kind")?;
    if !matches!(kind, "in" | "out" | "correction") {
        return Err(DataError::Validation(
            "Inventory adjustment kind is invalid.".into(),
        ));
    }

    let quantity_delta = adjustment.get("quantityDelta").ok_or_else(|| {
        DataError::Validation("Inventory adjustment quantityDelta is required.".into())
    })?;
    adjustment.insert(
        "quantityDelta".into(),
        json!(json_i64(
            quantity_delta,
            "Inventory adjustment quantityDelta"
        )?),
    );
    let target_quantity = adjustment.get("targetQuantity").ok_or_else(|| {
        DataError::Validation("Inventory adjustment targetQuantity is required.".into())
    })?;
    if !target_quantity.is_null() {
        adjustment.insert(
            "targetQuantity".into(),
            json!(non_negative_i64(
                target_quantity,
                "Inventory adjustment targetQuantity"
            )?),
        );
    }
    let quantity_after = adjustment.get("quantityAfter").ok_or_else(|| {
        DataError::Validation("Inventory adjustment quantityAfter is required.".into())
    })?;
    adjustment.insert(
        "quantityAfter".into(),
        json!(non_negative_i64(
            quantity_after,
            "Inventory adjustment quantityAfter"
        )?),
    );

    match adjustment.get("note") {
        None => {
            adjustment.insert("note".into(), Value::String(String::new()));
        }
        Some(Value::String(_)) => {}
        Some(_) => {
            return Err(DataError::Validation(
                "Inventory adjustment note must be a string.".into(),
            ));
        }
    }
    match adjustment.get("actor") {
        None => {
            adjustment.insert("actor".into(), Value::String("unknown".into()));
        }
        Some(Value::String(value)) if !value.is_empty() => {}
        Some(Value::String(_)) => {
            return Err(DataError::Validation(
                "Inventory adjustment actor is required.".into(),
            ));
        }
        Some(_) => {
            return Err(DataError::Validation(
                "Inventory adjustment actor must be a string.".into(),
            ));
        }
    }
    adjustment.retain(|key, _| {
        matches!(
            key.as_str(),
            "id" | "materialId"
                | "kind"
                | "quantityDelta"
                | "targetQuantity"
                | "quantityAfter"
                | "note"
                | "actor"
                | "createdAt"
        )
    });
    Ok(Value::Object(adjustment))
}

fn validate_optional_string_field(
    object: &Map<String, Value>,
    key: &str,
    label: &str,
) -> Result<(), DataError> {
    if object.get(key).is_some_and(|value| !value.is_string()) {
        return Err(DataError::Validation(format!(
            "{label} {key} must be a string."
        )));
    }
    Ok(())
}

fn json_i64(value: &Value, label: &str) -> Result<i64, DataError> {
    value
        .as_i64()
        .or_else(|| {
            value
                .as_f64()
                .filter(|value| {
                    value.is_finite()
                        && value.fract() == 0.0
                        && *value >= i64::MIN as f64
                        && *value <= i64::MAX as f64
                })
                .map(|value| value as i64)
        })
        .ok_or_else(|| DataError::Validation(format!("{label} must be an integer.")))
}

fn non_negative_i64(value: &Value, label: &str) -> Result<i64, DataError> {
    let value = json_i64(value, label)?;
    if value < 0 {
        return Err(DataError::Validation(format!(
            "{label} must be a non-negative integer."
        )));
    }
    Ok(value)
}

fn normalize_template_metadata_patch(
    args: &Map<String, Value>,
) -> Result<Map<String, Value>, DataError> {
    let patch = args
        .get("patch")
        .and_then(Value::as_object)
        .ok_or_else(|| DataError::Validation("patch is required.".into()))?;
    if patch.is_empty() {
        return Err(DataError::Validation(
            "Template metadata patch is empty.".into(),
        ));
    }

    let mut normalized = Map::new();
    for (key, value) in patch {
        let value = value
            .as_str()
            .ok_or_else(|| DataError::Validation(format!("patch.{key} must be a string.")))?
            .trim();
        match key.as_str() {
            "name" if value.is_empty() => {
                return Err(DataError::Validation("name is required.".into()));
            }
            "name" | "description" | "recommendedUse" => {
                normalized.insert(key.clone(), Value::String(value.into()));
            }
            _ => {
                return Err(DataError::Validation(format!(
                    "Template metadata patch field {key} is not supported."
                )));
            }
        }
    }
    Ok(normalized)
}

/// Rebuilds the archive through the same parse/transform boundary used by all
/// DEVD archive endpoints. The raw JSON check happens before serde converts
/// optional values, so invalid incoming `null` values cannot become silently
/// omitted. Persisted values first repair the `Option::None` nulls emitted by
/// the Rust authority, which TypeScript would represent as omitted fields.
fn canonicalize_data_archive(
    value: Value,
    source: ArchiveNormalizationSource,
) -> Result<Value, DataError> {
    let mut archive = normalize_legacy_value(value)
        .map_err(|error| DataError::Validation(format!("Archive is invalid: {error}")))?;
    let archive_object = archive
        .as_object_mut()
        .ok_or_else(|| DataError::Validation("Archive must be an object.".into()))?;
    let runtime = archive_object
        .get_mut("runtime")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| DataError::Validation("Archive runtime must be an object.".into()))?;
    normalize_runtime_canvas_documents(runtime);
    validate_runtime_optional_string_fields(runtime)?;

    let inventory = archive_object
        .get_mut("inventory")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| DataError::Validation("Archive inventory must be an object.".into()))?;
    normalize_archive_material_records(inventory, source)?;
    normalize_archive_adjustment_records(inventory, source)?;

    let archive = normalize_legacy_value(archive)
        .map_err(|error| DataError::Validation(format!("Archive is invalid: {error}")))?;
    let validated = serde_json::from_value::<DevdDataArchive>(archive.clone())?;
    validated
        .validate()
        .map_err(|error| DataError::Validation(format!("Archive is invalid: {error}")))?;
    Ok(archive)
}

fn parse_data_archive(
    value: Value,
    source: ArchiveNormalizationSource,
) -> Result<DevdDataArchive, DataError> {
    let archive = canonicalize_data_archive(value, source)?;
    let archive = serde_json::from_value::<DevdDataArchive>(archive)?;
    archive
        .validate()
        .map_err(|error| DataError::Validation(format!("Archive is invalid: {error}")))?;
    Ok(archive)
}

fn normalize_archive_material_records(
    inventory: &mut Map<String, Value>,
    source: ArchiveNormalizationSource,
) -> Result<(), DataError> {
    let Some(records) = inventory.get_mut("materials").and_then(Value::as_array_mut) else {
        return Ok(());
    };
    for record in records {
        *record = match source {
            ArchiveNormalizationSource::Incoming => {
                normalize_inventory_material(std::mem::take(record))?
            }
            ArchiveNormalizationSource::Persisted => {
                normalize_persisted_inventory_material(std::mem::take(record))?
            }
        };
    }
    Ok(())
}

fn normalize_archive_adjustment_records(
    inventory: &mut Map<String, Value>,
    source: ArchiveNormalizationSource,
) -> Result<(), DataError> {
    let Some(records) = inventory
        .get_mut("adjustments")
        .and_then(Value::as_array_mut)
    else {
        return Ok(());
    };
    for record in records {
        *record = match source {
            ArchiveNormalizationSource::Incoming => {
                normalize_inventory_adjustment(std::mem::take(record))?
            }
            ArchiveNormalizationSource::Persisted => {
                normalize_persisted_inventory_adjustment(std::mem::take(record))?
            }
        };
    }
    Ok(())
}

fn runtime_validation_archive(runtime: Value) -> Value {
    json!({
        "schema": DEVD_DATA_ARCHIVE_SCHEMA,
        "exportedAt": "1970-01-01T00:00:00.000Z",
        "runtime": runtime,
        "inventory": {
            "materials": [],
            "adjustments": []
        }
    })
}

fn normalize_runtime_snapshot(snapshot: Value) -> Result<Value, DataError> {
    let normalized = normalize_legacy_value(runtime_validation_archive(snapshot))
        .map_err(|error| DataError::Validation(format!("Runtime snapshot is invalid: {error}")))?;
    let mut runtime = normalized
        .get("runtime")
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| {
            DataError::Validation(
                "Runtime snapshot normalization did not return runtime data.".into(),
            )
        })?;
    normalize_runtime_canvas_documents(&mut runtime);
    validate_runtime_optional_string_fields(&runtime)?;
    Ok(Value::Object(runtime))
}

fn normalize_canvas_document(document: Value, label: &str) -> Result<Value, DataError> {
    let mut document = require_object(document, label)?;
    normalize_canvas_document_fields(&mut document);

    let normalized = normalize_legacy_value(json!({
        "schema": DEVD_DATA_ARCHIVE_SCHEMA,
        "exportedAt": "1970-01-01T00:00:00.000Z",
        "runtime": { "document": Value::Object(document) },
        "inventory": { "materials": [], "adjustments": [] }
    }))
    .map_err(|error| DataError::Validation(format!("{label} is invalid: {error}")))?;
    let document = normalized
        .pointer("/runtime/document")
        .cloned()
        .ok_or_else(|| {
            DataError::Validation(format!("{label} normalization did not return data."))
        })?;
    validate_canvas_document(&document, label)?;
    Ok(document)
}

fn normalize_runtime_canvas_documents(runtime: &mut Map<String, Value>) {
    normalize_runtime_record_documents(runtime.get_mut("versions"), "document");
    normalize_runtime_record_documents(runtime.get_mut("workingCopies"), "draft");
    normalize_working_copy_sources(runtime.get_mut("workingCopies"));
}

fn normalize_runtime_record_documents(records: Option<&mut Value>, document_key: &str) {
    let Some(records) = records.and_then(Value::as_array_mut) else {
        return;
    };
    for record in records {
        let Some(document) = record
            .as_object_mut()
            .and_then(|record| record.get_mut(document_key))
            .and_then(Value::as_object_mut)
        else {
            continue;
        };
        normalize_canvas_document_fields(document);
    }
}

fn normalize_working_copy_sources(records: Option<&mut Value>) {
    let Some(records) = records.and_then(Value::as_array_mut) else {
        return;
    };
    for record in records {
        if let Some(source) = record
            .as_object_mut()
            .and_then(|record| record.get_mut("source"))
            .and_then(Value::as_object_mut)
        {
            normalize_canvas_source(source);
        }
    }
}

fn validate_runtime_optional_string_fields(runtime: &Map<String, Value>) -> Result<(), DataError> {
    validate_runtime_record_optional_strings(
        runtime.get("versions"),
        "Template version",
        &["sourceVersionId"],
    )?;
    validate_runtime_record_optional_strings(
        runtime.get("workingCopies"),
        "Working copy",
        &["templateId", "baseVersionId"],
    )
}

fn validate_runtime_record_optional_strings(
    records: Option<&Value>,
    label: &str,
    fields: &[&str],
) -> Result<(), DataError> {
    let Some(records) = records.and_then(Value::as_array) else {
        return Ok(());
    };
    for record in records {
        let Some(record) = record.as_object() else {
            continue;
        };
        for field in fields {
            if record.get(*field).is_some_and(|value| !value.is_string()) {
                return Err(DataError::Validation(format!(
                    "{label} {field} must be a string."
                )));
            }
        }
    }
    Ok(())
}

fn normalize_canvas_document_fields(document: &mut Map<String, Value>) {
    for key in ["id", "presetId", "name", "templateId", "baseVersionId"] {
        trim_identifier_field(document, key);
    }
    if let Some(source) = document.get_mut("source").and_then(Value::as_object_mut) {
        normalize_canvas_source(source);
    }
    if let Some(fields) = document.get_mut("fields").and_then(Value::as_array_mut) {
        for field in fields {
            if let Some(field) = field.as_object_mut() {
                trim_identifier_field(field, "key");
                trim_identifier_field(field, "label");
            }
        }
    }
    if let Some(elements) = document.get_mut("elements").and_then(Value::as_array_mut) {
        for element in elements {
            if let Some(element) = element.as_object_mut() {
                trim_identifier_field(element, "id");
            }
        }
    }
    if let Some(editor) = document.get_mut("editor").and_then(Value::as_object_mut) {
        normalize_canvas_editor(editor);
    }
}

fn normalize_canvas_source(source: &mut Map<String, Value>) {
    match source.get("kind").and_then(Value::as_str) {
        Some("scratch" | "preset-template") => trim_identifier_field(source, "presetId"),
        Some("user-template") => trim_identifier_field(source, "templateId"),
        _ => {}
    }
}

fn trim_identifier_field(object: &mut Map<String, Value>, key: &str) {
    if let Some(Value::String(value)) = object.get_mut(key) {
        *value = value.trim().into();
    }
}

fn normalize_canvas_editor(editor: &mut Map<String, Value>) {
    if !editor
        .get("gridSize")
        .and_then(Value::as_f64)
        .is_some_and(|value| value == 1.0 || value == 2.0 || value == 5.0)
    {
        editor.insert("gridSize".into(), json!(1));
    }
    if !editor
        .get("snapStep")
        .and_then(Value::as_f64)
        .is_some_and(|value| value == 0.25 || value == 0.5 || value == 1.0)
    {
        editor.insert("snapStep".into(), json!(1));
    }
}

fn validate_canvas_document(document: &Value, label: &str) -> Result<(), DataError> {
    let archive: DevdDataArchive = serde_json::from_value(json!({
        "schema": DEVD_DATA_ARCHIVE_SCHEMA,
        "exportedAt": "1970-01-01T00:00:00.000Z",
        "runtime": {
            "schema": RUNTIME_SCHEMA,
            "exportedAt": "1970-01-01T00:00:00.000Z",
            "snapshotUpdatedAt": null,
            "settings": {},
            "templates": [{
                "id": "validation-template",
                "name": "Validation template",
                "description": "",
                "width": document.get("width").cloned().unwrap_or(Value::Null),
                "height": document.get("height").cloned().unwrap_or(Value::Null),
                "createdAt": "1970-01-01T00:00:00.000Z",
                "updatedAt": "1970-01-01T00:00:00.000Z",
                "currentVersionId": "validation-version",
                "fieldOrder": []
            }],
            "versions": [{
                "id": "validation-version",
                "templateId": "validation-template",
                "version": 1,
                "kind": "saved",
                "createdAt": "1970-01-01T00:00:00.000Z",
                "label": "Validation",
                "document": document
            }],
            "workingCopies": []
        },
        "inventory": { "materials": [], "adjustments": [] }
    }))
    .map_err(|error| DataError::Validation(format!("{label} is invalid: {error}")))?;
    archive
        .validate()
        .map_err(|error| DataError::Validation(format!("{label} is invalid: {error}")))
}

fn validate_runtime_snapshot(snapshot: &Value) -> Result<(), DataError> {
    let archive: DevdDataArchive =
        serde_json::from_value(runtime_validation_archive(snapshot.clone())).map_err(|error| {
            DataError::Validation(format!("Runtime snapshot is invalid: {error}"))
        })?;
    archive
        .validate()
        .map_err(|error| DataError::Validation(format!("Runtime snapshot is invalid: {error}")))
}

fn normalize_label_bindings(value: Value) -> Result<Value, DataError> {
    let bindings = value
        .as_array()
        .ok_or_else(|| DataError::Validation("labelBindings must be an array.".into()))?;
    let mut normalized = Vec::with_capacity(bindings.len());
    for binding in bindings {
        let binding = require_object(binding.clone(), "Label binding")?;
        let id = required_nonempty_string(&binding, "id", "Label binding")?.to_owned();
        let template_source =
            required_nonempty_string(&binding, "templateSource", "Label binding")?.to_owned();
        if !matches!(template_source.as_str(), "system" | "user-template") {
            return Err(DataError::Validation(
                "Label binding templateSource is invalid.".into(),
            ));
        }
        let template_id =
            required_nonempty_string(&binding, "templateId", "Label binding")?.to_owned();
        let template_name =
            required_nonempty_string(&binding, "templateName", "Label binding")?.to_owned();
        let created_at =
            required_nonempty_string(&binding, "createdAt", "Label binding")?.to_owned();
        let updated_at =
            required_nonempty_string(&binding, "updatedAt", "Label binding")?.to_owned();

        let print_quantity = match binding.get("printQuantity") {
            Some(value) => positive_json_integer(value, "Label binding printQuantity")?,
            None => 1,
        };

        let field_overrides = binding
            .get("fieldOverrides")
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new()));
        let field_overrides = field_overrides.as_object().ok_or_else(|| {
            DataError::Validation("Label binding fieldOverrides must be an object.".into())
        })?;
        if field_overrides.values().any(|value| !value.is_string()) {
            return Err(DataError::Validation(
                "Label binding fieldOverrides values must be strings.".into(),
            ));
        }
        // This nested Zod object strips unrecognized fields, unlike the
        // enclosing material schema which deliberately preserves legacy data.
        normalized.push(json!({
            "id": id,
            "templateSource": template_source,
            "templateId": template_id,
            "templateName": template_name,
            "printQuantity": print_quantity,
            "fieldOverrides": field_overrides,
            "createdAt": created_at,
            "updatedAt": updated_at,
        }));
    }
    Ok(Value::Array(normalized))
}

fn required_nonempty_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    label: &str,
) -> Result<&'a str, DataError> {
    object
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| DataError::Validation(format!("{label} {key} is required.")))
}

fn positive_json_integer(value: &Value, label: &str) -> Result<u64, DataError> {
    value
        .as_u64()
        .filter(|value| *value > 0)
        .or_else(|| {
            value
                .as_f64()
                .filter(|value| {
                    value.is_finite()
                        && *value > 0.0
                        && value.fract() == 0.0
                        && *value <= u64::MAX as f64
                })
                .map(|value| value as u64)
        })
        .ok_or_else(|| DataError::Validation(format!("{label} must be a positive integer.")))
}

fn non_negative_json_integer(value: &Value, label: &str) -> Result<u64, DataError> {
    value
        .as_u64()
        .or_else(|| {
            value
                .as_f64()
                .filter(|value| {
                    value.is_finite()
                        && *value >= 0.0
                        && value.fract() == 0.0
                        && *value <= u64::MAX as f64
                })
                .map(|value| value as u64)
        })
        .ok_or_else(|| DataError::Validation(format!("{label} must be a non-negative integer.")))
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
        .ok_or_else(|| DataError::Validation(format!("{key} must be a positive integer.")))?;
    let value = positive_json_integer(value, key)?;
    i64::try_from(value)
        .map_err(|_| DataError::Validation(format!("{key} must be a positive integer.")))
}

fn non_negative_integer(object: &Map<String, Value>, key: &str) -> Result<i64, DataError> {
    let value = object
        .get(key)
        .ok_or_else(|| DataError::Validation(format!("{key} must be a non-negative integer.")))?;
    let value = non_negative_json_integer(value, key)?;
    i64::try_from(value)
        .map_err(|_| DataError::Validation(format!("{key} must be a non-negative integer.")))
}
