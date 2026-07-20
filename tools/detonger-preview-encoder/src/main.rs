use std::path::PathBuf;

use base64::Engine as _;
use clap::{Args, Parser, ValueEnum};
use detonger_protocol::{
    FinalizeMode, PaperType, PrintOptions, PrinterCaps, encode_png_job_messages_in_chunks,
    encode_png_job_messages_with_finalize,
};
use image::{DynamicImage, Rgba, RgbaImage};
use serde::Serialize;

#[derive(Debug, Parser)]
#[command(
    name = "tuckmark-detonger-preview-encoder",
    about = "Encode PNG previews into Detonger packets json"
)]
struct Cli {
    #[command(flatten)]
    args: PreviewPacketsArgs,
}

#[derive(Debug, Args)]
struct PreviewPacketsArgs {
    #[arg(long)]
    png: PathBuf,

    #[arg(long)]
    out: PathBuf,

    #[arg(long)]
    width: Option<u16>,

    #[arg(long = "x-offset", default_value_t = 0, allow_hyphen_values = true)]
    x_offset: i16,

    #[arg(long = "y-offset", default_value_t = 0, allow_hyphen_values = true)]
    y_offset: i16,

    #[arg(
        long = "print-strength",
        default_value_t = 0,
        allow_hyphen_values = true
    )]
    print_strength: i8,

    #[arg(long, default_value_t = 150)]
    threshold: u8,

    #[arg(long = "paper-type", value_enum, default_value_t = PaperTypeArg::Gap)]
    paper_type: PaperTypeArg,

    #[arg(long)]
    rows_per_chunk: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum PaperTypeArg {
    Continuous,
    Gap,
}

impl From<PaperTypeArg> for PaperType {
    fn from(value: PaperTypeArg) -> Self {
        match value {
            PaperTypeArg::Continuous => PaperType::Continuous,
            PaperTypeArg::Gap => PaperType::Gap,
        }
    }
}

#[derive(Debug, Serialize)]
struct PacketsJson {
    packets: Vec<String>,
}

fn position_png_into_print_frame(
    png: &[u8],
    print_width_dots: u16,
    x_offset: i16,
    y_offset: i16,
    paper_type: PaperTypeArg,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let src = image::load_from_memory(png)?.to_rgba8();
    let src_width = src.width() as i32;
    let src_height = src.height() as i32;
    let frame_width = i32::from(print_width_dots);
    let base_x = (frame_width - src_width) / 2;
    let applies_bitmap_y_offset = matches!(paper_type, PaperTypeArg::Continuous);
    let frame_top = if applies_bitmap_y_offset {
        std::cmp::min(0, i32::from(y_offset))
    } else {
        0
    };
    let frame_bottom = if applies_bitmap_y_offset {
        std::cmp::max(src_height, src_height + i32::from(y_offset))
    } else {
        src_height
    };
    let frame_height = frame_bottom - frame_top;
    let content_top = if applies_bitmap_y_offset {
        i32::from(y_offset) - frame_top
    } else {
        0
    };

    if frame_width <= 0 || frame_height <= 0 {
        return Ok(png.to_vec());
    }

    let mut dst = RgbaImage::from_pixel(
        frame_width as u32,
        frame_height as u32,
        Rgba([255, 255, 255, 255]),
    );

    for y in 0..src_height {
        let dest_y = y + content_top;
        if dest_y < 0 || dest_y >= frame_height {
            continue;
        }

        for x in 0..src_width {
            let dest_x = x + base_x + i32::from(x_offset);
            if dest_x < 0 || dest_x >= frame_width {
                continue;
            }

            let pixel = *src.get_pixel(x as u32, y as u32);
            dst.put_pixel(dest_x as u32, dest_y as u32, pixel);
        }
    }

    let mut bytes = Vec::new();
    DynamicImage::ImageRgba8(dst).write_to(
        &mut std::io::Cursor::new(&mut bytes),
        image::ImageFormat::Png,
    )?;
    Ok(bytes)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    let png = std::fs::read(&cli.args.png)?;

    let default_caps = PrinterCaps::default();
    let caps = PrinterCaps {
        dpi: default_caps.dpi,
        print_width_dots: cli.args.width.unwrap_or(default_caps.print_width_dots),
    };
    let positioned_png = position_png_into_print_frame(
        &png,
        caps.print_width_dots,
        cli.args.x_offset,
        cli.args.y_offset,
        cli.args.paper_type,
    )?;

    let opts = PrintOptions {
        threshold: cli.args.threshold,
        x_offset_dots: 0,
        paper_type: cli.args.paper_type.into(),
        ..PrintOptions::default()
    };

    let packets = match cli.args.rows_per_chunk {
        Some(rows_per_chunk) => encode_png_job_messages_in_chunks(
            &positioned_png,
            &caps,
            &opts,
            rows_per_chunk,
            FinalizeMode::default(),
        )?
        .into_iter()
        .flatten()
        .collect::<Vec<_>>(),
        None => encode_png_job_messages_with_finalize(
            &positioned_png,
            &caps,
            &opts,
            FinalizeMode::default(),
        )?,
    };

    let payload = PacketsJson {
        packets: packets
            .into_iter()
            .map(|packet| base64::engine::general_purpose::STANDARD.encode(packet))
            .collect(),
    };

    std::fs::write(
        &cli.args.out,
        format!("{}\n", serde_json::to_string_pretty(&payload)?),
    )?;
    Ok(())
}
