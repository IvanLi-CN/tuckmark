//! Stable render, artifact, and print wire contracts.

use std::collections::BTreeMap;

use crate::{ContractError, ExtraFields};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PaperType {
    Continuous,
    #[default]
    Gap,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RenderOptions {
    pub printer_model: String,
    pub printer_dpi: u32,
    pub print_width_dots: u32,
    pub threshold: u8,
    pub x_offset_dots: i32,
    pub y_offset_dots: i32,
    pub print_strength_level: i8,
    pub paper_type: PaperType,
    pub preview_scale: u8,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

impl Default for RenderOptions {
    fn default() -> Self {
        Self {
            printer_model: "generic".into(),
            printer_dpi: 203,
            print_width_dots: 384,
            threshold: 150,
            x_offset_dots: 0,
            y_offset_dots: 0,
            print_strength_level: 0,
            paper_type: PaperType::Gap,
            preview_scale: 4,
            extra: ExtraFields::new(),
        }
    }
}

impl RenderOptions {
    pub fn validate(&self) -> Result<(), ContractError> {
        if self.printer_model.trim().is_empty() {
            return Err(ContractError::Validation(
                "renderOptions.printerModel must not be empty".into(),
            ));
        }
        if self.printer_dpi == 0 || self.print_width_dots == 0 {
            return Err(ContractError::Validation(
                "renderOptions printerDpi and printWidthDots must be positive".into(),
            ));
        }
        if !(-2..=2).contains(&self.print_strength_level) {
            return Err(ContractError::Validation(
                "renderOptions.printStrengthLevel must be between -2 and 2".into(),
            ));
        }
        if !(1..=16).contains(&self.preview_scale) {
            return Err(ContractError::Validation(
                "renderOptions.previewScale must be between 1 and 16".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TemplateField {
    pub key: String,
    pub label: String,
    pub placeholder: Option<String>,
    pub required: bool,
    pub multiline: bool,
    pub default_value: Option<String>,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ResolvedTextLayoutLine {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub visual_width: Option<f64>,
    pub letter_spacing: f64,
}

impl ResolvedTextLayoutLine {
    fn validate(&self) -> Result<(), ContractError> {
        finite(self.x, "resolved text line x")?;
        finite(self.y, "resolved text line y")?;
        non_negative(self.width, "resolved text line width")?;
        optional_non_negative(self.visual_width, "resolved text line visualWidth")?;
        finite(self.letter_spacing, "resolved text line letterSpacing")
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ResolvedTextLayoutGlyph {
    pub text: String,
    pub x: f64,
    pub y: f64,
}

impl ResolvedTextLayoutGlyph {
    fn validate(&self) -> Result<(), ContractError> {
        finite(self.x, "resolved text glyph x")?;
        finite(self.y, "resolved text glyph y")
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ResolvedTextLayout {
    pub line_layouts: Vec<ResolvedTextLayoutLine>,
    pub glyphs: Vec<ResolvedTextLayoutGlyph>,
    pub vertical_text: bool,
    pub resolved_font_size: f64,
    pub line_height: f64,
    pub content_x: f64,
    pub content_y: f64,
    pub content_width: f64,
    pub content_height: f64,
    pub text_offset_x: f64,
    pub text_offset_y: f64,
    pub baseline_offset_y: f64,
    pub scale_x: f64,
    pub scale_y: f64,
}

impl ResolvedTextLayout {
    pub fn validate(&self) -> Result<(), ContractError> {
        for line in &self.line_layouts {
            line.validate()?;
        }
        for glyph in &self.glyphs {
            glyph.validate()?;
        }
        positive(self.resolved_font_size, "resolved text fontSize")?;
        positive(self.line_height, "resolved text lineHeight")?;
        finite(self.content_x, "resolved text contentX")?;
        finite(self.content_y, "resolved text contentY")?;
        non_negative(self.content_width, "resolved text contentWidth")?;
        non_negative(self.content_height, "resolved text contentHeight")?;
        finite(self.text_offset_x, "resolved text textOffsetX")?;
        finite(self.text_offset_y, "resolved text textOffsetY")?;
        finite(self.baseline_offset_y, "resolved text baselineOffsetY")?;
        positive(self.scale_x, "resolved text scaleX")?;
        positive(self.scale_y, "resolved text scaleY")
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum TemplateElement {
    #[serde(rename_all = "camelCase")]
    Text {
        key: String,
        x: f64,
        y: f64,
        #[serde(default)]
        width: Option<f64>,
        #[serde(default)]
        height: Option<f64>,
        font_size: f64,
        #[serde(default)]
        font_family: Option<String>,
        #[serde(default)]
        line_height: Option<f64>,
        #[serde(default = "default_font_weight")]
        font_weight: String,
        #[serde(default = "default_text_alignment")]
        align: String,
        #[serde(default)]
        justify_align: Option<String>,
        #[serde(default)]
        vertical_align: Option<String>,
        #[serde(default)]
        stretch_x_grow: Option<bool>,
        #[serde(default)]
        stretch_x_shrink: Option<bool>,
        #[serde(default)]
        stretch_y_grow: Option<bool>,
        #[serde(default)]
        stretch_y_shrink: Option<bool>,
        #[serde(default)]
        stretch_x: Option<bool>,
        #[serde(default)]
        stretch_y: Option<bool>,
        #[serde(default)]
        auto_wrap: Option<bool>,
        #[serde(default)]
        adaptive_font_size: Option<bool>,
        #[serde(default)]
        vertical_text: Option<bool>,
        #[serde(default)]
        value: Option<String>,
        #[serde(default)]
        max_lines: Option<u32>,
        #[serde(default)]
        rotation: f64,
        #[serde(default)]
        resolved_layout: Option<Box<ResolvedTextLayout>>,
        #[serde(flatten, default)]
        extra: ExtraFields,
    },
    #[serde(rename_all = "camelCase")]
    Rect {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        #[serde(default = "default_stroke_width")]
        stroke_width: f64,
        #[serde(default = "default_none")]
        fill: String,
        #[serde(default = "default_stroke")]
        stroke: String,
        #[serde(default)]
        radius: f64,
        #[serde(default)]
        rotation: f64,
        #[serde(flatten, default)]
        extra: ExtraFields,
    },
    #[serde(rename_all = "camelCase")]
    Circle {
        x: f64,
        y: f64,
        size: f64,
        #[serde(default = "default_stroke_width")]
        stroke_width: f64,
        #[serde(default = "default_none")]
        fill: String,
        #[serde(default = "default_stroke")]
        stroke: String,
        #[serde(flatten, default)]
        extra: ExtraFields,
    },
    #[serde(rename_all = "camelCase")]
    Triangle {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        #[serde(default = "default_stroke_width")]
        stroke_width: f64,
        #[serde(default = "default_none")]
        fill: String,
        #[serde(default = "default_stroke")]
        stroke: String,
        #[serde(default)]
        rotation: f64,
        #[serde(flatten, default)]
        extra: ExtraFields,
    },
    #[serde(rename_all = "camelCase")]
    Line {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        #[serde(default = "default_stroke_width")]
        stroke_width: f64,
        #[serde(default = "default_stroke")]
        stroke: String,
        #[serde(flatten, default)]
        extra: ExtraFields,
    },
    #[serde(rename_all = "camelCase")]
    Barcode {
        key: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        #[serde(default)]
        value: Option<String>,
        #[serde(default = "default_code128")]
        format: String,
        #[serde(default)]
        show_value: bool,
        #[serde(default)]
        rotation: f64,
        #[serde(flatten, default)]
        extra: ExtraFields,
    },
    #[serde(rename_all = "camelCase")]
    Qr {
        key: String,
        x: f64,
        y: f64,
        size: f64,
        #[serde(default)]
        value: Option<String>,
        #[serde(default = "default_qr_level")]
        error_correction_level: String,
        #[serde(default)]
        rotation: f64,
        #[serde(flatten, default)]
        extra: ExtraFields,
    },
    #[serde(rename = "datamatrix")]
    #[serde(rename_all = "camelCase")]
    DataMatrix {
        key: String,
        x: f64,
        y: f64,
        size: f64,
        #[serde(default)]
        value: Option<String>,
        #[serde(default)]
        rotation: f64,
        #[serde(flatten, default)]
        extra: ExtraFields,
    },
}

impl TemplateElement {
    pub fn validate(&self) -> Result<(), ContractError> {
        match self {
            Self::Text {
                key,
                x,
                y,
                width,
                height,
                font_size,
                line_height,
                max_lines,
                rotation,
                resolved_layout,
                ..
            } => {
                non_empty(key, "text element key")?;
                finite(*x, "text element x")?;
                finite(*y, "text element y")?;
                positive(*font_size, "text element fontSize")?;
                optional_positive(*width, "text element width")?;
                optional_positive(*height, "text element height")?;
                optional_positive(*line_height, "text element lineHeight")?;
                if max_lines.is_some_and(|value| value == 0) {
                    return Err(ContractError::Validation(
                        "text element maxLines must be positive".into(),
                    ));
                }
                finite(*rotation, "text element rotation")?;
                if let Some(layout) = resolved_layout {
                    layout.validate()?;
                }
                Ok(())
            }
            Self::Rect {
                x,
                y,
                width,
                height,
                stroke_width,
                radius,
                rotation,
                ..
            } => {
                finite(*x, "rect x")?;
                finite(*y, "rect y")?;
                positive(*width, "rect width")?;
                positive(*height, "rect height")?;
                non_negative(*stroke_width, "rect strokeWidth")?;
                non_negative(*radius, "rect radius")?;
                finite(*rotation, "rect rotation")
            }
            Self::Circle {
                x,
                y,
                size,
                stroke_width,
                ..
            } => {
                finite(*x, "circle x")?;
                finite(*y, "circle y")?;
                positive(*size, "circle size")?;
                non_negative(*stroke_width, "circle strokeWidth")
            }
            Self::Triangle {
                x,
                y,
                width,
                height,
                stroke_width,
                rotation,
                ..
            } => {
                finite(*x, "triangle x")?;
                finite(*y, "triangle y")?;
                positive(*width, "triangle width")?;
                positive(*height, "triangle height")?;
                non_negative(*stroke_width, "triangle strokeWidth")?;
                finite(*rotation, "triangle rotation")
            }
            Self::Line {
                x1,
                y1,
                x2,
                y2,
                stroke_width,
                ..
            } => {
                finite(*x1, "line x1")?;
                finite(*y1, "line y1")?;
                finite(*x2, "line x2")?;
                finite(*y2, "line y2")?;
                positive(*stroke_width, "line strokeWidth")
            }
            Self::Barcode {
                key,
                x,
                y,
                width,
                height,
                format,
                rotation,
                ..
            } => {
                non_empty(key, "barcode key")?;
                if format != "CODE128" {
                    return Err(ContractError::Validation(
                        "barcode format must be CODE128".into(),
                    ));
                }
                finite(*x, "barcode x")?;
                finite(*y, "barcode y")?;
                positive(*width, "barcode width")?;
                positive(*height, "barcode height")?;
                finite(*rotation, "barcode rotation")
            }
            Self::Qr {
                key,
                x,
                y,
                size,
                error_correction_level,
                rotation,
                ..
            } => {
                non_empty(key, "QR key")?;
                if !matches!(error_correction_level.as_str(), "L" | "M" | "Q" | "H") {
                    return Err(ContractError::Validation(
                        "QR errorCorrectionLevel must be L, M, Q, or H".into(),
                    ));
                }
                finite(*x, "QR x")?;
                finite(*y, "QR y")?;
                positive(*size, "QR size")?;
                finite(*rotation, "QR rotation")
            }
            Self::DataMatrix {
                key,
                x,
                y,
                size,
                rotation,
                ..
            } => {
                non_empty(key, "Data Matrix key")?;
                finite(*x, "Data Matrix x")?;
                finite(*y, "Data Matrix y")?;
                positive(*size, "Data Matrix size")?;
                finite(*rotation, "Data Matrix rotation")
            }
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TemplateDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub width: f64,
    pub height: f64,
    pub fields: Vec<TemplateField>,
    pub elements: Vec<TemplateElement>,
    pub tags: Vec<String>,
    pub recommended_use: Option<String>,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

impl TemplateDefinition {
    pub fn validate(&self) -> Result<(), ContractError> {
        non_empty(&self.id, "template id")?;
        non_empty(&self.name, "template name")?;
        positive(self.width, "template width")?;
        positive(self.height, "template height")?;
        for field in &self.fields {
            non_empty(&field.key, "template field key")?;
            non_empty(&field.label, "template field label")?;
        }
        for element in &self.elements {
            element.validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DirectCanvasDefinition {
    pub id: String,
    pub name: String,
    pub width: f64,
    pub height: f64,
    pub elements: Vec<TemplateElement>,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

impl DirectCanvasDefinition {
    pub fn validate(&self) -> Result<(), ContractError> {
        positive(self.width, "canvas width")?;
        positive(self.height, "canvas height")?;
        for element in &self.elements {
            element.validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PreviewSource {
    #[default]
    Template,
    Canvas,
    BatchRow,
    SafeText,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SafeTextLabelRequest {
    pub text: String,
    pub title: String,
    pub render_options: RenderOptions,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

impl Default for SafeTextLabelRequest {
    fn default() -> Self {
        Self {
            text: String::new(),
            title: "Safe Text Label".into(),
            render_options: RenderOptions {
                paper_type: PaperType::Continuous,
                ..RenderOptions::default()
            },
            extra: ExtraFields::new(),
        }
    }
}

impl SafeTextLabelRequest {
    pub fn validate(&self) -> Result<(), ContractError> {
        if self.text.is_empty() {
            return Err(ContractError::Validation(
                "safe text label text must not be empty".into(),
            ));
        }
        non_empty(&self.title, "safe text label title")?;
        self.render_options.validate()
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PreviewArtifact {
    pub id: String,
    pub source: PreviewSource,
    pub name: String,
    pub template_id: Option<String>,
    pub batch_index: Option<u64>,
    pub created_at: String,
    pub render_options: RenderOptions,
    pub input: BTreeMap<String, String>,
    pub png_path: String,
    pub bitmap_path: String,
    pub svg_path: String,
    pub width: u32,
    pub height: u32,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

impl Default for PreviewArtifact {
    fn default() -> Self {
        Self {
            id: String::new(),
            source: PreviewSource::Template,
            name: String::new(),
            template_id: None,
            batch_index: None,
            created_at: String::new(),
            render_options: RenderOptions::default(),
            input: BTreeMap::new(),
            png_path: String::new(),
            bitmap_path: String::new(),
            svg_path: String::new(),
            width: 0,
            height: 0,
            extra: ExtraFields::new(),
        }
    }
}

impl PreviewArtifact {
    pub fn validate(&self) -> Result<(), ContractError> {
        non_empty(&self.id, "artifact id")?;
        non_empty(&self.name, "artifact name")?;
        non_empty(&self.created_at, "artifact createdAt")?;
        if self.width == 0 || self.height == 0 {
            return Err(ContractError::Validation(
                "artifact dimensions must be positive".into(),
            ));
        }
        self.render_options.validate()
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ArtifactPackets {
    pub artifact_id: String,
    pub packets_json_path: String,
    pub packets: Vec<String>,
    pub packet_count: u64,
    pub total_bytes: u64,
    #[serde(flatten, default)]
    pub extra: ExtraFields,
}

impl ArtifactPackets {
    pub fn validate(&self) -> Result<(), ContractError> {
        non_empty(&self.artifact_id, "artifact packets artifactId")?;
        non_empty(&self.packets_json_path, "artifact packets packetsJsonPath")?;
        if self.packets.is_empty() {
            return Err(ContractError::Validation(
                "artifact packets must not be empty".into(),
            ));
        }
        if self.packet_count != self.packets.len() as u64 {
            return Err(ContractError::Validation(
                "artifact packets packetCount does not match packets".into(),
            ));
        }
        let mut total_bytes = 0_u64;
        for packet in &self.packets {
            let decoded = STANDARD.decode(packet).map_err(|error| {
                ContractError::Validation(format!(
                    "artifact packet is not standard base64: {error}"
                ))
            })?;
            if decoded.is_empty() || STANDARD.encode(&decoded) != *packet {
                return Err(ContractError::Validation(
                    "artifact packets must use non-empty canonical standard base64".into(),
                ));
            }
            total_bytes = total_bytes
                .checked_add(decoded.len() as u64)
                .ok_or_else(|| {
                    ContractError::Validation("artifact packet totalBytes overflowed".into())
                })?;
        }
        if self.total_bytes != total_bytes {
            return Err(ContractError::Validation(
                "artifact packets totalBytes does not match packets".into(),
            ));
        }
        Ok(())
    }
}

fn default_font_weight() -> String {
    "normal".into()
}

fn default_text_alignment() -> String {
    "left".into()
}

fn default_stroke_width() -> f64 {
    1.0
}

fn default_none() -> String {
    "none".into()
}

fn default_stroke() -> String {
    "#111111".into()
}

fn default_code128() -> String {
    "CODE128".into()
}

fn default_qr_level() -> String {
    "M".into()
}

fn non_empty(value: &str, name: &str) -> Result<(), ContractError> {
    if value.trim().is_empty() {
        return Err(ContractError::Validation(format!(
            "{name} must not be empty"
        )));
    }
    Ok(())
}

fn finite(value: f64, name: &str) -> Result<(), ContractError> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(ContractError::Validation(format!("{name} must be finite")))
    }
}

fn positive(value: f64, name: &str) -> Result<(), ContractError> {
    if value.is_finite() && value > 0.0 {
        Ok(())
    } else {
        Err(ContractError::Validation(format!(
            "{name} must be positive and finite"
        )))
    }
}

fn non_negative(value: f64, name: &str) -> Result<(), ContractError> {
    if value.is_finite() && value >= 0.0 {
        Ok(())
    } else {
        Err(ContractError::Validation(format!(
            "{name} must be non-negative and finite"
        )))
    }
}

fn optional_positive(value: Option<f64>, name: &str) -> Result<(), ContractError> {
    if let Some(value) = value {
        positive(value, name)?;
    }
    Ok(())
}

fn optional_non_negative(value: Option<f64>, name: &str) -> Result<(), ContractError> {
    match value {
        Some(value) => non_negative(value, name),
        None => Ok(()),
    }
}
