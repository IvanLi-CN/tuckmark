use std::path::PathBuf;

use serde_json::{Value, json};
use tuckmark_contracts::{
    DataDirectoryManifest, DevdDataTransaction, canonical_json_string, normalize_legacy_value,
};

fn fixture(name: &str) -> String {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    std::fs::read_to_string(root.join("compatibility/fixtures").join(name)).unwrap()
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
                        "kind": "text",
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
}
