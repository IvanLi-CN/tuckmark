use serde_json::json;
use tempfile::tempdir;
use tuckmark_devd::{config::DevdConfig, data::DataFacade};

fn data_facade() -> (tempfile::TempDir, DataFacade) {
    let directory = tempdir().unwrap();
    let config = DevdConfig::resolve(Some(directory.path().to_path_buf())).unwrap();
    let data = DataFacade::open(config.active_data_dir()).unwrap();
    (directory, data)
}

fn template_document(recommended_use: &str) -> serde_json::Value {
    json!({
        "id": "document-67",
        "name": "Compatibility template",
        "width": 384,
        "height": 224,
        "fields": [],
        "elements": [],
        "recommendedUse": recommended_use,
    })
}

#[test]
fn save_template_clears_an_explicit_empty_recommended_use() {
    let (_directory, data) = data_facade();
    let created = data
        .mutate_runtime(
            "save-template",
            0,
            json!({
                "name": "Compatibility template",
                "document": template_document("electronics"),
            }),
        )
        .unwrap();
    let template_id = created["data"]["template"]["id"].as_str().unwrap();

    data.mutate_runtime(
        "save-template",
        1,
        json!({
            "templateId": template_id,
            "name": "Compatibility template",
            "document": template_document(""),
        }),
    )
    .unwrap();

    let snapshot = data.read_runtime_snapshot().unwrap();
    assert!(
        snapshot["data"]["templates"][0]
            .get("recommendedUse")
            .is_none()
    );
}

#[test]
fn autosave_keeps_the_established_five_minute_cadence() {
    let (_directory, data) = data_facade();
    let created = data
        .mutate_runtime(
            "save-template",
            0,
            json!({
                "name": "Autosave template",
                "document": template_document(""),
            }),
        )
        .unwrap();
    let template_id = created["data"]["template"]["id"].as_str().unwrap();

    for revision in 1..=2 {
        data.mutate_runtime(
            "save-autosave",
            revision,
            json!({
                "templateId": template_id,
                "source": { "kind": "user-template", "templateId": template_id },
                "document": template_document(""),
            }),
        )
        .unwrap();
    }

    let snapshot = data.read_runtime_snapshot().unwrap();
    let autosaves = snapshot["data"]["versions"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|version| version["templateId"] == template_id && version["kind"] == "autosave")
        .count();
    assert_eq!(autosaves, 1);
}
