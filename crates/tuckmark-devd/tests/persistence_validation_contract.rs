use serde_json::{Value, json};
use tempfile::tempdir;
use tuckmark_devd::{config::DevdConfig, data::DataFacade};

fn data_facade() -> (tempfile::TempDir, DataFacade) {
    let directory = tempdir().unwrap();
    let config = DevdConfig::resolve(Some(directory.path().to_path_buf())).unwrap();
    let data = DataFacade::open(config.active_data_dir()).unwrap();
    (directory, data)
}

fn canvas_document(source: Value) -> Value {
    json!({
        "version": 1,
        "id": "validation-document",
        "presetId": "validation-preset",
        "name": "Validation document",
        "source": source,
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
    })
}

fn valid_binding() -> Value {
    json!({
        "id": "binding-validation",
        "templateSource": "system",
        "templateId": "cable-tag",
        "templateName": "Cable Tag",
        "printQuantity": 1,
        "fieldOverrides": {},
        "createdAt": "2026-08-09T00:00:00.000Z",
        "updatedAt": "2026-08-09T00:00:00.000Z"
    })
}

fn runtime_snapshot(document: Value) -> Value {
    json!({
        "schema": "tuckmark.runtime-export.v1",
        "exportedAt": "2026-08-09T00:00:00.000Z",
        "snapshotUpdatedAt": null,
        "settings": {},
        "templates": [{
            "id": "validation-template",
            "name": "Validation template",
            "description": "",
            "width": 48,
            "height": 24,
            "createdAt": "2026-08-09T00:00:00.000Z",
            "updatedAt": "2026-08-09T00:00:00.000Z",
            "currentVersionId": "validation-version",
            "fieldOrder": []
        }],
        "versions": [{
            "id": "validation-version",
            "templateId": "validation-template",
            "version": 1,
            "kind": "saved",
            "createdAt": "2026-08-09T00:00:00.000Z",
            "label": "Initial",
            "document": document
        }],
        "workingCopies": [{
            "sourceKey": "user:validation-template",
            "source": { "kind": "user-template", "templateId": "validation-template" },
            "templateId": "validation-template",
            "draft": document,
            "updatedAt": "2026-08-09T00:00:00.000Z",
            "baseVersionId": "validation-version"
        }]
    })
}

#[test]
fn save_template_normalizes_legacy_document_defaults_before_persisting() {
    let (_directory, data) = data_facade();
    let result = data
        .mutate_runtime(
            "save-template",
            0,
            json!({
                "name": "Legacy template",
                "document": {
                    "id": "legacy-document",
                    "name": "Legacy template",
                    "width": 48,
                    "height": 24,
                    "fields": [],
                    "elements": [],
                    "recommendedUses": [{ "scope": "electronics" }, "bench"]
                }
            }),
        )
        .unwrap();

    let document = &result["data"]["version"]["document"];
    assert_eq!(document["version"], 1);
    assert_eq!(document["presetId"], "custom");
    assert_eq!(document["recommendedUse"], "electronics；bench");
    assert!(document.get("recommendedUses").is_none());
    assert_eq!(document["editor"]["gridSize"], 1);
    assert_eq!(document["editor"]["snapStep"], 1);
}

#[test]
fn runtime_document_commands_reject_malformed_documents_without_committing() {
    for command in ["save-template", "save-autosave", "replace-working-copy"] {
        let (_directory, data) = data_facade();
        let malformed = json!({
            "id": "malformed-document",
            "name": "Malformed document",
            "width": 48,
            "height": 24,
            "fields": "not-an-array",
            "elements": []
        });
        let args = if command == "save-template" {
            json!({ "name": "Malformed template", "document": malformed })
        } else {
            json!({
                "source": { "kind": "scratch", "presetId": "validation-scratch" },
                "document": malformed
            })
        };

        assert!(data.mutate_runtime(command, 0, args).is_err(), "{command}");
        assert_eq!(data.status().unwrap()["revision"], 0, "{command}");
    }

    let (_directory, data) = data_facade();
    let invalid_source = canvas_document(json!({ "kind": "unsupported" }));
    assert!(
        data.mutate_runtime(
            "save-template",
            0,
            json!({ "name": "Invalid source template", "document": invalid_source }),
        )
        .is_err()
    );
    assert_eq!(data.status().unwrap()["revision"], 0);
}

#[test]
fn save_material_rejects_malformed_label_bindings_and_normalizes_binding_defaults() {
    let invalid_bindings = [
        json!([{
            "templateSource": "system",
            "templateId": "cable-tag",
            "templateName": "Cable Tag",
            "createdAt": "2026-08-09T00:00:00.000Z",
            "updatedAt": "2026-08-09T00:00:00.000Z"
        }]),
        json!([{
            "id": "binding-invalid-source",
            "templateSource": "remote",
            "templateId": "cable-tag",
            "templateName": "Cable Tag",
            "createdAt": "2026-08-09T00:00:00.000Z",
            "updatedAt": "2026-08-09T00:00:00.000Z"
        }]),
        json!([{
            "id": "binding-invalid-quantity",
            "templateSource": "system",
            "templateId": "cable-tag",
            "templateName": "Cable Tag",
            "printQuantity": 0,
            "createdAt": "2026-08-09T00:00:00.000Z",
            "updatedAt": "2026-08-09T00:00:00.000Z"
        }]),
        json!([{
            "id": "binding-invalid-overrides",
            "templateSource": "system",
            "templateId": "cable-tag",
            "templateName": "Cable Tag",
            "fieldOverrides": { "name": 7 },
            "createdAt": "2026-08-09T00:00:00.000Z",
            "updatedAt": "2026-08-09T00:00:00.000Z"
        }]),
    ];

    for bindings in invalid_bindings {
        let (_directory, data) = data_facade();
        assert!(
            data.mutate_inventory(
                "save-material",
                0,
                json!({ "fullName": "Invalid binding material", "labelBindings": bindings }),
            )
            .is_err()
        );
        assert_eq!(data.status().unwrap()["revision"], 0);
    }

    let (_directory, data) = data_facade();
    let mut binding = valid_binding();
    binding.as_object_mut().unwrap().remove("printQuantity");
    binding.as_object_mut().unwrap().remove("fieldOverrides");
    let material = data
        .mutate_inventory(
            "save-material",
            0,
            json!({ "fullName": "Default binding material", "labelBindings": [binding] }),
        )
        .unwrap();
    assert_eq!(material["data"]["labelBindings"][0]["printQuantity"], 1);
    assert_eq!(
        material["data"]["labelBindings"][0]["fieldOverrides"],
        json!({})
    );

    let (_directory, data) = data_facade();
    let mut binding = valid_binding();
    binding["printQuantity"] = json!(1.0);
    assert!(
        data.mutate_inventory(
            "save-material",
            0,
            json!({ "fullName": "Floating integer binding material", "labelBindings": [binding] }),
        )
        .is_ok()
    );
}

#[test]
fn replace_snapshot_validates_complete_records_and_normalizes_legacy_documents() {
    let (_directory, data) = data_facade();
    let malformed = json!({
        "schema": "tuckmark.runtime-export.v1",
        "exportedAt": "2026-08-09T00:00:00.000Z",
        "snapshotUpdatedAt": null,
        "settings": {},
        "templates": [{ "id": "incomplete-template", "name": "Incomplete" }],
        "versions": [],
        "workingCopies": []
    });
    assert!(
        data.mutate_runtime("replace-snapshot", 0, json!({ "snapshot": malformed }),)
            .is_err()
    );
    assert_eq!(data.status().unwrap()["revision"], 0);

    let mut document = canvas_document(json!({
        "kind": "user-template",
        "templateId": "validation-template"
    }));
    document
        .as_object_mut()
        .unwrap()
        .insert("recommendedUses".into(), json!(["electronics"]));
    let replacement = data
        .mutate_runtime(
            "replace-snapshot",
            0,
            json!({ "snapshot": runtime_snapshot(document) }),
        )
        .unwrap();
    assert_eq!(replacement["revision"], 1);

    let snapshot = data.read_runtime_snapshot().unwrap();
    let persisted = &snapshot["data"]["versions"][0]["document"];
    assert_eq!(persisted["recommendedUse"], "electronics");
    assert!(persisted.get("recommendedUses").is_none());
}
