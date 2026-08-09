use std::{
    collections::BTreeMap,
    convert::Infallible,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use axum::{
    Json, Router,
    body::Body,
    extract::{ConnectInfo, Path as AxumPath, Query, Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, Uri, header},
    middleware::{self, Next},
    response::{
        IntoResponse, Response, Sse,
        sse::{Event, KeepAlive},
    },
    routing::{get, post, put},
};
use futures_util::{StreamExt, stream};
use mime_guess::from_path;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use tokio::fs;
use tokio_stream::wrappers::BroadcastStream;
use tuckmark_contracts::{AgentImportItem, AgentImportProposal, AgentImportTemplate};
use tuckmark_engine::{
    AgentImportError, AgentImportManager, CreateAgentImportSession,
    FulfillAgentImportTemplateInput, RequestAgentImportTemplateInput, UpdateAgentImportItem,
};

use crate::{
    config::{ConfigError, DevdConfig},
    data::{DataError, DataFacade},
    service::{ArtifactAsset, NativeService, NativeServiceError},
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TransportContext {
    Http,
    Ipc,
}

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<DevdConfig>,
    pub data: DataFacade,
    pub agent_import: AgentImportManager,
    pub service: NativeService,
    pub web_dist: Option<Arc<PathBuf>>,
}

impl AppState {
    pub fn open(config: DevdConfig, web_dist: Option<PathBuf>) -> Result<Self, DataError> {
        let data = DataFacade::open(config.active_data_dir())?;
        let agent_import = AgentImportManager::new(data.authority().clone());
        let service =
            NativeService::with_mutation_gate(data.authority().clone(), data.mutation_gate());
        Ok(Self {
            config: Arc::new(config),
            data,
            agent_import,
            service,
            web_dist: web_dist.map(Arc::new),
        })
    }
}

#[derive(Clone, Debug)]
pub struct DevdServerOptions {
    pub host: String,
    pub port: u16,
    pub instance: Option<String>,
    pub data_dir: Option<PathBuf>,
    pub web_dist: Option<PathBuf>,
}

impl Default for DevdServerOptions {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: 5210,
            instance: None,
            data_dir: None,
            web_dist: None,
        }
    }
}

#[derive(Debug)]
pub enum ApiError {
    Data(DataError),
    Config(ConfigError),
    Message {
        status: StatusCode,
        code: Option<&'static str>,
        message: String,
    },
}

impl From<DataError> for ApiError {
    fn from(error: DataError) -> Self {
        Self::Data(error)
    }
}

impl From<ConfigError> for ApiError {
    fn from(error: ConfigError) -> Self {
        Self::Config(error)
    }
}

impl From<AgentImportError> for ApiError {
    fn from(error: AgentImportError) -> Self {
        Self::Message {
            status: StatusCode::BAD_REQUEST,
            code: None,
            message: error.to_string(),
        }
    }
}

impl From<NativeServiceError> for ApiError {
    fn from(error: NativeServiceError) -> Self {
        Self::Message {
            status: StatusCode::BAD_REQUEST,
            code: None,
            message: error.to_string(),
        }
    }
}

impl From<serde_json::Error> for ApiError {
    fn from(error: serde_json::Error) -> Self {
        Self::Data(DataError::Json(error))
    }
}

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self::Message {
            status: StatusCode::BAD_REQUEST,
            code: None,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, body) = match self {
            Self::Data(DataError::RevisionConflict { expected, actual }) => (
                StatusCode::CONFLICT,
                json!({
                    "status": "error",
                    "code": "revision_conflict",
                    "expectedRevision": expected,
                    "actualRevision": actual,
                    "error": format!("Expected revision {expected} but current revision is {actual}."),
                }),
            ),
            Self::Data(error @ DataError::NotFound(_)) => (
                StatusCode::NOT_FOUND,
                json!({ "status": "error", "code": error.code(), "error": error.to_string() }),
            ),
            Self::Data(error @ DataError::Unavailable(_)) => (
                StatusCode::SERVICE_UNAVAILABLE,
                json!({ "status": "error", "code": error.code(), "error": error.to_string() }),
            ),
            Self::Data(error) => (
                StatusCode::BAD_REQUEST,
                json!({ "status": "error", "code": error.code(), "error": error.to_string() }),
            ),
            Self::Config(error) => (
                StatusCode::BAD_REQUEST,
                json!({ "status": "error", "error": error.to_string() }),
            ),
            Self::Message {
                status,
                code,
                message,
            } => {
                let mut body = json!({ "status": "error", "error": message });
                if let Some(code) = code {
                    body["code"] = Value::String(code.into());
                }
                (status, body)
            }
        };
        (status, Json(body)).into_response()
    }
}

pub fn app_router(state: AppState) -> Router {
    app_router_for_transport(state, TransportContext::Http)
}

pub fn app_router_for_transport(state: AppState, transport: TransportContext) -> Router {
    let protected = Router::new()
        .route("/api/data/status", get(data_status))
        .route("/api/data/config", get(data_config))
        .route("/api/data/config/data-directory", put(save_data_directory))
        .route("/api/data/runtime/snapshot", get(runtime_snapshot))
        .route("/api/data/runtime/{command}", post(runtime_command))
        .route("/api/data/inventory/materials", get(inventory_materials))
        .route(
            "/api/data/inventory/adjustments",
            get(inventory_adjustments),
        )
        .route(
            "/api/data/inventory/print-binding",
            post(inventory_print_binding),
        )
        .route("/api/data/inventory/{command}", post(inventory_command))
        .route("/api/data/events", get(data_events))
        .route("/api/data/archive", get(data_archive))
        .route("/api/data/archive/inspect", post(inspect_archive))
        .route("/api/data/archive/import", post(import_archive))
        .route("/api/data/backups", post(create_backup))
        .route("/api/agent-import/catalog", get(agent_catalog))
        .route("/api/agent-import/inventory", get(agent_inventory))
        .route("/api/agent-import/sessions", post(create_agent_session))
        .route(
            "/api/agent-import/sessions/{session_id}",
            get(get_agent_session),
        )
        .route(
            "/api/agent-import/sessions/{session_id}/events",
            get(agent_events),
        )
        .route(
            "/api/agent-import/sessions/{session_id}/restock-targets",
            get(agent_restock_targets),
        )
        .route(
            "/api/agent-import/sessions/{session_id}/items/{item_id}",
            put(update_agent_item),
        )
        .route(
            "/api/agent-import/sessions/{session_id}/items/{item_id}/template-input",
            post(request_agent_template_input),
        )
        .route(
            "/api/agent-import/sessions/{session_id}/events/{event_id}/fulfill",
            post(fulfill_agent_template_input),
        )
        .route(
            "/api/agent-import/sessions/{session_id}/confirm",
            post(confirm_agent_session),
        )
        .route_layer(middleware::from_fn(require_local_origin));

    Router::new()
        .route("/health", get(health))
        .merge(protected)
        .route("/api/templates", get(list_templates))
        .route("/api/printers", get(list_printers))
        .route("/api/printers/probe", post(probe_printer))
        .route("/api/artifacts", get(list_artifacts))
        .route("/api/artifacts/{artifact_id}/png", get(artifact_png))
        .route(
            "/api/artifacts/{artifact_id}/packets",
            get(artifact_packets),
        )
        .route("/api/artifacts/{artifact_id}/svg", get(artifact_svg))
        .route("/api/artifacts/{artifact_id}", get(get_artifact))
        .route(
            "/api/sync/state",
            get(get_sync_state).post(merge_sync_state),
        )
        .route("/api/sync/template-usage", post(upsert_template_usage))
        .route("/api/sync/recent-print", post(upsert_recent_print))
        .route("/api/sync/canvas-draft", post(upsert_canvas_draft))
        .route("/api/preview/template", post(preview_template))
        .route("/api/preview/canvas", post(preview_canvas))
        .route("/api/preview/batch", post(preview_batch))
        .route("/api/preview/safe-text", post(preview_safe_text))
        .route("/api/print/artifact", post(print_artifact))
        .route("/api/print/batch", post(print_batch))
        .route("/api/print/template", post(print_template))
        .route("/api/print/canvas", post(print_canvas))
        .route("/api/print/safe-text", post(print_safe_text))
        .fallback(static_fallback)
        .layer(middleware::from_fn(cors_middleware))
        .layer(axum::Extension(transport))
        .with_state(state)
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "name": "tuckmark" }))
}

async fn data_status(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.data.status()?))
}

async fn data_config(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(serde_json::to_value(state.config.status()?)?))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DataDirectoryRequest {
    data_dir: String,
}

async fn save_data_directory(
    State(state): State<AppState>,
    Json(payload): Json<DataDirectoryRequest>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(serde_json::to_value(
        state.config.save_data_directory(&payload.data_dir)?,
    )?))
}

async fn runtime_snapshot(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.data.read_runtime_snapshot()?))
}

async fn runtime_command(
    State(state): State<AppState>,
    AxumPath(command): AxumPath<String>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let (expected_revision, args) = mutation_payload(payload)?;
    Ok(Json(state.data.mutate_runtime(
        &command,
        expected_revision,
        args,
    )?))
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct MaterialsQuery {
    #[serde(default)]
    query: String,
    #[serde(default)]
    include_archived: bool,
}

async fn inventory_materials(
    State(state): State<AppState>,
    Query(query): Query<MaterialsQuery>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        state
            .data
            .read_materials(&query.query, query.include_archived)?,
    ))
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AdjustmentsQuery {
    material_id: Option<String>,
}

async fn inventory_adjustments(
    State(state): State<AppState>,
    Query(query): Query<AdjustmentsQuery>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        state.data.read_adjustments(query.material_id.as_deref())?,
    ))
}

async fn inventory_command(
    State(state): State<AppState>,
    AxumPath(command): AxumPath<String>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let (expected_revision, args) = mutation_payload(payload)?;
    Ok(Json(state.data.mutate_inventory(
        &command,
        expected_revision,
        args,
    )?))
}

async fn inventory_print_binding(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let (expected_revision, args) = mutation_payload(payload)?;
    let snapshot = state.data.read_inventory_print_snapshot()?;
    let actual_revision = snapshot.revision;
    if actual_revision != expected_revision {
        return Err(DataError::RevisionConflict {
            expected: expected_revision,
            actual: actual_revision,
        }
        .into());
    }
    let args = args
        .as_object()
        .ok_or_else(|| ApiError::bad_request("Print binding arguments must be an object."))?;
    let material_id = required_value_string(args, "materialId")?;
    let binding_id = required_value_string(args, "bindingId")?;
    let material = snapshot
        .materials
        .iter()
        .find(|material| material["id"].as_str() == Some(material_id))
        .ok_or_else(|| DataError::NotFound("Material was not found.".into()))?;
    if material["archivedAt"].is_string() {
        return Err(ApiError::bad_request(
            "Cannot print labels for an archived material.",
        ));
    }
    let binding = material["labelBindings"]
        .as_array()
        .and_then(|bindings| {
            bindings
                .iter()
                .find(|binding| binding["id"].as_str() == Some(binding_id))
        })
        .ok_or_else(|| DataError::NotFound("Template binding was not found.".into()))?;
    match state.service.print_transport_unavailable() {
        Err(error) => Err(error.into()),
        Ok(()) => Ok(Json(json!({
            "revision": actual_revision,
            "data": { "material": material, "binding": binding, "copies": 0, "jobs": [] },
        }))),
    }
}

async fn data_archive(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.data.read_archive()?))
}

async fn inspect_archive(
    State(state): State<AppState>,
    Json(archive): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        json!({ "data": state.data.inspect_archive(archive)? }),
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveImportRequest {
    expected_revision: u64,
    archive_hash: String,
    mode: String,
    archive: Value,
}

async fn import_archive(
    State(state): State<AppState>,
    Json(payload): Json<ArchiveImportRequest>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.data.import_archive(
        payload.expected_revision,
        &payload.archive_hash,
        &payload.mode,
        payload.archive,
    )?))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupRequest {
    expected_revision: u64,
}

async fn create_backup(
    State(state): State<AppState>,
    Json(payload): Json<BackupRequest>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.data.create_backup(payload.expected_revision)?))
}

async fn agent_catalog(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(serde_json::to_value(state.agent_import.catalog()?)?))
}

#[derive(Debug, Deserialize, Default)]
struct AgentInventoryQuery {
    query: Option<String>,
}

async fn agent_inventory(
    State(state): State<AppState>,
    Query(query): Query<AgentInventoryQuery>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "materials": state.agent_import.list_inventory(query.query.as_deref())?,
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAgentSessionRequest {
    session_id: String,
    secret: String,
    proposal: AgentImportProposal,
}

async fn create_agent_session(
    State(state): State<AppState>,
    Json(payload): Json<CreateAgentSessionRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let session = state
        .agent_import
        .create_session(CreateAgentImportSession {
            id: payload.session_id,
            secret: payload.secret,
            proposal: payload.proposal,
        })?;
    Ok((StatusCode::CREATED, Json(json!({ "session": session }))))
}

async fn get_agent_session(
    State(state): State<AppState>,
    AxumPath(session_id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "session": state.agent_import.get_session(&session_id, agent_secret(&headers)?)?,
    })))
}

async fn agent_events(
    State(state): State<AppState>,
    AxumPath(session_id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "events": state.agent_import.list_events(&session_id, agent_secret(&headers)?)?,
    })))
}

async fn agent_restock_targets(
    State(state): State<AppState>,
    AxumPath(session_id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let gate = state.data.mutation_gate();
    let _gate = gate
        .lock()
        .map_err(|_| ApiError::bad_request("DEVD mutation queue is poisoned."))?;
    Ok(Json(json!({
        "targets": state.agent_import.resolve_restock_targets(&session_id, agent_secret(&headers)?)?,
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAgentItemRequest {
    expected_revision: u64,
    item: AgentImportItem,
}

async fn update_agent_item(
    State(state): State<AppState>,
    AxumPath((session_id, item_id)): AxumPath<(String, String)>,
    headers: HeaderMap,
    Json(payload): Json<UpdateAgentItemRequest>,
) -> Result<Json<Value>, ApiError> {
    let session = state.agent_import.update_item(UpdateAgentImportItem {
        session_id,
        secret: agent_secret(&headers)?.to_owned(),
        item_id,
        expected_revision: payload.expected_revision,
        item: payload.item,
    })?;
    Ok(Json(json!({ "session": session })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestAgentTemplateRequest {
    expected_revision: u64,
    template: AgentImportTemplate,
}

async fn request_agent_template_input(
    State(state): State<AppState>,
    AxumPath((session_id, item_id)): AxumPath<(String, String)>,
    headers: HeaderMap,
    Json(payload): Json<RequestAgentTemplateRequest>,
) -> Result<Json<Value>, ApiError> {
    let session = state
        .agent_import
        .request_template_input(RequestAgentImportTemplateInput {
            session_id,
            secret: agent_secret(&headers)?.to_owned(),
            item_id,
            expected_revision: payload.expected_revision,
            template: payload.template,
        })?;
    Ok(Json(json!({ "session": session })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FulfillAgentTemplateRequest {
    expected_revision: u64,
    input: BTreeMap<String, String>,
}

async fn fulfill_agent_template_input(
    State(state): State<AppState>,
    AxumPath((session_id, event_id)): AxumPath<(String, String)>,
    headers: HeaderMap,
    Json(payload): Json<FulfillAgentTemplateRequest>,
) -> Result<Json<Value>, ApiError> {
    let session = state
        .agent_import
        .fulfill_template_input(FulfillAgentImportTemplateInput {
            session_id,
            secret: agent_secret(&headers)?.to_owned(),
            event_id,
            expected_revision: payload.expected_revision,
            input: payload.input,
        })?;
    Ok(Json(json!({ "session": session })))
}

async fn confirm_agent_session(
    State(state): State<AppState>,
    AxumPath(session_id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let gate = state.data.mutation_gate();
    let _gate = gate
        .lock()
        .map_err(|_| ApiError::bad_request("DEVD mutation queue is poisoned."))?;
    let result = state
        .agent_import
        .confirm_with_result(&session_id, agent_secret(&headers)?)?;
    if let Some(event) = result.event {
        state.data.publish_event(event);
    }
    Ok(Json(json!({ "session": result.session })))
}

fn agent_secret(headers: &HeaderMap) -> Result<&str, ApiError> {
    headers
        .get("x-tuckmark-agent-import-key")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("Missing agent import session key."))
}

async fn data_events(State(state): State<AppState>) -> Response {
    let initial = stream::once(async {
        Ok::<Event, Infallible>(Event::default().retry(Duration::from_millis(3000)))
    });
    let updates = BroadcastStream::new(state.data.subscribe()).filter_map(|result| async move {
        let event = result.ok()?;
        let data = serde_json::to_string(&event).ok()?;
        Some(Ok::<Event, Infallible>(
            Event::default()
                .id(event.revision.to_string())
                .event("data-revision")
                .data(data),
        ))
    });
    let stream = initial.chain(updates);
    let mut response = Sse::new(stream)
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("keepalive"),
        )
        .into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache, no-transform"),
    );
    headers.insert(header::CONNECTION, HeaderValue::from_static("keep-alive"));
    response
}

async fn list_templates(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        json!({ "templates": state.service.list_templates()? }),
    ))
}

async fn list_printers(State(state): State<AppState>) -> Json<Value> {
    Json(json!({ "printers": state.service.list_printers() }))
}

async fn probe_printer(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let object = payload
        .as_object()
        .ok_or_else(|| ApiError::bad_request("Printer probe payload must be an object."))?;
    let printer_id = required_value_string(object, "printerId")?;
    let printer_name = optional_value_string(object, "printerName");
    Ok(Json(state.service.probe_printer(printer_id, printer_name)))
}

async fn list_artifacts(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        json!({ "artifacts": state.service.list_artifacts()? }),
    ))
}

async fn get_artifact(
    State(state): State<AppState>,
    AxumPath(artifact_id): AxumPath<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        json!({ "artifact": state.service.get_artifact(&artifact_id)? }),
    ))
}

async fn artifact_png(
    State(state): State<AppState>,
    AxumPath(artifact_id): AxumPath<String>,
) -> Result<Response, ApiError> {
    artifact_asset_response(
        &state.service,
        &artifact_id,
        ArtifactAsset::Png,
        "image/png",
    )
}

async fn artifact_svg(
    State(state): State<AppState>,
    AxumPath(artifact_id): AxumPath<String>,
) -> Result<Response, ApiError> {
    artifact_asset_response(
        &state.service,
        &artifact_id,
        ArtifactAsset::Svg,
        "image/svg+xml",
    )
}

fn artifact_asset_response(
    service: &NativeService,
    artifact_id: &str,
    asset: ArtifactAsset,
    content_type: &'static str,
) -> Result<Response, ApiError> {
    let mut response = Body::from(service.read_artifact_bytes(artifact_id, asset)?).into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    Ok(response)
}

async fn artifact_packets(
    State(state): State<AppState>,
    AxumPath(artifact_id): AxumPath<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(serde_json::to_value(
        state.service.get_artifact_packets(&artifact_id)?,
    )?))
}

async fn get_sync_state(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({ "state": state.service.get_sync_state()? })))
}

async fn merge_sync_state(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        json!({ "state": state.service.merge_sync_state(payload)? }),
    ))
}

async fn upsert_template_usage(
    State(state): State<AppState>,
    Json(record): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "state": state.service.upsert_template_usage_record(record)?,
    })))
}

async fn upsert_recent_print(
    State(state): State<AppState>,
    Json(record): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "state": state.service.upsert_recent_print_record(record)?,
    })))
}

async fn upsert_canvas_draft(
    State(state): State<AppState>,
    Json(record): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "state": state.service.upsert_canvas_draft_record(record)?,
    })))
}

async fn preview_template(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.service.preview_template(payload)?))
}

async fn preview_canvas(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.service.preview_canvas(payload)?))
}

async fn preview_batch(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.service.preview_batch(payload)?))
}

async fn preview_safe_text(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.service.preview_safe_text(payload)?))
}

async fn print_artifact(
    State(state): State<AppState>,
    Json(_payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    print_transport_response(&state.service)
}

async fn print_batch(
    State(state): State<AppState>,
    Json(_payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    print_transport_response(&state.service)
}

async fn print_template(
    State(state): State<AppState>,
    Json(_payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    print_transport_response(&state.service)
}

async fn print_canvas(
    State(state): State<AppState>,
    Json(_payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    print_transport_response(&state.service)
}

async fn print_safe_text(
    State(state): State<AppState>,
    Json(_payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    print_transport_response(&state.service)
}

fn print_transport_response(service: &NativeService) -> Result<Json<Value>, ApiError> {
    match service.print_transport_unavailable() {
        Err(error) => Err(error.into()),
        Ok(()) => Ok(Json(json!({ "status": "completed" }))),
    }
}

async fn cors_preflight() -> Response {
    (
        StatusCode::NO_CONTENT,
        [
            (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*"),
            (
                header::ACCESS_CONTROL_ALLOW_HEADERS,
                "content-type, x-tuckmark-ipc, x-tuckmark-agent-import-key",
            ),
            (
                header::ACCESS_CONTROL_ALLOW_METHODS,
                "GET, POST, PUT, OPTIONS",
            ),
        ],
    )
        .into_response()
}

async fn cors_middleware(request: Request, next: Next) -> Response {
    if request.method() == axum::http::Method::OPTIONS {
        return cors_preflight().await;
    }
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    response
}

async fn static_fallback(State(state): State<AppState>, uri: Uri) -> Response {
    let Some(root) = state.web_dist.as_deref() else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "status": "error", "error": "Not found." })),
        )
            .into_response();
    };
    if uri.path().starts_with("/api/") || uri.path() == "/health" {
        return StatusCode::NOT_FOUND.into_response();
    }
    let relative = uri.path().trim_start_matches('/');
    let candidate = root.join(relative);
    let path = if is_safe_child(root, &candidate) && candidate.is_file() {
        candidate
    } else {
        root.join("index.html")
    };
    let Ok(bytes) = fs::read(&path).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let content_type = from_path(&path).first_or_octet_stream();
    let mut response = Body::from(bytes).into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(content_type.as_ref())
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    response
}

fn is_safe_child(root: &Path, candidate: &Path) -> bool {
    candidate.strip_prefix(root).ok().is_some_and(|relative| {
        !relative
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    })
}

fn mutation_payload(payload: Value) -> Result<(u64, Value), ApiError> {
    let object = payload
        .as_object()
        .ok_or_else(|| ApiError::bad_request("Mutation payload must be an object."))?;
    let expected_revision = object
        .get("expectedRevision")
        .and_then(Value::as_u64)
        .ok_or_else(|| ApiError::bad_request("expectedRevision is required."))?;
    let args = object
        .get("args")
        .cloned()
        .ok_or_else(|| ApiError::bad_request("args is required."))?;
    Ok((expected_revision, args))
}

fn required_value_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a str, ApiError> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request(format!("{key} is required.")))
}

fn optional_value_string(object: &Map<String, Value>, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

async fn require_local_origin(request: Request, next: Next) -> Response {
    if request
        .extensions()
        .get::<TransportContext>()
        .is_some_and(|transport| *transport == TransportContext::Ipc)
    {
        if request
            .headers()
            .get("x-tuckmark-ipc")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value == "1")
        {
            return next.run(request).await;
        }
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "status": "error", "error": "DEVD IPC requests require x-tuckmark-ipc: 1." })),
        )
            .into_response();
    }

    let loopback = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .is_some_and(|ConnectInfo(address)| is_loopback_peer(address.ip()));
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !loopback || !is_loopback_hostname(host) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "status": "error", "error": "DEVD only accepts loopback requests." })),
        )
            .into_response();
    }
    if let Some(origin) = request.headers().get(header::ORIGIN) {
        let allowed = origin
            .to_str()
            .ok()
            .and_then(|value| value.parse::<Uri>().ok())
            .and_then(|uri| uri.authority().map(|authority| authority.host().to_owned()))
            .is_some_and(|origin_host| {
                is_loopback_hostname(&origin_host) || origin_host == host_host(host)
            });
        if !allowed {
            return (
                StatusCode::FORBIDDEN,
                Json(
                    json!({ "status": "error", "error": "Cross-origin DEVD access is forbidden." }),
                ),
            )
                .into_response();
        }
    }
    next.run(request).await
}

fn host_host(value: &str) -> String {
    if let Some(stripped) = value.strip_prefix('[') {
        return stripped.split(']').next().unwrap_or_default().to_owned();
    }
    value
        .rsplit_once(':')
        .filter(|(_, port)| port.bytes().all(|byte| byte.is_ascii_digit()))
        .map_or_else(|| value.to_owned(), |(host, _)| host.to_owned())
}

fn is_loopback_hostname(value: &str) -> bool {
    let owned_host = host_host(value);
    let host = owned_host.trim_matches(['[', ']']);
    if host.eq_ignore_ascii_case("localhost") || host == "::1" {
        return true;
    }
    host.parse::<IpAddr>()
        .is_ok_and(|address| address.is_loopback())
}

fn is_loopback_peer(address: IpAddr) -> bool {
    address.is_loopback()
        || matches!(address, IpAddr::V6(value) if value.to_ipv4_mapped().is_some_and(|value| Ipv4Addr::is_loopback(&value)))
}
