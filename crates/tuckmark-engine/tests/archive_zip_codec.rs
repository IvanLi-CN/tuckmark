use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Write},
};

use serde_json::{Value, json};
use tuckmark_contracts::DataDirectoryManifest;
use tuckmark_engine::{ArchiveZipInput, DirectoryTreeArchive, decode_archive_zip};

fn fixture_entries() -> (String, DataDirectoryManifest, BTreeMap<String, Value>) {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let fixture: Value = serde_json::from_str(
        &fs::read_to_string(root.join("compatibility/fixtures/archive.json")).unwrap(),
    )
    .unwrap();
    let entries = fixture["entries"].as_object().unwrap();
    let metadata = entries["archive.json"].as_object().unwrap();
    let manifest = serde_json::from_value(entries["manifest.json"].clone()).unwrap();
    let data_entries = entries
        .iter()
        .filter(|(path, _)| path.as_str() != "archive.json" && path.as_str() != "manifest.json")
        .map(|(path, value)| (path.clone(), value.clone()))
        .collect();

    (
        metadata["exportedAt"].as_str().unwrap().into(),
        manifest,
        data_entries,
    )
}

fn zip_entries(entries: &[(String, Value)]) -> Vec<u8> {
    let cursor = Cursor::new(Vec::new());
    let mut writer = zip::ZipWriter::new(cursor);
    let options = zip::write::SimpleFileOptions::default();
    for (path, value) in entries {
        writer.start_file(path, options).unwrap();
        writer
            .write_all(serde_json::to_string(value).unwrap().as_bytes())
            .unwrap();
    }
    writer.finish().unwrap().into_inner()
}

fn raw_stored_zip(entries: &[(String, Value)]) -> Vec<u8> {
    let files = entries
        .iter()
        .map(|(path, value)| (path.as_bytes(), serde_json::to_vec(value).unwrap()))
        .collect::<Vec<_>>();
    let mut bytes = Vec::new();
    let mut central_records = Vec::new();

    for (name, payload) in &files {
        let offset = bytes.len() as u32;
        let checksum = crc32(payload);
        write_u32(&mut bytes, 0x0403_4b50);
        write_u16(&mut bytes, 20);
        write_u16(&mut bytes, 0);
        write_u16(&mut bytes, 0);
        write_u16(&mut bytes, 0);
        write_u16(&mut bytes, 0);
        write_u32(&mut bytes, checksum);
        write_u32(&mut bytes, payload.len() as u32);
        write_u32(&mut bytes, payload.len() as u32);
        write_u16(&mut bytes, name.len() as u16);
        write_u16(&mut bytes, 0);
        bytes.extend_from_slice(name);
        bytes.extend_from_slice(payload);
        central_records.push((name, payload, checksum, offset));
    }

    let central_offset = bytes.len() as u32;
    for (name, payload, checksum, offset) in central_records {
        write_u32(&mut bytes, 0x0201_4b50);
        write_u16(&mut bytes, 20);
        write_u16(&mut bytes, 20);
        write_u16(&mut bytes, 0);
        write_u16(&mut bytes, 0);
        write_u16(&mut bytes, 0);
        write_u16(&mut bytes, 0);
        write_u32(&mut bytes, checksum);
        write_u32(&mut bytes, payload.len() as u32);
        write_u32(&mut bytes, payload.len() as u32);
        write_u16(&mut bytes, name.len() as u16);
        write_u16(&mut bytes, 0);
        write_u16(&mut bytes, 0);
        write_u16(&mut bytes, 0);
        write_u16(&mut bytes, 0);
        write_u32(&mut bytes, 0);
        write_u32(&mut bytes, offset);
        bytes.extend_from_slice(name);
    }
    let central_size = bytes.len() as u32 - central_offset;
    write_u32(&mut bytes, 0x0605_4b50);
    write_u16(&mut bytes, 0);
    write_u16(&mut bytes, 0);
    write_u16(&mut bytes, files.len() as u16);
    write_u16(&mut bytes, files.len() as u16);
    write_u32(&mut bytes, central_size);
    write_u32(&mut bytes, central_offset);
    write_u16(&mut bytes, 0);
    bytes
}

fn write_u16(bytes: &mut Vec<u8>, value: u16) {
    bytes.extend_from_slice(&value.to_le_bytes());
}

fn write_u32(bytes: &mut Vec<u8>, value: u32) {
    bytes.extend_from_slice(&value.to_le_bytes());
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut value = !0_u32;
    for byte in bytes {
        value ^= u32::from(*byte);
        for _ in 0..8 {
            value = if value & 1 == 0 {
                value >> 1
            } else {
                (value >> 1) ^ 0xedb8_8320
            };
        }
    }
    !value
}

#[test]
fn directory_tree_archive_round_trips_the_frozen_fixture_entries_deterministically() {
    let (exported_at, manifest, entries) = fixture_entries();
    let archive =
        DirectoryTreeArchive::new(exported_at, manifest.clone(), entries.clone()).unwrap();

    let first = archive.encode_zip().unwrap();
    assert_eq!(first, archive.encode_zip().unwrap());

    let decoded = DirectoryTreeArchive::decode_zip(&first).unwrap();
    assert_eq!(decoded.exported_at, "2026-01-02T03:04:05.000Z");
    assert_eq!(decoded.manifest, manifest);
    assert_eq!(decoded.entries, entries);
    assert_eq!(
        decoded.to_devd_data_archive().unwrap().runtime.settings,
        json!({ "threshold": 144, "paperType": "gap" })
    );
}

#[test]
fn directory_tree_archive_rejects_path_traversal_entries() {
    let (exported_at, manifest, entries) = fixture_entries();
    let mut archive_entries = vec![
        (
            "archive.json".into(),
            json!({
                "schema": "tuckmark.runtime-export-archive.v1",
                "exportedAt": exported_at,
            }),
        ),
        (
            "manifest.json".into(),
            serde_json::to_value(manifest).unwrap(),
        ),
    ];
    archive_entries.extend(entries);
    archive_entries.push(("../settings/escaped.json".into(), json!({ "unsafe": true })));

    let error = DirectoryTreeArchive::decode_zip(&zip_entries(&archive_entries)).unwrap_err();
    assert!(error.to_string().contains("unsafe archive entry path"));
}

#[test]
fn directory_tree_archive_rejects_manifest_count_mismatches() {
    let (exported_at, mut manifest, entries) = fixture_entries();
    manifest.counts.templates = 1;
    let mut archive_entries = vec![
        (
            "archive.json".into(),
            json!({
                "schema": "tuckmark.runtime-export-archive.v1",
                "exportedAt": exported_at,
            }),
        ),
        (
            "manifest.json".into(),
            serde_json::to_value(manifest).unwrap(),
        ),
    ];
    archive_entries.extend(entries);

    let error = DirectoryTreeArchive::decode_zip(&zip_entries(&archive_entries)).unwrap_err();
    assert!(error.to_string().contains("manifest count mismatch"));
}

#[test]
fn directory_tree_archive_rejects_duplicate_entries_and_control_directories() {
    let (exported_at, manifest, entries) = fixture_entries();
    let mut duplicate_entries = vec![
        (
            "archive.json".into(),
            json!({
                "schema": "tuckmark.runtime-export-archive.v1",
                "exportedAt": exported_at,
            }),
        ),
        (
            "manifest.json".into(),
            serde_json::to_value(&manifest).unwrap(),
        ),
    ];
    duplicate_entries.extend(entries.clone());
    duplicate_entries.push((
        "settings/app-settings.json".into(),
        json!({ "threshold": 128 }),
    ));
    let duplicate_error =
        DirectoryTreeArchive::decode_zip(&raw_stored_zip(&duplicate_entries)).unwrap_err();
    assert!(duplicate_error.to_string().contains("duplicate entry"));

    let mut control_entries = vec![
        (
            "archive.json".into(),
            json!({
                "schema": "tuckmark.runtime-export-archive.v1",
                "exportedAt": "2026-01-02T03:04:05.000Z",
            }),
        ),
        (
            "manifest.json".into(),
            serde_json::to_value(manifest).unwrap(),
        ),
    ];
    control_entries.extend(entries);
    control_entries.push((
        ".tuckmark/devd-live.lock".into(),
        json!({ "schema": "tuckmark.devd-live-lock.v1" }),
    ));
    let control_error =
        DirectoryTreeArchive::decode_zip(&zip_entries(&control_entries)).unwrap_err();
    assert!(
        control_error
            .to_string()
            .contains("forbidden control entry")
    );
}

#[test]
fn legacy_single_snapshot_zip_remains_available_through_the_explicit_decode_path() {
    let metadata = json!({
        "schema": "tuckmark.data-archive.v1",
        "exportedAt": "2026-01-02T03:04:05.000Z",
        "runtime": {
            "settings": { "threshold": 144 },
            "templates": [],
            "versions": [],
            "workingCopies": []
        },
        "inventory": {
            "materials": [],
            "adjustments": []
        }
    });
    let bytes = zip_entries(&[("archive.json".into(), metadata)]);

    let decoded = decode_archive_zip(&bytes).unwrap();
    let ArchiveZipInput::LegacySnapshot(snapshot) = decoded else {
        panic!("expected a legacy snapshot");
    };
    assert_eq!(snapshot.exported_at, "2026-01-02T03:04:05.000Z");
    assert_eq!(snapshot.runtime.settings["threshold"], 144);

    let error = DirectoryTreeArchive::decode_zip(&bytes).unwrap_err();
    assert!(error.to_string().contains("decode_legacy_archive_metadata"));
}
