use std::fs;

use serde_json::json;
use tempfile::tempdir;
use tuckmark_engine::{CommitRequest, DataAuthority, DataAuthorityError, JsonWrite};

#[test]
fn authority_commits_canonical_json_and_detects_revision_conflicts() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();

    let event = authority
        .commit(CommitRequest {
            expected_revision: 0,
            writes: vec![JsonWrite::new(
                "inventory/materials/fixture-material.json",
                json!({ "id": "fixture-material", "fullName": "Synthetic Component" }),
            )],
            deletes: vec![],
            domains: vec!["inventory".into()],
            reason: "fixture-write".into(),
        })
        .unwrap();

    assert_eq!(event.revision, 1);
    let written = fs::read_to_string(
        directory
            .path()
            .join("inventory/materials/fixture-material.json"),
    )
    .unwrap();
    assert!(written.ends_with('\n'));
    assert!(matches!(
        authority.commit(CommitRequest {
            expected_revision: 0,
            writes: vec![],
            deletes: vec![],
            domains: vec!["inventory".into()],
            reason: "stale".into(),
        }),
        Err(DataAuthorityError::RevisionConflict {
            expected: 0,
            actual: 1
        })
    ));
}

#[test]
fn authority_recovers_a_frozen_wal_before_its_first_read() {
    let directory = tempdir().unwrap();
    let control = directory.path().join(".tuckmark/transactions");
    fs::create_dir_all(&control).unwrap();
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let fixture: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(root.join("compatibility/fixtures/interrupted-transaction.json"))
            .unwrap(),
    )
    .unwrap();
    fs::write(
        control.join("8-fixture-transaction.json"),
        serde_json::to_string_pretty(&fixture["journal"]).unwrap(),
    )
    .unwrap();

    let authority = DataAuthority::open(directory.path()).unwrap();

    assert_eq!(authority.revision().unwrap(), 8);
    assert!(
        directory
            .path()
            .join("inventory/materials/fixture-material.json")
            .exists()
    );
    assert!(!control.join("8-fixture-transaction.json").exists());
}
