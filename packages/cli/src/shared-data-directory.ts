import { randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  type DirectCanvasDefinition,
  type RenderOptions,
  renderOptionsSchema,
  type TemplateDefinition,
  type UserTemplatePackage,
} from "@tuckmark/core"
import {
  agentImportTransactionSchema,
  applyInventoryAdjustment,
  buildInventoryTemplateInput,
  ensureInventoryMaterialActive,
  ensureInventoryMaterialDeletionAllowed,
  type InventoryAdjustment,
  type InventoryAdjustmentInput,
  type InventoryMaterial,
  type InventoryTemplateBinding,
  inventoryAdjustmentSchema,
  inventoryAdjustmentTransactionSchema,
  inventoryMaterialSchema,
  materialMatchesQuery,
  sortInventoryAdjustmentsNewestFirst,
  sortInventoryMaterialsByName,
} from "@tuckmark/inventory"
import { z } from "zod"

const CANVAS_DOTS_PER_MILLIMETER = 8
const CLI_CONFIG_PATH = path.join(os.homedir(), ".config", "tuckmark", "config.json")
const TEMPLATES_ROOT = "templates"
const INVENTORY_MATERIALS_ROOT = path.join("inventory", "materials")
const INVENTORY_ADJUSTMENTS_ROOT = path.join("inventory", "adjustments")
const INVENTORY_TRANSACTIONS_ROOT = path.join("inventory", "transactions")
const AGENT_IMPORT_TRANSACTIONS_ROOT = path.join("inventory", "agent-import-transactions")
const DATA_DIRECTORY_MANIFEST_PATH = "manifest.json"
const DATA_DIRECTORY_MANIFEST_SCHEMA = "tuckmark.data-dir-manifest.v1"

const cliConfigSchema = z.object({
  version: z.literal(1).default(1),
  dataDir: z.string().min(1).optional(),
})

const dataDirectoryManifestSchema = z.object({
  schema: z.literal(DATA_DIRECTORY_MANIFEST_SCHEMA),
  generatedAt: z.string().min(1),
  snapshotUpdatedAt: z.string().nullable(),
  source: z.enum(["runtime-sync", "backup-archive"]),
  files: z.object({
    settings: z.string().min(1),
    templatesDir: z.string().min(1),
    draftsDir: z.string().min(1),
    inventoryDir: z.string().min(1),
    backupsDir: z.string().min(1),
  }),
  counts: z.object({
    templates: z.number().int().min(0),
    versions: z.number().int().min(0),
    workingCopies: z.number().int().min(0),
    materials: z.number().int().min(0),
    adjustments: z.number().int().min(0),
  }),
})

const canvasDraftSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("scratch"),
    presetId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("preset-template"),
    presetId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("user-template"),
    templateId: z.string().min(1),
  }),
])

const canvasLayerMetaSchema = z.object({
  name: z.string().min(1),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
})

const canvasElementBindingSchema = z.object({
  fieldKey: z.string().min(1),
  kind: z.enum(["text", "barcode", "qr", "datamatrix"]),
})

const draftElementBaseSchema = z.object({
  id: z.string().min(1),
  meta: canvasLayerMetaSchema,
  binding: canvasElementBindingSchema.optional(),
})

const draftTextElementSchema = draftElementBaseSchema
  .extend({
    kind: z.literal("text"),
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    fontSize: z.number().positive(),
    fontFamily: z.string().min(1),
    lineHeight: z.number().positive().default(1.2),
    fontWeight: z.enum(["normal", "bold"]).default("normal"),
    align: z.enum(["left", "center", "right", "justify"]).default("left"),
    justifyAlign: z.enum(["left", "center", "right"]).optional(),
    verticalAlign: z.enum(["top", "middle", "bottom"]).default("top"),
    stretchXGrow: z.boolean().default(false),
    stretchXShrink: z.boolean().default(false),
    stretchYGrow: z.boolean().default(false),
    stretchYShrink: z.boolean().default(false),
    autoWrap: z.boolean().default(true),
    adaptiveFontSize: z.boolean().default(false),
    verticalText: z.boolean().default(false),
    value: z.string(),
    maxLines: z.number().int().positive().optional(),
    rotation: z.number().optional(),
  })
  .passthrough()

const draftRectElementSchema = draftElementBaseSchema
  .extend({
    kind: z.literal("rect"),
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    strokeWidth: z.number().nonnegative(),
    fill: z.string(),
    stroke: z.string(),
    radius: z.number().nonnegative(),
    rotation: z.number().optional(),
  })
  .passthrough()

const draftCircleElementSchema = draftElementBaseSchema
  .extend({
    kind: z.literal("circle"),
    x: z.number(),
    y: z.number(),
    size: z.number().positive(),
    strokeWidth: z.number().nonnegative(),
    fill: z.string(),
    stroke: z.string(),
  })
  .passthrough()

const draftTriangleElementSchema = draftElementBaseSchema
  .extend({
    kind: z.literal("triangle"),
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    strokeWidth: z.number().nonnegative(),
    fill: z.string(),
    stroke: z.string(),
    rotation: z.number().optional(),
  })
  .passthrough()

const draftLineElementSchema = draftElementBaseSchema
  .extend({
    kind: z.literal("line"),
    x: z.number(),
    y: z.number(),
    x2: z.number(),
    y2: z.number(),
    strokeWidth: z.number().positive(),
    stroke: z.string(),
  })
  .passthrough()

const draftBarcodeElementSchema = draftElementBaseSchema
  .extend({
    kind: z.literal("barcode"),
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    value: z.string(),
    format: z.literal("CODE128").default("CODE128"),
    showValue: z.boolean().default(false),
    rotation: z.number().optional(),
  })
  .passthrough()

const draftQrElementSchema = draftElementBaseSchema
  .extend({
    kind: z.literal("qr"),
    x: z.number(),
    y: z.number(),
    size: z.number().positive(),
    value: z.string(),
    errorCorrectionLevel: z.enum(["L", "M", "Q", "H"]).default("M"),
    rotation: z.number().optional(),
  })
  .passthrough()

const draftDataMatrixElementSchema = draftElementBaseSchema
  .extend({
    kind: z.literal("datamatrix"),
    x: z.number(),
    y: z.number(),
    size: z.number().positive(),
    value: z.string(),
    rotation: z.number().optional(),
  })
  .passthrough()

const canvasDraftElementSchema = z.discriminatedUnion("kind", [
  draftTextElementSchema,
  draftRectElementSchema,
  draftCircleElementSchema,
  draftTriangleElementSchema,
  draftLineElementSchema,
  draftBarcodeElementSchema,
  draftQrElementSchema,
  draftDataMatrixElementSchema,
])

const canvasDraftFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  defaultValue: z.string().default(""),
  sampleValue: z.string().optional(),
  multiline: z.boolean().default(false),
  bindings: z.array(z.string()).default([]),
})

const canvasGridSizeSchema = z.preprocess(
  (value) => (value === 1 || value === 2 || value === 5 ? value : 1),
  z.union([z.literal(1), z.literal(2), z.literal(5)])
)

const canvasSnapStepSchema = z.preprocess(
  (value) => (value === 0.25 || value === 0.5 || value === 1 ? value : 1),
  z.union([z.literal(0.25), z.literal(0.5), z.literal(1)])
)

const recommendedUseSchema = z
  .union([z.string().trim().min(1), z.object({ scope: z.string().trim().min(1) })])
  .transform((value) => (typeof value === "string" ? value : value.scope))
const legacyRecommendedUsesSchema = z.array(recommendedUseSchema)

function normalizeRecommendedUse(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (Array.isArray(value)) {
    return (
      value
        .flatMap((entry) => recommendedUseSchema.safeParse(entry).data ?? [])
        .filter(Boolean)
        .join("；") || undefined
    )
  }
  return recommendedUseSchema.safeParse(value).data
}

const canvasDraftDocumentSchema = z
  .object({
    version: z.literal(1),
    unit: z.literal("mm").optional(),
    id: z.string().min(1),
    presetId: z.string().min(1),
    name: z.string().min(1),
    source: canvasDraftSourceSchema,
    templateId: z.string().min(1).optional(),
    baseVersionId: z.string().min(1).optional(),
    lastSavedAt: z.string().optional(),
    width: z.number().positive(),
    height: z.number().positive(),
    renderOptions: renderOptionsSchema.partial().optional(),
    recommendedUse: recommendedUseSchema.optional(),
    recommendedUses: legacyRecommendedUsesSchema.optional(),
    fields: z.array(canvasDraftFieldSchema),
    elements: z.array(canvasDraftElementSchema),
    editor: z.object({
      gridEnabled: z.boolean().default(true),
      gridSize: canvasGridSizeSchema,
      snapEnabled: z.boolean().default(true),
      snapStep: canvasSnapStepSchema,
    }),
  })
  .passthrough()
  .transform(({ recommendedUses, ...document }) => ({
    ...document,
    recommendedUse: document.recommendedUse ?? normalizeRecommendedUse(recommendedUses),
  }))

const userTemplateRecordSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    width: z.number().positive(),
    height: z.number().positive(),
    createdAt: z.string(),
    updatedAt: z.string(),
    archivedAt: z.string().nullable().optional(),
    currentVersionId: z.string().min(1),
    fieldOrder: z.array(z.string()),
    recommendedUse: recommendedUseSchema.optional(),
    recommendedUses: legacyRecommendedUsesSchema.optional(),
  })
  .transform(({ recommendedUses, ...record }) => ({
    ...record,
    recommendedUse: record.recommendedUse ?? normalizeRecommendedUse(recommendedUses),
  }))

const userTemplateVersionSchema = z.object({
  id: z.string().min(1),
  templateId: z.string().min(1),
  version: z.number().int().positive(),
  kind: z.enum(["saved", "autosave"]),
  createdAt: z.string(),
  label: z.string().min(1),
  sourceVersionId: z.string().optional(),
  document: canvasDraftDocumentSchema,
})

const canvasWorkingCopyIndexEntrySchema = z.object({
  sourceKey: z.string().min(1),
  source: canvasDraftSourceSchema,
  draft: canvasDraftDocumentSchema,
  updatedAt: z.string(),
  templateId: z.string().min(1).optional(),
  baseVersionId: z.string().min(1).optional(),
})

export type CliConfig = z.infer<typeof cliConfigSchema>
export type CanvasDraftDocument = z.infer<typeof canvasDraftDocumentSchema>
export type CanvasDraftField = z.infer<typeof canvasDraftFieldSchema>
export type CanvasWorkingCopyIndexEntry = z.infer<typeof canvasWorkingCopyIndexEntrySchema>
export type SharedUserTemplateRecord = z.infer<typeof userTemplateRecordSchema>
export type SharedUserTemplateVersion = z.infer<typeof userTemplateVersionSchema>

export type SharedUserTemplateSummary = SharedUserTemplateRecord & {
  source: "user-template"
  fields: CanvasDraftField[]
  document: CanvasDraftDocument | null
}

export type SharedUserTemplateDetail = {
  template: SharedUserTemplateSummary
  workingCopy: CanvasWorkingCopyIndexEntry | null
  savedVersions: SharedUserTemplateVersion[]
  autosaves: SharedUserTemplateVersion[]
}

type UserTemplateInventoryPrintSource = {
  kind: "user-template"
  canvas: DirectCanvasDefinition
  copies: number
  renderOptions?: Partial<RenderOptions>
}

export type InventoryPrintSource =
  | {
      kind: "system-template"
      templateId: string
      input: Record<string, string>
      copies: number
      renderOptions?: Partial<RenderOptions>
    }
  | UserTemplateInventoryPrintSource

type ResolvedUserTemplatePrintSource = Omit<UserTemplateInventoryPrintSource, "copies">

function createId(prefix: string): string {
  return `${prefix}-${randomUUID()}`
}

function dotsToMillimeters(value: number): number {
  return Number((value / CANVAS_DOTS_PER_MILLIMETER).toFixed(4))
}

function millimetersToDots(value: number): number {
  return Math.round(value * CANVAS_DOTS_PER_MILLIMETER)
}

function textHeightToMillimeters(fontSizeDots: number, lineHeight?: number): number {
  return dotsToMillimeters(fontSizeDots * (lineHeight ?? 1.2))
}

function mergeRenderOptions(
  ...values: Array<Partial<RenderOptions> | undefined>
): Partial<RenderOptions> | undefined {
  const next: Partial<RenderOptions> = {}
  for (const value of values) {
    if (!value) {
      continue
    }
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) {
        ;(next as Record<string, unknown>)[key] = entry
      }
    }
  }
  return Object.keys(next).length > 0 ? next : undefined
}

function inferDraftLayerName(
  element: TemplateDefinition["elements"][number],
  field: TemplateDefinition["fields"][number] | undefined,
  index: number
): string {
  if (field) {
    return field.label
  }
  switch (element.kind) {
    case "text":
      return `Text ${index + 1}`
    case "rect":
      return `Rect ${index + 1}`
    case "circle":
      return `Circle ${index + 1}`
    case "triangle":
      return `Triangle ${index + 1}`
    case "line":
      return `Line ${index + 1}`
    case "barcode":
      return `Barcode ${index + 1}`
    case "qr":
      return `QR ${index + 1}`
    case "datamatrix":
      return `Data Matrix ${index + 1}`
  }
}

function syncDraftBindings(
  fields: readonly CanvasDraftField[],
  elements: CanvasDraftDocument["elements"]
): {
  fields: CanvasDraftField[]
  elements: CanvasDraftDocument["elements"]
} {
  const fieldMap = new Map(
    fields.map((field) => [field.key, { ...field, bindings: [] as string[] }])
  )
  const nextElements = elements.map((element) => {
    if (!("binding" in element) || !element.binding) {
      return element
    }
    const field = fieldMap.get(element.binding.fieldKey)
    if (!field) {
      return { ...element, binding: undefined }
    }
    field.bindings.push(element.id)
    return element
  })
  return {
    fields: Array.from(fieldMap.values()),
    elements: nextElements,
  }
}

function createDraftFromUserTemplatePackage(
  templatePackage: UserTemplatePackage,
  options?: {
    templateId?: string
    name?: string
    description?: string
  }
): CanvasDraftDocument {
  const templateId = options?.templateId ?? templatePackage.id
  const template: TemplateDefinition = {
    id: templatePackage.id,
    name: options?.name ?? templatePackage.name,
    description: options?.description ?? templatePackage.description,
    width: templatePackage.canvas.width,
    height: templatePackage.canvas.height,
    fields: templatePackage.fields.map((field) => ({
      key: field.key,
      label: field.label,
      required: false,
      multiline: field.multiline,
      defaultValue: field.defaultValue,
      sampleValue: templatePackage.sampleInput[field.key],
    })),
    elements: templatePackage.elements,
    tags: templatePackage.tags,
    recommendedUse: templatePackage.recommendedUse,
  }
  const fields: CanvasDraftField[] = template.fields.map((field) => ({
    key: field.key,
    label: field.label,
    defaultValue: field.defaultValue ?? "",
    sampleValue: templatePackage.sampleInput[field.key],
    multiline: field.multiline ?? false,
    bindings: [],
  }))
  const fieldMap = new Map(template.fields.map((field) => [field.key, field]))
  const elements = template.elements.map((element, index) => {
    const field = "key" in element ? fieldMap.get(element.key) : undefined
    const meta = {
      name: inferDraftLayerName(element, field, index),
      visible: true,
      locked: false,
    }
    switch (element.kind) {
      case "text":
        return canvasDraftElementSchema.parse({
          id: `text-${createId("draft")}`,
          kind: "text",
          x: dotsToMillimeters(element.x),
          y: dotsToMillimeters(
            element.height === undefined ? element.y - element.fontSize : element.y
          ),
          width: dotsToMillimeters(element.width ?? 180),
          height:
            element.height === undefined
              ? textHeightToMillimeters(element.fontSize, element.lineHeight)
              : dotsToMillimeters(element.height),
          fontSize: dotsToMillimeters(element.fontSize),
          fontFamily: element.fontFamily ?? "inter",
          lineHeight: element.lineHeight ?? 1.2,
          fontWeight: element.fontWeight,
          align: element.align,
          justifyAlign: element.justifyAlign,
          verticalAlign: element.verticalAlign ?? "top",
          stretchXGrow: element.stretchXGrow ?? element.stretchX ?? false,
          stretchXShrink: element.stretchXShrink ?? element.stretchX ?? false,
          stretchYGrow: element.stretchYGrow ?? element.stretchY ?? false,
          stretchYShrink: element.stretchYShrink ?? element.stretchY ?? false,
          autoWrap: element.autoWrap ?? true,
          adaptiveFontSize: element.adaptiveFontSize ?? false,
          verticalText: element.verticalText ?? false,
          value:
            templatePackage.sampleInput[element.key] ??
            field?.defaultValue ??
            field?.label ??
            element.value ??
            "",
          maxLines: element.maxLines,
          rotation: element.rotation,
          binding: field ? { fieldKey: field.key, kind: "text" } : undefined,
          meta,
        })
      case "rect":
        return canvasDraftElementSchema.parse({
          id: `rect-${createId("draft")}`,
          kind: "rect",
          x: dotsToMillimeters(element.x),
          y: dotsToMillimeters(element.y),
          width: dotsToMillimeters(element.width),
          height: dotsToMillimeters(element.height),
          strokeWidth: dotsToMillimeters(element.strokeWidth),
          fill: element.fill,
          stroke: element.stroke,
          radius: dotsToMillimeters(element.radius),
          rotation: element.rotation,
          meta,
        })
      case "circle":
        return canvasDraftElementSchema.parse({
          id: `circle-${createId("draft")}`,
          kind: "circle",
          x: dotsToMillimeters(element.x),
          y: dotsToMillimeters(element.y),
          size: dotsToMillimeters(element.size),
          strokeWidth: dotsToMillimeters(element.strokeWidth),
          fill: element.fill,
          stroke: element.stroke,
          meta,
        })
      case "triangle":
        return canvasDraftElementSchema.parse({
          id: `triangle-${createId("draft")}`,
          kind: "triangle",
          x: dotsToMillimeters(element.x),
          y: dotsToMillimeters(element.y),
          width: dotsToMillimeters(element.width),
          height: dotsToMillimeters(element.height),
          strokeWidth: dotsToMillimeters(element.strokeWidth),
          fill: element.fill,
          stroke: element.stroke,
          rotation: element.rotation,
          meta,
        })
      case "line":
        return canvasDraftElementSchema.parse({
          id: `line-${createId("draft")}`,
          kind: "line",
          x: dotsToMillimeters(element.x1),
          y: dotsToMillimeters(element.y1),
          x2: dotsToMillimeters(element.x2),
          y2: dotsToMillimeters(element.y2),
          strokeWidth: dotsToMillimeters(element.strokeWidth),
          stroke: element.stroke,
          meta,
        })
      case "barcode":
        return canvasDraftElementSchema.parse({
          id: `barcode-${createId("draft")}`,
          kind: "barcode",
          x: dotsToMillimeters(element.x),
          y: dotsToMillimeters(element.y),
          width: dotsToMillimeters(element.width),
          height: dotsToMillimeters(element.height),
          value:
            templatePackage.sampleInput[element.key] ?? field?.defaultValue ?? element.value ?? "",
          format: element.format,
          showValue: element.showValue,
          rotation: element.rotation,
          binding: field ? { fieldKey: field.key, kind: "barcode" } : undefined,
          meta,
        })
      case "qr":
        return canvasDraftElementSchema.parse({
          id: `qr-${createId("draft")}`,
          kind: "qr",
          x: dotsToMillimeters(element.x),
          y: dotsToMillimeters(element.y),
          size: dotsToMillimeters(element.size),
          value:
            templatePackage.sampleInput[element.key] ?? field?.defaultValue ?? element.value ?? "",
          errorCorrectionLevel: element.errorCorrectionLevel,
          rotation: element.rotation,
          binding: field ? { fieldKey: field.key, kind: "qr" } : undefined,
          meta,
        })
      case "datamatrix":
        return canvasDraftElementSchema.parse({
          id: `datamatrix-${createId("draft")}`,
          kind: "datamatrix",
          x: dotsToMillimeters(element.x),
          y: dotsToMillimeters(element.y),
          size: dotsToMillimeters(element.size),
          value:
            templatePackage.sampleInput[element.key] ?? field?.defaultValue ?? element.value ?? "",
          rotation: element.rotation,
          binding: field ? { fieldKey: field.key, kind: "datamatrix" } : undefined,
          meta,
        })
      default:
        throw new Error("Unsupported template element kind")
    }
  })
  const synced = syncDraftBindings(fields, elements)
  return canvasDraftDocumentSchema.parse({
    version: 1,
    unit: "mm",
    id: `shared-template-${templateId}`,
    presetId: templatePackage.id,
    name: options?.name ?? templatePackage.name,
    source: {
      kind: "user-template",
      templateId,
    },
    templateId,
    width: dotsToMillimeters(templatePackage.canvas.width),
    height: dotsToMillimeters(templatePackage.canvas.height),
    renderOptions: templatePackage.renderOptions,
    recommendedUse: templatePackage.recommendedUse,
    fields: synced.fields,
    elements: synced.elements,
    editor: {
      gridEnabled: true,
      gridSize: 1,
      snapEnabled: true,
      snapStep: 1,
    },
  })
}

function compileFilledCanvasFromDraft(
  document: CanvasDraftDocument,
  input: Record<string, string>
): DirectCanvasDefinition {
  const fieldDefaults = new Map<string, string>(
    document.fields.map((field) => [field.key, input[field.key] ?? field.defaultValue ?? ""])
  )
  const elements = document.elements
    .filter((element) => element.meta.visible)
    .map((element) => {
      const resolvedValue =
        "binding" in element && element.binding
          ? (fieldDefaults.get(element.binding.fieldKey) ?? element.value)
          : "value" in element
            ? element.value
            : undefined
      const resolvedKey =
        "binding" in element && element.binding ? element.binding.fieldKey : element.id
      switch (element.kind) {
        case "text":
          return {
            kind: "text",
            key: resolvedKey,
            x: millimetersToDots(element.x),
            y: millimetersToDots(element.y),
            width: millimetersToDots(element.width),
            height: millimetersToDots(element.height),
            fontSize: millimetersToDots(element.fontSize),
            fontFamily:
              element.fontFamily as DirectCanvasDefinition["elements"][number] extends infer T
                ? T extends { kind: "text"; fontFamily?: infer TFontFamily }
                  ? TFontFamily
                  : never
                : never,
            lineHeight: element.lineHeight,
            fontWeight: element.fontWeight,
            align: element.align,
            justifyAlign: element.justifyAlign,
            verticalAlign: element.verticalAlign,
            stretchXGrow: element.stretchXGrow,
            stretchXShrink: element.stretchXShrink,
            stretchYGrow: element.stretchYGrow,
            stretchYShrink: element.stretchYShrink,
            autoWrap: element.autoWrap,
            adaptiveFontSize: element.adaptiveFontSize,
            verticalText: element.verticalText,
            value: resolvedValue ?? "",
            maxLines: element.maxLines,
            rotation: element.rotation ?? 0,
          } as DirectCanvasDefinition["elements"][number]
        case "rect":
          return {
            kind: "rect",
            x: millimetersToDots(element.x),
            y: millimetersToDots(element.y),
            width: millimetersToDots(element.width),
            height: millimetersToDots(element.height),
            strokeWidth: millimetersToDots(element.strokeWidth),
            fill: element.fill,
            stroke: element.stroke,
            radius: millimetersToDots(element.radius),
            rotation: element.rotation ?? 0,
          } as DirectCanvasDefinition["elements"][number]
        case "circle":
          return {
            kind: "circle",
            x: millimetersToDots(element.x),
            y: millimetersToDots(element.y),
            size: millimetersToDots(element.size),
            strokeWidth: millimetersToDots(element.strokeWidth),
            fill: element.fill,
            stroke: element.stroke,
          } as DirectCanvasDefinition["elements"][number]
        case "triangle":
          return {
            kind: "triangle",
            x: millimetersToDots(element.x),
            y: millimetersToDots(element.y),
            width: millimetersToDots(element.width),
            height: millimetersToDots(element.height),
            strokeWidth: millimetersToDots(element.strokeWidth),
            fill: element.fill,
            stroke: element.stroke,
            rotation: element.rotation ?? 0,
          } as DirectCanvasDefinition["elements"][number]
        case "line":
          return {
            kind: "line",
            x1: millimetersToDots(element.x),
            y1: millimetersToDots(element.y),
            x2: millimetersToDots(element.x2),
            y2: millimetersToDots(element.y2),
            strokeWidth: millimetersToDots(element.strokeWidth),
            stroke: element.stroke,
          } as DirectCanvasDefinition["elements"][number]
        case "barcode":
          return {
            kind: "barcode",
            key: resolvedKey,
            x: millimetersToDots(element.x),
            y: millimetersToDots(element.y),
            width: millimetersToDots(element.width),
            height: millimetersToDots(element.height),
            value: resolvedValue ?? "",
            format: element.format,
            showValue: element.showValue,
            rotation: element.rotation ?? 0,
          } as DirectCanvasDefinition["elements"][number]
        case "qr":
          return {
            kind: "qr",
            key: resolvedKey,
            x: millimetersToDots(element.x),
            y: millimetersToDots(element.y),
            size: millimetersToDots(element.size),
            value: resolvedValue ?? "",
            errorCorrectionLevel: element.errorCorrectionLevel,
            rotation: element.rotation ?? 0,
          } as DirectCanvasDefinition["elements"][number]
        case "datamatrix":
          return {
            kind: "datamatrix",
            key: resolvedKey,
            x: millimetersToDots(element.x),
            y: millimetersToDots(element.y),
            size: millimetersToDots(element.size),
            value: resolvedValue ?? "",
            rotation: element.rotation ?? 0,
          } as DirectCanvasDefinition["elements"][number]
        default:
          throw new Error("Unsupported draft element kind")
      }
    }) as DirectCanvasDefinition["elements"]
  return {
    id: document.id,
    name: document.name,
    width: millimetersToDots(document.width),
    height: millimetersToDots(document.height),
    elements,
  }
}

async function readJsonFile<T>(filePath: string, parser: (value: unknown) => T): Promise<T | null> {
  try {
    return parser(JSON.parse(await readFile(filePath, "utf8")))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null
    }
    throw error
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

async function listChildDirectories(rootPath: string): Promise<string[]> {
  try {
    const entries = await readdir(rootPath, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []
    }
    throw error
  }
}

async function listJsonFiles(rootPath: string): Promise<string[]> {
  try {
    const entries = await readdir(rootPath, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(rootPath, entry.name))
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []
    }
    throw error
  }
}

function buildSourceKey(templateId: string): string {
  return `user-template:${templateId}`
}

function getTemplateRoot(dataDir: string, templateId: string): string {
  return path.join(dataDir, TEMPLATES_ROOT, templateId)
}

function getTemplateRecordPath(dataDir: string, templateId: string): string {
  return path.join(getTemplateRoot(dataDir, templateId), "template.json")
}

function getTemplateWorkingCopyPath(dataDir: string, templateId: string): string {
  return path.join(getTemplateRoot(dataDir, templateId), "working-copy.json")
}

function getTemplateVersionsRoot(dataDir: string, templateId: string): string {
  return path.join(getTemplateRoot(dataDir, templateId), "versions")
}

async function readTemplateVersions(
  dataDir: string,
  templateId: string
): Promise<SharedUserTemplateVersion[]> {
  const files = await listJsonFiles(getTemplateVersionsRoot(dataDir, templateId))
  const versions = await Promise.all(
    files.map(async (filePath) =>
      userTemplateVersionSchema.parse(JSON.parse(await readFile(filePath, "utf8")))
    )
  )
  return versions.sort(
    (left, right) => right.createdAt.localeCompare(left.createdAt) || right.version - left.version
  )
}

async function readTemplateSummary(
  dataDir: string,
  templateId: string
): Promise<SharedUserTemplateSummary | null> {
  const record = await readJsonFile(
    getTemplateRecordPath(dataDir, templateId),
    userTemplateRecordSchema.parse
  )
  if (!record) {
    return null
  }
  const workingCopy = await readJsonFile(
    getTemplateWorkingCopyPath(dataDir, templateId),
    canvasWorkingCopyIndexEntrySchema.parse
  )
  const currentVersion = await readJsonFile(
    path.join(getTemplateVersionsRoot(dataDir, templateId), `${record.currentVersionId}.json`),
    userTemplateVersionSchema.parse
  )
  const document = workingCopy?.draft ?? currentVersion?.document ?? null
  return {
    ...record,
    source: "user-template",
    fields: document?.fields ?? [],
    document,
  }
}

function resolveInventoryMaterialsRoot(dataDir: string): string {
  return path.join(dataDir, INVENTORY_MATERIALS_ROOT)
}

function resolveInventoryAdjustmentsRoot(dataDir: string): string {
  return path.join(dataDir, INVENTORY_ADJUSTMENTS_ROOT)
}

function resolveInventoryTransactionsRoot(dataDir: string): string {
  return path.join(dataDir, INVENTORY_TRANSACTIONS_ROOT)
}

function resolveAgentImportTransactionsRoot(dataDir: string): string {
  return path.join(dataDir, AGENT_IMPORT_TRANSACTIONS_ROOT)
}

async function readInventoryEntries<T>(
  rootPath: string,
  parser: (value: unknown) => T
): Promise<T[]> {
  const files = await listJsonFiles(rootPath)
  const values = await Promise.all(
    files.map(async (filePath) => parser(JSON.parse(await readFile(filePath, "utf8"))))
  )
  return values
}

async function ensureDataDirExists(dataDir: string): Promise<string> {
  const resolved = path.resolve(dataDir)
  await mkdir(resolved, { recursive: true })
  return resolved
}

async function writeDataDirectoryManifest(dataDir: string): Promise<void> {
  const templateIds = await listChildDirectories(path.join(dataDir, TEMPLATES_ROOT))
  const templateCounts = await Promise.all(
    templateIds.map(async (templateId) => {
      const templateRoot = getTemplateRoot(dataDir, templateId)
      const topLevelFiles = await listJsonFiles(templateRoot)
      const versions = await listJsonFiles(getTemplateVersionsRoot(dataDir, templateId))
      return {
        templates: topLevelFiles.some((filePath) => path.basename(filePath) === "template.json")
          ? 1
          : 0,
        workingCopies: topLevelFiles.some(
          (filePath) => path.basename(filePath) === "working-copy.json"
        )
          ? 1
          : 0,
        versions: versions.length,
      }
    })
  )
  const generatedAt = new Date().toISOString()
  const manifest = dataDirectoryManifestSchema.parse({
    schema: DATA_DIRECTORY_MANIFEST_SCHEMA,
    generatedAt,
    snapshotUpdatedAt: generatedAt,
    source: "runtime-sync",
    files: {
      settings: "settings/app-settings.json",
      templatesDir: TEMPLATES_ROOT,
      draftsDir: "drafts",
      inventoryDir: "inventory",
      backupsDir: "backups",
    },
    counts: {
      templates: templateCounts.reduce((total, count) => total + count.templates, 0),
      versions: templateCounts.reduce((total, count) => total + count.versions, 0),
      workingCopies: templateCounts.reduce((total, count) => total + count.workingCopies, 0),
      materials: (await listJsonFiles(resolveInventoryMaterialsRoot(dataDir))).length,
      adjustments: (await listJsonFiles(resolveInventoryAdjustmentsRoot(dataDir))).length,
    },
  })
  await writeJsonFile(path.join(dataDir, DATA_DIRECTORY_MANIFEST_PATH), manifest)
}

async function ensureDataDirectoryManifest(dataDir: string): Promise<void> {
  const manifest = await readJsonFile(
    path.join(dataDir, DATA_DIRECTORY_MANIFEST_PATH),
    dataDirectoryManifestSchema.parse
  )
  if (!manifest) {
    await writeDataDirectoryManifest(dataDir)
  }
}

function resolveAgentImportWritePath(dataDir: string, relativePath: string): string {
  const resolvedDataDir = path.resolve(dataDir)
  const resolved = path.resolve(resolvedDataDir, relativePath)
  const permittedRoot = relativePath.split("/")[0]
  if (
    (permittedRoot !== "inventory" && permittedRoot !== "templates") ||
    !resolved.startsWith(`${resolvedDataDir}${path.sep}`)
  ) {
    throw new Error("Invalid agent import transaction path.")
  }
  return resolved
}

async function recoverAgentImportTransactions(dataDir: string): Promise<void> {
  const transactionPaths = await listJsonFiles(resolveAgentImportTransactionsRoot(dataDir))
  for (const transactionPath of transactionPaths) {
    const transaction = agentImportTransactionSchema.parse(
      JSON.parse(await readFile(transactionPath, "utf8"))
    )
    for (const write of transaction.writes) {
      await writeJsonFile(resolveAgentImportWritePath(dataDir, write.relativePath), write.value)
    }
    await rm(transactionPath, { force: true })
  }
  if (transactionPaths.length > 0) {
    await writeDataDirectoryManifest(dataDir)
  }
}

async function recoverInventoryAdjustmentTransactions(dataDir: string): Promise<void> {
  await recoverAgentImportTransactions(dataDir)
  const transactions = await readInventoryEntries(
    resolveInventoryTransactionsRoot(dataDir),
    inventoryAdjustmentTransactionSchema.parse
  )
  for (const transaction of transactions) {
    await writeJsonFile(
      path.join(resolveInventoryMaterialsRoot(dataDir), `${transaction.material.id}.json`),
      transaction.material
    )
    await writeJsonFile(
      path.join(resolveInventoryAdjustmentsRoot(dataDir), `${transaction.adjustment.id}.json`),
      transaction.adjustment
    )
    await rm(
      path.join(resolveInventoryTransactionsRoot(dataDir), `${transaction.adjustment.id}.json`),
      { force: true }
    )
  }
  if (transactions.length > 0) {
    await writeDataDirectoryManifest(dataDir)
  }
}

async function commitInventoryAdjustmentTransaction(args: {
  dataDir: string
  material: InventoryMaterial
  adjustment: InventoryAdjustment
}): Promise<void> {
  const transaction = inventoryAdjustmentTransactionSchema.parse({
    schema: "tuckmark.inventory-adjustment-transaction.v1",
    material: args.material,
    adjustment: args.adjustment,
  })
  await writeJsonFile(
    path.join(resolveInventoryTransactionsRoot(args.dataDir), `${args.adjustment.id}.json`),
    transaction
  )
  await writeJsonFile(
    path.join(resolveInventoryAdjustmentsRoot(args.dataDir), `${args.adjustment.id}.json`),
    args.adjustment
  )
  await writeJsonFile(
    path.join(resolveInventoryMaterialsRoot(args.dataDir), `${args.material.id}.json`),
    args.material
  )
  await rm(
    path.join(resolveInventoryTransactionsRoot(args.dataDir), `${args.adjustment.id}.json`),
    { force: true }
  )
}

export async function readCliConfig(): Promise<CliConfig> {
  const raw = await readJsonFile(CLI_CONFIG_PATH, cliConfigSchema.parse)
  return raw ?? { version: 1 }
}

export async function getSavedCliDataDir(): Promise<string | null> {
  const config = await readCliConfig()
  return config.dataDir ? path.resolve(config.dataDir) : null
}

export async function setSavedCliDataDir(dataDir: string): Promise<string> {
  const resolved = await ensureDataDirExists(dataDir)
  await ensureDataDirectoryManifest(resolved)
  await mkdir(path.dirname(CLI_CONFIG_PATH), { recursive: true })
  await writeJsonFile(CLI_CONFIG_PATH, {
    version: 1,
    dataDir: resolved,
  } satisfies CliConfig)
  return resolved
}

export async function resolveCliDataDir(explicitDataDir?: string): Promise<string> {
  if (explicitDataDir?.trim()) {
    return await ensureDataDirExists(explicitDataDir)
  }
  const saved = await getSavedCliDataDir()
  if (saved) {
    return await ensureDataDirExists(saved)
  }
  throw new Error(
    "Data directory is not configured. Run `tuckmark config set-data-dir --path <dir>` first."
  )
}

export async function listSharedUserTemplates(args: {
  dataDir: string
  includeArchived?: boolean
}): Promise<SharedUserTemplateSummary[]> {
  const templateIds = await listChildDirectories(path.join(args.dataDir, TEMPLATES_ROOT))
  const templates = (
    await Promise.all(
      templateIds.map((templateId) => readTemplateSummary(args.dataDir, templateId))
    )
  ).filter((template): template is SharedUserTemplateSummary => Boolean(template))
  return templates
    .filter((template) => (args.includeArchived ? true : !template.archivedAt))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export async function readSharedUserTemplateDetail(
  dataDir: string,
  templateId: string
): Promise<SharedUserTemplateDetail | null> {
  const template = await readTemplateSummary(dataDir, templateId)
  if (!template) {
    return null
  }
  const workingCopy = await readJsonFile(
    getTemplateWorkingCopyPath(dataDir, templateId),
    canvasWorkingCopyIndexEntrySchema.parse
  )
  const versions = await readTemplateVersions(dataDir, templateId)
  return {
    template,
    workingCopy,
    savedVersions: versions.filter((version) => version.kind === "saved"),
    autosaves: versions.filter((version) => version.kind === "autosave"),
  }
}

export async function importSharedUserTemplatePackage(args: {
  dataDir: string
  templatePackage: UserTemplatePackage
  templateId?: string
  name?: string
  description?: string
}): Promise<SharedUserTemplateDetail> {
  await ensureDataDirectoryManifest(args.dataDir)
  const templateId = args.templateId ?? args.templatePackage.id
  const existing = await readTemplateSummary(args.dataDir, templateId)
  if (existing) {
    throw new Error(`User template ${templateId} already exists.`)
  }
  const now = new Date().toISOString()
  const draft = createDraftFromUserTemplatePackage(args.templatePackage, {
    templateId,
    ...(args.name ? { name: args.name } : {}),
    ...(args.description ? { description: args.description } : {}),
  })
  draft.templateId = templateId
  draft.source = {
    kind: "user-template",
    templateId,
  }
  draft.lastSavedAt = now
  const version: SharedUserTemplateVersion = userTemplateVersionSchema.parse({
    id: createId("user-template-version"),
    templateId,
    version: 1,
    kind: "saved",
    createdAt: now,
    label: "Imported version 1",
    document: draft,
  })
  const record: SharedUserTemplateRecord = userTemplateRecordSchema.parse({
    id: templateId,
    name: args.name ?? args.templatePackage.name,
    description: args.description ?? args.templatePackage.description,
    width: draft.width,
    height: draft.height,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    currentVersionId: version.id,
    fieldOrder: draft.fields.map((field) => field.key),
    recommendedUse: args.templatePackage.recommendedUse,
  })
  const workingCopy: CanvasWorkingCopyIndexEntry = canvasWorkingCopyIndexEntrySchema.parse({
    sourceKey: buildSourceKey(templateId),
    source: {
      kind: "user-template",
      templateId,
    },
    templateId,
    draft,
    updatedAt: now,
    baseVersionId: version.id,
  })
  await writeJsonFile(getTemplateRecordPath(args.dataDir, templateId), record)
  await writeJsonFile(
    path.join(getTemplateVersionsRoot(args.dataDir, templateId), `${version.id}.json`),
    version
  )
  await writeJsonFile(getTemplateWorkingCopyPath(args.dataDir, templateId), workingCopy)
  await writeDataDirectoryManifest(args.dataDir)
  return (
    (await readSharedUserTemplateDetail(args.dataDir, templateId)) ??
    (() => {
      throw new Error("Imported template could not be reloaded.")
    })()
  )
}

export async function renameSharedUserTemplate(args: {
  dataDir: string
  templateId: string
  name: string
}): Promise<SharedUserTemplateSummary> {
  await ensureDataDirectoryManifest(args.dataDir)
  const detail = await readSharedUserTemplateDetail(args.dataDir, args.templateId)
  if (!detail) {
    throw new Error("User template not found.")
  }
  const now = new Date().toISOString()
  const nextRecord = userTemplateRecordSchema.parse({
    ...detail.template,
    name: args.name,
    updatedAt: now,
  })
  await writeJsonFile(getTemplateRecordPath(args.dataDir, args.templateId), nextRecord)
  if (detail.workingCopy) {
    await writeJsonFile(getTemplateWorkingCopyPath(args.dataDir, args.templateId), {
      ...detail.workingCopy,
      updatedAt: now,
      draft: {
        ...detail.workingCopy.draft,
        name: args.name,
      },
    })
  }
  await writeDataDirectoryManifest(args.dataDir)
  const summary = await readTemplateSummary(args.dataDir, args.templateId)
  if (!summary) {
    throw new Error("User template rename did not persist.")
  }
  return summary
}

export async function archiveSharedUserTemplate(
  dataDir: string,
  templateId: string
): Promise<SharedUserTemplateSummary> {
  await ensureDataDirectoryManifest(dataDir)
  const detail = await readSharedUserTemplateDetail(dataDir, templateId)
  if (!detail) {
    throw new Error("User template not found.")
  }
  const now = new Date().toISOString()
  await writeJsonFile(getTemplateRecordPath(dataDir, templateId), {
    ...detail.template,
    archivedAt: now,
    updatedAt: now,
  })
  await writeDataDirectoryManifest(dataDir)
  const summary = await readTemplateSummary(dataDir, templateId)
  if (!summary) {
    throw new Error("User template archive did not persist.")
  }
  return summary
}

export async function restoreSharedUserTemplate(
  dataDir: string,
  templateId: string
): Promise<SharedUserTemplateSummary> {
  await ensureDataDirectoryManifest(dataDir)
  const detail = await readSharedUserTemplateDetail(dataDir, templateId)
  if (!detail) {
    throw new Error("User template not found.")
  }
  const now = new Date().toISOString()
  await writeJsonFile(getTemplateRecordPath(dataDir, templateId), {
    ...detail.template,
    archivedAt: null,
    updatedAt: now,
  })
  await writeDataDirectoryManifest(dataDir)
  const summary = await readTemplateSummary(dataDir, templateId)
  if (!summary) {
    throw new Error("User template restore did not persist.")
  }
  return summary
}

export async function deleteSharedUserTemplate(dataDir: string, templateId: string): Promise<void> {
  await ensureDataDirectoryManifest(dataDir)
  const detail = await readSharedUserTemplateDetail(dataDir, templateId)
  if (!detail) {
    throw new Error("User template not found.")
  }
  await rm(getTemplateRoot(dataDir, templateId), { recursive: true, force: true })
  await writeDataDirectoryManifest(dataDir)
}

export async function resolveTemplateForPrint(args: {
  dataDir: string
  templateId: string
  input: Record<string, string>
  renderOptions?: Partial<RenderOptions>
}): Promise<ResolvedUserTemplatePrintSource> {
  const detail = await readSharedUserTemplateDetail(args.dataDir, args.templateId)
  if (!detail?.template.document) {
    throw new Error("User template does not have a printable canvas document.")
  }
  const renderOptions = mergeRenderOptions(
    detail.template.document.renderOptions as Partial<RenderOptions> | undefined,
    args.renderOptions
  )
  return {
    kind: "user-template",
    canvas: compileFilledCanvasFromDraft(detail.template.document, args.input),
    ...(renderOptions ? { renderOptions } : {}),
  }
}

function sanitizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function ensureMaterialUniqueness(
  materials: readonly InventoryMaterial[],
  draft: InventoryMaterial
): void {
  const fullNameCollision = materials.find(
    (material) => material.id !== draft.id && material.fullName === draft.fullName
  )
  if (fullNameCollision) {
    throw new Error(`Material ${draft.fullName} already exists.`)
  }

  if (draft.matrixCode?.trim()) {
    const matrixCodeCollision = materials.find(
      (material) => material.id !== draft.id && material.matrixCode === draft.matrixCode
    )
    if (matrixCodeCollision) {
      throw new Error(
        `Matrix code ${draft.matrixCode} is already used by ${matrixCodeCollision.fullName}.`
      )
    }
  }
}

export type InventoryMaterialSaveArgs = {
  id?: string
  fullName: string
  baseName?: string
  variantName?: string
  packageName?: string
  description?: string
  matrixCode?: string
  packagingRemark?: string
  labelBindings?: InventoryMaterial["labelBindings"]
  datasheets?: InventoryMaterial["datasheets"]
}

export async function listInventoryMaterialsFromDirectory(args: {
  dataDir: string
  query?: string
  includeArchived?: boolean
}): Promise<InventoryMaterial[]> {
  await recoverInventoryAdjustmentTransactions(args.dataDir)
  const materials = await readInventoryEntries(
    resolveInventoryMaterialsRoot(args.dataDir),
    inventoryMaterialSchema.parse
  )
  return materials
    .filter((material) => (args.includeArchived ? true : !material.archivedAt))
    .filter((material) => materialMatchesQuery(material, args.query ?? ""))
    .sort(sortInventoryMaterialsByName)
}

export async function readInventoryMaterialFromDirectory(
  dataDir: string,
  materialId: string
): Promise<InventoryMaterial | null> {
  const materials = await listInventoryMaterialsFromDirectory({
    dataDir,
    includeArchived: true,
  })
  return materials.find((material) => material.id === materialId) ?? null
}

export async function listInventoryAdjustmentsFromDirectory(args: {
  dataDir: string
  materialId?: string
}): Promise<InventoryAdjustment[]> {
  await recoverInventoryAdjustmentTransactions(args.dataDir)
  const adjustments = await readInventoryEntries(
    resolveInventoryAdjustmentsRoot(args.dataDir),
    inventoryAdjustmentSchema.parse
  )
  return adjustments
    .filter((adjustment) => !args.materialId || adjustment.materialId === args.materialId)
    .sort(sortInventoryAdjustmentsNewestFirst)
}

export async function saveInventoryMaterialToDirectory(args: {
  dataDir: string
  material: InventoryMaterialSaveArgs
}): Promise<InventoryMaterial> {
  await ensureDataDirectoryManifest(args.dataDir)
  const materials = await listInventoryMaterialsFromDirectory({
    dataDir: args.dataDir,
    includeArchived: true,
  })
  const existing = args.material.id
    ? (materials.find((material) => material.id === args.material.id) ?? null)
    : null
  if (existing) {
    ensureInventoryMaterialActive(existing, "编辑")
  }
  const now = new Date().toISOString()
  const material = inventoryMaterialSchema.parse({
    id: args.material.id ?? createId("inventory-material"),
    fullName: args.material.fullName.trim(),
    baseName: sanitizeOptionalText(args.material.baseName),
    variantName: sanitizeOptionalText(args.material.variantName),
    packageName: sanitizeOptionalText(args.material.packageName),
    description: args.material.description?.trim() ?? "",
    matrixCode: sanitizeOptionalText(args.material.matrixCode),
    packagingRemark: args.material.packagingRemark?.trim() ?? "",
    currentQuantity: existing?.currentQuantity ?? 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    archivedAt: existing?.archivedAt ?? null,
    labelBindings: args.material.labelBindings ?? existing?.labelBindings ?? [],
    datasheets: args.material.datasheets ?? existing?.datasheets ?? [],
  })
  ensureMaterialUniqueness(materials, material)
  await writeJsonFile(
    path.join(resolveInventoryMaterialsRoot(args.dataDir), `${material.id}.json`),
    material
  )
  await writeDataDirectoryManifest(args.dataDir)
  return material
}

export async function archiveInventoryMaterialInDirectory(
  dataDir: string,
  materialId: string
): Promise<InventoryMaterial> {
  await ensureDataDirectoryManifest(dataDir)
  const material = await readInventoryMaterialFromDirectory(dataDir, materialId)
  if (!material) {
    throw new Error("Material not found.")
  }
  ensureInventoryMaterialActive(material, "归档")
  await writeJsonFile(path.join(resolveInventoryMaterialsRoot(dataDir), `${material.id}.json`), {
    ...material,
    archivedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  await writeDataDirectoryManifest(dataDir)
  return (
    (await readInventoryMaterialFromDirectory(dataDir, materialId)) ??
    (() => {
      throw new Error("Material archive did not persist.")
    })()
  )
}

export async function restoreInventoryMaterialInDirectory(
  dataDir: string,
  materialId: string
): Promise<InventoryMaterial> {
  await ensureDataDirectoryManifest(dataDir)
  const materials = await listInventoryMaterialsFromDirectory({
    dataDir,
    includeArchived: true,
  })
  const material = materials.find((entry) => entry.id === materialId)
  if (!material) {
    throw new Error("Material not found.")
  }
  const restored = inventoryMaterialSchema.parse({
    ...material,
    archivedAt: null,
    updatedAt: new Date().toISOString(),
  })
  ensureMaterialUniqueness(materials, restored)
  await writeJsonFile(
    path.join(resolveInventoryMaterialsRoot(dataDir), `${material.id}.json`),
    restored
  )
  await writeDataDirectoryManifest(dataDir)
  return restored
}

export async function deleteInventoryMaterialFromDirectory(
  dataDir: string,
  materialId: string
): Promise<void> {
  await ensureDataDirectoryManifest(dataDir)
  const material = await readInventoryMaterialFromDirectory(dataDir, materialId)
  if (!material) {
    throw new Error("Material not found.")
  }
  const adjustments = await listInventoryAdjustmentsFromDirectory({ dataDir, materialId })
  ensureInventoryMaterialDeletionAllowed({ material, adjustments })
  await rm(path.join(resolveInventoryMaterialsRoot(dataDir), `${material.id}.json`), {
    force: true,
  })
  await writeDataDirectoryManifest(dataDir)
}

export async function adjustInventoryMaterialInDirectory(args: {
  dataDir: string
  materialId: string
  input: InventoryAdjustmentInput
}): Promise<{
  material: InventoryMaterial
  adjustment: InventoryAdjustment
}> {
  await ensureDataDirectoryManifest(args.dataDir)
  const material = await readInventoryMaterialFromDirectory(args.dataDir, args.materialId)
  if (!material) {
    throw new Error("Material not found.")
  }
  ensureInventoryMaterialActive(material, "调整库存")
  const result = applyInventoryAdjustment({
    material,
    input: args.input,
    adjustmentId: createId("inventory-adjustment"),
  })
  await commitInventoryAdjustmentTransaction({
    dataDir: args.dataDir,
    material: result.material,
    adjustment: result.adjustment,
  })
  await writeDataDirectoryManifest(args.dataDir)
  return result
}

export async function resolveInventoryPrintSource(args: {
  dataDir: string
  materialId: string
  bindingId: string
  quantity?: number
  renderOptions?: Partial<RenderOptions>
}): Promise<InventoryPrintSource> {
  const material = await readInventoryMaterialFromDirectory(args.dataDir, args.materialId)
  if (!material) {
    throw new Error("Material not found.")
  }
  ensureInventoryMaterialActive(material, "打印标签")
  const binding = material.labelBindings.find((entry) => entry.id === args.bindingId)
  if (!binding) {
    throw new Error("Template binding not found on material.")
  }
  const copies = args.quantity ?? binding.printQuantity
  if (!Number.isInteger(copies) || copies < 1) {
    throw new Error("Print quantity must be a positive integer.")
  }
  const input = {
    ...buildInventoryTemplateInput(material, binding),
    currentQuantity: String(material.currentQuantity),
  }
  if (binding.templateSource === "system") {
    const renderOptions = mergeRenderOptions(args.renderOptions)
    return {
      kind: "system-template",
      templateId: binding.templateId,
      input,
      copies,
      ...(renderOptions ? { renderOptions } : {}),
    }
  }
  const resolved = await resolveTemplateForPrint({
    dataDir: args.dataDir,
    templateId: binding.templateId,
    input,
    ...(args.renderOptions ? { renderOptions: args.renderOptions } : {}),
  })
  return { ...resolved, copies }
}

export function createInventoryAdjustmentInput(args: {
  kind: InventoryAdjustmentInput["kind"]
  quantity?: number
  targetQuantity?: number
  note?: string
  actor?: string
}): InventoryAdjustmentInput {
  const note = args.note?.trim() ?? ""
  const actor = args.actor ?? "cli"
  if (args.kind === "correction") {
    if (
      args.targetQuantity === undefined ||
      !Number.isInteger(args.targetQuantity) ||
      args.targetQuantity < 0
    ) {
      throw new Error("Correction adjustments require a non-negative --target-quantity.")
    }
    return {
      kind: "correction",
      targetQuantity: args.targetQuantity,
      note,
      actor,
    }
  }
  if (args.quantity === undefined || !Number.isInteger(args.quantity) || args.quantity < 1) {
    throw new Error("In and out adjustments require a positive --quantity.")
  }
  return {
    kind: args.kind,
    quantity: args.quantity,
    note,
    actor,
  }
}

export function createTemplateBindingLookup(
  material: InventoryMaterial
): Record<string, InventoryTemplateBinding> {
  return Object.fromEntries(material.labelBindings.map((binding) => [binding.id, binding]))
}
