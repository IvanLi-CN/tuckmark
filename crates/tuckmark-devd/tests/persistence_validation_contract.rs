use std::fs;

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

fn noncanonical_canvas_document(source: Value) -> Value {
    let mut document = canvas_document(source);
    document["id"] = json!("  validation-document  ");
    document["presetId"] = json!("  validation-preset  ");
    document["name"] = json!("  Validation document  ");
    document["fields"] = json!([{ "key": "  part  ", "label": "  Part  " }]);
    document["editor"] = json!({
        "gridEnabled": true,
        "gridSize": 3,
        "snapEnabled": true,
        "snapStep": 0.75
    });
    document
}

fn assert_canvas_zod_transforms(document: &Value) {
    assert_eq!(document["id"], "validation-document");
    assert_eq!(document["presetId"], "validation-preset");
    assert_eq!(document["name"], "Validation document");
    assert_eq!(document["fields"][0]["key"], "part");
    assert_eq!(document["fields"][0]["label"], "Part");
    assert_eq!(document["editor"]["gridSize"], 1);
    assert_eq!(document["editor"]["snapStep"], 1);
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

fn sparse_legacy_archive() -> Value {
    let mut document = noncanonical_canvas_document(json!({
        "kind": "user-template",
        "templateId": "  validation-template  "
    }));
    document["recommendedUses"] = json!([{ "scope": "  electronics  " }, " shipping "]);
    let mut runtime = runtime_snapshot(document);
    runtime["templates"][0]["recommendedUses"] = json!([{ "scope": "  electronics  " }]);
    runtime["workingCopies"][0]["source"]["templateId"] = json!("  validation-template  ");

    json!({
        "schema": "tuckmark.devd-data-archive.v1",
        "exportedAt": "2026-08-09T00:00:00.000Z",
        "runtime": runtime,
        "inventory": {
            "materials": [{
                "id": "legacy-archive-material",
                "fullName": "Legacy archive material",
                "createdAt": "2026-08-09T00:00:00.000Z",
                "updatedAt": "2026-08-09T00:00:00.000Z",
                "legacyMetadata": { "source": "pre-v1" },
                "labelBindings": [{
                    "id": "legacy-archive-binding",
                    "templateSource": "system",
                    "templateId": "shipping-compact",
                    "templateName": "Shipping compact",
                    "createdAt": "2026-08-09T00:00:00.000Z",
                    "updatedAt": "2026-08-09T00:00:00.000Z",
                    "ignoredByZod": "drop me"
                }]
            }],
            "adjustments": [{
                "id": "legacy-archive-adjustment",
                "materialId": "legacy-archive-material",
                "kind": "in",
                "quantityDelta": 2,
                "targetQuantity": null,
                "quantityAfter": 2,
                "legacyExtra": true,
                "createdAt": "2026-08-09T00:00:01.000Z"
            }]
        }
    })
}

fn canonical_archive_equivalent() -> Value {
    let mut document = canvas_document(json!({
        "kind": "user-template",
        "templateId": "validation-template"
    }));
    document["fields"] = json!([{ "key": "part", "label": "Part" }]);
    document["recommendedUse"] = json!("electronics；shipping");
    let mut runtime = runtime_snapshot(document);
    runtime["templates"][0]["recommendedUse"] = json!("electronics");

    json!({
        "schema": "tuckmark.devd-data-archive.v1",
        "exportedAt": "2026-08-09T00:00:00.000Z",
        "runtime": runtime,
        "inventory": {
            "materials": [{
                "id": "legacy-archive-material",
                "fullName": "Legacy archive material",
                "description": "",
                "deviceDetails": "",
                "packagingRemark": "",
                "currentQuantity": 0,
                "createdAt": "2026-08-09T00:00:00.000Z",
                "updatedAt": "2026-08-09T00:00:00.000Z",
                "legacyMetadata": { "source": "pre-v1" },
                "labelBindings": [{
                    "id": "legacy-archive-binding",
                    "templateSource": "system",
                    "templateId": "shipping-compact",
                    "templateName": "Shipping compact",
                    "printQuantity": 1,
                    "fieldOverrides": {},
                    "createdAt": "2026-08-09T00:00:00.000Z",
                    "updatedAt": "2026-08-09T00:00:00.000Z"
                }]
            }],
            "adjustments": [{
                "id": "legacy-archive-adjustment",
                "materialId": "legacy-archive-material",
                "kind": "in",
                "quantityDelta": 2,
                "targetQuantity": null,
                "quantityAfter": 2,
                "note": "",
                "actor": "unknown",
                "createdAt": "2026-08-09T00:00:01.000Z"
            }]
        }
    })
}

#[test]
fn runtime_document_commands_apply_canvas_zod_transforms_before_persisting() {
    let (_directory, data) = data_facade();
    let saved = data
        .mutate_runtime(
            "save-template",
            0,
            json!({
                "name": "  Validation document  ",
                "document": noncanonical_canvas_document(json!({
                    "kind": "scratch",
                    "presetId": "  validation-scratch  "
                }))
            }),
        )
        .unwrap();
    assert_canvas_zod_transforms(&saved["data"]["version"]["document"]);

    for command in ["save-autosave", "replace-working-copy"] {
        let (_directory, data) = data_facade();
        let working_copy = data
            .mutate_runtime(
                command,
                0,
                json!({
                    "source": { "kind": "scratch", "presetId": "  validation-scratch  " },
                    "document": noncanonical_canvas_document(json!({
                        "kind": "scratch",
                        "presetId": "  validation-scratch  "
                    }))
                }),
            )
            .unwrap();
        assert_canvas_zod_transforms(&working_copy["data"]["draft"]);
        assert_eq!(
            working_copy["data"]["source"]["presetId"],
            "validation-scratch"
        );
    }

    let (_directory, data) = data_facade();
    let mut replacement = runtime_snapshot(noncanonical_canvas_document(json!({
        "kind": "user-template",
        "templateId": "  validation-template  "
    })));
    replacement["workingCopies"][0]["source"]["templateId"] = json!("  validation-template  ");
    data.mutate_runtime("replace-snapshot", 0, json!({ "snapshot": replacement }))
        .unwrap();
    let snapshot = data.read_runtime_snapshot().unwrap();
    assert_canvas_zod_transforms(&snapshot["data"]["versions"][0]["document"]);
    assert_eq!(
        snapshot["data"]["versions"][0]["document"]["source"]["templateId"],
        "validation-template"
    );
    assert_eq!(
        snapshot["data"]["workingCopies"][0]["source"]["templateId"],
        "validation-template"
    );
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

    for missing_field in ["version", "presetId", "editor", "source"] {
        for command in ["save-template", "save-autosave", "replace-working-copy"] {
            let (_directory, data) = data_facade();
            let mut document = canvas_document(json!({
                "kind": "scratch",
                "presetId": "validation-scratch"
            }));
            document.as_object_mut().unwrap().remove(missing_field);
            let args = if command == "save-template" {
                json!({ "name": "Canvas schema fields are required", "document": document })
            } else {
                json!({
                    "source": { "kind": "scratch", "presetId": "validation-scratch" },
                    "document": document
                })
            };
            assert!(
                data.mutate_runtime(command, 0, args).is_err(),
                "{command} must require {missing_field}"
            );
            assert_eq!(data.status().unwrap()["revision"], 0, "{command}");
        }
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

    let (_directory, data) = data_facade();
    let mut blank_identifier = canvas_document(json!({
        "kind": "scratch",
        "presetId": "validation-scratch"
    }));
    blank_identifier["id"] = json!("   ");
    assert!(
        data.mutate_runtime(
            "save-template",
            0,
            json!({ "name": "Blank identifier", "document": blank_identifier }),
        )
        .is_err()
    );
    assert_eq!(data.status().unwrap()["revision"], 0);

    for (key, value) in [
        ("templateId", json!("   ")),
        ("description", json!(42)),
        ("sourceVersionId", json!(0)),
    ] {
        let (_directory, data) = data_facade();
        let mut args = json!({
            "name": "Strict optional template fields",
            "document": canvas_document(json!({
                "kind": "scratch",
                "presetId": "validation-scratch"
            }))
        });
        args.as_object_mut().unwrap().insert(key.into(), value);
        assert!(
            data.mutate_runtime("save-template", 0, args).is_err(),
            "{key}"
        );
        assert_eq!(data.status().unwrap()["revision"], 0, "{key}");
    }

    for command in ["save-autosave", "replace-working-copy"] {
        for (key, value) in [("templateId", json!("   ")), ("sourceVersionId", json!(0))] {
            let (_directory, data) = data_facade();
            let mut args = json!({
                "source": { "kind": "scratch", "presetId": "validation-scratch" },
                "document": canvas_document(json!({
                    "kind": "scratch",
                    "presetId": "validation-scratch"
                }))
            });
            args.as_object_mut().unwrap().insert(key.into(), value);
            assert!(
                data.mutate_runtime(command, 0, args).is_err(),
                "{command} {key}"
            );
            assert_eq!(data.status().unwrap()["revision"], 0, "{command} {key}");
        }
    }
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
            "id": "binding-overflow-quantity",
            "templateSource": "system",
            "templateId": "cable-tag",
            "templateName": "Cable Tag",
            "printQuantity": 18446744073709551616.0,
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
fn save_material_normalizes_inventory_schema_defaults() {
    let (_directory, data) = data_facade();
    let material = data
        .mutate_inventory(
            "save-material",
            0,
            json!({
                "fullName": "Defaulted material",
                "baseName": "   ",
                "variantName": "  Variant  ",
                "packageName": "",
                "matrixCode": "   "
            }),
        )
        .unwrap();
    let material = &material["data"];
    assert_eq!(material["description"], "");
    assert_eq!(material["deviceDetails"], "");
    assert_eq!(material["packagingRemark"], "");
    assert_eq!(material["variantName"], "Variant");
    assert!(material.get("baseName").is_none());
    assert!(material.get("packageName").is_none());
    assert!(material.get("matrixCode").is_none());
}

#[test]
fn save_material_ignores_the_unsupported_material_id_alias() {
    let (_directory, data) = data_facade();
    let existing = data
        .mutate_inventory(
            "save-material",
            0,
            json!({ "fullName": "Existing material" }),
        )
        .unwrap();
    let existing_id = existing["data"]["id"].as_str().unwrap();

    let created = data
        .mutate_inventory(
            "save-material",
            1,
            json!({
                "materialId": existing_id,
                "fullName": "New material"
            }),
        )
        .unwrap();
    assert_ne!(created["data"]["id"], existing_id);
    assert_eq!(
        data.read_materials("", true).unwrap()["data"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn empty_archived_at_remains_an_active_material() {
    let (_directory, data) = data_facade();
    let root = data.authority().root();
    fs::create_dir_all(root.join("inventory/materials")).unwrap();
    fs::write(
        root.join("inventory/materials/empty-archived-at.json"),
        json!({
            "id": "empty-archived-at",
            "fullName": "Empty archive marker",
            "description": "",
            "deviceDetails": "",
            "packagingRemark": "",
            "currentQuantity": 0,
            "createdAt": "2026-08-09T00:00:00.000Z",
            "updatedAt": "2026-08-09T00:00:00.000Z",
            "archivedAt": "",
            "labelBindings": []
        })
        .to_string(),
    )
    .unwrap();

    assert_eq!(
        data.read_materials("", false).unwrap()["data"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(
        data.mutate_inventory(
            "save-material",
            0,
            json!({
                "id": "empty-archived-at",
                "fullName": "Still active"
            }),
        )
        .is_ok()
    );
    assert!(
        data.mutate_inventory(
            "apply-adjustment",
            1,
            json!({
                "materialId": "empty-archived-at",
                "input": { "kind": "in", "quantity": 1 }
            }),
        )
        .is_ok()
    );
}

#[test]
fn legacy_inventory_reads_apply_schema_defaults_before_returning_data() {
    let (_directory, data) = data_facade();
    let root = data.authority().root();
    fs::create_dir_all(root.join("inventory/materials")).unwrap();
    fs::create_dir_all(root.join("inventory/adjustments")).unwrap();
    fs::write(
        root.join("inventory/materials/legacy-material.json"),
        json!({
            "id": "legacy-material",
            "fullName": "Legacy material",
            "deviceDetails": "Laser calibration fixture",
            "packagingRemark": "Blue carton insert",
            "createdAt": "2026-08-09T00:00:00.000Z",
            "updatedAt": "2026-08-09T00:00:00.000Z"
        })
        .to_string(),
    )
    .unwrap();
    fs::write(
        root.join("inventory/adjustments/legacy-adjustment.json"),
        json!({
            "id": "legacy-adjustment",
            "materialId": "legacy-material",
            "kind": "in",
            "quantityDelta": 2,
            "targetQuantity": null,
            "quantityAfter": 2,
            "note": null,
            "actor": null,
            "legacyExtra": true,
            "createdAt": "2026-08-09T00:00:01.000Z"
        })
        .to_string(),
    )
    .unwrap();

    let materials = data.read_materials("", true).unwrap();
    let material = &materials["data"][0];
    assert_eq!(material["description"], "");
    assert_eq!(material["deviceDetails"], "Laser calibration fixture");
    assert_eq!(material["packagingRemark"], "Blue carton insert");
    assert_eq!(material["currentQuantity"], 0);
    assert_eq!(material["labelBindings"], json!([]));
    assert_eq!(
        data.read_materials("calibration fixture", true).unwrap()["data"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        data.read_materials("carton insert", true).unwrap()["data"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    let adjustments = data.read_adjustments(Some("legacy-material")).unwrap();
    let adjustment = &adjustments["data"][0];
    assert_eq!(adjustment["note"], "");
    assert_eq!(adjustment["actor"], "unknown");
    assert!(adjustment.get("legacyExtra").is_none());
}

#[test]
fn archive_endpoints_share_canonical_parse_transform_and_hash() {
    let (_directory, data) = data_facade();
    let raw = sparse_legacy_archive();
    let canonical = canonical_archive_equivalent();

    let raw_inspection = data.inspect_archive(raw.clone()).unwrap();
    let canonical_inspection = data.inspect_archive(canonical).unwrap();
    assert_eq!(
        raw_inspection["archiveHash"],
        canonical_inspection["archiveHash"]
    );

    let imported = data
        .import_archive(
            0,
            raw_inspection["archiveHash"].as_str().unwrap(),
            "replace",
            raw,
        )
        .unwrap();
    assert_eq!(
        imported["data"]["archiveHash"],
        raw_inspection["archiveHash"]
    );

    let archive = data.read_archive().unwrap();
    let data_archive = &archive["data"];
    assert_canvas_zod_transforms(&data_archive["runtime"]["versions"][0]["document"]);
    assert_eq!(
        data_archive["runtime"]["versions"][0]["document"]["recommendedUse"],
        "electronics；shipping"
    );
    assert_eq!(
        data_archive["runtime"]["templates"][0]["recommendedUse"],
        "electronics"
    );
    assert_eq!(
        data_archive["runtime"]["workingCopies"][0]["source"]["templateId"],
        "validation-template"
    );
    let material = &data_archive["inventory"]["materials"][0];
    assert_eq!(material["description"], "");
    assert_eq!(material["deviceDetails"], "");
    assert_eq!(material["packagingRemark"], "");
    assert_eq!(material["currentQuantity"], 0);
    assert!(material["labelBindings"][0].get("ignoredByZod").is_none());
    assert_eq!(data_archive["inventory"]["adjustments"][0]["note"], "");
    assert_eq!(
        data_archive["inventory"]["adjustments"][0]["actor"],
        "unknown"
    );
    assert!(
        data_archive["inventory"]["adjustments"][0]
            .get("legacyExtra")
            .is_none()
    );
    assert!(data.inspect_archive(data_archive.clone()).is_ok());

    let mut invalid_optional = sparse_legacy_archive();
    invalid_optional["runtime"]["versions"][0]["sourceVersionId"] = Value::Null;
    assert!(data.inspect_archive(invalid_optional).is_err());
}

#[test]
fn apply_adjustment_normalizes_inventory_input_defaults() {
    let (_directory, data) = data_facade();
    let material = data
        .mutate_inventory(
            "save-material",
            0,
            json!({ "fullName": "Adjustment material" }),
        )
        .unwrap();
    let material_id = material["data"]["id"].as_str().unwrap();
    let adjustment = data
        .mutate_inventory(
            "apply-adjustment",
            1,
            json!({
                "materialId": material_id,
                "input": { "kind": "in", "quantity": 1 }
            }),
        )
        .unwrap();
    assert_eq!(adjustment["data"]["adjustment"]["note"], "");
    assert_eq!(adjustment["data"]["adjustment"]["actor"], "unknown");
    assert_eq!(
        adjustment["data"]["material"]["updatedAt"],
        adjustment["data"]["adjustment"]["createdAt"]
    );

    let blank_timestamp = data
        .mutate_inventory(
            "apply-adjustment",
            2,
            json!({
                "materialId": material_id,
                "input": { "kind": "in", "quantity": 1.0, "createdAt": "   " }
            }),
        )
        .unwrap();
    assert_ne!(blank_timestamp["data"]["adjustment"]["createdAt"], "   ");

    assert!(
        data.mutate_inventory(
            "apply-adjustment",
            3,
            json!({
                "materialId": material_id,
                "input": { "kind": "in", "quantity": 1, "note": null }
            }),
        )
        .is_err()
    );
    assert!(
        data.mutate_inventory(
            "apply-adjustment",
            3,
            json!({
                "materialId": material_id,
                "input": { "kind": "in", "quantity": 9223372036854775808u64 }
            }),
        )
        .is_err()
    );
    assert_eq!(data.status().unwrap()["revision"], 3);
}

#[test]
fn update_template_metadata_rejects_non_schema_patches() {
    let (_directory, data) = data_facade();
    let created = data
        .mutate_runtime(
            "save-template",
            0,
            json!({
                "name": "Metadata template",
                "document": canvas_document(json!({
                    "kind": "scratch",
                    "presetId": "metadata-scratch"
                }))
            }),
        )
        .unwrap();
    let template_id = created["data"]["template"]["id"].as_str().unwrap();

    for patch in [json!({ "unexpected": "value" }), json!({ "name": 3 })] {
        assert!(
            data.mutate_runtime(
                "update-template-metadata",
                1,
                json!({ "templateId": template_id, "patch": patch }),
            )
            .is_err()
        );
        assert_eq!(data.status().unwrap()["revision"], 1);
    }

    let updated = data
        .mutate_runtime(
            "update-template-metadata",
            1,
            json!({
                "templateId": template_id,
                "patch": { "description": "  normalized  " }
            }),
        )
        .unwrap();
    assert_eq!(updated["data"]["description"], "normalized");
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

    let (_directory, data) = data_facade();
    let mut null_optional = runtime_snapshot(canvas_document(json!({
        "kind": "user-template",
        "templateId": "validation-template"
    })));
    null_optional["versions"][0]["sourceVersionId"] = Value::Null;
    assert!(
        data.mutate_runtime("replace-snapshot", 0, json!({ "snapshot": null_optional }))
            .is_err()
    );
    assert_eq!(data.status().unwrap()["revision"], 0);
}
