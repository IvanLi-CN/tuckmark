use serde_json::{Value, json};
use tempfile::tempdir;
use tuckmark_contracts::{AgentImportProposal, AgentImportTemplate};
use tuckmark_engine::{
    AgentImportCatalog, AgentImportError, AgentImportManager, CommitRequest,
    CreateAgentImportSession, DataAuthority, JsonWrite, RequestAgentImportTemplateInput,
    UpdateAgentImportItem,
};

const SESSION_ID: &str = "agent-import-input-parity-session";
const SECRET: &str = "agent-import-input-parity-secret-012345";

struct TestManager {
    _directory: tempfile::TempDir,
    manager: AgentImportManager,
}

fn manager() -> TestManager {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();
    TestManager {
        _directory: directory,
        manager: AgentImportManager::new(authority),
    }
}

fn proposal_value() -> Value {
    json!({
        "schema": "tuckmark.agent-import.v1",
        "items": [{
            "id": "parity-new-item",
            "kind": "new",
            "quantity": 1,
            "material": { "fullName": "Parity material" },
            "template": {
                "source": "system",
                "id": "cable-tag",
                "name": "Cable Tag",
                "fields": [{ "key": "name", "label": "Name" }]
            }
        }]
    })
}

fn proposal(value: Value) -> AgentImportProposal {
    serde_json::from_value(value).unwrap()
}

fn create_session(
    manager: &AgentImportManager,
    id: impl Into<String>,
    secret: impl Into<String>,
    proposal: AgentImportProposal,
) -> Result<tuckmark_contracts::AgentImportSession, AgentImportError> {
    manager.create_session(CreateAgentImportSession {
        id: id.into(),
        secret: secret.into(),
        proposal,
    })
}

#[test]
fn create_session_normalizes_schema_defaults_and_keeps_template_alternatives() {
    let fixture = manager();
    let mut value = proposal_value();
    value["items"][0]["template"]["recommendedUse"] = json!({ "scope": "  electronics  " });
    value["items"][0]["templateAlternatives"] = json!([
        {
            "source": "system",
            "id": "shipping-compact",
            "name": "Compact Shipping Label",
            "fields": [{ "key": "recipient", "label": "Recipient" }],
            "recommendedUse": { "scope": " shipping " }
        }
    ]);

    let session = create_session(&fixture.manager, SESSION_ID, SECRET, proposal(value)).unwrap();
    let item = &session.proposal.items[0];
    assert_eq!(item.material["description"], "");
    assert_eq!(item.material["deviceDetails"], "");
    assert_eq!(item.material["packagingRemark"], "");
    assert_eq!(item.template.as_ref().unwrap().fields[0]["required"], false);
    assert_eq!(
        item.template.as_ref().unwrap().fields[0]["multiline"],
        false
    );
    assert_eq!(
        item.template.as_ref().unwrap().extra["recommendedUse"],
        "electronics"
    );
    assert_eq!(
        item.extra["templateAlternatives"][0]["fields"][0]["required"],
        false
    );
    assert_eq!(
        item.extra["templateAlternatives"][0]["fields"][0]["multiline"],
        false
    );
    assert_eq!(
        item.extra["templateAlternatives"][0]["recommendedUse"],
        "shipping"
    );

    let response = serde_json::to_value(session).unwrap();
    assert!(
        response["proposal"]["items"][0]
            .get("templateAlternatives")
            .is_some()
    );
}

#[test]
fn create_session_rejects_material_and_template_values_outside_the_schema() {
    for (path, invalid) in [
        ("description", Value::Null),
        ("deviceDetails", json!(42)),
        ("packagingRemark", json!({ "unexpected": true })),
        ("baseName", Value::Null),
    ] {
        let fixture = manager();
        let mut value = proposal_value();
        value["items"][0]["material"][path] = invalid;
        assert!(create_session(&fixture.manager, SESSION_ID, SECRET, proposal(value)).is_err());
    }

    for (field_key, invalid) in [("required", json!("true")), ("multiline", json!(1))] {
        let fixture = manager();
        let mut value = proposal_value();
        value["items"][0]["template"]["fields"][0][field_key] = invalid;
        assert!(create_session(&fixture.manager, SESSION_ID, SECRET, proposal(value)).is_err());
    }

    for invalid in [Value::Null, json!({ "scope": 42 })] {
        let fixture = manager();
        let mut value = proposal_value();
        value["items"][0]["template"]["recommendedUse"] = invalid;
        assert!(create_session(&fixture.manager, SESSION_ID, SECRET, proposal(value)).is_err());
    }

    let fixture = manager();
    let mut value = proposal_value();
    value["items"][0]["templateAlternatives"] = Value::Null;
    assert!(create_session(&fixture.manager, SESSION_ID, SECRET, proposal(value)).is_err());
}

#[test]
fn update_item_normalizes_missing_template_alternatives_and_rejects_invalid_materials() {
    let fixture = manager();
    let session = create_session(
        &fixture.manager,
        SESSION_ID,
        SECRET,
        proposal(proposal_value()),
    )
    .unwrap();
    assert_eq!(
        session.proposal.items[0].extra["templateAlternatives"],
        json!([])
    );

    let mut invalid = session.proposal.items[0].clone();
    invalid.material["description"] = Value::Null;
    assert!(
        fixture
            .manager
            .update_item(UpdateAgentImportItem {
                session_id: session.id.clone(),
                secret: SECRET.into(),
                item_id: invalid.id.clone(),
                expected_revision: invalid.revision,
                item: invalid,
            })
            .is_err()
    );

    let mut valid = session.proposal.items[0].clone();
    valid.extra.remove("templateAlternatives");
    valid.material["description"] = json!("updated description");
    let updated = fixture
        .manager
        .update_item(UpdateAgentImportItem {
            session_id: session.id,
            secret: SECRET.into(),
            item_id: valid.id.clone(),
            expected_revision: valid.revision,
            item: valid,
        })
        .unwrap();
    assert_eq!(
        updated.proposal.items[0].extra["templateAlternatives"],
        json!([])
    );
}

#[test]
fn request_template_input_validates_template_defaults_and_types() {
    let fixture = manager();
    let session = create_session(
        &fixture.manager,
        SESSION_ID,
        SECRET,
        proposal(proposal_value()),
    )
    .unwrap();
    let requested: AgentImportTemplate = serde_json::from_value(json!({
        "source": "system",
        "id": "shipping-compact",
        "name": "Compact Shipping Label",
        "fields": [{ "key": "recipient", "label": "Recipient" }],
        "recommendedUse": { "scope": " shipping " }
    }))
    .unwrap();
    let updated = fixture
        .manager
        .request_template_input(RequestAgentImportTemplateInput {
            session_id: session.id.clone(),
            secret: SECRET.into(),
            item_id: "parity-new-item".into(),
            expected_revision: 0,
            template: requested,
        })
        .unwrap();
    assert_eq!(updated.events.len(), 1);

    let fixture = manager();
    let session = create_session(
        &fixture.manager,
        SESSION_ID,
        SECRET,
        proposal(proposal_value()),
    )
    .unwrap();
    let invalid: AgentImportTemplate = serde_json::from_value(json!({
        "source": "system",
        "id": "shipping-compact",
        "name": "Compact Shipping Label",
        "fields": [{ "key": "recipient", "label": "Recipient", "multiline": "false" }]
    }))
    .unwrap();
    assert!(
        fixture
            .manager
            .request_template_input(RequestAgentImportTemplateInput {
                session_id: session.id,
                secret: SECRET.into(),
                item_id: "parity-new-item".into(),
                expected_revision: 0,
                template: invalid,
            })
            .is_err()
    );
}

#[test]
fn create_session_enforces_server_session_id_and_secret_boundaries() {
    let valid_secret = "s".repeat(32);
    assert!(
        create_session(
            &manager().manager,
            "i".repeat(23),
            valid_secret.clone(),
            proposal(proposal_value()),
        )
        .is_err()
    );
    assert!(
        create_session(
            &manager().manager,
            format!("{}😀", "i".repeat(22)),
            valid_secret.clone(),
            proposal(proposal_value()),
        )
        .is_ok()
    );
    assert!(
        create_session(
            &manager().manager,
            "i".repeat(201),
            valid_secret.clone(),
            proposal(proposal_value()),
        )
        .is_err()
    );
    assert!(matches!(
        create_session(
            &manager().manager,
            "i".repeat(24),
            "s".repeat(31),
            proposal(proposal_value()),
        ),
        Err(AgentImportError::SecretTooShort)
    ));
    assert!(
        create_session(
            &manager().manager,
            "i".repeat(24),
            valid_secret,
            proposal(proposal_value()),
        )
        .is_ok()
    );
    assert!(matches!(
        create_session(
            &manager().manager,
            "i".repeat(24),
            "s".repeat(1001),
            proposal(proposal_value()),
        ),
        Err(AgentImportError::SecretTooLong)
    ));
}

#[test]
fn custom_system_catalog_normalizes_omitted_template_field_flags() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();
    let catalog = AgentImportCatalog::from_system_templates(vec![
        serde_json::from_value::<AgentImportTemplate>(json!({
            "source": "system",
            "id": "custom-catalog-template",
            "name": "Custom catalog template",
            "fields": [{ "key": "serial", "label": "Serial" }]
        }))
        .unwrap(),
    ])
    .unwrap();
    let manager = AgentImportManager::with_catalog(authority, catalog);

    let template = manager.catalog().unwrap().templates.remove(0);
    assert_eq!(template.fields[0]["required"], false);
    assert_eq!(template.fields[0]["multiline"], false);
}

#[test]
fn list_inventory_normalizes_sparse_legacy_materials_before_deserializing() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();
    authority
        .commit(CommitRequest {
            expected_revision: 0,
            writes: vec![JsonWrite::new(
                "inventory/materials/sparse-material.json",
                json!({
                    "id": "sparse-material",
                    "fullName": "Sparse legacy material",
                    "matrixCode": null,
                    "createdAt": "2026-08-09T00:00:00Z",
                    "updatedAt": "2026-08-09T00:00:00Z"
                }),
            )],
            deletes: vec![],
            domains: vec!["inventory".into()],
            reason: "agent-import-sparse-material-fixture".into(),
        })
        .unwrap();
    let manager = AgentImportManager::new(authority);

    let materials = manager.list_inventory(None).unwrap();
    assert_eq!(materials.len(), 1);
    assert_eq!(materials[0].current_quantity, 0);
    assert_eq!(materials[0].matrix_code, None);
    assert!(materials[0].label_bindings.is_empty());
    assert_eq!(materials[0].extra["description"], "");
    assert_eq!(materials[0].extra["deviceDetails"], "");
    assert_eq!(materials[0].extra["packagingRemark"], "");
}

#[test]
fn list_inventory_rejects_noncanonical_legacy_material_fields() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();
    authority
        .commit(CommitRequest {
            expected_revision: 0,
            writes: vec![JsonWrite::new(
                "inventory/materials/invalid-material.json",
                json!({
                    "id": "invalid-material",
                    "fullName": "Invalid legacy material",
                    "description": null,
                    "createdAt": "2026-08-09T00:00:00Z",
                    "updatedAt": "2026-08-09T00:00:00Z"
                }),
            )],
            deletes: vec![],
            domains: vec!["inventory".into()],
            reason: "agent-import-invalid-material-fixture".into(),
        })
        .unwrap();
    let manager = AgentImportManager::new(authority);

    assert!(manager.list_inventory(None).is_err());
}
