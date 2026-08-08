use std::marker::PhantomData;

use detonger_protocol::{
    FinalizeMode, PaperType as DetongerPaperType, PrintOptions, PrinterCaps,
    encode_png_job_messages_in_chunks, encode_png_job_messages_with_finalize,
};
use image::{
    ExtendedColorType, ImageEncoder, Rgba, RgbaImage,
    codecs::png::{CompressionType, FilterType, PngEncoder},
};
use thiserror::Error;
use tuckmark_contracts::ArtifactPackets;
use tuckmark_contracts::{PaperType, RenderOptions};

use crate::{MonoBitmap, artifact_store::artifact_packets_from_vendor_messages};

#[derive(Debug, Error)]
pub enum PrintError {
    #[error("print bitmap is invalid: {0}")]
    InvalidBitmap(String),
    #[error("print options are invalid: {0}")]
    InvalidOptions(String),
    #[error("image processing failed: {0}")]
    Image(#[from] image::ImageError),
    #[error("PNG encoding failed: {0}")]
    Png(#[from] std::io::Error),
    #[error("detonger protocol failed: {0}")]
    Detonger(#[from] detonger_protocol::Error),
    #[error("artifact packets are invalid: {0}")]
    ArtifactPackets(String),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompatibilityPackets {
    pub info: Vec<Vec<u8>>,
    pub data: Vec<Vec<u8>>,
    pub finish: Vec<Vec<u8>>,
}

impl CompatibilityPackets {
    pub fn flattened(&self) -> Vec<u8> {
        self.info
            .iter()
            .chain(&self.data)
            .chain(&self.finish)
            .flatten()
            .copied()
            .collect()
    }
}

/// Explicit transport boundary. Native engine code only produces packets; callers own I/O.
pub trait PrintTransport {
    type Error;

    fn write_vendor_messages(&mut self, packets: &[Vec<u8>]) -> Result<(), Self::Error>;
}

/// Keeps the pinned `detonger-printer` crate in the native link graph without initiating BLE work.
#[derive(Clone, Debug, Default)]
pub struct DetongerPrinterLink {
    _marker: PhantomData<detonger_printer::DeviceId>,
}

#[derive(Clone, Debug, Default)]
pub struct PrintEngine;

impl PrintEngine {
    pub fn new() -> Self {
        Self
    }

    pub fn compatibility_packets(
        &self,
        bitmap: &MonoBitmap,
    ) -> Result<CompatibilityPackets, PrintError> {
        bitmap
            .validate()
            .map_err(|error| PrintError::InvalidBitmap(error.to_string()))?;
        let bytes_per_row = bitmap.bytes_per_row();
        let byte_width = u16::try_from(bytes_per_row).map_err(|_| {
            PrintError::InvalidBitmap("compatibility raster is wider than u16".into())
        })?;
        let height = u16::try_from(bitmap.height).map_err(|_| {
            PrintError::InvalidBitmap("compatibility raster is taller than u16".into())
        })?;
        let mut raster = vec![
            0x1d,
            0x76,
            0x30,
            0x00,
            byte_width as u8,
            (byte_width >> 8) as u8,
            height as u8,
            (height >> 8) as u8,
        ];
        raster.extend_from_slice(&bitmap.bytes);
        Ok(CompatibilityPackets {
            info: vec![vec![0x1b, 0x40], vec![0x1d, 0x49, 0x43]],
            data: vec![raster],
            finish: vec![vec![0x0c]],
        })
    }

    pub fn detonger_packets_from_mono(
        &self,
        bitmap: &MonoBitmap,
        options: &RenderOptions,
        rows_per_chunk: Option<usize>,
    ) -> Result<Vec<Vec<u8>>, PrintError> {
        bitmap
            .validate()
            .map_err(|error| PrintError::InvalidBitmap(error.to_string()))?;
        let png = mono_to_png(bitmap)?;
        self.detonger_packets(&png, options, rows_per_chunk)
    }

    pub fn detonger_packets(
        &self,
        png: &[u8],
        options: &RenderOptions,
        rows_per_chunk: Option<usize>,
    ) -> Result<Vec<Vec<u8>>, PrintError> {
        options
            .validate()
            .map_err(|error| PrintError::InvalidOptions(error.to_string()))?;
        let caps = PrinterCaps {
            dpi: u16::try_from(options.printer_dpi)
                .map_err(|_| PrintError::InvalidOptions("printer DPI is wider than u16".into()))?,
            print_width_dots: u16::try_from(options.print_width_dots)
                .map_err(|_| PrintError::InvalidOptions("print width is wider than u16".into()))?,
        };
        let positioned = position_png(png, caps.print_width_dots, options)?;
        let protocol_options = PrintOptions {
            threshold: options.threshold,
            // Positioning is applied to the PNG itself to match the legacy helper.
            x_offset_dots: 0,
            paper_type: match options.paper_type {
                PaperType::Continuous => DetongerPaperType::Continuous,
                PaperType::Gap => DetongerPaperType::Gap,
            },
        };
        match rows_per_chunk {
            Some(rows_per_chunk) => Ok(encode_png_job_messages_in_chunks(
                &positioned,
                &caps,
                &protocol_options,
                rows_per_chunk,
                FinalizeMode::default(),
            )?
            .into_iter()
            .flatten()
            .collect()),
            None => Ok(encode_png_job_messages_with_finalize(
                &positioned,
                &caps,
                &protocol_options,
                FinalizeMode::default(),
            )?),
        }
    }

    /// Converts detonger vendor messages into the shared artifact-packets wire contract.
    /// This has no transport side effects.
    pub fn artifact_packets(
        &self,
        artifact_id: impl Into<String>,
        packets_json_path: impl AsRef<std::path::Path>,
        packets: &[Vec<u8>],
    ) -> Result<ArtifactPackets, PrintError> {
        artifact_packets_from_vendor_messages(artifact_id, packets_json_path, packets)
            .map_err(|error| PrintError::ArtifactPackets(error.to_string()))
    }

    pub fn dispatch<T: PrintTransport>(
        &self,
        transport: &mut T,
        packets: &[Vec<u8>],
    ) -> Result<(), T::Error> {
        transport.write_vendor_messages(packets)
    }

    pub fn static_printer_link() -> DetongerPrinterLink {
        DetongerPrinterLink::default()
    }

    pub fn static_printer_link_marker() -> &'static str {
        std::any::type_name::<detonger_printer::DeviceId>()
    }
}

fn mono_to_png(bitmap: &MonoBitmap) -> Result<Vec<u8>, PrintError> {
    let mut rgba = vec![255; bitmap.width as usize * bitmap.height as usize * 4];
    let bytes_per_row = bitmap.bytes_per_row();
    for y in 0..bitmap.height as usize {
        for x in 0..bitmap.width as usize {
            if bitmap.bytes[y * bytes_per_row + x / 8] & (0x80 >> (x % 8)) == 0 {
                continue;
            }
            let offset = (y * bitmap.width as usize + x) * 4;
            rgba[offset] = 0;
            rgba[offset + 1] = 0;
            rgba[offset + 2] = 0;
        }
    }
    encode_rgba_png(&rgba, bitmap.width, bitmap.height)
}

fn position_png(
    png: &[u8],
    print_width_dots: u16,
    options: &RenderOptions,
) -> Result<Vec<u8>, PrintError> {
    let source = image::load_from_memory_with_format(png, image::ImageFormat::Png)?.to_rgba8();
    let source_width = i32::try_from(source.width())
        .map_err(|_| PrintError::InvalidOptions("source image is too wide".into()))?;
    let source_height = i32::try_from(source.height())
        .map_err(|_| PrintError::InvalidOptions("source image is too tall".into()))?;
    let frame_width = i32::from(print_width_dots);
    let base_x = (frame_width - source_width) / 2;
    let y_offset = options.y_offset_dots;
    let uses_y_offset = options.paper_type == PaperType::Continuous;
    let frame_top = if uses_y_offset { y_offset.min(0) } else { 0 };
    let frame_bottom = if uses_y_offset {
        source_height.max(source_height.saturating_add(y_offset))
    } else {
        source_height
    };
    let frame_height = frame_bottom.saturating_sub(frame_top);
    let content_top = if uses_y_offset {
        y_offset.saturating_sub(frame_top)
    } else {
        0
    };
    if frame_width <= 0 || frame_height <= 0 {
        return Ok(png.to_vec());
    }
    let mut positioned = RgbaImage::from_pixel(
        frame_width as u32,
        frame_height as u32,
        Rgba([255, 255, 255, 255]),
    );
    for y in 0..source_height {
        let destination_y = y.saturating_add(content_top);
        if !(0..frame_height).contains(&destination_y) {
            continue;
        }
        for x in 0..source_width {
            let destination_x = x
                .saturating_add(base_x)
                .saturating_add(options.x_offset_dots);
            if !(0..frame_width).contains(&destination_x) {
                continue;
            }
            positioned.put_pixel(
                destination_x as u32,
                destination_y as u32,
                *source.get_pixel(x as u32, y as u32),
            );
        }
    }
    encode_rgba_png(positioned.as_raw(), positioned.width(), positioned.height())
}

fn encode_rgba_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, PrintError> {
    let mut png = Vec::new();
    PngEncoder::new_with_quality(&mut png, CompressionType::Best, FilterType::NoFilter)
        .write_image(rgba, width, height, ExtendedColorType::Rgba8)?;
    Ok(png)
}
