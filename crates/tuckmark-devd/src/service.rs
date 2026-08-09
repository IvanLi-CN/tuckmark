//! Native, side-effect-free implementations of the non-data DEVD service surface.
//!
//! Rendering and artifact persistence deliberately stay in the native process. Printer
//! discovery and dispatch do not: the facade can produce protocol packets for an artifact,
//! but it never opens a device connection.

use std::{
    collections::{BTreeMap, BTreeSet},
    env,
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};

use serde_json::{Map, Value, json};
use thiserror::Error;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tuckmark_contracts::{
    ArtifactPackets, DirectCanvasDefinition, PreviewArtifact, RenderOptions, SafeTextLabelRequest,
};
use tuckmark_engine::{
    ArtifactStore, ArtifactStoreError, DataAuthority, DataAuthorityError, PrintEngine, PrintError,
    RenderEngine, RenderError,
};
use uuid::Uuid;

use crate::templates;

const SYNC_STATE_FILE: &str = "sync-state.json";
const SERVER_PRINT_DISABLED: &str = "Server-side printer control is disabled. Set TUCKMARK_ENABLE_SERVER_SIDE_PRINT=1 to enable it.";

/// A concrete artifact payload that can be read without exposing arbitrary filesystem paths.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ArtifactAsset {
    Png,
    Bitmap,
    Svg,
}

#[derive(Debug, Error)]
pub enum NativeServiceError {
    #[error("unknown template: {0}")]
    UnknownTemplate(String),
    #[error("invalid {field}: {message}")]
    InvalidRequest {
        field: &'static str,
        message: String,
    },
    #[error("artifact {0} does not exist")]
    ArtifactNotFound(String),
    #[error("artifact payload path is outside the artifact directory")]
    UnsafeArtifactPath,
    #[error("native service mutation queue is poisoned")]
    MutationPoisoned,
    #[error("{SERVER_PRINT_DISABLED}")]
    ServerSidePrintDisabled,
    #[error("Native printer transport is not available in tuckmark-devd.")]
    PrinterTransportUnavailable,
    #[error("native service I/O failed: {0}")]
    Io(#[from] io::Error),
    #[error("native service JSON failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("native artifact store failed: {0}")]
    Artifact(#[from] ArtifactStoreError),
    #[error("native render failed: {0}")]
    Render(#[from] RenderError),
    #[error("native print packet generation failed: {0}")]
    Print(#[from] PrintError),
    #[error("native data authority failed: {0}")]
    Authority(#[from] DataAuthorityError),
}

/// The native replacement for the old Node-only non-data service APIs.
///
/// The supplied mutation gate should be the same gate used by the data facade when both
/// facades share an authority. That keeps the sync-state read/merge/write operation ordered
/// with the rest of the daemon's local mutations.
#[derive(Clone)]
pub struct NativeService {
    authority: DataAuthority,
    artifacts: ArtifactStore,
    renderer: RenderEngine,
    printer: PrintEngine,
    mutation: Arc<Mutex<()>>,
    server_side_print_enabled: bool,
}

impl NativeService {
    pub fn new(authority: DataAuthority) -> Self {
        Self::with_mutation_gate(authority, Arc::new(Mutex::new(())))
    }

    pub fn with_mutation_gate(authority: DataAuthority, mutation: Arc<Mutex<()>>) -> Self {
        let enabled = env::var("TUCKMARK_ENABLE_SERVER_SIDE_PRINT")
            .ok()
            .is_some_and(|value| {
                matches!(value.trim().to_ascii_lowercase().as_str(), "1" | "true")
            });
        Self::with_print_enabled(authority, mutation, enabled)
    }

    /// Allows tests and an explicit host policy to choose whether print endpoints pass the
    /// server-side-print feature gate. Passing the gate still never opens a printer device.
    pub fn with_print_enabled(
        authority: DataAuthority,
        mutation: Arc<Mutex<()>>,
        server_side_print_enabled: bool,
    ) -> Self {
        let artifacts = ArtifactStore::from_data_root(authority.root());
        Self {
            authority,
            artifacts,
            renderer: RenderEngine::new(),
            printer: PrintEngine::new(),
            mutation,
            server_side_print_enabled,
        }
    }

    pub fn authority(&self) -> &DataAuthority {
        &self.authority
    }

    pub fn artifacts(&self) -> &ArtifactStore {
        &self.artifacts
    }

    pub fn server_side_print_enabled(&self) -> bool {
        self.server_side_print_enabled
    }

    pub fn list_templates(&self) -> Result<Vec<Value>, NativeServiceError> {
        Ok(templates::catalog_values()?)
    }

    /// Native DEVD intentionally does not discover or connect to hardware. The Web client can
    /// still render and persist previews through this endpoint while hardware control remains a
    /// separately authorized transport concern.
    pub fn list_printers(&self) -> Vec<Value> {
        vec![]
    }

    pub fn probe_printer(
        &self,
        printer_id: impl Into<String>,
        printer_name: Option<String>,
    ) -> Value {
        let printer_id = printer_id.into();
        let mut response = json!({
            "ok": false,
            "printerId": printer_id,
            "stage": "not_found",
            "message": "Native printer discovery is disabled.",
            "log": [],
            "timingsMs": {},
        });
        if let Some(printer_name) = printer_name.filter(|value| !value.trim().is_empty()) {
            response["printerName"] = Value::String(printer_name);
        }
        response
    }

    pub fn preview_template(&self, request: Value) -> Result<Value, NativeServiceError> {
        let object = request_object(&request, "template preview request")?;
        let template_id = required_string(object, "templateId")?;
        let template = templates::find(template_id)?
            .ok_or_else(|| NativeServiceError::UnknownTemplate(template_id.into()))?;
        let input = string_map(object.get("input"), "input")?;
        let options = render_options(object.get("renderOptions"))?;
        let artifact = self
            .artifacts
            .write_artifact(&self.renderer.render_template(&template, &input, &options)?)?;
        Ok(json!({ "artifact": artifact }))
    }

    pub fn preview_canvas(&self, request: Value) -> Result<Value, NativeServiceError> {
        let object = request_object(&request, "canvas preview request")?;
        let canvas = required_json(object, "canvas")?;
        let canvas = serde_json::from_value::<DirectCanvasDefinition>(canvas.clone())?;
        let options = render_options(object.get("renderOptions"))?;
        let artifact = self
            .artifacts
            .write_artifact(&self.renderer.render_canvas(&canvas, &options)?)?;
        Ok(json!({ "artifact": artifact }))
    }

    pub fn preview_canvas_draft(&self, request: Value) -> Result<Value, NativeServiceError> {
        let object = request_object(&request, "canvas draft preview request")?;
        let draft = required_json(object, "draft")?;
        let input = string_map(object.get("input"), "input")?;
        let options = render_options(object.get("renderOptions"))?;
        let artifact = self
            .artifacts
            .write_artifact(&self.renderer.render_canvas_draft(draft, &input, &options)?)?;
        Ok(json!({ "artifact": artifact }))
    }

    pub fn preview_batch(&self, request: Value) -> Result<Value, NativeServiceError> {
        let object = request_object(&request, "batch preview request")?;
        let template_id = required_string(object, "templateId")?;
        let template = templates::find(template_id)?
            .ok_or_else(|| NativeServiceError::UnknownTemplate(template_id.into()))?;
        let csv_text = required_string(object, "csvText")?;
        if csv_text.trim().is_empty() {
            return Err(invalid("csvText", "must not be empty"));
        }
        let options = render_options(object.get("renderOptions"))?;
        let rendered = self
            .renderer
            .render_csv_batch(&template, csv_text, &options)?;
        let mut items = Vec::with_capacity(rendered.len());
        for (index, rendered) in rendered.into_iter().enumerate() {
            let input = rendered.artifact.input.clone();
            let artifact = self.artifacts.write_artifact(&rendered)?;
            items.push(json!({ "index": index, "input": input, "artifact": artifact }));
        }
        Ok(json!({
            "templateId": template.id,
            "total": items.len(),
            "items": items,
        }))
    }

    pub fn preview_safe_text(&self, request: Value) -> Result<Value, NativeServiceError> {
        let mut request = request;
        let object = request_object_mut(&mut request, "safe text preview request")?;
        object
            .entry("title")
            .or_insert_with(|| Value::String("Safe Text Label".into()));
        let request = serde_json::from_value::<SafeTextLabelRequest>(request)?;
        let artifact = self
            .artifacts
            .write_artifact(&self.renderer.render_safe_text(&request)?)?;
        Ok(json!({ "artifact": artifact }))
    }

    pub fn list_artifacts(&self) -> Result<Vec<PreviewArtifact>, NativeServiceError> {
        Ok(self.artifacts.list_artifacts()?)
    }

    pub fn get_artifact(&self, artifact_id: &str) -> Result<PreviewArtifact, NativeServiceError> {
        self.artifacts
            .get_artifact(artifact_id)?
            .ok_or_else(|| NativeServiceError::ArtifactNotFound(artifact_id.into()))
    }

    pub fn read_artifact_bytes(
        &self,
        artifact_id: &str,
        asset: ArtifactAsset,
    ) -> Result<Vec<u8>, NativeServiceError> {
        let artifact = self.get_artifact(artifact_id)?;
        let path = match asset {
            ArtifactAsset::Png => Path::new(&artifact.png_path),
            ArtifactAsset::Bitmap => Path::new(&artifact.bitmap_path),
            ArtifactAsset::Svg => Path::new(&artifact.svg_path),
        };
        ensure_artifact_path(&self.artifacts, artifact_id, path)?;
        Ok(fs::read(path)?)
    }

    /// Reads already persisted packets, or deterministically creates them from the stored PNG.
    /// This only serializes protocol bytes; it does not transmit them to a device.
    pub fn get_artifact_packets(
        &self,
        artifact_id: &str,
    ) -> Result<ArtifactPackets, NativeServiceError> {
        let _guard = self.lock_mutation()?;
        if let Some(packets) = self.artifacts.read_packets(artifact_id)? {
            return Ok(packets);
        }
        let artifact = self.get_artifact(artifact_id)?;
        let png = self.read_artifact_bytes(artifact_id, ArtifactAsset::Png)?;
        let packets = self
            .printer
            .detonger_packets(&png, &artifact.render_options, None)?;
        Ok(self.artifacts.write_packets(artifact_id, &packets)?)
    }

    pub fn get_sync_state(&self) -> Result<Value, NativeServiceError> {
        let _guard = self.lock_mutation()?;
        self.read_sync_state_locked()
    }

    pub fn merge_sync_state(&self, next: Value) -> Result<Value, NativeServiceError> {
        let _guard = self.lock_mutation()?;
        let current = self.read_sync_state_locked()?;
        let mut merged = merge_sync_states(&current, &next)?;
        set_updated_at(&mut merged, now_rfc3339())?;
        self.write_sync_state_locked(&merged)?;
        Ok(merged)
    }

    pub fn upsert_template_usage_record(&self, record: Value) -> Result<Value, NativeServiceError> {
        self.upsert_sync_record("templateUsageRecords", "template_usage", record)
    }

    pub fn upsert_recent_print_record(&self, record: Value) -> Result<Value, NativeServiceError> {
        self.upsert_sync_record("recentPrintRecords", "recent_print", record)
    }

    pub fn upsert_canvas_draft_record(&self, record: Value) -> Result<Value, NativeServiceError> {
        self.upsert_sync_record("canvasDraftRecords", "canvas_draft", record)
    }

    /// Verifies the feature gate used by legacy print routes. Even when enabled, this native
    /// service intentionally has no device transport and therefore does not claim a print job
    /// completed without an explicit transport adapter.
    pub fn require_server_side_print(&self) -> Result<(), NativeServiceError> {
        if self.server_side_print_enabled {
            Ok(())
        } else {
            Err(NativeServiceError::ServerSidePrintDisabled)
        }
    }

    pub fn print_transport_unavailable(&self) -> Result<(), NativeServiceError> {
        self.require_server_side_print()?;
        Err(NativeServiceError::PrinterTransportUnavailable)
    }

    fn upsert_sync_record(
        &self,
        collection: &'static str,
        expected_kind: &'static str,
        mut record: Value,
    ) -> Result<Value, NativeServiceError> {
        normalize_sync_record_defaults(&mut record, Some(expected_kind))?;
        normalize_sync_record(&record, Some(expected_kind))?;
        let _guard = self.lock_mutation()?;
        let current = self.read_sync_state_locked()?;
        let mut next = current.clone();
        let object = request_object_mut(&mut next, "sync state")?;
        object.insert(collection.into(), Value::Array(vec![record]));
        object.insert("updatedAt".into(), Value::String(now_rfc3339()));
        let mut merged = merge_sync_states(&current, &next)?;
        set_updated_at(&mut merged, now_rfc3339())?;
        self.write_sync_state_locked(&merged)?;
        Ok(merged)
    }

    fn lock_mutation(&self) -> Result<MutexGuard<'_, ()>, NativeServiceError> {
        self.mutation
            .lock()
            .map_err(|_| NativeServiceError::MutationPoisoned)
    }

    fn sync_state_path(&self) -> PathBuf {
        self.authority
            .root()
            .join(".tuckmark")
            .join(SYNC_STATE_FILE)
    }

    fn read_sync_state_locked(&self) -> Result<Value, NativeServiceError> {
        let path = self.sync_state_path();
        let raw = match fs::read_to_string(&path) {
            Ok(raw) => raw,
            // The existing Web store deliberately treats any unreadable local state as empty.
            Err(_) => return Ok(empty_sync_state()),
        };
        match serde_json::from_str::<Value>(&raw).and_then(normalize_sync_state) {
            Ok(state) => Ok(state),
            Err(_) => Ok(empty_sync_state()),
        }
    }

    fn write_sync_state_locked(&self, state: &Value) -> Result<(), NativeServiceError> {
        let state = normalize_sync_state(state.clone())?;
        let path = self.sync_state_path();
        let directory = path
            .parent()
            .ok_or_else(|| invalid("sync state path", "has no parent directory"))?;
        fs::create_dir_all(directory)?;
        let temporary = directory.join(format!(".{SYNC_STATE_FILE}-{}.tmp", Uuid::new_v4()));
        let result = (|| -> Result<(), NativeServiceError> {
            let mut file = File::create(&temporary)?;
            file.write_all(serde_json::to_string_pretty(&state)?.as_bytes())?;
            file.write_all(b"\n")?;
            file.sync_all()?;
            fs::rename(&temporary, &path)?;
            sync_directory(directory)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }
}

fn invalid(field: &'static str, message: impl Into<String>) -> NativeServiceError {
    NativeServiceError::InvalidRequest {
        field,
        message: message.into(),
    }
}

fn request_object<'a>(
    value: &'a Value,
    name: &'static str,
) -> Result<&'a Map<String, Value>, NativeServiceError> {
    value
        .as_object()
        .ok_or_else(|| invalid(name, "must be an object"))
}

fn request_object_mut<'a>(
    value: &'a mut Value,
    name: &'static str,
) -> Result<&'a mut Map<String, Value>, NativeServiceError> {
    value
        .as_object_mut()
        .ok_or_else(|| invalid(name, "must be an object"))
}

fn required_json<'a>(
    object: &'a Map<String, Value>,
    field: &'static str,
) -> Result<&'a Value, NativeServiceError> {
    object
        .get(field)
        .ok_or_else(|| invalid(field, "is required"))
}

fn required_string<'a>(
    object: &'a Map<String, Value>,
    field: &'static str,
) -> Result<&'a str, NativeServiceError> {
    required_json(object, field)?
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| invalid(field, "must be a non-empty string"))
}

fn string_map(
    value: Option<&Value>,
    field: &'static str,
) -> Result<BTreeMap<String, String>, NativeServiceError> {
    let Some(value) = value else {
        return Ok(BTreeMap::new());
    };
    let object = value
        .as_object()
        .ok_or_else(|| invalid(field, "must be an object"))?;
    object
        .iter()
        .map(|(key, value)| {
            value
                .as_str()
                .map(|value| (key.clone(), value.into()))
                .ok_or_else(|| invalid(field, format!("{key} must be a string")))
        })
        .collect()
}

fn render_options(value: Option<&Value>) -> Result<RenderOptions, NativeServiceError> {
    let options = match value {
        Some(value) => serde_json::from_value(value.clone())?,
        None => RenderOptions::default(),
    };
    options
        .validate()
        .map_err(|error| invalid("renderOptions", error.to_string()))?;
    Ok(options)
}

fn ensure_artifact_path(
    artifacts: &ArtifactStore,
    artifact_id: &str,
    path: &Path,
) -> Result<(), NativeServiceError> {
    let expected_directory = artifacts.preview_dir().join(artifact_id);
    let expected_directory = fs::canonicalize(expected_directory)?;
    let resolved = fs::canonicalize(path)?;
    if resolved.starts_with(expected_directory) {
        Ok(())
    } else {
        Err(NativeServiceError::UnsafeArtifactPath)
    }
}

fn empty_sync_state() -> Value {
    json!({
        "schemaVersion": 1,
        "updatedAt": "1970-01-01T00:00:00.000Z",
        "templateUsageRecords": [],
        "recentPrintRecords": [],
        "canvasDraftRecords": [],
    })
}

fn normalize_sync_state(mut state: Value) -> Result<Value, serde_json::Error> {
    let object = state.as_object_mut().ok_or_else(|| {
        serde_json::Error::io(io::Error::new(
            io::ErrorKind::InvalidData,
            "sync state must be an object",
        ))
    })?;
    if object.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err(serde_json::Error::io(io::Error::new(
            io::ErrorKind::InvalidData,
            "sync state schemaVersion must be 1",
        )));
    }
    if object
        .get("updatedAt")
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
    {
        return Err(serde_json::Error::io(io::Error::new(
            io::ErrorKind::InvalidData,
            "sync state updatedAt must be a non-empty string",
        )));
    }
    for (collection, kind) in [
        ("templateUsageRecords", "template_usage"),
        ("recentPrintRecords", "recent_print"),
        ("canvasDraftRecords", "canvas_draft"),
    ] {
        let records = object
            .entry(collection)
            .or_insert_with(|| Value::Array(vec![]));
        let records = records.as_array_mut().ok_or_else(|| {
            serde_json::Error::io(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("sync state {collection} must be an array"),
            ))
        })?;
        for record in records {
            normalize_sync_record_defaults(record, Some(kind)).map_err(|error| {
                serde_json::Error::io(io::Error::new(
                    io::ErrorKind::InvalidData,
                    error.to_string(),
                ))
            })?;
            normalize_sync_record(record, Some(kind)).map_err(|error| {
                serde_json::Error::io(io::Error::new(
                    io::ErrorKind::InvalidData,
                    error.to_string(),
                ))
            })?;
        }
    }
    Ok(state)
}

fn normalize_sync_record_defaults(
    record: &mut Value,
    expected_kind: Option<&str>,
) -> Result<(), NativeServiceError> {
    let object = request_object_mut(record, "sync record")?;
    let kind = object
        .get("kind")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| invalid("kind", "must be a non-empty string"))?;
    if kind.trim().is_empty() {
        return Err(invalid("kind", "must be a non-empty string"));
    }
    if expected_kind.is_some_and(|expected| expected != kind.as_str()) {
        return Err(invalid("kind", "does not match the sync record collection"));
    }
    let vector_clock = object
        .get_mut("vectorClock")
        .ok_or_else(|| invalid("vectorClock", "is required"))?
        .as_object_mut()
        .ok_or_else(|| invalid("vectorClock", "must be an object"))?;
    for key in ["browser", "service"] {
        vector_clock.entry(key).or_insert_with(|| Value::from(0));
    }
    let conflicts = object
        .entry("conflicts")
        .or_insert_with(|| Value::Array(Vec::new()))
        .as_array_mut()
        .ok_or_else(|| invalid("conflicts", "must be an array"))?;
    for conflict in conflicts {
        let conflict = conflict
            .as_object_mut()
            .ok_or_else(|| invalid("conflicts", "must contain objects"))?;
        let branches = conflict
            .entry("branches")
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or_else(|| invalid("conflicts.branches", "must be an array"))?;
        for branch in branches {
            let branch = branch
                .as_object_mut()
                .ok_or_else(|| invalid("conflicts.branches", "must contain objects"))?;
            branch
                .entry("deleted")
                .or_insert_with(|| Value::Bool(false));
        }
    }
    Ok(())
}

fn normalize_sync_record(
    record: &Value,
    expected_kind: Option<&str>,
) -> Result<(), NativeServiceError> {
    let object = request_object(record, "sync record")?;
    let kind = required_string(object, "kind")?;
    if expected_kind.is_some_and(|expected| expected != kind) {
        return Err(invalid("kind", "does not match the sync record collection"));
    }
    required_string(object, "recordId")?;
    if object
        .get("version")
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .is_none()
    {
        return Err(invalid("version", "must be a positive integer"));
    }
    let clock = required_json(object, "vectorClock")
        .and_then(|value| request_object(value, "vectorClock"))?;
    for key in ["browser", "service"] {
        if clock.get(key).and_then(Value::as_u64).is_none() {
            return Err(invalid(
                "vectorClock",
                format!("{key} must be a non-negative integer"),
            ));
        }
    }
    required_string(object, "updatedAt")?;
    required_string(object, "hash")?;
    let payload = required_json(object, "payload")?;
    validate_sync_payload(kind, payload)?;
    if let Some(deleted) = object.get("deleted")
        && !deleted.is_boolean()
    {
        return Err(invalid("deleted", "must be a boolean"));
    }
    if let Some(conflicts) = object.get("conflicts") {
        validate_sync_conflicts(conflicts)?;
    }
    Ok(())
}

fn validate_sync_payload(kind: &str, payload: &Value) -> Result<(), NativeServiceError> {
    let payload = request_object(payload, "payload")?;
    match kind {
        "template_usage" => {
            for field in ["id", "name", "description", "usedAt"] {
                require_sync_string(payload, field)?;
            }
        }
        "recent_print" => {
            for field in ["id", "title", "printedAt", "printerName"] {
                require_sync_string(payload, field)?;
            }
            let print_kind = require_sync_string(payload, "kind")?;
            if !matches!(print_kind, "template" | "canvas" | "safe_text") {
                return Err(invalid(
                    "payload",
                    "kind must be template, canvas, or safe_text",
                ));
            }
        }
        "canvas_draft" => {
            require_sync_string(payload, "presetId")?;
            required_json(payload, "draft")?;
            require_sync_string(payload, "savedAt")?;
        }
        _ => return Err(invalid("kind", "is not a supported sync record kind")),
    }
    Ok(())
}

fn validate_sync_conflicts(value: &Value) -> Result<(), NativeServiceError> {
    let conflicts = value
        .as_array()
        .ok_or_else(|| invalid("conflicts", "must be an array"))?;
    for conflict in conflicts {
        let conflict = conflict
            .as_object()
            .ok_or_else(|| invalid("conflicts", "must contain objects"))?;
        for field in ["recordId", "field", "localHash", "remoteHash", "detectedAt"] {
            require_sync_string(conflict, field)?;
        }
        let branches = required_json(conflict, "branches")?
            .as_array()
            .ok_or_else(|| invalid("conflicts.branches", "must be an array"))?;
        for branch in branches {
            let branch = branch
                .as_object()
                .ok_or_else(|| invalid("conflicts.branches", "must contain objects"))?;
            for field in ["branchId", "hash", "updatedAt"] {
                require_sync_string(branch, field)?;
            }
            required_json(branch, "payload")?;
            if branch
                .get("deleted")
                .is_some_and(|value| !value.is_boolean())
            {
                return Err(invalid("conflicts.branches.deleted", "must be a boolean"));
            }
        }
    }
    Ok(())
}

fn require_sync_string<'a>(
    object: &'a Map<String, Value>,
    field: &str,
) -> Result<&'a str, NativeServiceError> {
    object
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("payload", format!("{field} must be a string")))
}

fn merge_sync_states(local: &Value, remote: &Value) -> Result<Value, NativeServiceError> {
    let local = normalize_sync_state(local.clone())?;
    let remote = normalize_sync_state(remote.clone())?;
    let local_object = request_object(&local, "sync state")?;
    let remote_object = request_object(&remote, "sync state")?;
    let mut merged = Map::new();
    merged.insert("schemaVersion".into(), Value::from(1));
    merged.insert(
        "updatedAt".into(),
        Value::String(newest_timestamp(
            required_string(local_object, "updatedAt")?,
            required_string(remote_object, "updatedAt")?,
        )),
    );
    for (collection, kind) in [
        ("templateUsageRecords", "template_usage"),
        ("recentPrintRecords", "recent_print"),
        ("canvasDraftRecords", "canvas_draft"),
    ] {
        let left = required_json(local_object, collection)?
            .as_array()
            .ok_or_else(|| invalid(collection, "must be an array"))?;
        let right = required_json(remote_object, collection)?
            .as_array()
            .ok_or_else(|| invalid(collection, "must be an array"))?;
        merged.insert(
            collection.into(),
            Value::Array(merge_sync_collection(left, right, kind)?),
        );
    }
    Ok(Value::Object(merged))
}

fn merge_sync_collection(
    left: &[Value],
    right: &[Value],
    kind: &'static str,
) -> Result<Vec<Value>, NativeServiceError> {
    let mut merged = BTreeMap::<String, Value>::new();
    for record in left.iter().chain(right) {
        normalize_sync_record(record, Some(kind))?;
        let record_id =
            required_string(request_object(record, "sync record")?, "recordId")?.to_owned();
        let next = match merged.remove(&record_id) {
            Some(existing) => merge_sync_record(&existing, record)?,
            None => record.clone(),
        };
        merged.insert(record_id, next);
    }
    let mut records = merged.into_values().collect::<Vec<_>>();
    records.sort_by(|left, right| {
        let left = record_timestamp(left).unwrap_or_default();
        let right = record_timestamp(right).unwrap_or_default();
        right.cmp(left)
    });
    Ok(records)
}

fn merge_sync_record(left: &Value, right: &Value) -> Result<Value, NativeServiceError> {
    let left_object = request_object(left, "sync record")?;
    let right_object = request_object(right, "sync record")?;
    let left_kind = required_string(left_object, "kind")?;
    let right_kind = required_string(right_object, "kind")?;
    let left_id = required_string(left_object, "recordId")?;
    let right_id = required_string(right_object, "recordId")?;
    if left_kind != right_kind || left_id != right_id {
        return Err(invalid(
            "sync record",
            "records must share kind and recordId before merge",
        ));
    }
    let vector_result = compare_vector_clocks(left_object, right_object)?;
    let left_deleted = left_object
        .get("deleted")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let right_deleted = right_object
        .get("deleted")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if left_deleted && !right_deleted {
        return Ok(if vector_result == VectorClockOrder::RightNewer {
            right.clone()
        } else {
            left.clone()
        });
    }
    if right_deleted && !left_deleted {
        return Ok(if vector_result == VectorClockOrder::LeftNewer {
            left.clone()
        } else {
            right.clone()
        });
    }
    if vector_result == VectorClockOrder::LeftNewer {
        return Ok(left.clone());
    }
    if vector_result == VectorClockOrder::RightNewer {
        return Ok(right.clone());
    }

    let same_hash = required_string(left_object, "hash")? == required_string(right_object, "hash")?;
    let base_is_left = record_timestamp(left)? >= record_timestamp(right)?;
    let base = if base_is_left { left } else { right };
    let other = if base_is_left { right } else { left };
    let mut base = base.clone();
    if !same_hash {
        let payload_key = match left_kind {
            "template_usage" => "usedAt",
            "recent_print" => "printedAt",
            "canvas_draft" => "savedAt",
            _ => return Err(invalid("kind", "is not a supported sync record kind")),
        };
        let left_payload = required_json(left_object, "payload")?;
        let right_payload = required_json(right_object, "payload")?;
        let left_payload_time = payload_timestamp(left_payload, payload_key)?;
        let right_payload_time = payload_timestamp(right_payload, payload_key)?;
        let selected = if left_payload_time >= right_payload_time {
            left_payload.clone()
        } else {
            right_payload.clone()
        };
        request_object_mut(&mut base, "sync record")?.insert("payload".into(), selected);
    }

    let extra_conflict =
        if !same_hash && left_kind == "canvas_draft" && !left_deleted && !right_deleted {
            Some(canvas_draft_conflict(left_object, right_object)?)
        } else {
            None
        };
    merge_record_metadata(&mut base, other, !same_hash, extra_conflict)?;
    Ok(base)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum VectorClockOrder {
    Equal,
    LeftNewer,
    RightNewer,
    Concurrent,
}

fn compare_vector_clocks(
    left: &Map<String, Value>,
    right: &Map<String, Value>,
) -> Result<VectorClockOrder, NativeServiceError> {
    let left = vector_clock(left)?;
    let right = vector_clock(right)?;
    if left == right {
        return Ok(VectorClockOrder::Equal);
    }
    let left_gte = left.0 >= right.0 && left.1 >= right.1;
    let right_gte = right.0 >= left.0 && right.1 >= left.1;
    if left_gte {
        Ok(VectorClockOrder::LeftNewer)
    } else if right_gte {
        Ok(VectorClockOrder::RightNewer)
    } else {
        Ok(VectorClockOrder::Concurrent)
    }
}

fn vector_clock(object: &Map<String, Value>) -> Result<(u64, u64), NativeServiceError> {
    let clock = required_json(object, "vectorClock")
        .and_then(|value| request_object(value, "vectorClock"))?;
    Ok((
        clock
            .get("browser")
            .and_then(Value::as_u64)
            .ok_or_else(|| invalid("vectorClock.browser", "must be a non-negative integer"))?,
        clock
            .get("service")
            .and_then(Value::as_u64)
            .ok_or_else(|| invalid("vectorClock.service", "must be a non-negative integer"))?,
    ))
}

fn merge_record_metadata(
    base: &mut Value,
    other: &Value,
    increment_version: bool,
    extra_conflict: Option<Value>,
) -> Result<(), NativeServiceError> {
    let base_snapshot = base.clone();
    let base_object = request_object_mut(base, "sync record")?;
    let other_object = request_object(other, "sync record")?;
    let base_version = base_object
        .get("version")
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid("version", "must be a positive integer"))?;
    let other_version = other_object
        .get("version")
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid("version", "must be a positive integer"))?;
    let version = base_version.max(other_version) + u64::from(increment_version);
    let base_clock = vector_clock(request_object(&base_snapshot, "sync record")?)?;
    let other_clock = vector_clock(other_object)?;
    let base_updated_at =
        required_string(request_object(&base_snapshot, "sync record")?, "updatedAt")?;
    let other_updated_at = required_string(other_object, "updatedAt")?;
    let kind = required_string(request_object(&base_snapshot, "sync record")?, "kind")?;
    let payload = required_json(request_object(&base_snapshot, "sync record")?, "payload")?;
    let record_hash = sync_record_payload_hash(kind, payload)?;
    base_object.insert("version".into(), Value::from(version));
    base_object.insert(
        "vectorClock".into(),
        json!({
            "browser": base_clock.0.max(other_clock.0),
            "service": base_clock.1.max(other_clock.1),
        }),
    );
    base_object.insert(
        "updatedAt".into(),
        Value::String(newest_timestamp(base_updated_at, other_updated_at)),
    );
    base_object.insert("hash".into(), Value::String(record_hash));
    let conflicts = dedupe_conflicts(
        base_object
            .get("conflicts")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        other_object
            .get("conflicts")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        extra_conflict,
    );
    base_object.insert("conflicts".into(), Value::Array(conflicts));
    Ok(())
}

fn canvas_draft_conflict(
    left: &Map<String, Value>,
    right: &Map<String, Value>,
) -> Result<Value, NativeServiceError> {
    let left_id = required_string(left, "recordId")?;
    let left_hash = required_string(left, "hash")?;
    let right_hash = required_string(right, "hash")?;
    Ok(json!({
        "recordId": left_id,
        "field": "draft",
        "localHash": left_hash,
        "remoteHash": right_hash,
        "detectedAt": newest_timestamp(required_string(left, "updatedAt")?, required_string(right, "updatedAt")?),
        "branches": [
            conflict_branch(left)?,
            conflict_branch(right)?,
        ],
    }))
}

fn conflict_branch(record: &Map<String, Value>) -> Result<Value, NativeServiceError> {
    let record_id = required_string(record, "recordId")?;
    let hash = required_string(record, "hash")?;
    Ok(json!({
        "branchId": format!("{record_id}:{hash}"),
        "hash": hash,
        "updatedAt": required_string(record, "updatedAt")?,
        "payload": required_json(record, "payload")?,
        "deleted": record.get("deleted").and_then(Value::as_bool).unwrap_or(false),
    }))
}

fn dedupe_conflicts(first: Vec<Value>, second: Vec<Value>, extra: Option<Value>) -> Vec<Value> {
    let mut seen = BTreeSet::new();
    first
        .into_iter()
        .chain(second)
        .chain(extra)
        .filter(|conflict| {
            let object = conflict.as_object();
            let key = object.map(|object| {
                format!(
                    "{}:{}:{}:{}",
                    object
                        .get("recordId")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    object
                        .get("field")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    object
                        .get("localHash")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    object
                        .get("remoteHash")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                )
            });
            key.is_some_and(|key| seen.insert(key))
        })
        .collect()
}

fn payload_timestamp<'a>(
    payload: &'a Value,
    key: &'static str,
) -> Result<&'a str, NativeServiceError> {
    required_string(request_object(payload, "sync record payload")?, key)
}

fn record_timestamp(record: &Value) -> Result<&str, NativeServiceError> {
    required_string(request_object(record, "sync record")?, "updatedAt")
}

fn newest_timestamp(left: &str, right: &str) -> String {
    if left >= right {
        left.into()
    } else {
        right.into()
    }
}

fn set_updated_at(state: &mut Value, updated_at: String) -> Result<(), NativeServiceError> {
    request_object_mut(state, "sync state")?.insert("updatedAt".into(), Value::String(updated_at));
    Ok(())
}

fn sync_record_payload_hash(kind: &str, payload: &Value) -> Result<String, NativeServiceError> {
    let value = if kind == "canvas_draft" {
        let payload = request_object(payload, "canvas draft payload")?;
        json!({
            "presetId": required_json(payload, "presetId")?,
            "draft": required_json(payload, "draft")?,
        })
    } else {
        payload.clone()
    };
    Ok(stable_hash(&value))
}

// This intentionally mirrors the browser's stableHash algorithm, including UTF-16 code units.
fn stable_hash(value: &Value) -> String {
    let input = stable_json(value);
    let mut first = 0x811c9dc5_u32;
    let mut second = 0x01000193_u32;
    for code in input.encode_utf16() {
        first ^= u32::from(code);
        first = first.wrapping_mul(0x01000193);
        second ^= u32::from(code);
        second = second.wrapping_mul(0x27d4eb2d);
    }
    format!("{first:08x}{second:08x}")
}

fn stable_json(value: &Value) -> String {
    match value {
        Value::Array(values) => format!(
            "[{}]",
            values.iter().map(stable_json).collect::<Vec<_>>().join(",")
        ),
        Value::Object(values) => {
            let mut entries = values.iter().collect::<Vec<_>>();
            entries.sort_by(|(left, _), (right, _)| left.cmp(right));
            format!(
                "{{{}}}",
                entries
                    .into_iter()
                    .map(|(key, value)| format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap_or_default(),
                        stable_json(value)
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        _ => serde_json::to_string(value).unwrap_or_else(|_| "null".into()),
    }
}

fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00.000Z".into())
}

fn sync_directory(directory: &Path) -> Result<(), io::Error> {
    #[cfg(unix)]
    {
        File::open(directory)?.sync_all()?;
    }
    #[cfg(not(unix))]
    {
        let _ = directory;
    }
    Ok(())
}
