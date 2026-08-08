use serde_json::json;
use tempfile::tempdir;
use tuckmark_contracts::JsonWrite;
use tuckmark_engine::{ArchiveImportMode, CommitRequest, DataAuthority, DataAuthorityError};

#[test]
fn authority_round_trips_portable_zip_archives_after_hash_confirmation() {
    let source_directory = tempdir().unwrap();
    let source = DataAuthority::open(source_directory.path()).unwrap();
    source
        .commit(CommitRequest {
            expected_revision: 0,
            writes: vec![JsonWrite::new(
                "inventory/materials/zip-material.json",
                json!({
                    "id": "zip-material",
                    "fullName": "Portable ZIP Material",
                    "currentQuantity": 7,
                    "labelBindings": []
                }),
            )],
            deletes: vec![],
            domains: vec!["inventory".into()],
            reason: "archive-zip-fixture".into(),
        })
        .unwrap();

    let portable_zip = source.export_archive_zip().unwrap();
    let target_directory = tempdir().unwrap();
    let target = DataAuthority::open(target_directory.path()).unwrap();
    let inspection = target.inspect_archive_zip(&portable_zip).unwrap();

    let imported = target
        .import_archive_zip(
            &portable_zip,
            &inspection.archive_hash,
            ArchiveImportMode::Replace,
            0,
        )
        .unwrap();
    assert_eq!(imported.revision, 1);
    assert_eq!(
        target
            .read_json("inventory/materials/zip-material.json")
            .unwrap()
            .unwrap()["currentQuantity"],
        7
    );
}

#[test]
fn authority_rejects_archive_import_when_inspected_content_hash_does_not_match() {
    let directory = tempdir().unwrap();
    let authority = DataAuthority::open(directory.path()).unwrap();
    let archive = authority.export_archive().unwrap();

    let error = authority
        .import_archive(
            &archive,
            "not-the-inspection-hash",
            ArchiveImportMode::Replace,
            0,
        )
        .unwrap_err();
    assert!(matches!(error, DataAuthorityError::ArchiveContentChanged));
    assert_eq!(authority.revision().unwrap(), 0);
}
