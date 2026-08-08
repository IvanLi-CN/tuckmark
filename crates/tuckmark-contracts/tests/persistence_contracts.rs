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
