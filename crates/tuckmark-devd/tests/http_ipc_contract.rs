use std::{net::SocketAddr, time::Duration};

use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tempfile::tempdir;
#[cfg(any(unix, windows))]
use tokio::io::{AsyncReadExt, AsyncWriteExt};
#[cfg(unix)]
use tokio::net::UnixStream;
#[cfg(windows)]
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};
use tokio::time::timeout;
use tower::ServiceExt;
#[cfg(unix)]
use tuckmark_devd::ipc::bind_unix_ipc;
#[cfg(windows)]
use tuckmark_devd::ipc::bind_windows_ipc;
use tuckmark_devd::{
    AppState,
    config::DevdConfig,
    routes::{TransportContext, app_router_for_transport},
};
use tuckmark_engine::{CommitRequest, JsonWrite};

const AGENT_SESSION_ID: &str = "agent-import-http-contract-session";
const AGENT_SESSION_SECRET: &str = "agent-import-http-contract-secret-012345";

fn test_state() -> (tempfile::TempDir, AppState) {
    let directory = tempdir().unwrap();
    let config = DevdConfig::resolve(Some(directory.path().to_path_buf())).unwrap();
    let state = AppState::open(config, None).unwrap();
    (directory, state)
}

fn http_request_from(path: &str, address: SocketAddr) -> Request<Body> {
    let mut request = Request::builder()
        .uri(path)
        .header(header::HOST, "127.0.0.1")
        .body(Body::empty())
        .unwrap();
    request.extensions_mut().insert(ConnectInfo(address));
    request
}

fn http_request(path: &str) -> Request<Body> {
    http_request_from(path, SocketAddr::from(([127, 0, 0, 1], 34000)))
}

fn json_request(method: axum::http::Method, path: &str, payload: Value) -> Request<Body> {
    let mut request = http_request(path);
    *request.method_mut() = method;
    request.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("application/json"),
    );
    *request.body_mut() = Body::from(serde_json::to_vec(&payload).unwrap());
    request
}

async fn response_json(response: axum::response::Response) -> Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

#[cfg(windows)]
async fn open_windows_ipc(endpoint: &str) -> NamedPipeClient {
    const ERROR_PIPE_BUSY: i32 = 231;

    for attempt in 0..100 {
        // `spawn` does not poll the listener synchronously. Yield once so it
        // can start waiting, then tolerate the documented busy-pipe race.
        tokio::task::yield_now().await;
        match ClientOptions::new().open(endpoint) {
            Ok(stream) => return stream,
            Err(error) if error.raw_os_error() == Some(ERROR_PIPE_BUSY) && attempt < 99 => {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            Err(error) => panic!("failed to open Windows IPC endpoint: {error}"),
        }
    }

    unreachable!("Windows IPC open retry loop returned without a stream")
}

fn agent_json_request(method: axum::http::Method, path: &str, payload: Value) -> Request<Body> {
    let mut request = json_request(method, path, payload);
    request.headers_mut().insert(
        "x-tuckmark-agent-import-key",
        header::HeaderValue::from_static(AGENT_SESSION_SECRET),
    );
    request
}

fn agent_session_payload() -> Value {
    json!({
        "sessionId": AGENT_SESSION_ID,
        "secret": AGENT_SESSION_SECRET,
        "proposal": {
            "schema": "tuckmark.agent-import.v1",
            "items": [{
                "id": "agent-http-item",
                "kind": "new",
                "quantity": 1,
                "material": { "fullName": "HTTP contract material" },
                "templateAlternatives": [{
                    "source": "system",
                    "id": "cable-tag",
                    "name": "Cable Tag",
                    "fields": [{ "key": "name", "label": "Name" }]
                }]
            }]
        }
    })
}

#[tokio::test]
async fn frozen_http_fixture_preserves_health_conflict_and_origin_boundaries() {
    let (_directory, state) = test_state();
    for expected_revision in 0..5 {
        state
            .data
            .mutate_runtime(
                "save-settings",
                expected_revision,
                json!({ "patch": { "threshold": 140 + expected_revision } }),
            )
            .unwrap();
    }
    let app = app_router_for_transport(state, TransportContext::Http);

    let health = app.clone().oneshot(http_request("/health")).await.unwrap();
    assert_eq!(health.status(), StatusCode::OK);
    assert_eq!(
        response_json(health).await,
        json!({ "status": "ok", "name": "tuckmark" })
    );

    let mapped_loopback = app
        .clone()
        .oneshot(http_request_from(
            "/api/data/status",
            "[::ffff:127.0.0.1]:34000".parse().unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(mapped_loopback.status(), StatusCode::OK);

    let remote_peer = app
        .clone()
        .oneshot(http_request_from(
            "/api/data/status",
            SocketAddr::from(([192, 0, 2, 67], 34000)),
        ))
        .await
        .unwrap();
    assert_eq!(remote_peer.status(), StatusCode::FORBIDDEN);

    let mut conflict = http_request("/api/data/runtime/save-settings");
    *conflict.method_mut() = axum::http::Method::POST;
    conflict.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("application/json"),
    );
    *conflict.body_mut() = Body::from(
        serde_json::to_vec(&json!({
            "expectedRevision": 4,
            "args": { "patch": { "threshold": 144 } },
        }))
        .unwrap(),
    );
    let conflict = app.clone().oneshot(conflict).await.unwrap();
    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(conflict).await,
        json!({
            "status": "error",
            "code": "revision_conflict",
            "expectedRevision": 4,
            "actualRevision": 5,
            "error": "Expected revision 4 but current revision is 5.",
        })
    );

    let mut cross_origin = http_request("/api/data/status");
    cross_origin.headers_mut().insert(
        header::ORIGIN,
        header::HeaderValue::from_static("https://synthetic.invalid"),
    );
    let cross_origin = app.oneshot(cross_origin).await.unwrap();
    assert_eq!(cross_origin.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(cross_origin).await,
        json!({ "status": "error", "error": "Cross-origin DEVD access is forbidden." })
    );

    let preflight = Request::builder()
        .method(axum::http::Method::OPTIONS)
        .uri("/api/data/status")
        .body(Body::empty())
        .unwrap();
    let (_preflight_directory, preflight_state) = test_state();
    let preflight = app_router_for_transport(preflight_state, TransportContext::Http)
        .oneshot(preflight)
        .await
        .unwrap();
    assert_eq!(preflight.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        preflight
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .unwrap(),
        "*"
    );
}

#[tokio::test]
async fn sse_observes_the_committed_revision() {
    let (_directory, state) = test_state();
    let http = app_router_for_transport(state.clone(), TransportContext::Http);
    let sse = http
        .clone()
        .oneshot(http_request("/api/data/events"))
        .await
        .unwrap();
    assert_eq!(sse.status(), StatusCode::OK);
    assert_eq!(
        sse.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-cache, no-transform"
    );
    let mut body = sse.into_body();
    let retry = timeout(Duration::from_secs(1), body.frame())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
        .into_data()
        .unwrap();
    assert_eq!(&retry[..], b"retry: 3000\n\n");

    let updated = state
        .data
        .mutate_runtime("save-settings", 0, json!({ "patch": { "threshold": 151 } }))
        .unwrap();
    assert_eq!(updated["revision"], 1);
    let event = timeout(Duration::from_secs(1), body.frame())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
        .into_data()
        .unwrap();
    let event = String::from_utf8(event.to_vec()).unwrap();
    assert!(event.contains("id: 1\n"));
    assert!(event.contains("event: data-revision\n"));
    assert!(event.contains("\"revision\":1"));
}

#[cfg(unix)]
#[tokio::test]
async fn unix_named_ipc_observes_the_committed_revision() {
    let (_directory, state) = test_state();
    state
        .data
        .mutate_runtime("save-settings", 0, json!({ "patch": { "threshold": 151 } }))
        .unwrap();
    let instance = format!("ticket-67-{}", std::process::id());
    let ipc = bind_unix_ipc(&instance).await.unwrap();
    let endpoint = ipc.endpoint().address.clone();
    let (listener, _cleanup) = ipc.into_parts();
    let ipc_router = app_router_for_transport(state, TransportContext::Ipc);
    let server = tokio::spawn(async move {
        axum::serve(listener, ipc_router.into_make_service())
            .await
            .unwrap();
    });
    let mut stream = UnixStream::connect(endpoint).await.unwrap();
    stream
        .write_all(
            b"GET /api/data/status HTTP/1.1\r\nHost: localhost\r\nx-tuckmark-ipc: 1\r\nConnection: close\r\n\r\n",
        )
        .await
        .unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).await.unwrap();
    server.abort();
    assert!(response.starts_with("HTTP/1.1 200"));
    assert!(response.contains("\"revision\":1"));
}

#[cfg(windows)]
#[tokio::test]
async fn windows_named_ipc_observes_the_committed_revision() {
    let (_directory, state) = test_state();
    state
        .data
        .mutate_runtime("save-settings", 0, json!({ "patch": { "threshold": 151 } }))
        .unwrap();
    let instance = format!("ticket-67-{}", std::process::id());
    let ipc = bind_windows_ipc(&instance).unwrap();
    let endpoint = ipc.endpoint().address.clone();
    let ipc_router = app_router_for_transport(state, TransportContext::Ipc);
    let server = tokio::spawn(async move {
        axum::serve(ipc, ipc_router.into_make_service())
            .await
            .unwrap();
    });
    let mut stream = open_windows_ipc(&endpoint).await;
    stream
        .write_all(
            b"GET /api/data/status HTTP/1.1\r\nHost: localhost\r\nx-tuckmark-ipc: 1\r\nConnection: close\r\n\r\n",
        )
        .await
        .unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).await.unwrap();
    server.abort();
    assert!(response.starts_with("HTTP/1.1 200"));
    assert!(response.contains("\"revision\":1"));
}

#[cfg(windows)]
#[tokio::test]
async fn windows_named_ipc_serves_agent_inventory_contract() {
    let (_directory, state) = test_state();
    state
        .data
        .authority()
        .commit(CommitRequest {
            expected_revision: 0,
            writes: vec![JsonWrite::new(
                "inventory/materials/windows-ipc-material.json",
                json!({
                    "id": "windows-ipc-material",
                    "fullName": "Windows IPC material",
                    "createdAt": "2026-08-10T00:00:00Z",
                    "updatedAt": "2026-08-10T00:00:00Z",
                    "labelBindings": []
                }),
            )],
            deletes: vec![],
            domains: vec!["inventory".into()],
            reason: "windows-named-ipc-agent-inventory-contract".into(),
        })
        .unwrap();
    let instance = format!("ticket-67-inventory-{}", std::process::id());
    let ipc = bind_windows_ipc(&instance).unwrap();
    let endpoint = ipc.endpoint().address.clone();
    let ipc_router = app_router_for_transport(state, TransportContext::Ipc);
    let server = tokio::spawn(async move {
        axum::serve(ipc, ipc_router.into_make_service())
            .await
            .unwrap();
    });
    let mut stream = open_windows_ipc(&endpoint).await;
    stream
        .write_all(
            b"GET /api/agent-import/inventory HTTP/1.1\r\nHost: localhost\r\nx-tuckmark-ipc: 1\r\nConnection: close\r\n\r\n",
        )
        .await
        .unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).await.unwrap();
    server.abort();
    assert!(response.starts_with("HTTP/1.1 200"));
    assert!(response.contains("windows-ipc-material"));
}

#[tokio::test]
async fn native_service_routes_render_persist_and_serve_contract_artifacts() {
    let (_directory, state) = test_state();
    let app = app_router_for_transport(state, TransportContext::Http);

    let templates = app
        .clone()
        .oneshot(http_request("/api/templates"))
        .await
        .unwrap();
    assert_eq!(templates.status(), StatusCode::OK);
    let templates = response_json(templates).await;
    assert_eq!(
        templates["templates"][0]["id"],
        Value::String("shipping-compact".into())
    );

    let preview = app
        .clone()
        .oneshot(json_request(
            axum::http::Method::POST,
            "/api/preview/template",
            json!({
                "templateId": "shipping-compact",
                "input": {
                    "recipient": "Ada",
                    "address": "Loopback Lane",
                    "orderId": "ORDER-67",
                    "note": "contract"
                }
            }),
        ))
        .await
        .unwrap();
    assert_eq!(preview.status(), StatusCode::OK);
    let preview = response_json(preview).await;
    let artifact_id = preview["artifact"]["id"].as_str().unwrap().to_owned();

    let png = app
        .clone()
        .oneshot(http_request(&format!("/api/artifacts/{artifact_id}/png")))
        .await
        .unwrap();
    assert_eq!(png.status(), StatusCode::OK);
    assert_eq!(
        png.headers().get(header::CONTENT_TYPE).unwrap(),
        "image/png"
    );
    assert!(
        !png.into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .is_empty()
    );

    let svg = app
        .clone()
        .oneshot(http_request(&format!("/api/artifacts/{artifact_id}/svg")))
        .await
        .unwrap();
    assert_eq!(svg.status(), StatusCode::OK);
    assert_eq!(
        svg.headers().get(header::CONTENT_TYPE).unwrap(),
        "image/svg+xml"
    );

    let packets = app
        .clone()
        .oneshot(http_request(&format!(
            "/api/artifacts/{artifact_id}/packets"
        )))
        .await
        .unwrap();
    assert_eq!(packets.status(), StatusCode::OK);
    assert_eq!(response_json(packets).await["artifactId"], artifact_id);

    let sync = app
        .clone()
        .oneshot(json_request(
            axum::http::Method::POST,
            "/api/sync/state",
            json!({
                "schemaVersion": 1,
                "updatedAt": "2026-08-09T00:00:00.000Z",
                "templateUsageRecords": [],
                "recentPrintRecords": [],
                "canvasDraftRecords": []
            }),
        ))
        .await
        .unwrap();
    assert_eq!(sync.status(), StatusCode::OK);
    assert_eq!(response_json(sync).await["state"]["schemaVersion"], 1);

    let print = app
        .oneshot(json_request(
            axum::http::Method::POST,
            "/api/print/artifact",
            json!({ "printerId": "none", "artifactId": artifact_id }),
        ))
        .await
        .unwrap();
    assert_eq!(print.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(print).await["error"],
        "Server-side printer control is disabled. Set TUCKMARK_ENABLE_SERVER_SIDE_PRINT=1 to enable it."
    );
}

#[tokio::test]
async fn sync_record_routes_apply_existing_optional_field_defaults() {
    let (_directory, state) = test_state();
    let app = app_router_for_transport(state, TransportContext::Http);
    let response = app
        .oneshot(json_request(
            axum::http::Method::POST,
            "/api/sync/template-usage",
            json!({
                "kind": "template_usage",
                "recordId": "usage-67",
                "version": 1,
                "vectorClock": {},
                "updatedAt": "2026-08-09T00:00:00.000Z",
                "hash": "usage-67-hash",
                "payload": {
                    "id": "shipping-compact",
                    "name": "Shipping Compact",
                    "description": "Compact shipping label",
                    "usedAt": "2026-08-09T00:00:00.000Z"
                }
            }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let state = response_json(response).await["state"].clone();
    assert_eq!(
        state["templateUsageRecords"][0]["vectorClock"],
        json!({ "browser": 0, "service": 0 })
    );
    assert_eq!(state["templateUsageRecords"][0]["conflicts"], json!([]));
}

#[tokio::test]
async fn sync_record_routes_reject_payloads_outside_the_existing_schema() {
    let (_directory, state) = test_state();
    let app = app_router_for_transport(state, TransportContext::Http);
    let response = app
        .oneshot(json_request(
            axum::http::Method::POST,
            "/api/sync/template-usage",
            json!({
                "kind": "template_usage",
                "recordId": "usage-invalid",
                "version": 1,
                "vectorClock": {},
                "updatedAt": "2026-08-09T00:00:00.000Z",
                "hash": "usage-invalid-hash",
                "payload": { "id": "shipping-compact" }
            }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(response_json(response).await["status"], "error");
}

#[tokio::test]
async fn agent_import_routes_preserve_optional_defaults_and_reject_explicit_nulls() {
    let (_directory, state) = test_state();
    let app = app_router_for_transport(state, TransportContext::Http);
    let created = app
        .clone()
        .oneshot(json_request(
            axum::http::Method::POST,
            "/api/agent-import/sessions",
            agent_session_payload(),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let created = response_json(created).await;
    let item = &created["session"]["proposal"]["items"][0];
    assert_eq!(item["sourceNote"], "");
    assert_eq!(
        item["templateAlternatives"][0]["fields"][0]["required"],
        false
    );
    assert_eq!(
        item["templateAlternatives"][0]["fields"][0]["multiline"],
        false
    );
    for key in [
        "targetMaterialId",
        "targetMaterialUpdatedAt",
        "template",
        "labelPrintQuantity",
    ] {
        assert!(item.get(key).is_none(), "{key} must remain omitted");
    }

    let mut null_proposal_note = agent_session_payload();
    null_proposal_note["proposal"]["sourceNote"] = Value::Null;
    let mut null_target = agent_session_payload();
    null_target["proposal"]["items"][0]["targetMaterialId"] = Value::Null;
    let mut null_template = agent_session_payload();
    null_template["proposal"]["items"][0]["template"] = Value::Null;
    let mut null_label_quantity = agent_session_payload();
    null_label_quantity["proposal"]["items"][0]["labelPrintQuantity"] = Value::Null;
    let mut null_material_default = agent_session_payload();
    null_material_default["proposal"]["items"][0]["material"]["description"] = Value::Null;
    let mut null_alternatives = agent_session_payload();
    null_alternatives["proposal"]["items"][0]["templateAlternatives"] = Value::Null;
    for payload in [
        null_proposal_note,
        null_target,
        null_template,
        null_label_quantity,
        null_material_default,
        null_alternatives,
    ] {
        let response = app
            .clone()
            .oneshot(json_request(
                axum::http::Method::POST,
                "/api/agent-import/sessions",
                payload,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    let mut nullable_pending_event = agent_session_payload();
    nullable_pending_event["sessionId"] = json!("agent-import-http-nullable-event-session");
    nullable_pending_event["proposal"]["items"][0]["pendingTemplateEventId"] = Value::Null;
    let response = app
        .clone()
        .oneshot(json_request(
            axum::http::Method::POST,
            "/api/agent-import/sessions",
            nullable_pending_event,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    assert!(
        response_json(response).await["session"]["proposal"]["items"][0]["pendingTemplateEventId"]
            .is_null()
    );

    let mut null_item_note = created["session"]["proposal"]["items"][0].clone();
    null_item_note["sourceNote"] = Value::Null;
    let response = app
        .clone()
        .oneshot(agent_json_request(
            axum::http::Method::PUT,
            &format!("/api/agent-import/sessions/{AGENT_SESSION_ID}/items/agent-http-item"),
            json!({ "expectedRevision": 0, "item": null_item_note }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let response = app
        .clone()
        .oneshot(agent_json_request(
            axum::http::Method::POST,
            &format!(
                "/api/agent-import/sessions/{AGENT_SESSION_ID}/items/agent-http-item/template-input"
            ),
            json!({
                "expectedRevision": 0,
                "template": {
                    "source": "system",
                    "id": "shipping-compact",
                    "name": "Compact Shipping Label",
                    "recommendedUse": null
                }
            }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let response = app
        .clone()
        .oneshot(agent_json_request(
            axum::http::Method::POST,
            &format!(
                "/api/agent-import/sessions/{AGENT_SESSION_ID}/items/agent-http-item/template-input"
            ),
            json!({
                "expectedRevision": 0,
                "template": {
                    "source": "system",
                    "id": "shipping-compact",
                    "name": "Compact Shipping Label"
                },
                "unexpected": true
            }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let requested = app
        .clone()
        .oneshot(agent_json_request(
            axum::http::Method::POST,
            &format!(
                "/api/agent-import/sessions/{AGENT_SESSION_ID}/items/agent-http-item/template-input"
            ),
            json!({
                "expectedRevision": 0,
                "template": {
                    "source": "system",
                    "id": "shipping-compact",
                    "name": "Compact Shipping Label"
                }
            }),
        ))
        .await
        .unwrap();
    assert_eq!(requested.status(), StatusCode::OK);
    let requested = response_json(requested).await;
    assert_eq!(
        requested["session"]["proposal"]["items"][0]["templateAlternatives"][0]["id"],
        "cable-tag"
    );
    let event = &requested["session"]["events"][0];
    let fulfilled = app
        .oneshot(agent_json_request(
            axum::http::Method::POST,
            &format!(
                "/api/agent-import/sessions/{AGENT_SESSION_ID}/events/{}/fulfill",
                event["id"].as_str().unwrap()
            ),
            json!({
                "expectedRevision": event["revision"],
                "input": {
                    "recipient": "Ada",
                    "address": "Loopback Lane",
                    "orderId": "ORDER-67"
                }
            }),
        ))
        .await
        .unwrap();
    assert_eq!(fulfilled.status(), StatusCode::OK);
    assert_eq!(
        response_json(fulfilled).await["session"]["proposal"]["items"][0]["templateAlternatives"]
            [0]["id"],
        "cable-tag"
    );
}

#[tokio::test]
async fn agent_inventory_http_and_ipc_apply_the_shared_inventory_contract() {
    let (_directory, state) = test_state();
    state
        .data
        .authority()
        .commit(CommitRequest {
            expected_revision: 0,
            writes: vec![JsonWrite::new(
                "inventory/materials/adapter-canonical-material.json",
                json!({
                    "id": "adapter-canonical-material",
                    "fullName": "Adapter canonical material",
                    "matrixCode": null,
                    "createdAt": "2026-08-09T00:00:00Z",
                    "updatedAt": "2026-08-09T00:00:00Z",
                    "labelBindings": [{
                        "id": "adapter-canonical-binding",
                        "templateSource": "system",
                        "templateId": "cable-tag",
                        "templateName": "Cable Tag",
                        "createdAt": "2026-08-09T00:00:00Z",
                        "updatedAt": "2026-08-09T00:00:00Z",
                        "discard": true
                    }]
                }),
            )],
            deletes: vec![],
            domains: vec!["inventory".into()],
            reason: "agent-inventory-adapter-contract-fixture".into(),
        })
        .unwrap();

    let http = app_router_for_transport(state.clone(), TransportContext::Http);
    let http_response = http
        .oneshot(http_request("/api/agent-import/inventory"))
        .await
        .unwrap();
    assert_eq!(http_response.status(), StatusCode::OK);
    let http_response = response_json(http_response).await;

    let ipc = app_router_for_transport(state, TransportContext::Ipc);
    let mut ipc_request = http_request("/api/agent-import/inventory");
    ipc_request
        .headers_mut()
        .insert("x-tuckmark-ipc", header::HeaderValue::from_static("1"));
    let ipc_response = ipc.oneshot(ipc_request).await.unwrap();
    assert_eq!(ipc_response.status(), StatusCode::OK);
    let ipc_response = response_json(ipc_response).await;

    for response in [http_response, ipc_response] {
        let material = &response["materials"][0];
        assert!(material.get("matrixCode").is_none());
        assert_eq!(
            material["labelBindings"],
            json!([{
                "id": "adapter-canonical-binding",
                "templateSource": "system",
                "templateId": "cable-tag",
                "templateName": "Cable Tag",
                "printQuantity": 1,
                "fieldOverrides": {},
                "createdAt": "2026-08-09T00:00:00Z",
                "updatedAt": "2026-08-09T00:00:00Z"
            }])
        );
    }
}

#[tokio::test]
async fn archive_import_rejects_noncanonical_hash_before_data_mutation() {
    let (_directory, state) = test_state();
    let app = app_router_for_transport(state.clone(), TransportContext::Http);
    for archive_hash in ["a".repeat(63), "A".repeat(64)] {
        let response = app
            .clone()
            .oneshot(json_request(
                axum::http::Method::POST,
                "/api/data/archive/import",
                json!({
                    "expectedRevision": 0,
                    "archiveHash": archive_hash,
                    "mode": "replace",
                    "archive": {}
                }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(
            response_json(response).await["error"]
                .as_str()
                .unwrap()
                .contains("archiveHash")
        );
    }
    assert_eq!(state.data.status().unwrap()["revision"], 0);
}
