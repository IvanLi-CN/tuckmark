use std::{
    fs,
    path::Path,
    sync::{Arc, Barrier, Mutex},
};

#[cfg(unix)]
use std::os::unix::fs::symlink;

use serde_json::json;
use tempfile::tempdir;
use tuckmark_contracts::AgentImportProposal;
use tuckmark_engine::{
    AgentImportManager, ArchiveImportMode, Clock, CommitRequest, CreateAgentImportSession,
    DataAuthority, DataAuthorityError, DataAuthorityOptions, JsonWrite, ProcessProbe,
};

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> String {
        "2026-01-02T03:04:05Z".into()
    }
}

struct MutableClock(Mutex<String>);

impl MutableClock {
    fn set(&self, value: &str) {
        *self.0.lock().unwrap() = value.into();
    }
}

impl Clock for MutableClock {
    fn now(&self) -> String {
        self.0.lock().unwrap().clone()
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

struct ReusedPidProcess;

impl ProcessProbe for ReusedPidProcess {
    fn is_alive(&self, _pid: u32) -> bool {
        true
    }

    fn start_identity(&self, _pid: u32) -> Option<String> {
        Some("replacement-process".into())
    }
}

fn fixture_options(probe: impl ProcessProbe + 'static) -> DataAuthorityOptions {
    DataAuthorityOptions {
        process_probe: Arc::new(probe),
        clock: Arc::new(FixedClock),
    }
}

fn backup_file_paths(directory: &Path) -> Vec<std::path::PathBuf> {
    let mut paths = fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.is_file())
        .collect::<Vec<_>>();
    paths.sort();
    paths
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
fn authority_reserves_control_and_manifest_paths_from_public_commits() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();

    for path in [
        ".tuckmark/devd-live.lock",
        ".tuckmark/state.json",
        "manifest.json",
    ] {
        assert!(matches!(
            authority.commit(CommitRequest {
                expected_revision: 0,
                writes: vec![JsonWrite::new(path, json!({ "replaced": true }))],
                deletes: vec![],
                domains: vec!["settings".into()],
                reason: "attempt-control-write".into(),
            }),
            Err(DataAuthorityError::InvalidPath(_))
        ));
    }
    assert_eq!(authority.revision().unwrap(), 0);
}

#[cfg(unix)]
#[test]
fn authority_rejects_commit_through_an_ancestor_symlink_without_writing_outside_root() {
    let directory = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();

    symlink(outside.path(), directory.path().join("settings")).unwrap();

    assert!(matches!(
        authority.commit(CommitRequest {
            expected_revision: 0,
            writes: vec![JsonWrite::new(
                "settings/app-settings.json",
                json!({ "updatedAt": "2026-01-03T04:05:06Z" }),
            )],
            deletes: vec![],
            domains: vec!["settings".into()],
            reason: "reject-symlink-escape".into(),
        }),
        Err(DataAuthorityError::InvalidPath(path)) if path == "settings/app-settings.json"
    ));
    assert!(!outside.path().join("app-settings.json").exists());
    assert!(!directory.path().join(".tuckmark/state.json").exists());
}

#[cfg(unix)]
#[test]
fn authority_rejects_an_outside_symlink_when_scanning_managed_data() {
    let directory = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();

    fs::create_dir_all(outside.path().join("materials")).unwrap();
    fs::write(
        outside.path().join("materials/outside-material.json"),
        r#"{
            "id":"outside-material",
            "fullName":"Outside Material",
            "currentQuantity":0,
            "createdAt":"2026-01-01T00:00:00Z",
            "updatedAt":"2026-01-01T00:00:00Z",
            "labelBindings":[]
        }"#,
    )
    .unwrap();
    symlink(outside.path(), directory.path().join("inventory")).unwrap();

    assert!(matches!(
        authority.export_archive(),
        Err(DataAuthorityError::InvalidPath(path)) if path == "inventory/materials"
    ));
}

#[cfg(unix)]
#[test]
fn authority_rejects_read_through_an_ancestor_symlink() {
    let directory = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();

    fs::write(
        outside.path().join("app-settings.json"),
        r#"{"secret":"outside-root"}"#,
    )
    .unwrap();
    symlink(outside.path(), directory.path().join("settings")).unwrap();

    assert!(matches!(
        authority.read_json("settings/app-settings.json"),
        Err(DataAuthorityError::InvalidPath(path)) if path == "settings/app-settings.json"
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
fn authority_rejects_legacy_wal_gaps_when_managed_data_already_exists() {
    let directory = tempdir().unwrap();
    let transactions = directory.path().join(".tuckmark/transactions");
    fs::create_dir_all(&transactions).unwrap();
    fs::create_dir_all(directory.path().join("settings")).unwrap();
    fs::write(
        directory.path().join("settings/app-settings.json"),
        r#"{"updatedAt":"2026-01-01T00:00:00Z"}"#,
    )
    .unwrap();
    fs::write(
        transactions.join("8-legacy.json"),
        serde_json::to_vec_pretty(&json!({
            "schema": "tuckmark.devd-data-transaction.v1",
            "revision": 8,
            "writes": [],
            "deletes": [],
            "event": {
                "revision": 8,
                "domains": ["settings"],
                "reason": "legacy-gap"
            }
        }))
        .unwrap(),
    )
    .unwrap();

    assert!(matches!(
        DataAuthority::open(directory.path()),
        Err(DataAuthorityError::CorruptTransaction(message)) if message.contains("expected 1")
    ));
    assert!(transactions.join("8-legacy.json").exists());
}

#[test]
fn authority_only_cleans_an_already_committed_journal() {
    let directory = tempdir().unwrap();
    let transactions = directory.path().join(".tuckmark/transactions");
    fs::create_dir_all(&transactions).unwrap();
    fs::write(
        directory.path().join(".tuckmark/state.json"),
        r#"{"schema":"tuckmark.devd-data-state.v1","revision":1,"updatedAt":"2026-01-01T00:00:00Z"}"#,
    )
    .unwrap();
    fs::write(
        transactions.join("1-committed.json"),
        serde_json::to_vec_pretty(&json!({
            "schema": "tuckmark.devd-data-transaction.v1",
            "revision": 1,
            "writes": [{
                "relativePath": "inventory/materials/should-not-be-written.json",
                "value": { "id": "should-not-be-written" }
            }],
            "deletes": [],
            "event": {
                "revision": 1,
                "domains": ["inventory"],
                "reason": "completed"
            }
        }))
        .unwrap(),
    )
    .unwrap();

    let authority = DataAuthority::open(directory.path()).unwrap();
    assert_eq!(authority.revision().unwrap(), 1);
    assert!(
        !directory
            .path()
            .join("inventory/materials/should-not-be-written.json")
            .exists()
    );
    assert!(!transactions.join("1-committed.json").exists());
}

#[test]
fn authority_rejects_multiple_wals_with_a_revision_gap() {
    let directory = tempdir().unwrap();
    let transactions = directory.path().join(".tuckmark/transactions");
    fs::create_dir_all(&transactions).unwrap();

    for (revision, material_id) in [(2, "revision-two"), (10, "revision-ten")] {
        let journal = json!({
            "schema": "tuckmark.devd-data-transaction.v1",
            "revision": revision,
            "writes": [{
                "relativePath": format!("inventory/materials/{material_id}.json"),
                "value": {
                    "id": material_id,
                    "fullName": format!("Material {revision}"),
                    "currentQuantity": 0,
                    "labelBindings": []
                }
            }],
            "deletes": [],
            "event": {
                "revision": revision,
                "domains": ["inventory"],
                "reason": "recovery-order"
            }
        });
        fs::write(
            transactions.join(format!("{revision}-fixture.json")),
            serde_json::to_vec_pretty(&journal).unwrap(),
        )
        .unwrap();
    }

    assert!(matches!(
        DataAuthority::open(directory.path()),
        Err(DataAuthorityError::CorruptTransaction(message)) if message.contains("expected 1")
    ));
    assert!(transactions.join("2-fixture.json").exists());
    assert!(transactions.join("10-fixture.json").exists());
}

#[test]
fn authority_refreshes_manifest_snapshot_timestamp_from_persisted_records() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();

    authority
        .commit(CommitRequest {
            expected_revision: 0,
            writes: vec![JsonWrite::new(
                "settings/app-settings.json",
                json!({ "updatedAt": "2026-01-03T04:05:06Z" }),
            )],
            deletes: vec![],
            domains: vec!["settings".into()],
            reason: "timestamp-fixture".into(),
        })
        .unwrap();

    assert_eq!(
        authority.read_json("manifest.json").unwrap().unwrap()["snapshotUpdatedAt"],
        "2026-01-03T04:05:06Z"
    );
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

    let reused_directory = tempdir().unwrap();
    let reused_control = reused_directory.path().join(".tuckmark");
    fs::create_dir_all(&reused_control).unwrap();
    fs::write(
        reused_control.join("devd-live.lock"),
        serde_json::to_vec_pretty(&json!({
            "schema": "tuckmark.devd-live-lock.v1",
            "pid": 78,
            "token": "reused-token",
            "claimedAt": "2026-01-01T00:00:00Z",
            "processStartIdentity": "retired-process"
        }))
        .unwrap(),
    )
    .unwrap();
    let reused = DataAuthority::open_with_options(
        reused_directory.path(),
        fixture_options(ReusedPidProcess),
    )
    .unwrap();
    assert_ne!(
        reused
            .read_json(".tuckmark/devd-live.lock")
            .unwrap()
            .unwrap()["token"],
        "reused-token"
    );
    drop(reused);

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
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z",
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
    let archive_inspection = source.inspect_archive(&archive).unwrap();
    assert_eq!(
        archive_inspection.conflicts,
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
        .import_archive(
            &archive,
            &archive_inspection.archive_hash,
            ArchiveImportMode::Replace,
            0,
        )
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
        backup_file_paths(&target.root().join("backups/protection")).len(),
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
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z",
                    "labelBindings": []
                }),
            )],
            deletes: vec![],
            domains: vec!["inventory".into()],
            reason: "current".into(),
        })
        .unwrap();
    let archive = authority.export_archive().unwrap();

    let archive_hash = authority.inspect_archive(&archive).unwrap().archive_hash;
    assert!(
        authority
            .import_archive(&archive, &archive_hash, ArchiveImportMode::Merge, 1)
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
    let archive_hash = authority.inspect_archive(&archive).unwrap().archive_hash;
    let mut revision = 0;

    for _ in 0..21 {
        revision = authority
            .import_archive(
                &archive,
                &archive_hash,
                ArchiveImportMode::Replace,
                revision,
            )
            .unwrap()
            .revision;
    }

    assert_eq!(revision, 21);
    let protection = backup_file_paths(&authority.root().join("backups/protection"));
    assert_eq!(protection.len(), 20);
    assert!(
        protection
            .iter()
            .all(|path| path.extension().is_some_and(|extension| extension == "zip"))
    );
}

#[test]
fn authority_writes_manual_and_protection_backups_as_portable_zip_archives() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();

    let manual = authority.create_backup(0).unwrap();
    assert_eq!(
        manual
            .path
            .extension()
            .and_then(|extension| extension.to_str()),
        Some("zip")
    );
    assert!(!manual.name.contains(':'));
    let manual_inspection = authority
        .inspect_archive_zip(&fs::read(&manual.path).unwrap())
        .unwrap();
    assert_eq!(manual_inspection.summary.materials, 0);

    let archive = authority.export_archive().unwrap();
    let archive_hash = authority.inspect_archive(&archive).unwrap().archive_hash;
    authority
        .import_archive(&archive, &archive_hash, ArchiveImportMode::Replace, 1)
        .unwrap();

    let protection = backup_file_paths(&authority.root().join("backups/protection"));
    assert_eq!(protection.len(), 1);
    assert_eq!(
        protection[0]
            .extension()
            .and_then(|extension| extension.to_str()),
        Some("zip")
    );
    assert!(
        !protection[0]
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap()
            .contains(':')
    );
    let protection_inspection = authority
        .inspect_archive_zip(&fs::read(&protection[0]).unwrap())
        .unwrap();
    assert_eq!(protection_inspection.summary.materials, 0);
}

#[test]
fn authority_retention_counts_legacy_json_and_portable_zip_protection_backups() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();
    let archive = authority.export_archive().unwrap();
    let archive_hash = authority.inspect_archive(&archive).unwrap().archive_hash;
    let protection_directory = authority.root().join("backups/protection");
    fs::create_dir_all(&protection_directory).unwrap();
    fs::write(
        protection_directory.join("legacy.json"),
        serde_json::to_vec(&archive).unwrap(),
    )
    .unwrap();

    let mut revision = 0;
    for _ in 0..20 {
        revision = authority
            .import_archive(
                &archive,
                &archive_hash,
                ArchiveImportMode::Replace,
                revision,
            )
            .unwrap()
            .revision;
    }

    let retained = backup_file_paths(&protection_directory);
    assert_eq!(retained.len(), 20);
    assert!(
        retained
            .iter()
            .any(|path| path.extension().is_some_and(|ext| ext == "zip"))
    );
}

#[test]
fn agent_import_normalizes_material_defaults_and_matrix_codes() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();
    let manager = AgentImportManager::new(authority.clone());
    let proposal: AgentImportProposal = serde_json::from_value(json!({
        "schema": "tuckmark.agent-import.v1",
        "items": [{
            "id": "normalized-material",
            "kind": "new",
            "quantity": 1,
            "material": {
                "fullName": "Normalized material",
                "matrixCode": "  MATRIX-42  "
            },
            "template": {
                "source": "system",
                "id": "cable-tag",
                "name": "Caller supplied name is ignored",
                "fields": []
            },
            "templateInput": { "name": "Normalized material" }
        }]
    }))
    .unwrap();
    let session = manager
        .create_session(CreateAgentImportSession {
            id: "normalized-material-session".into(),
            secret: "synthetic-secret-at-least-sixteen".into(),
            proposal,
        })
        .unwrap();

    assert_eq!(session.proposal.source_note.as_deref(), Some(""));
    assert_eq!(session.proposal.items[0].source_note.as_deref(), Some(""));
    assert_eq!(session.proposal.items[0].material["description"], "");
    assert_eq!(session.proposal.items[0].material["deviceDetails"], "");
    assert_eq!(session.proposal.items[0].material["packagingRemark"], "");

    manager
        .confirm(
            "normalized-material-session",
            "synthetic-secret-at-least-sixteen",
        )
        .unwrap();
    let material_path = authority
        .list_json_files("inventory/materials")
        .unwrap()
        .into_iter()
        .next()
        .unwrap();
    let material_path = material_path
        .strip_prefix(authority.root())
        .unwrap()
        .to_string_lossy()
        .replace('\\', "/");
    let material = authority.read_json(&material_path).unwrap().unwrap();
    assert_eq!(material["matrixCode"], "MATRIX-42");
    assert_eq!(material["description"], "");
    assert_eq!(material["deviceDetails"], "");
    assert_eq!(material["packagingRemark"], "");
}

#[test]
fn agent_import_falls_back_to_the_proposal_source_note() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();
    let manager = AgentImportManager::new(authority.clone());
    let proposal: AgentImportProposal = serde_json::from_value(json!({
        "schema": "tuckmark.agent-import.v1",
        "sourceNote": "proposal-wide source note",
        "items": [{
            "id": "proposal-note-material",
            "kind": "new",
            "quantity": 1,
            "material": { "fullName": "Proposal note material" },
            "template": {
                "source": "system",
                "id": "cable-tag",
                "name": "Caller supplied name is ignored",
                "fields": []
            },
            "templateInput": { "name": "Proposal note material" }
        }]
    }))
    .unwrap();
    manager
        .create_session(CreateAgentImportSession {
            id: "proposal-note-session-0001".into(),
            secret: "synthetic-secret-at-least-sixteen".into(),
            proposal,
        })
        .unwrap();

    manager
        .confirm(
            "proposal-note-session-0001",
            "synthetic-secret-at-least-sixteen",
        )
        .unwrap();
    let adjustment_path = authority
        .list_json_files("inventory/adjustments")
        .unwrap()
        .into_iter()
        .next()
        .unwrap();
    let adjustment_path = adjustment_path
        .strip_prefix(authority.root())
        .unwrap()
        .to_string_lossy()
        .replace('\\', "/");
    assert_eq!(
        authority.read_json(&adjustment_path).unwrap().unwrap()["note"],
        "proposal-wide source note"
    );
}

#[test]
fn agent_import_confirmation_commits_new_and_restock_items_in_one_revision() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();
    authority
        .commit(CommitRequest {
            expected_revision: 0,
            writes: vec![JsonWrite::new(
                "inventory/materials/restock-target.json",
                json!({
                    "id": "restock-target",
                    "fullName": "Restock Target",
                    "currentQuantity": 4,
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z",
                    "labelBindings": []
                }),
            )],
            deletes: vec![],
            domains: vec!["inventory".into()],
            reason: "seed-restock".into(),
        })
        .unwrap();
    let manager = AgentImportManager::new(authority.clone());
    let proposal: AgentImportProposal = serde_json::from_value(json!({
        "schema": "tuckmark.agent-import.v1",
        "sourceNote": "synthetic fixture",
        "items": [
            {
                "id": "new-item",
                "kind": "new",
                "selected": true,
                "quantity": 3,
                "material": { "fullName": "New Imported Material" },
                "template": {
                    "source": "system",
                    "id": "cable-tag",
                    "name": "Caller supplied name is ignored",
                    "fields": []
                },
                "templateInput": { "name": "Imported material" }
            },
            {
                "id": "restock-item",
                "kind": "restock",
                "selected": true,
                "quantity": 2,
                "targetMaterialId": "restock-target",
                "targetMaterialUpdatedAt": "2026-01-01T00:00:00Z",
                "material": { "fullName": "Restock Target" }
            }
        ]
    }))
    .unwrap();
    manager
        .create_session(CreateAgentImportSession {
            id: "session-atomic-0000000001".into(),
            secret: "synthetic-secret-at-least-sixteen".into(),
            proposal,
        })
        .unwrap();

    let completed = manager
        .confirm(
            "session-atomic-0000000001",
            "synthetic-secret-at-least-sixteen",
        )
        .unwrap();

    assert_eq!(completed.state, "completed");
    assert_eq!(authority.revision().unwrap(), 2);
    assert_eq!(
        authority
            .read_json("inventory/materials/restock-target.json")
            .unwrap()
            .unwrap()["currentQuantity"],
        6
    );
    assert_eq!(
        authority
            .list_json_files("inventory/adjustments")
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn agent_import_applies_duplicate_restock_targets_against_the_session_snapshot() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();
    authority
        .commit(CommitRequest {
            expected_revision: 0,
            writes: vec![JsonWrite::new(
                "inventory/materials/duplicate-restock-target.json",
                json!({
                    "id": "duplicate-restock-target",
                    "fullName": "Duplicate Restock Target",
                    "currentQuantity": 4,
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z",
                    "labelBindings": []
                }),
            )],
            deletes: vec![],
            domains: vec!["inventory".into()],
            reason: "seed-duplicate-restock".into(),
        })
        .unwrap();
    let manager = AgentImportManager::new(authority.clone());
    let proposal: AgentImportProposal = serde_json::from_value(json!({
        "schema": "tuckmark.agent-import.v1",
        "items": [
            {
                "id": "first-restock",
                "kind": "restock",
                "selected": true,
                "quantity": 2,
                "targetMaterialId": "duplicate-restock-target",
                "targetMaterialUpdatedAt": "2026-01-01T00:00:00Z",
                "material": { "fullName": "Duplicate Restock Target" }
            },
            {
                "id": "second-restock",
                "kind": "restock",
                "selected": true,
                "quantity": 3,
                "targetMaterialId": "duplicate-restock-target",
                "targetMaterialUpdatedAt": "2026-01-01T00:00:00Z",
                "material": { "fullName": "Duplicate Restock Target" }
            }
        ]
    }))
    .unwrap();
    manager
        .create_session(CreateAgentImportSession {
            id: "duplicate-restock-session".into(),
            secret: "synthetic-secret-at-least-sixteen".into(),
            proposal,
        })
        .unwrap();

    manager
        .confirm(
            "duplicate-restock-session",
            "synthetic-secret-at-least-sixteen",
        )
        .unwrap();

    assert_eq!(authority.revision().unwrap(), 2);
    assert_eq!(
        authority
            .read_json("inventory/materials/duplicate-restock-target.json")
            .unwrap()
            .unwrap()["currentQuantity"],
        9
    );
    assert_eq!(
        authority
            .list_json_files("inventory/adjustments")
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn agent_import_confirmation_rejects_the_entire_batch_when_one_restock_is_invalid() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();
    let manager = AgentImportManager::new(authority.clone());
    let proposal: AgentImportProposal = serde_json::from_value(json!({
        "schema": "tuckmark.agent-import.v1",
        "items": [
            {
                "id": "new-item",
                "kind": "new",
                "selected": true,
                "quantity": 1,
                "material": { "fullName": "Must Not Persist" },
                "template": {
                    "source": "system",
                    "id": "cable-tag",
                    "name": "Caller supplied name is ignored",
                    "fields": []
                },
                "templateInput": { "name": "Must not persist" }
            },
            {
                "id": "invalid-restock",
                "kind": "restock",
                "selected": true,
                "quantity": 1,
                "targetMaterialId": "missing-target",
                "material": { "fullName": "Missing Target" }
            }
        ]
    }))
    .unwrap();
    manager
        .create_session(CreateAgentImportSession {
            id: "session-invalid-0000000001".into(),
            secret: "synthetic-secret-at-least-sixteen".into(),
            proposal,
        })
        .unwrap();

    assert!(
        manager
            .confirm(
                "session-invalid-0000000001",
                "synthetic-secret-at-least-sixteen",
            )
            .is_err()
    );
    assert_eq!(authority.revision().unwrap(), 0);
    assert!(
        authority
            .list_json_files("inventory/materials")
            .unwrap()
            .is_empty()
    );
    assert!(
        authority
            .list_json_files("inventory/adjustments")
            .unwrap()
            .is_empty()
    );
}

#[test]
fn agent_import_serializes_concurrent_confirmations() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();
    let manager = AgentImportManager::new(authority.clone());
    let secret = "synthetic-secret-at-least-sixteen";

    for (session_id, material_name) in [
        ("concurrent-session-one-0001", "Concurrent material one"),
        ("concurrent-session-two-0001", "Concurrent material two"),
    ] {
        let proposal: AgentImportProposal = serde_json::from_value(json!({
            "schema": "tuckmark.agent-import.v1",
            "items": [{
                "id": format!("{session_id}-item"),
                "kind": "new",
                "selected": true,
                "quantity": 1,
                "material": { "fullName": material_name },
                "template": {
                    "source": "system",
                    "id": "cable-tag",
                    "name": "Caller supplied name is ignored",
                    "fields": []
                },
                "templateInput": { "name": material_name }
            }]
        }))
        .unwrap();
        manager
            .create_session(CreateAgentImportSession {
                id: session_id.into(),
                secret: secret.into(),
                proposal,
            })
            .unwrap();
    }

    let barrier = Arc::new(Barrier::new(3));
    let (first, second) = std::thread::scope(|scope| {
        let first_manager = manager.clone();
        let first_barrier = barrier.clone();
        let first = scope.spawn(move || {
            first_barrier.wait();
            first_manager.confirm("concurrent-session-one-0001", secret)
        });
        let second_manager = manager.clone();
        let second_barrier = barrier.clone();
        let second = scope.spawn(move || {
            second_barrier.wait();
            second_manager.confirm("concurrent-session-two-0001", secret)
        });
        barrier.wait();
        (first.join().unwrap(), second.join().unwrap())
    });

    assert_eq!(first.unwrap().state, "completed");
    assert_eq!(second.unwrap().state, "completed");
    assert_eq!(authority.revision().unwrap(), 2);
    assert_eq!(
        authority
            .list_json_files("inventory/materials")
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn agent_import_rejects_unknown_system_and_user_templates() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();
    let manager = AgentImportManager::new(authority.clone());

    for (session_id, source) in [
        ("unknown-system-template-0001", "system"),
        ("unknown-user-template-0001", "user-template"),
    ] {
        let proposal: AgentImportProposal = serde_json::from_value(json!({
            "schema": "tuckmark.agent-import.v1",
            "items": [{
                "id": format!("{source}-item"),
                "kind": "new",
                "selected": true,
                "quantity": 1,
                "material": { "fullName": format!("Unknown {source} material") },
                "template": {
                    "source": source,
                    "id": "not-in-catalog",
                    "name": "Forged template",
                    "fields": []
                }
            }]
        }))
        .unwrap();
        manager
            .create_session(CreateAgentImportSession {
                id: session_id.into(),
                secret: "synthetic-secret-at-least-sixteen".into(),
                proposal,
            })
            .unwrap();

        assert!(
            manager
                .confirm(session_id, "synthetic-secret-at-least-sixteen")
                .is_err()
        );
    }

    assert_eq!(authority.revision().unwrap(), 0);
}

#[test]
fn agent_import_uses_the_current_user_template_catalog_record() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();
    authority
        .commit(CommitRequest {
            expected_revision: 0,
            writes: vec![
                JsonWrite::new(
                    "templates/trusted-template/template.json",
                    json!({
                        "id": "trusted-template",
                        "name": "Trusted template name",
                        "currentVersionId": "trusted-version"
                    }),
                ),
                JsonWrite::new(
                    "templates/trusted-template/versions/trusted-version.json",
                    json!({
                        "id": "trusted-version",
                        "templateId": "trusted-template",
                        "version": 1,
                        "kind": "saved",
                        "createdAt": "2026-01-01T00:00:00Z",
                        "label": "Initial",
                        "document": {
                            "id": "trusted-template",
                            "name": "Trusted template name",
                            "width": 100,
                            "height": 50,
                            "fields": [{
                                "key": "serial",
                                "label": "Serial number",
                                "required": true
                            }],
                            "elements": []
                        }
                    }),
                ),
            ],
            deletes: vec![],
            domains: vec!["templates".into()],
            reason: "seed-user-template".into(),
        })
        .unwrap();

    let manager = AgentImportManager::new(authority.clone());
    let proposal: AgentImportProposal = serde_json::from_value(json!({
        "schema": "tuckmark.agent-import.v1",
        "items": [{
            "id": "trusted-user-template-item",
            "kind": "new",
            "selected": true,
            "quantity": 1,
            "material": { "fullName": "Trusted user template material" },
            "template": {
                "source": "user-template",
                "id": "trusted-template",
                "name": "Forged caller name",
                "fields": [{
                    "key": "attackerField",
                    "label": "Forged caller field",
                    "required": true
                }]
            },
            "templateInput": { "serial": "SN-42" }
        }]
    }))
    .unwrap();
    manager
        .create_session(CreateAgentImportSession {
            id: "trusted-user-template-session".into(),
            secret: "synthetic-secret-at-least-sixteen".into(),
            proposal,
        })
        .unwrap();

    manager
        .confirm(
            "trusted-user-template-session",
            "synthetic-secret-at-least-sixteen",
        )
        .unwrap();

    let material = authority
        .list_json_files("inventory/materials")
        .unwrap()
        .into_iter()
        .next()
        .and_then(|path| {
            let relative = path
                .strip_prefix(authority.root())
                .ok()?
                .to_string_lossy()
                .replace('\\', "/");
            authority.read_json(&relative).ok().flatten()
        })
        .unwrap();
    let binding = &material["labelBindings"][0];
    assert_eq!(binding["templateSource"], "user-template");
    assert_eq!(binding["templateId"], "trusted-template");
    assert_eq!(binding["templateName"], "Trusted template name");
    assert_eq!(binding["fieldOverrides"], json!({ "serial": "SN-42" }));
}

#[test]
fn agent_import_expires_sessions_and_returns_the_commit_event() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();
    let clock = Arc::new(MutableClock(Mutex::new("2026-01-02T03:04:05Z".into())));
    let manager = AgentImportManager::with_clock(authority.clone(), clock.clone());
    let proposal: AgentImportProposal = serde_json::from_value(json!({
        "schema": "tuckmark.agent-import.v1",
        "items": [{
            "id": "new-material",
            "kind": "new",
            "selected": true,
            "quantity": 1,
            "material": { "fullName": "TTL material" },
            "template": {
                "source": "system",
                "id": "cable-tag",
                "name": "Caller supplied name is ignored",
                "fields": []
            },
            "templateInput": { "name": "TTL material" }
        }]
    }))
    .unwrap();
    let secret = "synthetic-secret-at-least-sixteen";
    let session = manager
        .create_session(CreateAgentImportSession {
            id: "session-event-0000000001".into(),
            secret: secret.into(),
            proposal,
        })
        .unwrap();
    assert_eq!(session.expires_at, "2026-01-02T03:34:05Z");

    let confirmed = manager
        .confirm_with_result("session-event-0000000001", secret)
        .unwrap();
    assert_eq!(confirmed.event.unwrap().revision, 1);

    clock.set("2026-01-02T04:00:00Z");
    let expired_proposal: AgentImportProposal = serde_json::from_value(json!({
        "schema": "tuckmark.agent-import.v1",
        "items": [{
            "id": "expired-unselected",
            "kind": "new",
            "selected": false,
            "quantity": 1,
            "material": { "fullName": "Session Only" },
            "template": {
                "source": "system",
                "id": "cable-tag",
                "name": "Caller supplied name is ignored",
                "fields": []
            }
        }]
    }))
    .unwrap();
    manager
        .create_session(CreateAgentImportSession {
            id: "session-expired-0000000001".into(),
            secret: secret.into(),
            proposal: expired_proposal,
        })
        .unwrap();
    clock.set("2026-01-02T04:30:00Z");
    assert!(
        manager
            .get_session("session-expired-0000000001", secret)
            .is_err()
    );
}
