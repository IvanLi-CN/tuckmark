use std::{collections::BTreeMap, fs};

use serde_json::json;
use tempfile::tempdir;
use tuckmark_contracts::{
    DirectCanvasDefinition, PaperType, PreviewSource, RenderOptions, SafeTextLabelRequest,
    TemplateDefinition,
};
use tuckmark_engine::{ArtifactStore, RenderEngine, compile_canvas_draft};

fn fixture_options(width: u32) -> RenderOptions {
    RenderOptions {
        print_width_dots: width,
        threshold: 128,
        preview_scale: 1,
        paper_type: PaperType::Gap,
        ..RenderOptions::default()
    }
}

#[test]
fn renderer_matches_the_frozen_msb_first_bitmap_fixture() {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let fixture: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(root.join("compatibility/fixtures/decoded-render.json")).unwrap(),
    )
    .unwrap();
    let options: RenderOptions =
        serde_json::from_value(fixture["artifact"]["renderOptions"].clone()).unwrap();

    let bitmap = RenderEngine::rasterize_svg(fixture["svg"].as_str().unwrap(), &options).unwrap();
    assert_eq!(bitmap.width, 8);
    assert_eq!(bitmap.height, 4);
    assert_eq!(bitmap.bytes, vec![0x81, 0x42, 0x24, 0x18]);
}

#[test]
fn renderer_handles_template_canvas_safe_text_and_csv_artifacts() {
    let engine = RenderEngine::new();
    let options = fixture_options(160);
    let template: TemplateDefinition = serde_json::from_value(json!({
        "id": "fixture-template",
        "name": "Fixture",
        "width": 160,
        "height": 80,
        "fields": [{ "key": "title", "label": "Title" }],
        "elements": [
            { "kind": "text", "key": "title", "x": 6, "y": 18, "width": 80, "fontSize": 14 },
            { "kind": "barcode", "key": "code", "x": 6, "y": 28, "width": 90, "height": 20 },
            { "kind": "qr", "key": "code", "x": 104, "y": 4, "size": 28, "errorCorrectionLevel": "H" },
            { "kind": "datamatrix", "key": "code", "x": 136, "y": 4, "size": 20 },
            { "kind": "rect", "x": 2, "y": 2, "width": 156, "height": 76, "fill": "none" }
        ]
    }))
    .unwrap();
    let input = BTreeMap::from([
        ("title".into(), "A <safe> title".into()),
        ("code".into(), "TM-001".into()),
    ]);

    let rendered = engine.render_template(&template, &input, &options).unwrap();
    assert!(rendered.svg.contains("&lt;safe&gt;"));
    assert!(!rendered.svg.contains("<safe>"));
    assert!(rendered.png.starts_with(b"\x89PNG\r\n\x1a\n"));
    assert!(rendered.bitmap.starts_with(b"BITMAP:160x80\n"));
    assert_eq!(rendered.artifact.source, PreviewSource::Template);

    let canvas: DirectCanvasDefinition = serde_json::from_value(json!({
        "id": "fixture-canvas",
        "name": "Fixture Canvas",
        "width": 40,
        "height": 20,
        "elements": [{ "kind": "line", "x1": 0, "y1": 0, "x2": 39, "y2": 19, "strokeWidth": 1 }]
    }))
    .unwrap();
    let canvas_rendered = engine.render_canvas(&canvas, &fixture_options(40)).unwrap();
    assert_eq!(canvas_rendered.artifact.source, PreviewSource::Canvas);

    let safe_text = engine
        .render_safe_text(&SafeTextLabelRequest {
            text: "one two three four five six seven eight nine".into(),
            title: "Safe".into(),
            render_options: RenderOptions {
                print_width_dots: 80,
                threshold: 128,
                preview_scale: 1,
                paper_type: PaperType::Continuous,
                ..RenderOptions::default()
            },
            extra: Default::default(),
        })
        .unwrap();
    assert_eq!(safe_text.artifact.source, PreviewSource::SafeText);
    assert_eq!(
        safe_text.artifact.render_options.paper_type,
        PaperType::Continuous
    );

    let batch = engine
        .render_csv_batch(
            &template,
            "title,code\nFirst,TM-101\nSecond,TM-102\n",
            &options,
        )
        .unwrap();
    assert_eq!(batch.len(), 2);
    assert_eq!(batch[1].artifact.batch_index, Some(1));
}

#[test]
fn renderer_rasterizes_text_instead_of_silently_dropping_it() {
    let template: TemplateDefinition = serde_json::from_value(json!({
        "id": "text-raster",
        "name": "Text Raster",
        "width": 96,
        "height": 40,
        "elements": [{
            "kind": "text",
            "key": "title",
            "x": 4,
            "y": 28,
            "width": 88,
            "height": 32,
            "fontSize": 24,
            "fontFamily": "arial",
            "value": "Tuckmark"
        }]
    }))
    .unwrap();
    let rendered = RenderEngine::new()
        .render_template(&template, &BTreeMap::new(), &fixture_options(96))
        .unwrap();

    assert!(rendered.monochrome.bytes.iter().any(|byte| *byte != 0));
}

#[test]
fn renderer_normalizes_template_defaults_required_fields_and_csv_rows() {
    let template: TemplateDefinition = serde_json::from_value(json!({
        "id": "input-normalization",
        "name": "Input normalization",
        "width": 96,
        "height": 32,
        "fields": [
            { "key": "title", "label": "Title", "required": true },
            { "key": "suffix", "label": "Suffix", "defaultValue": "default" }
        ],
        "elements": [{
            "kind": "text",
            "key": "title",
            "x": 4,
            "y": 24,
            "width": 88,
            "fontSize": 16
        }]
    }))
    .unwrap();
    let engine = RenderEngine::new();
    let options = fixture_options(96);

    let rendered = engine
        .render_template(
            &template,
            &BTreeMap::from([("title".into(), "Tuckmark".into())]),
            &options,
        )
        .unwrap();
    assert_eq!(rendered.artifact.input["suffix"], "default");
    assert!(
        engine
            .render_template(&template, &BTreeMap::new(), &options)
            .is_err()
    );

    let batch = engine
        .render_csv_batch(
            &template,
            " title , suffix \n Tuckmark , custom \n\n Second , \n",
            &options,
        )
        .unwrap();
    assert_eq!(batch.len(), 2);
    assert_eq!(batch[0].artifact.input["title"], "Tuckmark");
    assert_eq!(batch[0].artifact.input["suffix"], "custom");
    assert_eq!(batch[1].artifact.input["suffix"], "");
}

#[test]
fn renderer_applies_text_layout_and_value_resolution_contracts() {
    let template: TemplateDefinition = serde_json::from_value(json!({
        "id": "text-layout-contract",
        "name": "Text layout contract",
        "width": 180,
        "height": 80,
        "elements": [
            {
                "kind": "text",
                "key": "empty-text",
                "x": 4,
                "y": 4,
                "width": 48,
                "height": 20,
                "fontSize": 12,
                "value": "",
                "verticalAlign": "bottom",
                "stretchX": true,
                "stretchY": true
            },
            {
                "kind": "text",
                "key": "precomputed",
                "x": 60,
                "y": 6,
                "width": 96,
                "height": 24,
                "fontSize": 10,
                "fontWeight": "bold",
                "value": "AB",
                "resolvedLayout": {
                    "lineLayouts": [{ "text": "AB", "x": 0, "y": 8, "width": 18, "visualWidth": 16, "letterSpacing": 0 }],
                    "glyphs": [],
                    "verticalText": false,
                    "resolvedFontSize": 10,
                    "lineHeight": 12,
                    "contentX": 3,
                    "contentY": 4,
                    "contentWidth": 18,
                    "contentHeight": 10,
                    "textOffsetX": 0,
                    "textOffsetY": 0,
                    "baselineOffsetY": 8,
                    "scaleX": 5,
                    "scaleY": 2
                }
            },
            { "kind": "barcode", "key": "barcode", "x": 4, "y": 34, "width": 72, "height": 16, "value": "  TM-001  ", "showValue": true },
            { "kind": "qr", "key": "qr", "x": 82, "y": 34, "size": 20, "value": "  TM-001  " },
            { "kind": "datamatrix", "key": "matrix", "x": 108, "y": 34, "size": 20, "value": "  TM-001  " }
        ]
    }))
    .unwrap();
    let engine = RenderEngine::new();
    let rendered = engine
        .render_template(&template, &BTreeMap::new(), &fixture_options(180))
        .unwrap();

    assert!(rendered.svg.contains("overflow=\"hidden\""));
    assert!(
        rendered
            .svg
            .contains("transform=\"translate(3 4) scale(5 2)\"")
    );
    assert!(
        rendered
            .svg
            .contains("textLength=\"16\" lengthAdjust=\"spacingAndGlyphs\"")
    );
    assert!(!rendered.svg.contains(">TM-001</text>"));

    let safe_text = engine
        .render_safe_text(&SafeTextLabelRequest {
            text: "   ".into(),
            title: "Whitespace fallback".into(),
            render_options: fixture_options(80),
            extra: Default::default(),
        })
        .unwrap();
    assert_eq!(safe_text.artifact.input["text"], "Tuckmark");
}

#[test]
fn artifact_store_writes_the_compatibility_file_layout_atomically() {
    let directory = tempdir().unwrap();
    let engine = RenderEngine::new();
    let canvas: DirectCanvasDefinition = serde_json::from_value(json!({
        "id": "artifact-canvas",
        "name": "Artifact Canvas",
        "width": 8,
        "height": 4,
        "elements": [{ "kind": "rect", "x": 0, "y": 0, "width": 8, "height": 4, "fill": "#ffffff" }]
    }))
    .unwrap();
    let rendered = engine.render_canvas(&canvas, &fixture_options(8)).unwrap();
    let store = ArtifactStore::new(directory.path());
    let stored = store.write_artifact(&rendered).unwrap();
    let artifact_dir = directory.path().join(".tuckmark/previews").join(&stored.id);

    for file in ["preview.png", "bitmap.bin", "preview.svg", "artifact.json"] {
        assert!(artifact_dir.join(file).is_file(), "missing {file}");
    }
    assert_eq!(
        store.get_artifact(&stored.id).unwrap().unwrap().id,
        stored.id
    );
}

#[test]
fn canvas_draft_compiles_millimeters_bindings_and_visibility_to_dots() {
    let draft = json!({
        "version": 1,
        "unit": "mm",
        "id": "mm-canvas",
        "name": "Millimeter Canvas",
        "width": 25.4,
        "height": 12.7,
        "fields": [{ "key": "part", "defaultValue": "M-001" }],
        "elements": [
            {
                "id": "text-1",
                "kind": "text",
                "x": 1,
                "y": 2,
                "width": 10,
                "height": 4,
                "fontSize": 3,
                "binding": { "fieldKey": "part" },
                "meta": { "visible": true }
            },
            {
                "id": "hidden",
                "kind": "rect",
                "x": 0,
                "y": 0,
                "width": 1,
                "height": 1,
                "meta": { "visible": false }
            },
            {
                "id": "line-1",
                "kind": "line",
                "x": 1,
                "y": 1,
                "x2": 10,
                "y2": 5,
                "strokeWidth": 0.5,
                "meta": { "visible": true }
            }
        ]
    });
    let canvas = compile_canvas_draft(&draft, &BTreeMap::new(), 203).unwrap();

    assert_eq!(canvas.width, 203.0);
    assert_eq!(canvas.height, 102.0);
    assert_eq!(canvas.elements.len(), 2);
    assert!(matches!(
        canvas.elements[1],
        tuckmark_contracts::TemplateElement::Line {
            x1: 8.0,
            y1: 8.0,
            x2: 80.0,
            y2: 40.0,
            stroke_width: 4.0,
            ..
        }
    ));
    let rendered = RenderEngine::new()
        .render_canvas(&canvas, &fixture_options(203))
        .unwrap();
    assert_eq!(
        (rendered.artifact.width, rendered.artifact.height),
        (203, 102)
    );
    assert!(rendered.svg.contains("M-001"));
}
