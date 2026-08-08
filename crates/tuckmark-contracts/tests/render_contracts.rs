use serde_json::json;
use tuckmark_contracts::{
    ArtifactPackets, DirectCanvasDefinition, PaperType, RenderOptions, TemplateDefinition,
    TemplateElement,
};

#[test]
fn render_options_use_the_frozen_wire_defaults() {
    let options: RenderOptions = serde_json::from_value(json!({
        "paperType": "continuous",
        "printWidthDots": 8,
        "threshold": 128,
        "previewScale": 1
    }))
    .unwrap();

    assert_eq!(options.printer_model, "generic");
    assert_eq!(options.printer_dpi, 203);
    assert_eq!(options.paper_type, PaperType::Continuous);
    options.validate().unwrap();
    assert_eq!(serde_json::to_value(&options).unwrap()["printWidthDots"], 8);
}

#[test]
fn template_and_canvas_wire_shapes_validate_all_code_elements() {
    let template: TemplateDefinition = serde_json::from_value(json!({
        "id": "fixture-template",
        "name": "Fixture",
        "width": 128,
        "height": 64,
        "fields": [{ "key": "title", "label": "Title" }],
        "elements": [
            { "kind": "text", "key": "title", "x": 1, "y": 2, "fontSize": 12 },
            { "kind": "barcode", "key": "barcode", "x": 1, "y": 20, "width": 100, "height": 20 },
            { "kind": "qr", "key": "qr", "x": 100, "y": 1, "size": 20, "errorCorrectionLevel": "H" },
            { "kind": "datamatrix", "key": "matrix", "x": 100, "y": 24, "size": 20 }
        ]
    }))
    .unwrap();

    template.validate().unwrap();
    assert!(matches!(
        template.elements.last(),
        Some(TemplateElement::DataMatrix { .. })
    ));
    let canvas: DirectCanvasDefinition = serde_json::from_value(json!({
        "id": "fixture-canvas",
        "name": "Fixture Canvas",
        "width": 8,
        "height": 4,
        "elements": [{ "kind": "rect", "x": 0, "y": 0, "width": 8, "height": 4 }]
    }))
    .unwrap();
    canvas.validate().unwrap();
}

#[test]
fn artifact_packets_require_canonical_base64_and_matching_metadata() {
    let valid = ArtifactPackets {
        artifact_id: "artifact-001".into(),
        packets_json_path: "previews/artifact-001/packets.json".into(),
        packets: vec!["ABEi".into(), "qrs=".into()],
        packet_count: 2,
        total_bytes: 5,
        extra: Default::default(),
    };
    valid.validate().unwrap();

    let mut invalid = valid;
    invalid.total_bytes = 4;
    assert!(invalid.validate().is_err());
}
