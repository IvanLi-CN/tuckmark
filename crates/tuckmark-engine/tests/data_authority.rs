use std::{fs, sync::Arc};

use serde_json::json;
use tempfile::tempdir;
use tuckmark_engine::{
    ArchiveImportMode, Clock, CommitRequest, DataAuthority, DataAuthorityError,
    DataAuthorityOptions, JsonWrite, ProcessProbe,
};

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> String {
        "2026-01-02T03:04:05Z".into()
    }
}

struct DeadProcess;

impl ProcessProbe for DeadProcess {
    fn is_alive(&self, _pid: u32) -> bool {
        false
    }

    fn start_identity(&self, _pid: u32) -> Option<String> {
        None
    }
}

struct LiveProcess;

impl ProcessProbe for LiveProcess {
    fn is_alive(&self, _pid: u32) -> bool {
        true
    }

    fn start_identity(&self, _pid: u32) -> Option<String> {
        Some("fixture-process".into())
    }
}

fn fixture_options(probe: impl ProcessProbe + 'static) -> DataAuthorityOptions {
    DataAuthorityOptions {
        process_probe: Arc::new(probe),
        clock: Arc::new(FixedClock),
    }
}

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

#[test]
fn authority_reclaims_a_stale_lock_but_rejects_an_active_owner() {
    let stale_directory = tempdir().unwrap();
    let control = stale_directory.path().join(".tuckmark");
    fs::create_dir_all(&control).unwrap();
    fs::write(
        control.join("devd-live.lock"),
        serde_json::to_vec_pretty(&json!({
            "schema": "tuckmark.devd-live-lock.v1",
            "pid": 77,
            "token": "stale-token",
            "claimedAt": "2026-01-01T00:00:00Z",
            "processStartIdentity": "stale-process"
        }))
        .unwrap(),
    )
    .unwrap();

    let stale =
        DataAuthority::open_with_options(stale_directory.path(), fixture_options(DeadProcess))
            .unwrap();
    let recovered: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(stale_directory.path().join(".tuckmark/devd-live.lock")).unwrap(),
    )
    .unwrap();
    assert_ne!(recovered["token"], "stale-token");
    drop(stale);

    let live_directory = tempdir().unwrap();
    let live_control = live_directory.path().join(".tuckmark");
    fs::create_dir_all(&live_control).unwrap();
    fs::write(
        live_control.join("devd-live.lock"),
        serde_json::to_vec_pretty(&json!({
            "schema": "tuckmark.devd-live-lock.v1",
            "pid": 88,
            "token": "live-token",
            "claimedAt": "2026-01-01T00:00:00Z",
            "processStartIdentity": "fixture-process"
        }))
        .unwrap(),
    )
    .unwrap();

    assert!(matches!(
        DataAuthority::open_with_options(live_directory.path(), fixture_options(LiveProcess)),
        Err(DataAuthorityError::LiveOwner)
    ));
}

#[test]
fn authority_rejects_referentially_invalid_commits_without_partial_writes() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();

    assert!(
        authority
            .commit(CommitRequest {
                expected_revision: 0,
                writes: vec![JsonWrite::new(
                    "inventory/materials/orphaned-material.json",
                    json!({
                        "id": "orphaned-material",
                        "fullName": "Orphaned Material",
                        "currentQuantity": 0,
                        "labelBindings": [{
                            "id": "orphaned-binding",
                            "templateSource": "user-template",
                            "templateId": "missing-template"
                        }]
                    }),
                )],
                deletes: vec![],
                domains: vec!["inventory".into()],
                reason: "invalid-reference".into(),
            })
            .is_err()
    );

    assert_eq!(authority.revision().unwrap(), 0);
    assert!(
        !directory
            .path()
            .join("inventory/materials/orphaned-material.json")
            .exists()
    );
    assert!(
        authority
            .list_json_files(".tuckmark/transactions")
            .unwrap()
            .is_empty()
    );
}

#[test]
fn authority_exports_inspects_and_restores_archives_atomically() {
    let source_directory = tempdir().unwrap();
    let source = DataAuthority::open(source_directory.path()).unwrap();
    source
        .commit(CommitRequest {
            expected_revision: 0,
            writes: vec![JsonWrite::new(
                "inventory/materials/archive-material.json",
                json!({
                    "id": "archive-material",
                    "fullName": "Archive Material",
                    "currentQuantity": 12,
                    "labelBindings": []
                }),
            )],
            deletes: vec![],
            domains: vec!["inventory".into()],
            reason: "archive-fixture".into(),
        })
        .unwrap();

    let archive = source.export_archive().unwrap();
    assert_eq!(archive.schema, "tuckmark.devd-data-archive.v1");
    assert_eq!(archive.inventory.materials.len(), 1);
    assert_eq!(
        source.inspect_archive(&archive).unwrap().conflicts,
        vec![
            "material-name:Archive Material",
            "material:archive-material"
        ]
    );

    let backup = source.create_backup(1).unwrap();
    assert_eq!(backup.revision, 2);
    assert!(backup.path.exists());

    let target_directory = tempdir().unwrap();
    let target = DataAuthority::open(target_directory.path()).unwrap();
    assert!(
        target
            .inspect_archive(&archive)
            .unwrap()
            .conflicts
            .is_empty()
    );
    let restored = target
        .import_archive(&archive, ArchiveImportMode::Replace, 0)
        .unwrap();
    assert_eq!(restored.revision, 1);
    assert_eq!(target.revision().unwrap(), 1);
    assert_eq!(
        target
            .read_json("inventory/materials/archive-material.json")
            .unwrap()
            .unwrap()["currentQuantity"],
        12
    );
    assert_eq!(
        target.list_json_files("backups/protection").unwrap().len(),
        1
    );
}

#[test]
fn authority_rejects_archive_merge_conflicts_and_orphaned_archive_records() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();
    authority
        .commit(CommitRequest {
            expected_revision: 0,
            writes: vec![JsonWrite::new(
                "inventory/materials/same-material.json",
                json!({
                    "id": "same-material",
                    "fullName": "Current Material",
                    "currentQuantity": 0,
                    "labelBindings": []
                }),
            )],
            deletes: vec![],
            domains: vec!["inventory".into()],
            reason: "current".into(),
        })
        .unwrap();
    let archive = authority.export_archive().unwrap();

    assert!(
        authority
            .import_archive(&archive, ArchiveImportMode::Merge, 1)
            .is_err()
    );
    assert_eq!(authority.revision().unwrap(), 1);

    let mut orphaned = archive.clone();
    orphaned.inventory.adjustments.push(
        serde_json::from_value(json!({
            "id": "orphan-adjustment",
            "materialId": "missing-material",
            "kind": "in",
            "quantityDelta": 1
        }))
        .unwrap(),
    );
    assert!(authority.inspect_archive(&orphaned).is_err());
    assert_eq!(authority.revision().unwrap(), 1);
}

#[test]
fn authority_retains_the_newest_twenty_protection_archives() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();
    let archive = authority.export_archive().unwrap();
    let mut revision = 0;

    for _ in 0..21 {
        revision = authority
            .import_archive(&archive, ArchiveImportMode::Replace, revision)
            .unwrap()
            .revision;
    }

    assert_eq!(revision, 21);
    assert_eq!(
        authority
            .list_json_files("backups/protection")
            .unwrap()
            .len(),
        20
    );
}
