use std::path::PathBuf;

use serde_json::{Value, json};
use tuckmark_contracts::{
    DataDirectoryManifest, DevdDataArchive, DevdDataTransaction, canonical_json_string,
    normalize_legacy_tree_value, normalize_legacy_value,
};

fn fixture(name: &str) -> String {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    std::fs::read_to_string(root.join("compatibility/fixtures").join(name)).unwrap()
}

fn complete_devd_archive() -> Value {
    let document = json!({
        "version": 1,
        "id": "template-1",
        "presetId": "template-1",
        "name": "Archive template",
        "source": { "kind": "user-template", "templateId": "template-1" },
        "templateId": "template-1",
        "baseVersionId": "version-1",
        "width": 100,
        "height": 50,
        "fields": [],
        "elements": [],
        "editor": {
            "gridEnabled": true,
            "gridSize": 1,
            "snapEnabled": true,
            "snapStep": 1
        }
    });

    json!({
        "schema": "tuckmark.devd-data-archive.v1",
        "exportedAt": "2026-01-02T03:04:05.000Z",
        "runtime": {
            "schema": "tuckmark.runtime-export.v1",
            "exportedAt": "2026-01-02T03:04:05.000Z",
            "snapshotUpdatedAt": null,
            "settings": {},
            "templates": [{
                "id": "template-1",
                "name": "Archive template",
                "description": "",
                "width": 100,
                "height": 50,
                "createdAt": "2026-01-02T03:04:05.000Z",
                "updatedAt": "2026-01-02T03:04:05.000Z",
                "currentVersionId": "version-1",
                "fieldOrder": []
            }],
            "versions": [{
                "id": "version-1",
                "templateId": "template-1",
                "version": 1,
                "kind": "saved",
                "createdAt": "2026-01-02T03:04:05.000Z",
                "label": "Initial",
                "document": document
            }],
            "workingCopies": [{
                "sourceKey": "user:template-1",
                "source": { "kind": "user-template", "templateId": "template-1" },
                "templateId": "template-1",
                "draft": document,
                "updatedAt": "2026-01-02T03:04:05.000Z",
                "baseVersionId": "version-1"
            }]
        },
        "inventory": {
            "materials": [{
                "id": "material-1",
                "fullName": "Archive material",
                "currentQuantity": 5,
                "createdAt": "2026-01-02T03:04:05.000Z",
                "updatedAt": "2026-01-02T03:04:05.000Z",
                "labelBindings": []
            }],
            "adjustments": [{
                "id": "adjustment-1",
                "materialId": "material-1",
                "kind": "in",
                "quantityDelta": 5,
                "targetQuantity": null,
                "quantityAfter": 5,
                "note": "",
                "actor": "test",
                "createdAt": "2026-01-02T03:04:05.000Z"
            }]
        }
    })
}

fn assert_archive_rejects_missing_field(mut archive: Value, pointer: &str) {
    let (parent, field) = pointer.rsplit_once('/').unwrap();
    archive
        .pointer_mut(parent)
        .and_then(Value::as_object_mut)
        .unwrap()
        .remove(field)
        .unwrap();

    let archive: DevdDataArchive = serde_json::from_value(archive).unwrap();
    assert!(
        archive.validate().is_err(),
        "archive accepted omitted required field {pointer}"
    );
}

fn assert_archive_rejects_value(mut archive: Value, pointer: &str, replacement: Value) {
    *archive.pointer_mut(pointer).unwrap() = replacement;
    let archive: DevdDataArchive = serde_json::from_value(archive).unwrap();
    assert!(
        archive.validate().is_err(),
        "archive accepted invalid value at {pointer}"
    );
}

#[test]
fn frozen_data_tree_manifest_round_trips_without_schema_change() {
    let value: Value = serde_json::from_str(&fixture("data-tree.json")).unwrap();
    let manifest: DataDirectoryManifest =
        serde_json::from_value(value["entries"]["manifest.json"].clone()).unwrap();

    manifest.validate().unwrap();
    let serialized = canonical_json_string(&manifest).unwrap();
    let reparsed: Value = serde_json::from_str(&serialized).unwrap();

    assert_eq!(reparsed["schema"], "tuckmark.data-dir-manifest.v1");
    assert_eq!(reparsed["counts"]["materials"], 1);
    assert!(serialized.ends_with('\n'));
}

#[test]
fn canonical_writes_sort_json_keys_even_when_wire_values_preserve_input_order() {
    let value: Value = serde_json::from_str(r#"{"z":{"b":1,"a":2},"a":3}"#).unwrap();

    assert_eq!(
        canonical_json_string(&value).unwrap(),
        "{\n  \"a\": 3,\n  \"z\": {\n    \"a\": 2,\n    \"b\": 1\n  }\n}\n"
    );
}

#[test]
fn frozen_interrupted_transaction_is_a_valid_wal_record() {
    let value: Value = serde_json::from_str(&fixture("interrupted-transaction.json")).unwrap();
    let transaction: DevdDataTransaction =
        serde_json::from_value(value["journal"].clone()).unwrap();

    transaction.validate().unwrap();
    assert_eq!(transaction.revision, transaction.event.revision);
    assert_eq!(transaction.writes.len(), 2);
}

#[test]
fn legacy_archive_is_normalized_without_renaming_its_v1_schema_family() {
    let normalized = normalize_legacy_value(json!({
        "schema": "tuckmark.data-archive.v1",
        "exportedAt": "2026-01-02T03:04:05.000Z",
        "runtime": { "templates": [], "versions": [], "workingCopies": [] },
        "inventory": { "materials": [], "adjustments": [] }
    }))
    .unwrap();

    assert_eq!(normalized["schema"], "tuckmark.devd-data-archive.v1");
    assert_eq!(normalized["runtime"]["templates"], json!([]));
    assert_eq!(normalized["runtime"]["snapshotUpdatedAt"], Value::Null);
    assert_eq!(normalized["runtime"]["settings"], json!({}));
}

#[test]
fn directory_tree_archive_metadata_keeps_its_own_schema() {
    let value: Value = serde_json::from_str(&fixture("archive.json")).unwrap();
    let normalized = normalize_legacy_value(value["entries"]["archive.json"].clone()).unwrap();

    assert_eq!(normalized["schema"], "tuckmark.runtime-export-archive.v1");
    assert_eq!(normalized["exportedAt"], "2026-01-02T03:04:05.000Z");
    assert!(normalized.get("runtime").is_none());
    assert!(normalized.get("inventory").is_none());
}

#[test]
fn legacy_recommended_uses_and_text_stretch_aliases_normalize_without_losing_behavior() {
    let normalized = normalize_legacy_value(json!({
        "schema": "tuckmark.data-archive.v1",
        "exportedAt": "2026-01-02T03:04:05.000Z",
        "runtime": {
            "templates": [{
                "id": "template-1",
                "name": "Legacy",
                "recommendedUses": [{ "scope": "electronics" }, "bench"]
            }],
            "versions": [{
                "id": "version-1",
                "templateId": "template-1",
                "document": {
                    "recommendedUses": ["parts"],
                    "elements": [{
                        "id": "text-1",
                        "kind": "text",
                        "fontSize": 4,
                        "width": null,
                        "height": 4,
                        "lineHeight": 1.2,
                        "fontFamily": "system-sans",
                        "value": "legacy",
                        "binding": {"fieldKey": "label", "kind": "text"},
                        "stretchX": true,
                        "stretchY": false
                    }]
                }
            }],
            "workingCopies": []
        },
        "inventory": { "materials": [], "adjustments": [] }
    }))
    .unwrap();

    assert_eq!(
        normalized["runtime"]["templates"][0]["recommendedUse"],
        "electronics；bench"
    );
    assert!(
        normalized["runtime"]["templates"][0]
            .get("recommendedUses")
            .is_none()
    );
    let document = &normalized["runtime"]["versions"][0]["document"];
    assert_eq!(document["recommendedUse"], "parts");
    let text = &document["elements"][0];
    assert_eq!(text["stretchX"], true);
    assert_eq!(text["stretchY"], false);
    assert_eq!(text["stretchXGrow"], true);
    assert_eq!(text["stretchXShrink"], true);
    assert_eq!(text["stretchYGrow"], false);
    assert_eq!(text["stretchYShrink"], false);
    assert_eq!(text["width"], 22.5);
    assert_eq!(text["fontWeight"], "normal");
    assert_eq!(text["align"], "left");
    assert_eq!(
        text["binding"],
        json!({"fieldKey": "label", "kind": "text"})
    );
    assert_eq!(text["autoWrap"], true);
    assert_eq!(text["verticalText"], false);
}

#[test]
fn legacy_multiline_text_uses_web_natural_height_defaults() {
    let normalized = normalize_legacy_value(json!({
        "schema": "tuckmark.data-archive.v1",
        "exportedAt": "2026-01-02T03:04:05.000Z",
        "runtime": {
            "templates": [],
            "versions": [{
                "id": "version-1",
                "templateId": "template-1",
                "document": {
                    "version": 1,
                    "id": "template-1",
                    "presetId": "template-1",
                    "name": "Legacy",
                    "source": {"kind": "user-template", "templateId": "template-1"},
                    "width": 100,
                    "height": 50,
                    "fields": [],
                    "elements": [{
                        "id": "text-1",
                        "meta": {"name": "Text", "visible": true, "locked": false},
                        "kind": "text",
                        "x": 0,
                        "y": 0,
                        "fontSize": 4,
                        "value": "A\nB"
                    }],
                    "editor": {"gridEnabled": true, "snapEnabled": true}
                }
            }],
            "workingCopies": []
        },
        "inventory": {"materials": [], "adjustments": []}
    }))
    .unwrap();

    let text = &normalized["runtime"]["versions"][0]["document"]["elements"][0];
    assert_eq!(text["fontWeight"], "normal");
    assert_eq!(text["align"], "left");
    assert_eq!(text["y"], -4.0);
    assert_eq!(text["height"], 8.8);
}

#[test]
fn legacy_wrapped_height_uses_the_native_font_metric_boundary() {
    let normalized = normalize_legacy_tree_value(json!({
        "id": "text-1",
        "kind": "text",
        "x": 0,
        "y": 10,
        "fontSize": 5,
        "value": "abcdefgh"
    }));

    assert_eq!(normalized["height"], 5.0);
    assert_eq!(normalized["y"], 5.0);
}

#[test]
fn archive_validation_rejects_missing_devd_runtime_record_fields() {
    for pointer in [
        "/runtime/snapshotUpdatedAt",
        "/runtime/settings",
        "/runtime/templates",
        "/runtime/versions",
        "/runtime/workingCopies",
        "/runtime/templates/0/description",
        "/runtime/templates/0/width",
        "/runtime/templates/0/height",
        "/runtime/templates/0/createdAt",
        "/runtime/templates/0/updatedAt",
        "/runtime/templates/0/currentVersionId",
        "/runtime/templates/0/fieldOrder",
        "/runtime/versions/0/version",
        "/runtime/versions/0/kind",
        "/runtime/versions/0/createdAt",
        "/runtime/versions/0/label",
        "/runtime/versions/0/document",
        "/runtime/workingCopies/0/source",
        "/runtime/workingCopies/0/draft",
        "/runtime/workingCopies/0/updatedAt",
    ] {
        assert_archive_rejects_missing_field(complete_devd_archive(), pointer);
    }
}

#[test]
fn archive_validation_rejects_missing_inventory_arrays_and_record_fields() {
    for pointer in [
        "/inventory",
        "/inventory/materials",
        "/inventory/adjustments",
        "/inventory/materials/0/createdAt",
        "/inventory/materials/0/updatedAt",
        "/inventory/adjustments/0/quantityDelta",
        "/inventory/adjustments/0/targetQuantity",
        "/inventory/adjustments/0/quantityAfter",
        "/inventory/adjustments/0/createdAt",
    ] {
        assert_archive_rejects_missing_field(complete_devd_archive(), pointer);
    }

    for (pointer, replacement) in [
        ("/inventory/materials/0/currentQuantity", json!(-1)),
        ("/inventory/adjustments/0/kind", json!("invalid")),
        ("/inventory/adjustments/0/targetQuantity", json!(-1)),
        ("/inventory/adjustments/0/quantityAfter", json!(-1)),
    ] {
        assert_archive_rejects_value(complete_devd_archive(), pointer, replacement);
    }
}

#[test]
fn archive_validation_rejects_incomplete_canvas_documents() {
    for (pointer, replacement) in [
        ("/runtime/versions/0/document", json!({})),
        ("/runtime/workingCopies/0/draft", json!({})),
        (
            "/runtime/versions/0/document/elements",
            json!([{ "kind": "text" }]),
        ),
        (
            "/runtime/workingCopies/0/draft/source",
            json!({ "kind": "user-template" }),
        ),
    ] {
        assert_archive_rejects_value(complete_devd_archive(), pointer, replacement);
    }
}

#[test]
fn archive_validation_accepts_canvas_editor_values_preprocessed_by_devd() {
    let mut archive = complete_devd_archive();
    *archive
        .pointer_mut("/runtime/versions/0/document/editor/gridSize")
        .unwrap() = json!(7);
    *archive
        .pointer_mut("/runtime/versions/0/document/editor/snapStep")
        .unwrap() = json!(2);
    archive
        .pointer_mut("/runtime/workingCopies/0/draft/editor")
        .unwrap()
        .as_object_mut()
        .unwrap()
        .remove("gridSize");
    archive
        .pointer_mut("/runtime/workingCopies/0/draft/editor")
        .unwrap()
        .as_object_mut()
        .unwrap()
        .remove("snapStep");

    let archive: DevdDataArchive = serde_json::from_value(archive).unwrap();
    archive.validate().unwrap();
}
