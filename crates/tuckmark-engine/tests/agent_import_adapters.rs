use serde_json::{Value, json};
use tempfile::tempdir;
use tuckmark_contracts::AgentImportProposal;
use tuckmark_engine::{
    AgentImportManager, CommitRequest, CreateAgentImportSession, DataAuthority,
    FulfillAgentImportTemplateInput, JsonWrite, RequestAgentImportTemplateInput,
    UpdateAgentImportItem,
};

const SECRET: &str = "agent-import-adapter-test-secret-0123456789";

#[test]
fn agent_import_adapter_lifecycle_preserves_item_and_event_revisions() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();
    authority
        .commit(CommitRequest {
            expected_revision: 0,
            writes: vec![JsonWrite::new(
                "inventory/materials/adapter-target.json",
                json!({
                    "id": "adapter-target",
                    "fullName": "Adapter target",
                    "currentQuantity": 4,
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z",
                    "labelBindings": []
                }),
            )],
            deletes: vec![],
            domains: vec!["inventory".into()],
            reason: "agent-import-adapter-fixture".into(),
        })
        .unwrap();

    let manager = AgentImportManager::new(authority);
    let catalog = manager.catalog().unwrap();
    assert_eq!(catalog.templates[0].id, "shipping-compact");
    assert_eq!(catalog.templates[1].id, "cable-tag");
    assert_eq!(
        manager
            .list_inventory(Some("ADAPTER TARGET"))
            .unwrap()
            .len(),
        1
    );

    let proposal: AgentImportProposal = serde_json::from_value(json!({
        "schema": "tuckmark.agent-import.v1",
        "items": [{
            "id": "adapter-new-item",
            "kind": "new",
            "quantity": 1,
            "material": { "fullName": "Adapter new material" },
            "template": {
                "source": "system",
                "id": "cable-tag",
                "name": "Caller value",
                "fields": []
            },
            "templateInput": { "name": "Adapter new material" }
        }, {
            "id": "adapter-restock-item",
            "kind": "restock",
            "quantity": 2,
            "targetMaterialId": "adapter-target",
            "targetMaterialUpdatedAt": "2026-01-01T00:00:00Z",
            "material": { "fullName": "Adapter target" }
        }]
    }))
    .unwrap();
    let session = manager
        .create_session(CreateAgentImportSession {
            id: "agent-import-adapter-session".into(),
            secret: SECRET.into(),
            proposal,
        })
        .unwrap();

    let targets = manager
        .resolve_restock_targets(&session.id, SECRET)
        .unwrap();
    assert_eq!(targets.len(), 1);
    assert_eq!(targets[0].item_id, "adapter-restock-item");

    let mut edited_item = session.proposal.items[0].clone();
    edited_item.material["description"] = Value::String("edited description".into());
    let edited = manager
        .update_item(UpdateAgentImportItem {
            session_id: session.id.clone(),
            secret: SECRET.into(),
            item_id: edited_item.id.clone(),
            expected_revision: edited_item.revision,
            item: edited_item,
        })
        .unwrap();
    assert_eq!(edited.proposal.items[0].revision, 1);

    let requested = manager
        .request_template_input(RequestAgentImportTemplateInput {
            session_id: session.id.clone(),
            secret: SECRET.into(),
            item_id: "adapter-new-item".into(),
            expected_revision: 1,
            template: serde_json::from_value(json!({
                "source": "system",
                "id": "shipping-compact",
                "name": "Caller value",
                "fields": []
            }))
            .unwrap(),
        })
        .unwrap();
    let event = manager.list_events(&session.id, SECRET).unwrap();
    assert_eq!(event.len(), 1);
    assert_eq!(event[0].revision, 2);

    let mut pending_item = requested.proposal.items[0].clone();
    pending_item.material["description"] = Value::String("preserved description".into());
    let edited_pending = manager
        .update_item(UpdateAgentImportItem {
            session_id: session.id.clone(),
            secret: SECRET.into(),
            item_id: pending_item.id.clone(),
            expected_revision: pending_item.revision,
            item: pending_item,
        })
        .unwrap();
    let event_revision = edited_pending.events[0]["revision"].as_u64().unwrap();
    assert_eq!(event_revision, 3);

    let fulfilled = manager
        .fulfill_template_input(FulfillAgentImportTemplateInput {
            session_id: session.id.clone(),
            secret: SECRET.into(),
            event_id: event[0].id.clone(),
            expected_revision: event_revision,
            input: [
                ("recipient".into(), "Ada".into()),
                ("address".into(), "Loopback Lane".into()),
                ("orderId".into(), "ORDER-42".into()),
            ]
            .into_iter()
            .collect(),
        })
        .unwrap();
    assert!(manager.list_events(&session.id, SECRET).unwrap().is_empty());
    assert_eq!(
        fulfilled.proposal.items[0]
            .template_input
            .get("recipient")
            .map(String::as_str),
        Some("Ada")
    );
    assert_eq!(fulfilled.proposal.items[0].pending_template_event_id, None);
    assert_eq!(fulfilled.proposal.items[0].revision, 4);
    assert_eq!(
        fulfilled.proposal.items[0].material["description"],
        "preserved description"
    );
}
