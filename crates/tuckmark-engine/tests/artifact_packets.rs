use std::fs;

use serde_json::json;
use tempfile::tempdir;
use tuckmark_contracts::{DirectCanvasDefinition, PaperType, RenderOptions};
use tuckmark_engine::{ArtifactStore, PrintEngine, RenderEngine};

fn fixture_options() -> RenderOptions {
    RenderOptions {
        print_width_dots: 8,
        threshold: 128,
        preview_scale: 1,
        paper_type: PaperType::Gap,
        ..RenderOptions::default()
    }
}

fn stored_artifact(store: &ArtifactStore) -> tuckmark_contracts::PreviewArtifact {
    let canvas: DirectCanvasDefinition = serde_json::from_value(json!({
        "id": "packets-canvas",
        "name": "Packets canvas",
        "width": 8,
        "height": 4,
        "elements": [{ "kind": "rect", "x": 0, "y": 0, "width": 8, "height": 4, "fill": "#ffffff" }]
    }))
    .unwrap();
    let rendered = RenderEngine::new()
        .render_canvas(&canvas, &fixture_options())
        .unwrap();
    store.write_artifact(&rendered).unwrap()
}

#[test]
fn artifact_store_atomically_round_trips_canonical_packet_json() {
    let directory = tempdir().unwrap();
    let store = ArtifactStore::from_data_root(directory.path());
    let artifact = stored_artifact(&store);
    let source_packets = vec![vec![0x00, 0x11, 0x22], vec![0xaa, 0xbb]];

    let written = store.write_packets(&artifact.id, &source_packets).unwrap();
    let expected_path = directory
        .path()
        .join(".tuckmark/previews")
        .join(&artifact.id)
        .join("packets.json");
    assert_eq!(written.artifact_id, artifact.id);
    assert_eq!(written.packets_json_path, expected_path.to_string_lossy());
    assert_eq!(written.packets, vec!["ABEi", "qrs="]);
    assert_eq!(written.packet_count, 2);
    assert_eq!(written.total_bytes, 5);
    assert_eq!(
        fs::read_to_string(&expected_path).unwrap(),
        "{\n  \"packets\": [\n    \"ABEi\",\n    \"qrs=\"\n  ]\n}\n"
    );

    let control_store = ArtifactStore::from_control_root(directory.path().join(".tuckmark"));
    assert_eq!(control_store.data_root(), directory.path());
    assert_eq!(
        control_store.packets_path(&artifact.id).unwrap(),
        expected_path
    );

    let read = store.read_packets(&artifact.id).unwrap().unwrap();
    assert_eq!(read, written);
}

#[test]
fn print_engine_exposes_detonger_packets_as_the_artifact_contract_without_hardware() {
    let packets = vec![vec![0x1f, 0x20, 0x01], vec![0x0c]];
    let artifact_packets = PrintEngine::new()
        .artifact_packets("artifact-001", "/tmp/artifact-001/packets.json", &packets)
        .unwrap();

    assert_eq!(artifact_packets.artifact_id, "artifact-001");
    assert_eq!(
        artifact_packets.packets_json_path,
        "/tmp/artifact-001/packets.json"
    );
    assert_eq!(artifact_packets.packets, vec!["HyAB", "DA=="]);
    assert_eq!(artifact_packets.packet_count, 2);
    assert_eq!(artifact_packets.total_bytes, 4);
}

#[test]
fn packet_reads_distinguish_missing_artifacts_from_missing_packet_files() {
    let directory = tempdir().unwrap();
    let store = ArtifactStore::from_data_root(directory.path());

    assert!(store.read_packets("missing-artifact").is_err());
    let artifact = stored_artifact(&store);
    assert!(store.read_packets(&artifact.id).unwrap().is_none());
}
