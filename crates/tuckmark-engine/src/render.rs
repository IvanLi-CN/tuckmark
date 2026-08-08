use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Write as _,
    io::Cursor,
    sync::{Arc, OnceLock},
};

use code128::Code128;
use csv::ReaderBuilder;
use datamatrix::{DataMatrix, SymbolList};
use image::{
    ExtendedColorType, ImageEncoder,
    codecs::png::{CompressionType, FilterType, PngEncoder},
};
use qrcode::{Color, EcLevel, QrCode};
use resvg::usvg;
use serde_json::{Map, Number, Value};
use thiserror::Error;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tiny_skia::{Color as SkiaColor, Pixmap, Transform};
use tuckmark_contracts::{
    ContractError, DirectCanvasDefinition, PaperType, PreviewArtifact, PreviewSource,
    RenderOptions, ResolvedTextLayout, ResolvedTextLayoutGlyph, ResolvedTextLayoutLine,
    SafeTextLabelRequest, TemplateDefinition, TemplateElement,
};
use uuid::Uuid;

const CONTINUOUS_SAFETY_ROW_DENSITY_THRESHOLD: usize = 320;
const CONTINUOUS_SAFETY_TARGET_DARK_BITS: usize = 220;
const CONTINUOUS_SAFETY_MIN_RUN_LENGTH: usize = 64;
const CONTINUOUS_SAFETY_EDGE_PRESERVE_DOTS: usize = 12;

#[derive(Debug, Error)]
pub enum RenderError {
    #[error("render contract failed: {0}")]
    Contract(#[from] ContractError),
    #[error("SVG parsing failed: {0}")]
    Svg(#[from] usvg::Error),
    #[error("PNG encoding failed: {0}")]
    Png(#[from] image::ImageError),
    #[error("CSV input failed: {0}")]
    Csv(#[from] csv::Error),
    #[error("render input is invalid: {0}")]
    Validation(String),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MonoBitmap {
    pub width: u32,
    pub height: u32,
    /// Packed, MSB-first monochrome rows with no header.
    pub bytes: Vec<u8>,
}

impl MonoBitmap {
    pub fn bytes_per_row(&self) -> usize {
        self.width.div_ceil(8) as usize
    }

    pub fn validate(&self) -> Result<(), RenderError> {
        if self.width == 0 || self.height == 0 {
            return Err(RenderError::Validation(
                "monochrome bitmap dimensions must be positive".into(),
            ));
        }
        let expected = self.bytes_per_row() * self.height as usize;
        if self.bytes.len() != expected {
            return Err(RenderError::Validation(format!(
                "monochrome bitmap has {} bytes but needs {expected}",
                self.bytes.len()
            )));
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct RenderedArtifact {
    pub artifact: PreviewArtifact,
    pub png: Vec<u8>,
    /// Compatibility payload: `BITMAP:<width>x<height>\n` followed by the rendered PNG.
    pub bitmap: Vec<u8>,
    pub monochrome: MonoBitmap,
    pub svg: String,
}

#[derive(Debug)]
struct ArtifactBuild {
    source: PreviewSource,
    name: String,
    template_id: Option<String>,
    batch_index: Option<u64>,
    input: BTreeMap<String, String>,
    options: RenderOptions,
    width: u32,
    height: u32,
    svg: String,
}

struct BarcodeMarkup<'a> {
    key: &'a str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    value: String,
    rotation: f64,
}

#[derive(Clone, Debug, Default)]
pub struct RenderEngine;

impl RenderEngine {
    pub fn new() -> Self {
        Self
    }

    pub fn rasterize_svg(svg: &str, options: &RenderOptions) -> Result<MonoBitmap, RenderError> {
        options.validate()?;
        let tree = parse_svg(svg)?;
        let size = tree.size().to_int_size();
        let (_, monochrome) = rasterize_tree(&tree, size.width(), size.height(), options)?;
        Ok(monochrome)
    }

    pub fn render_template(
        &self,
        template: &TemplateDefinition,
        input: &BTreeMap<String, String>,
        options: &RenderOptions,
    ) -> Result<RenderedArtifact, RenderError> {
        template.validate()?;
        options.validate()?;
        let input = normalize_template_input(template, input)?;
        let (width, height) = rounded_dimensions(template.width, template.height)?;
        let svg = build_svg(width, height, &template.elements, &input)?;
        self.finish_artifact(ArtifactBuild {
            source: PreviewSource::Template,
            name: template.name.clone(),
            template_id: Some(template.id.clone()),
            batch_index: None,
            input,
            options: options.clone(),
            width,
            height,
            svg,
        })
    }

    pub fn render_canvas(
        &self,
        canvas: &DirectCanvasDefinition,
        options: &RenderOptions,
    ) -> Result<RenderedArtifact, RenderError> {
        canvas.validate()?;
        options.validate()?;
        let (width, height) = rounded_dimensions(canvas.width, canvas.height)?;
        let svg = build_svg(width, height, &canvas.elements, &BTreeMap::new())?;
        self.finish_artifact(ArtifactBuild {
            source: PreviewSource::Canvas,
            name: canvas.name.clone(),
            template_id: None,
            batch_index: None,
            input: BTreeMap::new(),
            options: options.clone(),
            width,
            height,
            svg,
        })
    }

    pub fn render_canvas_draft(
        &self,
        draft: &Value,
        input: &BTreeMap<String, String>,
        options: &RenderOptions,
    ) -> Result<RenderedArtifact, RenderError> {
        let canvas = compile_canvas_draft(draft, input, options.printer_dpi)?;
        self.render_canvas(&canvas, options)
    }

    pub fn render_safe_text(
        &self,
        request: &SafeTextLabelRequest,
    ) -> Result<RenderedArtifact, RenderError> {
        request.validate()?;
        let mut options = request.render_options.clone();
        options.paper_type = PaperType::Continuous;
        options.validate()?;
        let text = request.text.trim_end();
        let text = if text.is_empty() { "Tuckmark" } else { text };
        let width = options.print_width_dots;
        let line_height = 34.0;
        let horizontal_padding = 16.0;
        let vertical_padding = 16.0;
        let max_width = (width as f64 - horizontal_padding * 2.0).max(1.0);
        let lines = wrap_text_by_width(text, 24.0, max_width, Some(4), true);
        let height = (vertical_padding * 2.0 + lines.len() as f64 * line_height)
            .max(64.0)
            .round() as u32;
        let elements = lines
            .into_iter()
            .enumerate()
            .map(|(index, line)| TemplateElement::Text {
                key: format!("line-{}", index + 1),
                x: horizontal_padding,
                y: vertical_padding + 24.0 + index as f64 * line_height,
                width: Some(max_width),
                height: None,
                font_size: 24.0,
                font_family: None,
                line_height: None,
                font_weight: "normal".into(),
                align: "left".into(),
                justify_align: None,
                vertical_align: None,
                stretch_x_grow: None,
                stretch_x_shrink: None,
                stretch_y_grow: None,
                stretch_y_shrink: None,
                stretch_x: None,
                stretch_y: None,
                auto_wrap: Some(true),
                adaptive_font_size: None,
                vertical_text: None,
                value: Some(line),
                max_lines: Some(1),
                rotation: 0.0,
                resolved_layout: None,
                extra: Default::default(),
            })
            .collect::<Vec<_>>();
        let svg = build_svg(width, height, &elements, &BTreeMap::new())?;
        self.finish_artifact(ArtifactBuild {
            source: PreviewSource::SafeText,
            name: request.title.clone(),
            template_id: Some("safe-text-label".into()),
            batch_index: None,
            input: BTreeMap::from([("text".into(), text.into())]),
            options,
            width,
            height,
            svg,
        })
    }

    pub fn render_csv_batch(
        &self,
        template: &TemplateDefinition,
        csv_text: &str,
        options: &RenderOptions,
    ) -> Result<Vec<RenderedArtifact>, RenderError> {
        template.validate()?;
        options.validate()?;
        let mut reader = ReaderBuilder::new()
            .has_headers(true)
            .flexible(false)
            .trim(csv::Trim::All)
            .from_reader(Cursor::new(csv_text.as_bytes()));
        let headers = reader.headers()?.clone();
        if headers.is_empty() {
            return Err(RenderError::Validation("CSV requires a header row".into()));
        }
        let mut known_headers = BTreeSet::new();
        for header in &headers {
            if header.trim().is_empty() || !known_headers.insert(header) {
                return Err(RenderError::Validation(
                    "CSV header names must be non-empty and unique".into(),
                ));
            }
        }

        reader
            .records()
            .filter_map(|record| match record {
                Ok(record) if record.iter().all(|value| value.trim().is_empty()) => None,
                other => Some(other),
            })
            .enumerate()
            .map(|(index, record)| {
                let record = record?;
                let input = headers
                    .iter()
                    .zip(record.iter())
                    .map(|(header, value)| (header.into(), value.into()))
                    .collect::<BTreeMap<_, _>>();
                let mut rendered = self.render_template(template, &input, options)?;
                rendered.artifact.source = PreviewSource::BatchRow;
                rendered.artifact.batch_index = Some(index as u64);
                Ok(rendered)
            })
            .collect()
    }

    fn finish_artifact(&self, build: ArtifactBuild) -> Result<RenderedArtifact, RenderError> {
        let ArtifactBuild {
            source,
            name,
            template_id,
            batch_index,
            input,
            options,
            width,
            height,
            svg,
        } = build;
        let tree = parse_svg(&svg)?;
        let (png, monochrome) = rasterize_tree(&tree, width, height, &options)?;
        let mut bitmap = format!("BITMAP:{width}x{height}\n").into_bytes();
        bitmap.extend_from_slice(&png);
        let artifact = PreviewArtifact {
            id: Uuid::new_v4().to_string(),
            source,
            name,
            template_id,
            batch_index,
            created_at: now_rfc3339(),
            render_options: options,
            input,
            png_path: String::new(),
            bitmap_path: String::new(),
            svg_path: String::new(),
            width,
            height,
            extra: Default::default(),
        };
        artifact.validate()?;
        Ok(RenderedArtifact {
            artifact,
            png,
            bitmap,
            monochrome,
            svg,
        })
    }
}

fn normalize_template_input(
    template: &TemplateDefinition,
    input: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, RenderError> {
    let mut resolved = BTreeMap::new();
    for field in &template.fields {
        let value = input
            .get(&field.key)
            .cloned()
            .or_else(|| field.default_value.clone())
            .unwrap_or_default();
        if field.required && value.trim().is_empty() {
            return Err(RenderError::Validation(format!(
                "missing required field: {}",
                field.key
            )));
        }
        resolved.insert(field.key.clone(), value);
    }
    for (key, value) in input {
        resolved.entry(key.clone()).or_insert_with(|| value.clone());
    }
    Ok(resolved)
}

fn parse_svg(svg: &str) -> Result<usvg::Tree, RenderError> {
    let options = svg_options();
    Ok(usvg::Tree::from_data(svg.as_bytes(), &options)?)
}

fn svg_options() -> usvg::Options<'static> {
    static FONT_DATABASE: OnceLock<Arc<usvg::fontdb::Database>> = OnceLock::new();
    let fontdb = FONT_DATABASE
        .get_or_init(|| {
            let mut database = usvg::fontdb::Database::new();
            database.load_system_fonts();
            Arc::new(database)
        })
        .clone();
    usvg::Options {
        fontdb,
        ..usvg::Options::default()
    }
}

/// Compile a persisted canvas draft into the renderer's dot-coordinate canvas.
/// Drafts without `unit: "mm"` already use renderer coordinates for legacy compatibility.
pub fn compile_canvas_draft(
    draft: &Value,
    input: &BTreeMap<String, String>,
    printer_dpi: u32,
) -> Result<DirectCanvasDefinition, RenderError> {
    if printer_dpi == 0 {
        return Err(RenderError::Validation(
            "printer DPI must be positive".into(),
        ));
    }
    let object = draft
        .as_object()
        .ok_or_else(|| RenderError::Validation("canvas draft must be an object".into()))?;
    let uses_millimeters = object.get("unit").and_then(Value::as_str) == Some("mm");
    let scale = if uses_millimeters {
        printer_dpi as f64 / 25.4
    } else {
        1.0
    };
    let resolved_fields = draft_fields(object, input);
    let elements = object
        .get("elements")
        .and_then(Value::as_array)
        .ok_or_else(|| RenderError::Validation("canvas draft elements are required".into()))?
        .iter()
        .filter_map(|element| {
            let object = element.as_object()?;
            if object
                .get("meta")
                .and_then(Value::as_object)
                .and_then(|meta| meta.get("visible"))
                .and_then(Value::as_bool)
                == Some(false)
            {
                return None;
            }
            Some(compile_canvas_element(
                object,
                &resolved_fields,
                scale,
                uses_millimeters,
            ))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let canvas = DirectCanvasDefinition {
        id: object
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("canvas")
            .into(),
        name: object
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Canvas")
            .into(),
        width: to_canvas_coordinate(
            required_draft_number(object, "width")?,
            scale,
            uses_millimeters,
        )?,
        height: to_canvas_coordinate(
            required_draft_number(object, "height")?,
            scale,
            uses_millimeters,
        )?,
        elements,
        extra: object
            .iter()
            .filter(|(key, _)| {
                !matches!(
                    key.as_str(),
                    "id" | "name" | "unit" | "width" | "height" | "fields" | "elements"
                )
            })
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
    };
    canvas.validate()?;
    Ok(canvas)
}

fn draft_fields(
    draft: &Map<String, Value>,
    input: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    draft
        .get("fields")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .filter_map(|field| {
            let key = field.get("key")?.as_str()?;
            let value = input.get(key).cloned().or_else(|| {
                field
                    .get("defaultValue")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })?;
            Some((key.into(), value))
        })
        .collect()
}

fn compile_canvas_element(
    source: &Map<String, Value>,
    fields: &BTreeMap<String, String>,
    scale: f64,
    uses_millimeters: bool,
) -> Result<TemplateElement, RenderError> {
    let kind = source
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| RenderError::Validation("canvas element kind is required".into()))?;
    let mut element = source.clone();
    if kind == "line" {
        for (draft_field, renderer_field) in [("x", "x1"), ("y", "y1")] {
            if let Some(value) = element.remove(draft_field) {
                element.insert(renderer_field.into(), value);
            }
        }
    }
    let binding_key = source
        .get("binding")
        .and_then(Value::as_object)
        .and_then(|binding| binding.get("fieldKey"))
        .and_then(Value::as_str);
    let key = binding_key
        .or_else(|| source.get("key").and_then(Value::as_str))
        .or_else(|| source.get("id").and_then(Value::as_str))
        .unwrap_or(kind);
    element.insert("key".into(), Value::String(key.into()));
    if matches!(kind, "text" | "barcode" | "qr" | "datamatrix") {
        let resolved = binding_key
            .and_then(|binding| fields.get(binding).cloned())
            .or_else(|| {
                source
                    .get("value")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .unwrap_or_default();
        element.insert("value".into(), Value::String(resolved));
    }
    for &field in geometry_fields(kind) {
        if let Some(value) = element.get_mut(field) {
            let number = value.as_f64().ok_or_else(|| {
                RenderError::Validation(format!("canvas {kind} {field} must be a number"))
            })?;
            let scaled = to_canvas_coordinate(number, scale, uses_millimeters)?;
            let number = Number::from_f64(scaled).ok_or_else(|| {
                RenderError::Validation(format!("canvas {kind} {field} must be finite"))
            })?;
            *value = Value::Number(number);
        }
    }
    serde_json::from_value::<TemplateElement>(Value::Object(element)).map_err(|error| {
        RenderError::Validation(format!("canvas {kind} element is invalid: {error}"))
    })
}

fn to_canvas_coordinate(
    value: f64,
    scale: f64,
    uses_millimeters: bool,
) -> Result<f64, RenderError> {
    let value = if uses_millimeters {
        // JavaScript's Math.round rounds ties toward positive infinity.
        (value * scale + 0.5).floor()
    } else {
        value
    };
    value
        .is_finite()
        .then_some(value)
        .ok_or_else(|| RenderError::Validation("canvas coordinate must be finite".into()))
}

fn geometry_fields(kind: &str) -> &'static [&'static str] {
    match kind {
        "text" => &["x", "y", "width", "height", "fontSize"],
        "rect" | "triangle" => &["x", "y", "width", "height", "strokeWidth", "radius"],
        "circle" | "qr" | "datamatrix" => &["x", "y", "size", "strokeWidth"],
        "line" => &["x1", "y1", "x2", "y2", "strokeWidth"],
        "barcode" => &["x", "y", "width", "height"],
        _ => &[],
    }
}

fn required_draft_number(object: &Map<String, Value>, field: &str) -> Result<f64, RenderError> {
    object
        .get(field)
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
        .ok_or_else(|| RenderError::Validation(format!("canvas draft {field} must be positive")))
}

fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())
}

fn rounded_dimensions(width: f64, height: f64) -> Result<(u32, u32), RenderError> {
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err(RenderError::Validation(
            "render dimensions must be positive finite values".into(),
        ));
    }
    let width = width.round();
    let height = height.round();
    if width > u32::MAX as f64 || height > u32::MAX as f64 {
        return Err(RenderError::Validation(
            "render dimensions are too large".into(),
        ));
    }
    Ok((width as u32, height as u32))
}

fn rasterize_tree(
    tree: &usvg::Tree,
    width: u32,
    height: u32,
    options: &RenderOptions,
) -> Result<(Vec<u8>, MonoBitmap), RenderError> {
    let mut pixmap = Pixmap::new(width, height)
        .ok_or_else(|| RenderError::Validation("invalid raster dimensions".into()))?;
    pixmap.fill(SkiaColor::WHITE);
    resvg::render(tree, Transform::default(), &mut pixmap.as_mut());
    let mut rgba = pixmap.data().to_vec();
    normalize_continuous_paper(&mut rgba, width, height, options);
    let monochrome = monochrome_from_rgba(&rgba, width, height, options.threshold)?;
    let mut png = Vec::new();
    PngEncoder::new_with_quality(&mut png, CompressionType::Best, FilterType::NoFilter)
        .write_image(&rgba, width, height, ExtendedColorType::Rgba8)?;
    Ok((png, monochrome))
}

fn monochrome_from_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
    threshold: u8,
) -> Result<MonoBitmap, RenderError> {
    let expected = width as usize * height as usize * 4;
    if rgba.len() != expected {
        return Err(RenderError::Validation(format!(
            "RGBA input has {} bytes but needs {expected}",
            rgba.len()
        )));
    }
    let bytes_per_row = width.div_ceil(8) as usize;
    let mut bytes = vec![0; bytes_per_row * height as usize];
    for y in 0..height as usize {
        for x in 0..width as usize {
            if pixel_is_black(rgba, width as usize, x, y, threshold) {
                bytes[y * bytes_per_row + x / 8] |= 0x80 >> (x % 8);
            }
        }
    }
    let bitmap = MonoBitmap {
        width,
        height,
        bytes,
    };
    bitmap.validate()?;
    Ok(bitmap)
}

fn pixel_is_black(rgba: &[u8], width: usize, x: usize, y: usize, threshold: u8) -> bool {
    let index = (y * width + x) * 4;
    let red = rgba[index] as u32;
    let green = rgba[index + 1] as u32;
    let blue = rgba[index + 2] as u32;
    let alpha = rgba[index + 3] as u32;
    let luminance = (red * 77 + green * 150 + blue * 29) >> 8;
    let composited = (luminance * alpha + 255 * (255 - alpha)) / 255;
    composited < threshold as u32
}

fn normalize_continuous_paper(rgba: &mut [u8], width: u32, height: u32, options: &RenderOptions) {
    if options.paper_type != PaperType::Continuous {
        return;
    }
    let width = width as usize;
    for y in 0..height as usize {
        let mut row = (0..width)
            .map(|x| pixel_is_black(rgba, width, x, y, options.threshold))
            .collect::<Vec<_>>();
        let mut dark_bits = row.iter().filter(|bit| **bit).count();
        if dark_bits <= CONTINUOUS_SAFETY_ROW_DENSITY_THRESHOLD {
            continue;
        }
        let mut protected = vec![false; width];
        let mut run_start = None;
        for x in 0..=width {
            let black = x < width && row[x];
            if black && run_start.is_none() {
                run_start = Some(x);
                continue;
            }
            let Some(start) = run_start else {
                continue;
            };
            if black {
                continue;
            }
            let end = x.saturating_sub(1);
            let length = end.saturating_sub(start) + 1;
            if length >= CONTINUOUS_SAFETY_MIN_RUN_LENGTH {
                for edge in 0..CONTINUOUS_SAFETY_EDGE_PRESERVE_DOTS {
                    if start + edge <= end {
                        protected[start + edge] = true;
                        protected[end - edge] = true;
                    }
                }
                let interior_start = start + CONTINUOUS_SAFETY_EDGE_PRESERVE_DOTS;
                let interior_end = end.saturating_sub(CONTINUOUS_SAFETY_EDGE_PRESERVE_DOTS);
                for (px, black) in row
                    .iter_mut()
                    .enumerate()
                    .take(interior_end.saturating_add(1))
                    .skip(interior_start)
                {
                    if *black && !(px - interior_start).is_multiple_of(2) {
                        *black = false;
                        dark_bits -= 1;
                    }
                }
            }
            run_start = None;
        }
        if dark_bits > CONTINUOUS_SAFETY_TARGET_DARK_BITS {
            for x in 0..width {
                if dark_bits <= CONTINUOUS_SAFETY_TARGET_DARK_BITS {
                    break;
                }
                if row[x] && !protected[x] && (x + y) % 2 != 0 {
                    row[x] = false;
                    dark_bits -= 1;
                }
            }
        }
        for (x, black) in row.into_iter().enumerate() {
            let index = (y * width + x) * 4;
            let value = if black { 0 } else { 255 };
            rgba[index] = value;
            rgba[index + 1] = value;
            rgba[index + 2] = value;
            rgba[index + 3] = 255;
        }
    }
}

fn build_svg(
    width: u32,
    height: u32,
    elements: &[TemplateElement],
    input: &BTreeMap<String, String>,
) -> Result<String, RenderError> {
    let mut output = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\" viewBox=\"0 0 {width} {height}\"><rect width=\"{width}\" height=\"{height}\" fill=\"white\"/>"
    );
    for element in elements {
        output.push_str(&render_element(element, input)?);
    }
    output.push_str("</svg>");
    Ok(output)
}

fn render_element(
    element: &TemplateElement,
    input: &BTreeMap<String, String>,
) -> Result<String, RenderError> {
    match element {
        TemplateElement::Text {
            key,
            x,
            y,
            width,
            height,
            font_size,
            font_family,
            line_height,
            font_weight,
            align,
            justify_align,
            vertical_align,
            stretch_x_grow,
            stretch_x_shrink,
            stretch_y_grow,
            stretch_y_shrink,
            stretch_x,
            stretch_y,
            value,
            max_lines,
            rotation,
            auto_wrap,
            adaptive_font_size,
            vertical_text,
            resolved_layout,
            ..
        } => render_text(
            key,
            *x,
            *y,
            *width,
            *height,
            *font_size,
            font_family.as_deref(),
            *line_height,
            font_weight,
            align,
            justify_align.as_deref(),
            vertical_align.as_deref(),
            *stretch_x_grow,
            *stretch_x_shrink,
            *stretch_y_grow,
            *stretch_y_shrink,
            *stretch_x,
            *stretch_y,
            value.as_deref(),
            *max_lines,
            *rotation,
            auto_wrap.unwrap_or(true),
            adaptive_font_size.unwrap_or(false),
            vertical_text.unwrap_or(false),
            resolved_layout.as_deref(),
            input,
        ),
        TemplateElement::Rect {
            x,
            y,
            width,
            height,
            stroke_width,
            fill,
            stroke,
            radius,
            rotation,
            ..
        } => Ok(with_rotation(
            format!(
                "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" rx=\"{}\" ry=\"{}\" fill=\"{}\" stroke=\"{}\" stroke-width=\"{}\"/>",
                number(*x),
                number(*y),
                number(*width),
                number(*height),
                number(*radius),
                number(*radius),
                escape_xml(fill),
                escape_xml(stroke),
                number(*stroke_width)
            ),
            *rotation,
            *x + *width / 2.0,
            *y + *height / 2.0,
        )),
        TemplateElement::Circle {
            x,
            y,
            size,
            stroke_width,
            fill,
            stroke,
            ..
        } => Ok(format!(
            "<circle cx=\"{}\" cy=\"{}\" r=\"{}\" fill=\"{}\" stroke=\"{}\" stroke-width=\"{}\"/>",
            number(*x + *size / 2.0),
            number(*y + *size / 2.0),
            number(*size / 2.0),
            escape_xml(fill),
            escape_xml(stroke),
            number(*stroke_width)
        )),
        TemplateElement::Triangle {
            x,
            y,
            width,
            height,
            stroke_width,
            fill,
            stroke,
            rotation,
            ..
        } => Ok(with_rotation(
            format!(
                "<polygon points=\"{},{} {},{} {},{}\" fill=\"{}\" stroke=\"{}\" stroke-width=\"{}\"/>",
                number(*x + *width / 2.0),
                number(*y),
                number(*x),
                number(*y + *height),
                number(*x + *width),
                number(*y + *height),
                escape_xml(fill),
                escape_xml(stroke),
                number(*stroke_width)
            ),
            *rotation,
            *x + *width / 2.0,
            *y + *height / 2.0,
        )),
        TemplateElement::Line {
            x1,
            y1,
            x2,
            y2,
            stroke_width,
            stroke,
            ..
        } => Ok(format!(
            "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"{}\" stroke-width=\"{}\"/>",
            number(*x1),
            number(*y1),
            number(*x2),
            number(*y2),
            escape_xml(stroke),
            number(*stroke_width)
        )),
        TemplateElement::Barcode {
            key,
            x,
            y,
            width,
            height,
            value,
            rotation,
            ..
        } => render_barcode(BarcodeMarkup {
            key,
            x: *x,
            y: *y,
            width: *width,
            height: *height,
            value: resolve_machine_value(key, value.as_deref(), input)?,
            rotation: *rotation,
        }),
        TemplateElement::Qr {
            key,
            x,
            y,
            size,
            value,
            error_correction_level,
            rotation,
            ..
        } => render_qr(
            key,
            *x,
            *y,
            *size,
            resolve_machine_value(key, value.as_deref(), input)?,
            error_correction_level,
            *rotation,
        ),
        TemplateElement::DataMatrix {
            key,
            x,
            y,
            size,
            value,
            rotation,
            ..
        } => render_data_matrix(
            key,
            *x,
            *y,
            *size,
            resolve_data_matrix_value(key, value.as_deref(), input)?,
            *rotation,
        ),
    }
}

#[allow(clippy::too_many_arguments)]
fn render_text(
    key: &str,
    x: f64,
    y: f64,
    width: Option<f64>,
    height: Option<f64>,
    font_size: f64,
    font_family: Option<&str>,
    line_height: Option<f64>,
    font_weight: &str,
    align: &str,
    justify_align: Option<&str>,
    vertical_align: Option<&str>,
    stretch_x_grow: Option<bool>,
    stretch_x_shrink: Option<bool>,
    stretch_y_grow: Option<bool>,
    stretch_y_shrink: Option<bool>,
    stretch_x: Option<bool>,
    stretch_y: Option<bool>,
    value: Option<&str>,
    max_lines: Option<u32>,
    rotation: f64,
    auto_wrap: bool,
    adaptive_font_size: bool,
    vertical_text: bool,
    resolved_layout: Option<&ResolvedTextLayout>,
    input: &BTreeMap<String, String>,
) -> Result<String, RenderError> {
    let value = resolve_text_value(key, value, input);
    let legacy_lines =
        wrap_text_by_width_with_font(&value, font_size, width, max_lines, auto_wrap, font_family);
    let has_explicit_width = width.is_some();
    let container_width = width.unwrap_or_else(|| {
        legacy_lines
            .iter()
            .map(|line| estimate_text_width_with_font(line, font_size, font_family))
            .fold(0.0001_f64, f64::max)
    });
    let legacy_line_count = if has_explicit_width {
        wrap_text_by_width_with_font(
            &value,
            font_size,
            Some(container_width),
            max_lines,
            auto_wrap,
            font_family,
        )
        .len()
    } else {
        legacy_lines.len()
    }
    .max(1);
    let has_explicit_height = height.is_some();
    let container_height = height.unwrap_or_else(|| {
        text_natural_height(
            font_size,
            legacy_line_count,
            normalize_text_line_height(line_height),
        )
    });
    let request = TextLayoutRequest {
        text: &value,
        font_size,
        font_family,
        width: container_width,
        height: container_height,
        line_height,
        align,
        vertical_align,
        stretch_x_grow,
        stretch_x_shrink,
        stretch_y_grow,
        stretch_y_shrink,
        stretch_x,
        stretch_y,
        auto_wrap,
        adaptive_font_size,
        vertical_text,
        max_lines,
    };
    let layout = resolved_layout
        .cloned()
        .unwrap_or_else(|| resolve_text_layout(&request));
    let container_x = if has_explicit_width {
        x
    } else {
        match align {
            "center" => x - container_width / 2.0,
            "right" => x - container_width,
            _ => x,
        }
    };
    let container_y = if !has_explicit_height && !layout.vertical_text {
        y - layout.baseline_offset_y
    } else if !has_explicit_height {
        y - layout.resolved_font_size
    } else {
        y
    };
    let mut transform = format!(
        "translate({} {})",
        number(layout.content_x),
        number(layout.content_y)
    );
    if layout.scale_x != 1.0 || layout.scale_y != 1.0 {
        let _ = write!(
            transform,
            " scale({} {})",
            number(layout.scale_x),
            number(layout.scale_y)
        );
    }
    let family = text_font_stack(font_family);
    let _ = justify_align;
    let mut markup = String::new();
    if layout.vertical_text {
        for glyph in &layout.glyphs {
            let _ = write!(
                markup,
                "<text x=\"{}\" y=\"{}\" font-size=\"{}\" font-weight=\"{}\" text-anchor=\"middle\" font-family=\"{}\" fill=\"#111111\">{}</text>",
                number(glyph.x),
                number(glyph.y + layout.baseline_offset_y),
                number(layout.resolved_font_size),
                escape_xml(font_weight),
                escape_xml(family),
                escape_xml(&glyph.text)
            );
        }
    } else {
        for line in &layout.line_layouts {
            let visual_width = line.visual_width.unwrap_or(line.width);
            let width_lock = resolved_layout.is_some() && visual_width > 0.0;
            let adjust = if line.letter_spacing > 0.0 {
                format!(
                    " textLength=\"{}\" lengthAdjust=\"spacing\"",
                    number(container_width)
                )
            } else if width_lock {
                format!(
                    " textLength=\"{}\" lengthAdjust=\"spacingAndGlyphs\"",
                    number(visual_width)
                )
            } else {
                String::new()
            };
            let _ = write!(
                markup,
                "<text x=\"{}\" y=\"{}\" font-size=\"{}\" font-weight=\"{}\" text-anchor=\"start\" font-family=\"{}\" fill=\"#111111\"{}>{}</text>",
                number(line.x),
                number(line.y),
                number(layout.resolved_font_size),
                escape_xml(font_weight),
                escape_xml(family),
                adjust,
                escape_xml(&line.text)
            );
        }
    }
    let markup = format!(
        "<svg x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" overflow=\"hidden\"><g transform=\"{}\">{markup}</g></svg>",
        number(container_x),
        number(container_y),
        number(container_width),
        number(container_height),
        transform,
    );
    Ok(with_rotation(
        markup,
        rotation,
        container_x + container_width / 2.0,
        container_y + container_height / 2.0,
    ))
}

fn render_barcode(markup: BarcodeMarkup<'_>) -> Result<String, RenderError> {
    let BarcodeMarkup {
        key,
        x,
        y,
        width,
        height,
        value,
        rotation,
    } = markup;
    let code = Code128::encode_str(&value).ok_or_else(|| {
        RenderError::Validation(format!(
            "CODE128 value for key {key} cannot be encoded as Latin-1"
        ))
    })?;
    let mut bars = String::new();
    for bar in code.bar_coordinates() {
        let _ = write!(
            bars,
            "<rect x=\"{}\" y=\"0\" width=\"{}\" height=\"{}\" fill=\"#111111\"/>",
            bar.x,
            bar.width,
            number(height.max(8.0).round())
        );
    }
    let view_height = height.max(8.0).round();
    Ok(with_rotation(
        format!(
            "<svg x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {} {}\" preserveAspectRatio=\"none\"><rect width=\"{}\" height=\"{}\" fill=\"#ffffff\"/>{bars}</svg>",
            number(x),
            number(y),
            number(width),
            number(height),
            code.len(),
            number(view_height),
            code.len(),
            number(view_height)
        ),
        rotation,
        x + width / 2.0,
        y + height / 2.0,
    ))
}

fn render_qr(
    key: &str,
    x: f64,
    y: f64,
    size: f64,
    value: String,
    level: &str,
    rotation: f64,
) -> Result<String, RenderError> {
    let level = match level {
        "L" => EcLevel::L,
        "M" => EcLevel::M,
        "Q" => EcLevel::Q,
        "H" => EcLevel::H,
        _ => {
            return Err(RenderError::Validation(format!(
                "invalid QR error correction level for key {key}"
            )));
        }
    };
    let code = QrCode::with_error_correction_level(value.as_bytes(), level)
        .map_err(|error| RenderError::Validation(format!("failed to encode QR {key}: {error}")))?;
    let modules = code.to_colors();
    let module_count = code.width();
    let mut rects = String::new();
    for row in 0..module_count {
        for column in 0..module_count {
            if modules[row * module_count + column] != Color::Dark {
                continue;
            }
            let _ = write!(
                rects,
                "<rect x=\"{}\" y=\"{}\" width=\"1\" height=\"1\" fill=\"#111111\"/>",
                column, row
            );
        }
    }
    Ok(with_rotation(
        format!(
            "<svg x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {module_count} {module_count}\" preserveAspectRatio=\"none\"><rect width=\"{module_count}\" height=\"{module_count}\" fill=\"#ffffff\"/>{rects}</svg>",
            number(x),
            number(y),
            number(size),
            number(size)
        ),
        rotation,
        x + size / 2.0,
        y + size / 2.0,
    ))
}

fn render_data_matrix(
    key: &str,
    x: f64,
    y: f64,
    size: f64,
    value: String,
    rotation: f64,
) -> Result<String, RenderError> {
    let bitmap = DataMatrix::encode_str(&value, SymbolList::default().enforce_square())
        .map_err(|error| {
            RenderError::Validation(format!("failed to encode Data Matrix {key}: {error:?}"))
        })?
        .bitmap();
    let (width, height) = (bitmap.width(), bitmap.height());
    if width != height {
        return Err(RenderError::Validation(format!(
            "Data Matrix {key} is not square"
        )));
    }
    let mut rects = String::new();
    for (column, row) in bitmap.pixels() {
        let _ = write!(
            rects,
            "<rect x=\"{column}\" y=\"{row}\" width=\"1\" height=\"1\" fill=\"#111111\"/>"
        );
    }
    Ok(with_rotation(
        format!(
            "<svg x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {width} {height}\" preserveAspectRatio=\"none\"><rect width=\"{width}\" height=\"{height}\" fill=\"#ffffff\"/>{rects}</svg>",
            number(x),
            number(y),
            number(size),
            number(size)
        ),
        rotation,
        x + size / 2.0,
        y + size / 2.0,
    ))
}

fn resolve_text_value(
    key: &str,
    explicit_value: Option<&str>,
    input: &BTreeMap<String, String>,
) -> String {
    explicit_value
        .map(str::to_owned)
        .or_else(|| input.get(key).cloned())
        .unwrap_or_default()
}

fn resolve_machine_value(
    key: &str,
    explicit_value: Option<&str>,
    input: &BTreeMap<String, String>,
) -> Result<String, RenderError> {
    let value = resolve_text_value(key, explicit_value, input);
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(RenderError::Validation(format!(
            "render value is required for key {key}"
        )));
    }
    Ok(trimmed.into())
}

fn resolve_data_matrix_value(
    key: &str,
    explicit_value: Option<&str>,
    input: &BTreeMap<String, String>,
) -> Result<String, RenderError> {
    let value = resolve_text_value(key, explicit_value, input);
    if value.trim().is_empty() {
        return Err(RenderError::Validation(format!(
            "render value is required for key {key}"
        )));
    }
    Ok(value)
}

#[derive(Clone, Copy)]
struct TextMetricProfile {
    space: f64,
    cjk: f64,
    uppercase: f64,
    lowercase: f64,
    digit: f64,
    punctuation: f64,
    symbol: f64,
    fallback: f64,
}

const CJK_SANS_METRICS: TextMetricProfile = TextMetricProfile {
    space: 0.32,
    cjk: 1.0,
    uppercase: 0.73,
    lowercase: 0.57,
    digit: 0.56,
    punctuation: 0.36,
    symbol: 0.8,
    fallback: 0.8,
};
const CJK_SERIF_METRICS: TextMetricProfile = TextMetricProfile {
    space: 0.3,
    cjk: 1.0,
    uppercase: 0.76,
    lowercase: 0.55,
    digit: 0.54,
    punctuation: 0.31,
    symbol: 0.74,
    fallback: 0.74,
};
const SANS_METRICS: TextMetricProfile = TextMetricProfile {
    space: 0.31,
    cjk: 1.0,
    uppercase: 0.7,
    lowercase: 0.55,
    digit: 0.56,
    punctuation: 0.32,
    symbol: 0.75,
    fallback: 0.74,
};
const CONDENSED_SANS_METRICS: TextMetricProfile = TextMetricProfile {
    space: 0.28,
    cjk: 1.0,
    uppercase: 0.62,
    lowercase: 0.5,
    digit: 0.51,
    punctuation: 0.28,
    symbol: 0.64,
    fallback: 0.64,
};
const GEOMETRIC_SANS_METRICS: TextMetricProfile = TextMetricProfile {
    space: 0.3,
    cjk: 1.0,
    uppercase: 0.72,
    lowercase: 0.56,
    digit: 0.58,
    punctuation: 0.33,
    symbol: 0.78,
    fallback: 0.76,
};
const SERIF_METRICS: TextMetricProfile = TextMetricProfile {
    space: 0.32,
    cjk: 1.0,
    uppercase: 0.75,
    lowercase: 0.55,
    digit: 0.53,
    punctuation: 0.32,
    symbol: 0.74,
    fallback: 0.74,
};
const MONO_METRICS: TextMetricProfile = TextMetricProfile {
    space: 0.6,
    cjk: 1.0,
    uppercase: 0.6,
    lowercase: 0.6,
    digit: 0.6,
    punctuation: 0.6,
    symbol: 0.6,
    fallback: 0.6,
};

#[derive(Clone, Copy)]
struct TextLayoutRequest<'a> {
    text: &'a str,
    font_size: f64,
    font_family: Option<&'a str>,
    width: f64,
    height: f64,
    line_height: Option<f64>,
    align: &'a str,
    vertical_align: Option<&'a str>,
    stretch_x_grow: Option<bool>,
    stretch_x_shrink: Option<bool>,
    stretch_y_grow: Option<bool>,
    stretch_y_shrink: Option<bool>,
    stretch_x: Option<bool>,
    stretch_y: Option<bool>,
    auto_wrap: bool,
    adaptive_font_size: bool,
    vertical_text: bool,
    max_lines: Option<u32>,
}

#[derive(Clone, Copy)]
struct TextAxisFit {
    stretch_x_grow: bool,
    stretch_x_shrink: bool,
    stretch_y_grow: bool,
    stretch_y_shrink: bool,
}

struct ComputedTextLayout {
    layout: ResolvedTextLayout,
    natural_height: f64,
}

fn resolve_text_layout(request: &TextLayoutRequest<'_>) -> ResolvedTextLayout {
    let axis_fit = resolve_text_axis_fit(request);
    let effective_auto_wrap = if request.adaptive_font_size {
        false
    } else {
        request.auto_wrap
    };
    let resolved_font_size = if request.adaptive_font_size {
        resolve_adaptive_font_size(request, axis_fit, effective_auto_wrap)
    } else {
        round_resolved_font_size(request.font_size)
    };
    resolve_text_layout_for_font_size(request, resolved_font_size, axis_fit, effective_auto_wrap)
        .layout
}

fn resolve_adaptive_font_size(
    request: &TextLayoutRequest<'_>,
    axis_fit: TextAxisFit,
    effective_auto_wrap: bool,
) -> f64 {
    let base = round_resolved_font_size(request.font_size);
    let initial = resolve_text_layout_for_font_size(request, base, axis_fit, effective_auto_wrap);
    if !initial.natural_height.is_finite() || initial.natural_height <= 0.0 {
        return base;
    }
    let primary =
        round_resolved_font_size((base * request.height / initial.natural_height).max(0.1));
    let corrected =
        resolve_text_layout_for_font_size(request, primary, axis_fit, effective_auto_wrap);
    if !corrected.natural_height.is_finite() || corrected.natural_height <= 0.0 {
        return primary;
    }
    round_resolved_font_size((primary * request.height / corrected.natural_height).max(0.1))
}

fn resolve_text_layout_for_font_size(
    request: &TextLayoutRequest<'_>,
    font_size: f64,
    axis_fit: TextAxisFit,
    effective_auto_wrap: bool,
) -> ComputedTextLayout {
    let line_height_ratio = normalize_text_line_height(request.line_height);
    let lines = if request.vertical_text {
        vertical_text_columns(
            request.text,
            font_size,
            request.height,
            line_height_ratio,
            request.max_lines,
            effective_auto_wrap,
        )
    } else {
        wrap_text_by_width_with_font(
            request.text,
            font_size,
            Some(request.width),
            request.max_lines,
            effective_auto_wrap,
            request.font_family,
        )
    };
    let lines = if lines.is_empty() {
        vec![String::new()]
    } else {
        lines
    };
    let line_height = font_size * line_height_ratio;
    let line_widths = lines
        .iter()
        .map(|line| estimate_text_width_with_font(line, font_size, request.font_family))
        .collect::<Vec<_>>();
    let natural_width = if request.vertical_text {
        text_natural_height(font_size, lines.len(), line_height_ratio)
    } else {
        line_widths.iter().copied().fold(font_size * 0.6, f64::max)
    };
    let vertical_line_length = lines
        .iter()
        .map(|line| line.chars().count())
        .max()
        .unwrap_or(1)
        .max(1);
    let natural_height = if request.vertical_text {
        text_natural_height(font_size, vertical_line_length, line_height_ratio)
    } else {
        text_natural_height(font_size, lines.len(), line_height_ratio)
    };
    let content_width = if request.align == "justify" && !request.vertical_text {
        request.width.max(natural_width)
    } else {
        natural_width
    };
    let scale_x = resolve_axis_scale(
        request.width,
        content_width,
        axis_fit.stretch_x_grow,
        axis_fit.stretch_x_shrink,
    );
    let scale_y = resolve_axis_scale(
        request.height,
        natural_height,
        axis_fit.stretch_y_grow,
        axis_fit.stretch_y_shrink,
    );
    let content_x = if scale_x != 1.0 || (request.align == "justify" && !request.vertical_text) {
        0.0
    } else {
        match request.align {
            "center" => (request.width - natural_width) / 2.0,
            "right" => request.width - natural_width,
            _ => 0.0,
        }
    };
    let content_y = if scale_y != 1.0 {
        0.0
    } else {
        match request.vertical_align.unwrap_or("top") {
            "middle" => (request.height - natural_height) / 2.0,
            "bottom" => request.height - natural_height,
            _ => 0.0,
        }
    };
    let baseline_offset_y = font_size * 0.82;
    let line_layouts = if request.vertical_text {
        vec![]
    } else {
        lines
            .iter()
            .zip(line_widths.iter().copied())
            .enumerate()
            .map(|(index, (text, width))| {
                let glyph_count = text.chars().count();
                let letter_spacing =
                    if request.align == "justify" && glyph_count > 1 && width < request.width {
                        (request.width - width) / (glyph_count - 1) as f64
                    } else {
                        0.0
                    };
                ResolvedTextLayoutLine {
                    text: text.clone(),
                    x: 0.0,
                    y: baseline_offset_y + index as f64 * line_height,
                    width,
                    visual_width: Some(width.max(0.0001)),
                    letter_spacing,
                }
            })
            .collect()
    };
    let glyphs = if request.vertical_text {
        lines
            .iter()
            .enumerate()
            .flat_map(|(column, line)| {
                line.chars()
                    .enumerate()
                    .map(move |(row, character)| ResolvedTextLayoutGlyph {
                        text: character.to_string(),
                        x: column as f64 * line_height + font_size / 2.0,
                        y: row as f64 * line_height,
                    })
            })
            .collect()
    } else {
        vec![]
    };
    ComputedTextLayout {
        layout: ResolvedTextLayout {
            line_layouts,
            glyphs,
            vertical_text: request.vertical_text,
            resolved_font_size: font_size,
            line_height,
            content_x,
            content_y,
            content_width,
            content_height: natural_height,
            text_offset_x: 0.0,
            text_offset_y: -font_size * 0.18,
            baseline_offset_y,
            scale_x,
            scale_y,
        },
        natural_height,
    }
}

fn resolve_text_axis_fit(request: &TextLayoutRequest<'_>) -> TextAxisFit {
    let legacy_x = request.stretch_x.unwrap_or(false);
    let legacy_y = request.stretch_y.unwrap_or(false);
    TextAxisFit {
        stretch_x_grow: request.stretch_x_grow.unwrap_or(legacy_x),
        stretch_x_shrink: request.stretch_x_shrink.unwrap_or(legacy_x),
        stretch_y_grow: request.stretch_y_grow.unwrap_or(legacy_y),
        stretch_y_shrink: request.stretch_y_shrink.unwrap_or(legacy_y),
    }
}

fn resolve_axis_scale(container: f64, content: f64, grow: bool, shrink: bool) -> f64 {
    let ratio = container / content.max(0.0001);
    if !ratio.is_finite() || ratio <= 0.0 {
        return 1.0;
    }
    if ratio > 1.0 {
        if grow { ratio } else { 1.0 }
    } else if ratio < 1.0 {
        if shrink { ratio } else { 1.0 }
    } else {
        1.0
    }
}

fn round_resolved_font_size(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn normalize_text_line_height(line_height: Option<f64>) -> f64 {
    line_height.unwrap_or(1.2).clamp(0.7, 4.0)
}

fn text_natural_height(font_size: f64, line_count: usize, line_height_ratio: f64) -> f64 {
    font_size + line_count.saturating_sub(1) as f64 * font_size * line_height_ratio
}

fn vertical_text_columns(
    text: &str,
    font_size: f64,
    height: f64,
    line_height_ratio: f64,
    max_lines: Option<u32>,
    auto_wrap: bool,
) -> Vec<String> {
    let capacity = if auto_wrap {
        ((height + font_size * (line_height_ratio - 1.0)) / (font_size * line_height_ratio))
            .floor()
            .max(1.0) as usize
    } else {
        usize::MAX
    };
    let mut columns = Vec::new();
    for chunk in text.replace("\r\n", "\n").split('\n') {
        let characters = chunk.chars().collect::<Vec<_>>();
        if characters.is_empty() {
            columns.push(String::new());
            continue;
        }
        for character_chunk in characters.chunks(capacity) {
            columns.push(character_chunk.iter().collect());
        }
    }
    if let Some(max_lines) = max_lines {
        columns.truncate(max_lines as usize);
    }
    if columns.is_empty() {
        vec![String::new()]
    } else {
        columns
    }
}

fn wrap_text_by_width(
    text: &str,
    font_size: f64,
    width: f64,
    max_lines: Option<u32>,
    auto_wrap: bool,
) -> Vec<String> {
    wrap_text_by_width_with_font(text, font_size, Some(width), max_lines, auto_wrap, None)
}

fn wrap_text_by_width_with_font(
    text: &str,
    font_size: f64,
    width: Option<f64>,
    max_lines: Option<u32>,
    auto_wrap: bool,
    font_family: Option<&str>,
) -> Vec<String> {
    let normalized = text.replace("\r\n", "\n");
    if !auto_wrap {
        let mut lines = normalized
            .split('\n')
            .map(str::to_owned)
            .collect::<Vec<_>>();
        if let Some(max_lines) = max_lines {
            lines.truncate(max_lines as usize);
        }
        return lines;
    }
    let Some(width) = width else {
        return wrap_text_by_character_count(&normalized, 100, max_lines);
    };
    let mut lines = Vec::new();
    for chunk in normalized.split('\n') {
        if chunk.is_empty() {
            lines.push(String::new());
            continue;
        }
        let mut current = String::new();
        for token in chunk.split_whitespace() {
            let candidate = if current.is_empty() {
                token.to_owned()
            } else {
                format!("{current} {token}")
            };
            if estimate_text_width_with_font(&candidate, font_size, font_family) > width
                && !current.is_empty()
            {
                lines.push(current);
                let parts = break_text_token(token, font_size, width, font_family);
                let last_index = parts.len().saturating_sub(1);
                lines.extend(parts.iter().take(last_index).cloned());
                current = parts.last().cloned().unwrap_or_default();
            } else if estimate_text_width_with_font(&candidate, font_size, font_family) > width {
                let parts = break_text_token(token, font_size, width, font_family);
                let last_index = parts.len().saturating_sub(1);
                lines.extend(parts.iter().take(last_index).cloned());
                current = parts.last().cloned().unwrap_or_default();
            } else {
                current = candidate;
            }
        }
        if !current.is_empty() {
            lines.push(current);
        }
    }
    if let Some(max_lines) = max_lines {
        lines.truncate(max_lines as usize);
    }
    lines
}

fn wrap_text_by_character_count(
    text: &str,
    max_chars: usize,
    max_lines: Option<u32>,
) -> Vec<String> {
    let mut lines = Vec::new();
    for chunk in text.split('\n') {
        if chunk.is_empty() {
            lines.push(String::new());
            continue;
        }
        let mut current = String::new();
        for token in chunk.split_whitespace() {
            let candidate = if current.is_empty() {
                token.to_owned()
            } else {
                format!("{current} {token}")
            };
            if candidate.chars().count() > max_chars && !current.is_empty() {
                lines.push(current);
                current = token.into();
            } else {
                current = candidate;
            }
        }
        if !current.is_empty() {
            lines.push(current);
        }
    }
    if let Some(max_lines) = max_lines {
        lines.truncate(max_lines as usize);
    }
    lines
}

fn break_text_token(
    token: &str,
    font_size: f64,
    width: f64,
    font_family: Option<&str>,
) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    for character in token.chars() {
        let mut candidate = current.clone();
        candidate.push(character);
        if !current.is_empty()
            && estimate_text_width_with_font(&candidate, font_size, font_family) > width
        {
            parts.push(current);
            current = character.to_string();
        } else {
            current = candidate;
        }
    }
    if !current.is_empty() {
        parts.push(current);
    }
    parts
}

fn estimate_text_width_with_font(text: &str, font_size: f64, font_family: Option<&str>) -> f64 {
    text.chars()
        .map(|character| estimate_glyph_width_ratio(character, font_family) * font_size)
        .sum()
}

fn estimate_glyph_width_ratio(character: char, font_family: Option<&str>) -> f64 {
    let profile = text_metric_profile(font_family);
    if character.is_whitespace() {
        profile.space
    } else if is_wide_character(character) {
        profile.cjk
    } else if character.is_ascii_uppercase() {
        profile.uppercase
    } else if character.is_ascii_lowercase() {
        profile.lowercase
    } else if character.is_ascii_digit() {
        profile.digit
    } else if matches!(
        character,
        '-' | '.'
            | ','
            | ':'
            | ';'
            | '\''
            | '"'
            | '!'
            | '?'
            | '|'
            | '/'
            | '\\'
            | '('
            | ')'
            | '['
            | ']'
            | '{'
            | '}'
    ) {
        profile.punctuation
    } else if character.is_ascii() {
        profile.symbol
    } else {
        profile.fallback
    }
}

fn text_metric_profile(font_family: Option<&str>) -> TextMetricProfile {
    match font_family.unwrap_or("noto-sans-sc") {
        "noto-serif-sc" => CJK_SERIF_METRICS,
        "barlow-condensed" | "bebas-neue" | "inter-tight" | "oswald" | "rajdhani"
        | "roboto-condensed" => CONDENSED_SANS_METRICS,
        "exo-2" | "manrope" | "outfit" | "space-grotesk" => GEOMETRIC_SANS_METRICS,
        "georgia" | "ibm-plex-serif" | "source-serif-4" | "times-new-roman" | "system-serif" => {
            SERIF_METRICS
        }
        "courier-new" | "ibm-plex-mono" | "inconsolata" | "jetbrains-mono" | "space-mono"
        | "system-mono" => MONO_METRICS,
        "noto-sans-sc" => CJK_SANS_METRICS,
        _ => SANS_METRICS,
    }
}

fn text_font_stack(font_family: Option<&str>) -> &'static str {
    match font_family.unwrap_or("noto-sans-sc") {
        "noto-serif-sc" => {
            "'Noto Serif SC Variable', 'Songti SC', 'Noto Serif CJK SC', 'Source Han Serif SC', serif"
        }
        "arial" => "Arial, 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif",
        "georgia" => "Georgia, 'Noto Serif SC Variable', 'Noto Serif SC', serif",
        "courier-new" => "'Courier New', 'Noto Sans SC Variable', 'Noto Sans SC', monospace",
        "times-new-roman" => "'Times New Roman', 'Noto Serif SC Variable', 'Noto Serif SC', serif",
        "system-serif" => "'Times New Roman', 'Noto Serif SC Variable', 'Noto Serif SC', serif",
        "system-mono" => "'Courier New', 'Noto Sans SC Variable', 'Noto Sans SC', monospace",
        "ibm-plex-mono" => "'IBM Plex Mono', 'Noto Sans SC Variable', 'Noto Sans SC', monospace",
        "inconsolata" => "'Inconsolata', 'Noto Sans SC Variable', 'Noto Sans SC', monospace",
        "jetbrains-mono" => "'JetBrains Mono', 'Noto Sans SC Variable', 'Noto Sans SC', monospace",
        "space-mono" => "'Space Mono', 'Noto Sans SC Variable', 'Noto Sans SC', monospace",
        "ibm-plex-serif" => "'IBM Plex Serif', 'Noto Serif SC Variable', 'Noto Serif SC', serif",
        "source-serif-4" => "'Source Serif 4', 'Noto Serif SC Variable', 'Noto Serif SC', serif",
        "noto-sans-sc" => {
            "'Noto Sans SC Variable', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif"
        }
        family => match family {
            "archivo" => "'Archivo', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif",
            "barlow" => "'Barlow', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif",
            "barlow-condensed" => {
                "'Barlow Condensed', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif"
            }
            "bebas-neue" => "'Bebas Neue', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif",
            "dm-sans" => "'DM Sans', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif",
            "exo-2" => "'Exo 2', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif",
            "ibm-plex-sans" => {
                "'IBM Plex Sans', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif"
            }
            "inter" => {
                "'Inter Variable', 'Inter', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif"
            }
            "inter-tight" => "'Inter Tight', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif",
            "manrope" => "'Manrope', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif",
            "oswald" => "'Oswald', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif",
            "outfit" => "'Outfit', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif",
            "overpass" => "'Overpass', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif",
            "public-sans" => "'Public Sans', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif",
            "rajdhani" => "'Rajdhani', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif",
            "roboto" => "'Roboto', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif",
            "roboto-condensed" => {
                "'Roboto Condensed', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif"
            }
            "source-sans-3" => {
                "'Source Sans 3', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif"
            }
            "space-grotesk" => {
                "'Space Grotesk', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif"
            }
            "trebuchet-ms" => "'Trebuchet MS', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif",
            "verdana" => "Verdana, 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif",
            "work-sans" => "'Work Sans', 'Noto Sans SC Variable', 'Noto Sans SC', sans-serif",
            _ => {
                "'Noto Sans SC Variable', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif"
            }
        },
    }
}

fn is_wide_character(character: char) -> bool {
    matches!(character as u32,
        0x1100..=0x115f
        | 0x2e80..=0xa4cf
        | 0xac00..=0xd7a3
        | 0xf900..=0xfaff
        | 0xfe10..=0xfe19
        | 0xfe30..=0xfe6f
        | 0xff00..=0xff60
        | 0xffe0..=0xffe6
        | 0x20000..=0x3fffd
    )
}

fn with_rotation(markup: String, rotation: f64, origin_x: f64, origin_y: f64) -> String {
    if rotation == 0.0 {
        markup
    } else {
        format!(
            "<g transform=\"rotate({} {} {})\">{markup}</g>",
            number(rotation),
            number(origin_x),
            number(origin_y)
        )
    }
}

fn number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        let mut value = format!("{value:.4}");
        while value.ends_with('0') {
            value.pop();
        }
        value.trim_end_matches('.').into()
    }
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
