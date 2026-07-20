import { z } from "zod"
import {
  textFontFamilies,
  textHorizontalAlignments,
  textVerticalAlignments,
} from "./text-layout.js"

export const paperTypeSchema = z.enum(["continuous", "gap"])
export type PaperType = z.infer<typeof paperTypeSchema>

export const printStrengthLevelSchema = z.number().int().min(-2).max(2).default(0)
export type PrintStrengthLevel = z.infer<typeof printStrengthLevelSchema>

export const renderOptionsSchema = z.object({
  printerModel: z.string().min(1).default("generic"),
  printerDpi: z.number().int().positive().default(203),
  printWidthDots: z.number().int().positive().default(384),
  threshold: z.number().int().min(0).max(255).default(150),
  xOffsetDots: z.number().int().default(0),
  yOffsetDots: z.number().int().default(0),
  printStrengthLevel: printStrengthLevelSchema,
  paperType: paperTypeSchema.default("gap"),
  previewScale: z.number().int().min(1).max(16).default(4),
})
export type RenderOptions = z.infer<typeof renderOptionsSchema>

export const printerCapabilitiesSchema = z.object({
  dpi: z.number().int().positive().default(203),
  printWidthDots: z.number().int().positive().default(384),
  supportedPaperTypes: z.array(paperTypeSchema).default(["gap", "continuous"]),
  colors: z.array(z.string()).default(["mono"]),
  notes: z.array(z.string()).default([]),
})
export type PrinterCapabilities = z.infer<typeof printerCapabilitiesSchema>

export const printerSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  model: z.string().optional(),
  rssi: z.number().int().optional(),
  capabilities: printerCapabilitiesSchema,
})
export type Printer = z.infer<typeof printerSchema>

export const printerProbeStageSchema = z.enum([
  "not_found",
  "open",
  "connect",
  "discover_service",
  "discover_characteristic",
  "disconnect",
  "complete",
])
export type PrinterProbeStage = z.infer<typeof printerProbeStageSchema>

export const printerProbeTimingsSchema = z.object({
  connectMs: z.number().int().nonnegative().optional(),
  discoverServiceMs: z.number().int().nonnegative().optional(),
  discoverCharacteristicMs: z.number().int().nonnegative().optional(),
  disconnectMs: z.number().int().nonnegative().optional(),
})
export type PrinterProbeTimings = z.infer<typeof printerProbeTimingsSchema>

export const printerProbeResultSchema = z.object({
  ok: z.boolean(),
  printerId: z.string(),
  printerName: z.string().optional(),
  stage: printerProbeStageSchema,
  message: z.string(),
  log: z.array(z.string()).default([]),
  timingsMs: printerProbeTimingsSchema.default({}),
})
export type PrinterProbeResult = z.infer<typeof printerProbeResultSchema>

export const templateFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  placeholder: z.string().optional(),
  required: z.boolean().default(false),
  multiline: z.boolean().default(false),
  defaultValue: z.string().optional(),
})
export type TemplateField = z.infer<typeof templateFieldSchema>

const resolvedTextLayoutLineSchema = z.object({
  text: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  visualWidth: z.number().nonnegative().optional(),
  letterSpacing: z.number(),
})

const resolvedTextLayoutGlyphSchema = z.object({
  text: z.string(),
  x: z.number(),
  y: z.number(),
})

export const resolvedTextLayoutSchema = z.object({
  lineLayouts: z.array(resolvedTextLayoutLineSchema),
  glyphs: z.array(resolvedTextLayoutGlyphSchema),
  verticalText: z.boolean(),
  resolvedFontSize: z.number().positive(),
  lineHeight: z.number().positive(),
  contentX: z.number(),
  contentY: z.number(),
  contentWidth: z.number().nonnegative(),
  contentHeight: z.number().nonnegative(),
  textOffsetX: z.number(),
  textOffsetY: z.number(),
  baselineOffsetY: z.number(),
  scaleX: z.number().positive(),
  scaleY: z.number().positive(),
})
export type ResolvedTextLayout = z.infer<typeof resolvedTextLayoutSchema>

export const textElementSchema = z.object({
  kind: z.literal("text"),
  key: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  fontSize: z.number().positive(),
  fontFamily: z.enum(textFontFamilies).optional(),
  lineHeight: z.number().positive().optional(),
  fontWeight: z.enum(["normal", "bold"]).default("normal"),
  align: z.enum(textHorizontalAlignments).default("left"),
  justifyAlign: z.enum(["left", "center", "right"]).optional(),
  verticalAlign: z.enum(textVerticalAlignments).optional(),
  stretchXGrow: z.boolean().optional(),
  stretchXShrink: z.boolean().optional(),
  stretchYGrow: z.boolean().optional(),
  stretchYShrink: z.boolean().optional(),
  stretchX: z.boolean().optional(),
  stretchY: z.boolean().optional(),
  autoWrap: z.boolean().optional(),
  adaptiveFontSize: z.boolean().optional(),
  verticalText: z.boolean().optional(),
  value: z.string().optional(),
  maxLines: z.number().int().positive().optional(),
  rotation: z.number().default(0),
  resolvedLayout: resolvedTextLayoutSchema.optional(),
})

export const rectElementSchema = z.object({
  kind: z.literal("rect"),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  strokeWidth: z.number().nonnegative().default(1),
  fill: z.string().default("none"),
  stroke: z.string().default("#111111"),
  radius: z.number().nonnegative().default(0),
  rotation: z.number().default(0),
})

export const circleElementSchema = z.object({
  kind: z.literal("circle"),
  x: z.number(),
  y: z.number(),
  size: z.number().positive(),
  strokeWidth: z.number().nonnegative().default(1),
  fill: z.string().default("none"),
  stroke: z.string().default("#111111"),
})

export const triangleElementSchema = z.object({
  kind: z.literal("triangle"),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  strokeWidth: z.number().nonnegative().default(1),
  fill: z.string().default("none"),
  stroke: z.string().default("#111111"),
  rotation: z.number().default(0),
})

export const lineElementSchema = z.object({
  kind: z.literal("line"),
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
  strokeWidth: z.number().positive().default(1),
  stroke: z.string().default("#111111"),
})

export const barcodeElementSchema = z.object({
  kind: z.literal("barcode"),
  key: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  value: z.string().optional(),
  format: z.literal("CODE128").default("CODE128"),
  showValue: z.boolean().default(false),
  rotation: z.number().default(0),
})

export const qrElementSchema = z.object({
  kind: z.literal("qr"),
  key: z.string().min(1),
  x: z.number(),
  y: z.number(),
  size: z.number().positive(),
  value: z.string().optional(),
  errorCorrectionLevel: z.enum(["L", "M", "Q", "H"]).default("M"),
  rotation: z.number().default(0),
})

export const dataMatrixElementSchema = z.object({
  kind: z.literal("datamatrix"),
  key: z.string().min(1),
  x: z.number(),
  y: z.number(),
  size: z.number().positive(),
  value: z.string().optional(),
  rotation: z.number().default(0),
})

export const templateElementSchema = z.discriminatedUnion("kind", [
  textElementSchema,
  rectElementSchema,
  circleElementSchema,
  triangleElementSchema,
  lineElementSchema,
  barcodeElementSchema,
  qrElementSchema,
  dataMatrixElementSchema,
])
export type TemplateElement = z.infer<typeof templateElementSchema>

export const templateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  width: z.number().positive(),
  height: z.number().positive(),
  fields: z.array(templateFieldSchema),
  elements: z.array(templateElementSchema),
  tags: z.array(z.string()).default([]),
})
export type TemplateDefinition = z.infer<typeof templateSchema>

export const directCanvasSchema = z.object({
  id: z.string().default("canvas"),
  name: z.string().default("Canvas"),
  width: z.number().positive(),
  height: z.number().positive(),
  elements: z.array(templateElementSchema),
})
export type DirectCanvasDefinition = z.infer<typeof directCanvasSchema>

export const previewSourceSchema = z.enum(["template", "canvas", "batch_row", "safe_text"])
export type PreviewSource = z.infer<typeof previewSourceSchema>

export const safeTextLabelSchema = z.object({
  text: z.string().min(1),
  title: z.string().default("Safe Text Label"),
  renderOptions: renderOptionsSchema.partial().default({
    paperType: "continuous",
  }),
})
export type SafeTextLabelRequest = z.infer<typeof safeTextLabelSchema>
export type SafeTextLabelInput = z.input<typeof safeTextLabelSchema>

export const previewArtifactSchema = z.object({
  id: z.string(),
  source: previewSourceSchema,
  name: z.string(),
  templateId: z.string().optional(),
  batchIndex: z.number().int().nonnegative().optional(),
  createdAt: z.string(),
  renderOptions: renderOptionsSchema,
  input: z.record(z.string(), z.string()),
  pngPath: z.string(),
  bitmapPath: z.string(),
  svgPath: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
})
export type PreviewArtifact = z.infer<typeof previewArtifactSchema>

export const previewBatchItemSchema = z.object({
  index: z.number().int().nonnegative(),
  input: z.record(z.string(), z.string()),
  artifact: previewArtifactSchema,
})
export type PreviewBatchItem = z.infer<typeof previewBatchItemSchema>

export const previewResultSchema = z.object({
  artifact: previewArtifactSchema,
})
export type PreviewResult = z.infer<typeof previewResultSchema>

export const artifactPacketsSchema = z.object({
  artifactId: z.string(),
  packetsJsonPath: z.string(),
  packets: z.array(z.string()).min(1),
  packetCount: z.number().int().positive(),
  totalBytes: z.number().int().positive(),
})
export type ArtifactPackets = z.infer<typeof artifactPacketsSchema>

export const batchPreviewResultSchema = z.object({
  templateId: z.string(),
  total: z.number().int().nonnegative(),
  items: z.array(previewBatchItemSchema),
})
export type BatchPreviewResult = z.infer<typeof batchPreviewResultSchema>

export const printJobSchema = z.object({
  id: z.string(),
  artifactId: z.string(),
  printerId: z.string(),
  createdAt: z.string(),
  status: z.enum(["queued", "completed", "failed"]),
  error: z.string().optional(),
})
export type PrintJob = z.infer<typeof printJobSchema>

export const previewRequestSchema = z.object({
  templateId: z.string(),
  input: z.record(z.string(), z.string()),
  renderOptions: renderOptionsSchema.partial().optional(),
})
export type PreviewRequest = z.infer<typeof previewRequestSchema>

export const batchPreviewRequestSchema = z.object({
  templateId: z.string(),
  csvText: z.string().min(1),
  renderOptions: renderOptionsSchema.partial().optional(),
})
export type BatchPreviewRequest = z.infer<typeof batchPreviewRequestSchema>

export const directCanvasPreviewRequestSchema = z.object({
  canvas: directCanvasSchema,
  renderOptions: renderOptionsSchema.partial().optional(),
})
export type DirectCanvasPreviewRequest = z.infer<typeof directCanvasPreviewRequestSchema>

export const printByArtifactRequestSchema = z.object({
  printerId: z.string(),
  printerName: z.string().min(1).optional(),
  artifactId: z.string(),
})
export type PrintByArtifactRequest = z.infer<typeof printByArtifactRequestSchema>

export const printBatchRequestSchema = z.object({
  printerId: z.string(),
  printerName: z.string().min(1).optional(),
  artifactIds: z.array(z.string()).min(1),
})
export type PrintBatchRequest = z.infer<typeof printBatchRequestSchema>

export const printByTemplateRequestSchema = z.object({
  printerId: z.string(),
  printerName: z.string().min(1).optional(),
  templateId: z.string(),
  input: z.record(z.string(), z.string()),
  renderOptions: renderOptionsSchema.partial().optional(),
})
export type PrintByTemplateRequest = z.infer<typeof printByTemplateRequestSchema>

export const printCanvasRequestSchema = z.object({
  printerId: z.string(),
  printerName: z.string().min(1).optional(),
  canvas: directCanvasSchema,
  renderOptions: renderOptionsSchema.partial().optional(),
})
export type PrintCanvasRequest = z.infer<typeof printCanvasRequestSchema>
