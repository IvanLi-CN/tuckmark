use std::path::PathBuf;

use base64::Engine as _;
use clap::{Args, Parser, ValueEnum};
use detonger_protocol::{
    FinalizeMode, PaperType, PrintOptions, PrinterCaps, encode_png_job_messages_in_chunks,
    encode_png_job_messages_with_finalize,
};
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

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    let png = std::fs::read(&cli.args.png)?;

    let default_caps = PrinterCaps::default();
    let caps = PrinterCaps {
        dpi: default_caps.dpi,
        print_width_dots: cli.args.width.unwrap_or(default_caps.print_width_dots),
    };

    let opts = PrintOptions {
        threshold: cli.args.threshold,
        x_offset_dots: cli.args.x_offset,
        paper_type: cli.args.paper_type.into(),
    };

    let packets = match cli.args.rows_per_chunk {
        Some(rows_per_chunk) => encode_png_job_messages_in_chunks(
            &png,
            &caps,
            &opts,
            rows_per_chunk,
            FinalizeMode::default(),
        )?
        .into_iter()
        .flatten()
        .collect::<Vec<_>>(),
        None => encode_png_job_messages_with_finalize(&png, &caps, &opts, FinalizeMode::default())?,
    };

    let payload = PacketsJson {
        packets: packets
            .into_iter()
            .map(|packet| base64::engine::general_purpose::STANDARD.encode(packet))
            .collect(),
    };

    std::fs::write(&cli.args.out, format!("{}\n", serde_json::to_string_pretty(&payload)?))?;
    Ok(())
}
