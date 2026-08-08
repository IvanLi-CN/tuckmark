use std::fs;

use tuckmark_contracts::{PaperType, RenderOptions};
use tuckmark_engine::{MonoBitmap, PrintEngine, RenderEngine};

#[test]
fn print_engine_reproduces_the_frozen_compatibility_packets() {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let fixture: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(root.join("compatibility/fixtures/print-packets.json")).unwrap(),
    )
    .unwrap();
    let bitmap = MonoBitmap {
        width: 8,
        height: 4,
        bytes: vec![0x81, 0x42, 0x24, 0x18],
    };

    let packets = PrintEngine::new().compatibility_packets(&bitmap).unwrap();
    let expected_info: Vec<Vec<u8>> =
        serde_json::from_value(fixture["packets"]["info"].clone()).unwrap();
    let expected_data: Vec<Vec<u8>> =
        serde_json::from_value(fixture["packets"]["data"].clone()).unwrap();
    let expected_finish: Vec<Vec<u8>> =
        serde_json::from_value(fixture["packets"]["finish"].clone()).unwrap();
    assert_eq!(packets.info, expected_info);
    assert_eq!(packets.data, expected_data);
    assert_eq!(packets.finish, expected_finish);
    assert_eq!(packets.flattened().last(), Some(&0x0c));
}

#[test]
fn print_engine_uses_the_pinned_detonger_protocol_without_hardware() {
    let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"4\"><path d=\"M0 0h1v1H0z\"/></svg>";
    let options = RenderOptions {
        print_width_dots: 8,
        threshold: 128,
        paper_type: PaperType::Gap,
        preview_scale: 1,
        ..RenderOptions::default()
    };
    let bitmap = RenderEngine::rasterize_svg(svg, &options).unwrap();
    let packets = PrintEngine::new()
        .detonger_packets_from_mono(&bitmap, &options, None)
        .unwrap();

    assert!(
        packets
            .iter()
            .any(|packet| packet.starts_with(&[0x1f, 0x20]))
    );
    assert_eq!(packets.last().and_then(|packet| packet.last()), Some(&0x0c));
}

#[cfg(target_os = "macos")]
#[test]
fn macos_print_engine_keeps_the_static_detonger_printer_link() {
    assert!(PrintEngine::static_printer_link_marker().contains("detonger_printer"));
    let _link = PrintEngine::static_printer_link();
}
