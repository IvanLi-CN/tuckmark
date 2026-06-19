import { z } from "zod";
export const paperTypeSchema = z.enum(["continuous", "gap"]);
export const renderOptionsSchema = z.object({
    printWidthDots: z.number().int().positive().default(384),
    threshold: z.number().int().min(0).max(255).default(150),
    xOffsetDots: z.number().int().default(0),
    paperType: paperTypeSchema.default("gap"),
    previewScale: z.number().int().min(1).max(16).default(4)
});
export const printerCapabilitiesSchema = z.object({
    dpi: z.number().int().positive().default(203),
    printWidthDots: z.number().int().positive().default(384),
    supportedPaperTypes: z.array(paperTypeSchema).default(["gap", "continuous"]),
    colors: z.array(z.string()).default(["mono"]),
    notes: z.array(z.string()).default([])
});
export const printerSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    rssi: z.number().int().optional(),
    capabilities: printerCapabilitiesSchema
});
export const templateFieldSchema = z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    placeholder: z.string().optional(),
    required: z.boolean().default(false),
    multiline: z.boolean().default(false),
    defaultValue: z.string().optional()
});
export const textElementSchema = z.object({
    kind: z.literal("text"),
    key: z.string().min(1),
    x: z.number(),
    y: z.number(),
    width: z.number().positive().optional(),
    fontSize: z.number().positive(),
    fontWeight: z.enum(["normal", "bold"]).default("normal"),
    align: z.enum(["left", "center", "right"]).default("left"),
    value: z.string().optional(),
    maxLines: z.number().int().positive().optional()
});
export const rectElementSchema = z.object({
    kind: z.literal("rect"),
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    strokeWidth: z.number().nonnegative().default(1),
    fill: z.string().default("none"),
    stroke: z.string().default("#111111"),
    radius: z.number().nonnegative().default(0)
});
export const lineElementSchema = z.object({
    kind: z.literal("line"),
    x1: z.number(),
    y1: z.number(),
    x2: z.number(),
    y2: z.number(),
    strokeWidth: z.number().positive().default(1),
    stroke: z.string().default("#111111")
});
export const templateElementSchema = z.discriminatedUnion("kind", [
    textElementSchema,
    rectElementSchema,
    lineElementSchema
]);
export const templateSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().default(""),
    width: z.number().positive(),
    height: z.number().positive(),
    fields: z.array(templateFieldSchema),
    elements: z.array(templateElementSchema),
    tags: z.array(z.string()).default([])
});
export const directCanvasSchema = z.object({
    id: z.string().default("canvas"),
    name: z.string().default("Canvas"),
    width: z.number().positive(),
    height: z.number().positive(),
    elements: z.array(templateElementSchema)
});
export const previewSourceSchema = z.enum(["template", "canvas", "batch_row"]);
export const safeTextLabelSchema = z.object({
    text: z.string().min(1),
    title: z.string().default("Safe Text Label"),
    renderOptions: renderOptionsSchema
        .partial()
        .default({
        paperType: "continuous"
    })
});
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
    height: z.number().positive()
});
export const previewBatchItemSchema = z.object({
    index: z.number().int().nonnegative(),
    input: z.record(z.string(), z.string()),
    artifact: previewArtifactSchema
});
export const previewResultSchema = z.object({
    artifact: previewArtifactSchema
});
export const batchPreviewResultSchema = z.object({
    templateId: z.string(),
    total: z.number().int().nonnegative(),
    items: z.array(previewBatchItemSchema)
});
export const printJobSchema = z.object({
    id: z.string(),
    artifactId: z.string(),
    printerId: z.string(),
    createdAt: z.string(),
    status: z.enum(["queued", "completed", "failed"]),
    error: z.string().optional()
});
export const previewRequestSchema = z.object({
    templateId: z.string(),
    input: z.record(z.string(), z.string()),
    renderOptions: renderOptionsSchema.partial().optional()
});
export const batchPreviewRequestSchema = z.object({
    templateId: z.string(),
    csvText: z.string().min(1),
    renderOptions: renderOptionsSchema.partial().optional()
});
export const directCanvasPreviewRequestSchema = z.object({
    canvas: directCanvasSchema,
    renderOptions: renderOptionsSchema.partial().optional()
});
export const printByArtifactRequestSchema = z.object({
    printerId: z.string(),
    artifactId: z.string()
});
export const printBatchRequestSchema = z.object({
    printerId: z.string(),
    artifactIds: z.array(z.string()).min(1)
});
export const printByTemplateRequestSchema = z.object({
    printerId: z.string(),
    templateId: z.string(),
    input: z.record(z.string(), z.string()),
    renderOptions: renderOptionsSchema.partial().optional()
});
export const printCanvasRequestSchema = z.object({
    printerId: z.string(),
    canvas: directCanvasSchema,
    renderOptions: renderOptionsSchema.partial().optional()
});
//# sourceMappingURL=types.js.map