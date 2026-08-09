use std::net::SocketAddr;

use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tempfile::tempdir;
use tower::ServiceExt;
use tuckmark_devd::{
    AppState,
    config::DevdConfig,
    routes::{TransportContext, app_router_for_transport},
};

fn test_state() -> (tempfile::TempDir, AppState) {
    let directory = tempdir().unwrap();
    let config = DevdConfig::resolve(Some(directory.path().to_path_buf())).unwrap();
    let state = AppState::open(config, None).unwrap();
    (directory, state)
}

fn json_request(path: &str, payload: Value) -> Request<Body> {
    let mut request = Request::builder()
        .method("POST")
        .uri(path)
        .header(header::HOST, "127.0.0.1")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&payload).unwrap()))
        .unwrap();
    request
        .extensions_mut()
        .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 34000))));
    request
}

async fn response_json(response: axum::response::Response) -> Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

fn system_binding(field_overrides: Value, print_quantity: u64) -> Value {
    json!({
        "id": "binding-system",
        "templateSource": "system",
        "templateId": "cable-tag",
        "templateName": "Cable Tag",
        "printQuantity": print_quantity,
        "fieldOverrides": field_overrides,
        "createdAt": "2026-08-09T00:00:00.000Z",
        "updatedAt": "2026-08-09T00:00:00.000Z"
    })
}

fn save_material(state: &AppState, binding: Value) -> (String, u64) {
    let result = state
        .data
        .mutate_inventory(
            "save-material",
            0,
            json!({
                "fullName": "Tuckmark inventory print material",
                "description": "Adapter contract material",
                "deviceDetails": "No device transport",
                "currentQuantity": 7,
                "labelBindings": [binding]
            }),
        )
        .unwrap();
    (
        result["data"]["id"].as_str().unwrap().to_owned(),
        result["revision"].as_u64().unwrap(),
    )
}

fn print_payload(revision: u64, material_id: &str, binding_id: &str) -> Value {
    json!({
        "expectedRevision": revision,
        "args": {
            "materialId": material_id,
            "bindingId": binding_id,
            "printerId": "printer-67"
        }
    })
}

#[tokio::test]
async fn inventory_print_validates_default_and_override_quantities_before_the_transport_gate() {
    let (_directory, state) = test_state();
    let (material_id, revision) = save_material(&state, system_binding(json!({}), 0));
    let app = app_router_for_transport(state, TransportContext::Http);

    let invalid_default = app
        .clone()
        .oneshot(json_request(
            "/api/data/inventory/print-binding",
            print_payload(revision, &material_id, "binding-system"),
        ))
        .await
        .unwrap();
    assert_eq!(invalid_default.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(invalid_default).await["error"],
        "Print quantity must be a positive integer."
    );

    let mut overridden = print_payload(revision, &material_id, "binding-system");
    overridden["args"]["quantity"] = json!(2);
    let transport = app
        .oneshot(json_request(
            "/api/data/inventory/print-binding",
            overridden,
        ))
        .await
        .unwrap();
    assert_eq!(transport.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(transport).await["error"],
        "Server-side printer control is disabled. Set TUCKMARK_ENABLE_SERVER_SIDE_PRINT=1 to enable it."
    );
}

#[tokio::test]
async fn inventory_print_applies_binding_field_overrides_before_the_transport_gate() {
    let (_directory, state) = test_state();
    let (material_id, revision) = save_material(&state, system_binding(json!({ "name": "" }), 2));
    let app = app_router_for_transport(state, TransportContext::Http);

    let response = app
        .oneshot(json_request(
            "/api/data/inventory/print-binding",
            print_payload(revision, &material_id, "binding-system"),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(
        response_json(response).await["error"]
            .as_str()
            .unwrap()
            .contains("missing required field: name")
    );
}

#[tokio::test]
async fn inventory_print_resolves_the_authoritative_user_template_document_before_the_gate() {
    let (_directory, state) = test_state();
    let saved = state
        .data
        .mutate_runtime(
            "save-template",
            0,
            json!({
                "templateId": "user-template-67",
                "name": "Inventory user template",
                "document": {
                    "version": 1,
                    "unit": "mm",
                    "id": "inventory-user-template-67",
                    "presetId": "custom",
                    "name": "Inventory user template",
                    "source": { "kind": "scratch", "presetId": "custom" },
                    "width": 48,
                    "height": 24,
                    "fields": [],
                    "elements": [],
                    "editor": {
                        "gridEnabled": true,
                        "gridSize": 1,
                        "snapEnabled": true,
                        "snapStep": 1
                    }
                }
            }),
        )
        .unwrap();
    let material = state
        .data
        .mutate_inventory(
            "save-material",
            saved["revision"].as_u64().unwrap(),
            json!({
                "fullName": "User-template inventory material",
                "currentQuantity": 3,
                "labelBindings": [{
                    "id": "binding-user",
                    "templateSource": "user-template",
                    "templateId": "user-template-67",
                    "templateName": "Inventory user template",
                    "printQuantity": 1,
                    "fieldOverrides": {},
                    "createdAt": "2026-08-09T00:00:00.000Z",
                    "updatedAt": "2026-08-09T00:00:00.000Z"
                }]
            }),
        )
        .unwrap();
    let app = app_router_for_transport(state, TransportContext::Http);

    let response = app
        .oneshot(json_request(
            "/api/data/inventory/print-binding",
            print_payload(
                material["revision"].as_u64().unwrap(),
                material["data"]["id"].as_str().unwrap(),
                "binding-user",
            ),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(response).await["error"],
        "Server-side printer control is disabled. Set TUCKMARK_ENABLE_SERVER_SIDE_PRINT=1 to enable it."
    );
}
