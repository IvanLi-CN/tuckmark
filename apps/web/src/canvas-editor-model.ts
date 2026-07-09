import {
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_VERTICAL_ALIGN,
  type DirectCanvasDefinition,
  getTextNaturalHeight,
  normalizeTextLineHeight,
  presetTemplateData,
  resolveTextLayout,
  type TemplateDefinition,
  type UserTemplatePackage,
} from "../../../packages/core/src/web.js"

import type { BrowserPrintSource } from "./browser-print-payload.js"
import {
  CANVAS_DOTS_PER_MILLIMETER,
  canvasDotsToMillimeters,
  canvasDraftDocumentToDots,
  normalizeCanvasDraftDocumentUnits,
  scaleTemplateElementGeometry,
} from "./lib/canvas-units.js"
import type {
  CanvasDocumentPreset,
  CanvasDraftDocument,
  CanvasDraftElement,
  CanvasDraftField,
  CanvasDraftSource,
  CanvasElement,
  RenderOptions,
} from "./types.js"

export const CANVAS_PRESETS: CanvasDocumentPreset[] = [
  {
    id: "shipping-wide",
    name: "快递单宽版",
    width: 48,
    height: 28,
    description: "适合完整收件信息与条码。",
  },
  {
    id: "ops-tag",
    name: "机柜标签",
    width: 48,
    height: 20,
    description: "适合短文本、二维码与设备标识。",
  },
  {
    id: "compact-note",
    name: "紧凑便签",
    width: 40,
    height: 16,
    description: "适合短说明和操作提示。",
  },
]

export const CANVAS_TOOL_LABELS: Record<CanvasElement["kind"], string> = {
  text: "文本",
  rect: "矩形",
  circle: "圆形",
  triangle: "三角形",
  line: "线段",
  barcode: "条码",
  qr: "二维码",
  datamatrix: "数据矩阵码",
}

export const CANVAS_HISTORY_LIMIT = 50
export const CANVAS_MIN_WIDTH = 960
export const CANVAS_WIDE_THRESHOLD = 1280

const DRAFT_STORAGE_VERSION = 1
const DRAFT_STORAGE_PREFIX = `tuckmark:canvas-draft:v${DRAFT_STORAGE_VERSION}:`
const MONO_FILL = "none"
const MONO_STROKE = "#111111"
const MONO_SOLID_FILL = "#111111"
const STATIC_TEMPLATE_KEY_PREFIX = "__"

type CanvasBounds = {
  x: number
  y: number
  width: number
  height: number
}

type CanvasPoint = {
  x: number
  y: number
}

function assertNever(value: never): never {
  throw new Error(`unexpected canvas element: ${JSON.stringify(value)}`)
}

export type CanvasElementGeometry = {
  bounds: CanvasBounds
  localBounds: CanvasBounds
  rotationOrigin: CanvasPoint
  stagePosition: CanvasPoint
}

function rotatePoint(point: CanvasPoint, origin: CanvasPoint, rotation: number): CanvasPoint {
  if (!rotation) {
    return point
  }

  const radians = (rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const offsetX = point.x - origin.x
  const offsetY = point.y - origin.y

  return {
    x: origin.x + offsetX * cos - offsetY * sin,
    y: origin.y + offsetX * sin + offsetY * cos,
  }
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizeRotation(value: number | undefined): number {
  return Number.isFinite(value) ? (value ?? 0) : 0
}

function createLayerMeta(kind: CanvasElement["kind"], index: number) {
  return {
    name: `${CANVAS_TOOL_LABELS[kind]} ${index + 1}`,
    visible: true,
    locked: false,
  }
}

function normalizeMonochromeFill(fill: string | undefined): string {
  const normalized = fill?.trim().toLowerCase()
  if (!normalized || normalized === "none" || normalized === "transparent") {
    return "none"
  }

  if (
    normalized === "#111111" ||
    normalized === "#000" ||
    normalized === "#000000" ||
    normalized === "black"
  ) {
    return MONO_SOLID_FILL
  }

  return "none"
}

function normalizeMonochromeElement(element: CanvasDraftElement): CanvasDraftElement {
  switch (element.kind) {
    case "text": {
      const width = element.width ?? canvasDotsToMillimeters(180)
      const fallbackLayout = resolveTextLayout({
        text: element.value,
        fontSize: element.fontSize,
        width,
        height: element.height ?? getTextNaturalHeight(element.fontSize, 1, element.lineHeight),
        lineHeight: element.lineHeight,
        fontFamily: element.fontFamily,
        fontWeight: element.fontWeight,
        align: element.align,
        maxLines: element.maxLines,
        verticalAlign: element.verticalAlign,
        stretchX: element.stretchX,
        stretchY: element.stretchY,
        autoWrap: element.autoWrap ?? true,
        verticalText: element.verticalText ?? false,
      })
      const hasExplicitHeight = Number.isFinite(element.height)
      const height = hasExplicitHeight ? element.height : fallbackLayout.naturalHeight
      return {
        ...element,
        y: hasExplicitHeight ? element.y : element.y - element.fontSize,
        width,
        height,
        fontFamily: element.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY,
        lineHeight: normalizeTextLineHeight(element.lineHeight),
        verticalAlign: element.verticalAlign ?? DEFAULT_TEXT_VERTICAL_ALIGN,
        stretchX: element.stretchX ?? false,
        stretchY: element.stretchY ?? false,
        autoWrap: element.autoWrap ?? true,
        verticalText: element.verticalText ?? false,
      }
    }
    case "rect":
      return {
        ...element,
        fill: normalizeMonochromeFill(element.fill),
        stroke: MONO_STROKE,
      }
    case "circle":
    case "triangle":
      return {
        ...element,
        fill: normalizeMonochromeFill(element.fill),
        stroke: MONO_STROKE,
      }
    case "line":
      return {
        ...element,
        stroke: MONO_STROKE,
      }
    default:
      return element
  }
}

function isBindableKind(
  element: CanvasDraftElement
): element is Extract<CanvasDraftElement, { kind: "text" | "barcode" | "qr" | "datamatrix" }> {
  return (
    element.kind === "text" ||
    element.kind === "barcode" ||
    element.kind === "qr" ||
    element.kind === "datamatrix"
  )
}

function inferFieldMultiline(element: CanvasDraftElement): boolean {
  return element.kind === "text" ? Math.max(element.maxLines ?? 1, 1) > 1 : false
}

function slugifyFieldKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized || "field"
}

function createUniqueFieldKey(existingKeys: string[], seed: string): string {
  const base = slugifyFieldKey(seed)
  if (!existingKeys.includes(base)) {
    return base
  }
  let index = 2
  while (existingKeys.includes(`${base}-${index}`)) {
    index += 1
  }
  return `${base}-${index}`
}

function syncBindingsIntoElements(
  elements: CanvasDraftElement[],
  fields: CanvasDraftField[],
  source?: CanvasDraftSource
): { elements: CanvasDraftElement[]; fields: CanvasDraftField[] } {
  const fieldMap = new Map<string, CanvasDraftField>(
    fields.map((field) => [field.key, { ...field, bindings: [] }])
  )
  const nextElements = elements.map((element) => {
    if (!isBindableKind(element) || !element.binding) {
      return element
    }
    const field = fieldMap.get(element.binding.fieldKey)
    if (!field) {
      const { binding: _binding, ...rest } = element
      return rest as CanvasDraftElement
    }
    field.bindings.push(element.id)
    const value =
      source?.kind === "preset-template" && field.defaultValue === ""
        ? field.label
        : field.defaultValue
    return {
      ...element,
      value,
    }
  })
  return {
    elements: nextElements,
    fields: Array.from(fieldMap.values()).filter((field) => field.bindings.length > 0),
  }
}

export function normalizeDraftDocument(document: CanvasDraftDocument): CanvasDraftDocument {
  const unitDocument = normalizeCanvasDraftDocumentUnits(document)
  const source =
    unitDocument.source ??
    ({
      kind: "scratch",
      presetId: unitDocument.presetId,
    } as const)
  const fields = Array.isArray(unitDocument.fields) ? unitDocument.fields : []
  const normalizedFields =
    source.kind === "preset-template" &&
    fields.length > 0 &&
    fields.every((field) => field.defaultValue === "")
      ? (() => {
          const template = presetTemplateData.find((item) => item.id === source.presetId)
          if (!template) {
            return fields
          }
          const templateFields = new Map(template.fields.map((field) => [field.key, field]))
          return fields.map((field) => {
            const templateField = templateFields.get(field.key)
            if (!templateField) {
              return field
            }
            return {
              ...field,
              label: field.label || templateField.label,
              defaultValue: templateField.defaultValue ?? "",
            }
          })
        })()
      : fields
  const synced = syncBindingsIntoElements(
    unitDocument.elements.map((element) => normalizeMonochromeElement(element)),
    normalizedFields,
    source
  )
  return {
    ...unitDocument,
    unit: "mm",
    source,
    templateId: unitDocument.templateId,
    baseVersionId: unitDocument.baseVersionId,
    lastSavedAt: unitDocument.lastSavedAt,
    fields: synced.fields,
    elements: synced.elements,
  }
}

export function createCanvasElement(
  kind: CanvasElement["kind"],
  index: number,
  overrides?: Partial<CanvasDraftElement>
): CanvasDraftElement {
  const seedX = canvasDotsToMillimeters(28 + (index % 3) * 18)
  const seedY = canvasDotsToMillimeters(24 + (index % 4) * 16)

  const base = (() => {
    switch (kind) {
      case "text": {
        const fontSize = canvasDotsToMillimeters(24)
        return {
          id: `text-${crypto.randomUUID()}`,
          kind,
          x: seedX,
          y: seedY,
          width: canvasDotsToMillimeters(180),
          height: getTextNaturalHeight(fontSize, 2),
          fontSize,
          fontFamily: DEFAULT_TEXT_FONT_FAMILY,
          lineHeight: DEFAULT_TEXT_LINE_HEIGHT,
          fontWeight: "bold" as const,
          align: "left" as const,
          verticalAlign: DEFAULT_TEXT_VERTICAL_ALIGN,
          stretchX: false,
          stretchY: false,
          autoWrap: true,
          verticalText: false,
          value: "可编辑文本",
          maxLines: 2,
          rotation: 0,
          meta: createLayerMeta(kind, index),
        }
      }
      case "rect":
        return {
          id: `rect-${crypto.randomUUID()}`,
          kind,
          x: seedX,
          y: seedY,
          width: canvasDotsToMillimeters(152),
          height: canvasDotsToMillimeters(68),
          strokeWidth: canvasDotsToMillimeters(2),
          fill: MONO_FILL,
          stroke: MONO_STROKE,
          radius: 0,
          rotation: 0,
          meta: createLayerMeta(kind, index),
        }
      case "circle":
        return {
          id: `circle-${crypto.randomUUID()}`,
          kind,
          x: seedX,
          y: seedY,
          size: canvasDotsToMillimeters(76),
          strokeWidth: canvasDotsToMillimeters(2),
          fill: MONO_FILL,
          stroke: MONO_STROKE,
          meta: createLayerMeta(kind, index),
        }
      case "triangle":
        return {
          id: `triangle-${crypto.randomUUID()}`,
          kind,
          x: seedX,
          y: seedY,
          width: canvasDotsToMillimeters(120),
          height: canvasDotsToMillimeters(86),
          strokeWidth: canvasDotsToMillimeters(2),
          fill: MONO_FILL,
          stroke: MONO_STROKE,
          rotation: 0,
          meta: createLayerMeta(kind, index),
        }
      case "line":
        return {
          id: `line-${crypto.randomUUID()}`,
          kind,
          x: seedX,
          y: seedY + canvasDotsToMillimeters(12),
          x2: seedX + canvasDotsToMillimeters(160),
          y2: seedY + canvasDotsToMillimeters(12),
          strokeWidth: canvasDotsToMillimeters(3),
          stroke: MONO_STROKE,
          meta: createLayerMeta(kind, index),
        }
      case "barcode":
        return {
          id: `barcode-${crypto.randomUUID()}`,
          kind,
          x: seedX,
          y: seedY,
          width: canvasDotsToMillimeters(168),
          height: canvasDotsToMillimeters(52),
          value: "TM-0001",
          format: "CODE128" as const,
          showValue: false,
          rotation: 0,
          meta: createLayerMeta(kind, index),
        }
      case "qr":
        return {
          id: `qr-${crypto.randomUUID()}`,
          kind,
          x: seedX,
          y: seedY,
          size: canvasDotsToMillimeters(76),
          value: "https://tuckmark.local/item/TM-0001",
          errorCorrectionLevel: "M" as const,
          rotation: 0,
          meta: createLayerMeta(kind, index),
        }
      case "datamatrix":
        return {
          id: `datamatrix-${crypto.randomUUID()}`,
          kind,
          x: seedX,
          y: seedY,
          size: canvasDotsToMillimeters(76),
          value: "TM-0001",
          rotation: 0,
          meta: createLayerMeta(kind, index),
        }
    }
  })()

  return normalizeMonochromeElement({
    ...base,
    ...overrides,
    meta: {
      ...base.meta,
      ...overrides?.meta,
    },
  } as CanvasDraftElement)
}

function buildPresetElements(presetId: string): CanvasDraftElement[] {
  const d = canvasDotsToMillimeters
  if (presetId === "ops-tag") {
    return [
      createCanvasElement("rect", 0, {
        width: d(340),
        height: d(118),
        x: d(20),
        y: d(20),
        radius: d(14),
        meta: { name: "容器底板", visible: true, locked: false },
      }),
      createCanvasElement("text", 1, {
        x: d(36),
        y: d(52),
        width: d(180),
        fontSize: d(28),
        value: "LAN-01",
        meta: { name: "设备名称", visible: true, locked: false },
      }),
      createCanvasElement("text", 2, {
        x: d(36),
        y: d(92),
        width: d(180),
        fontSize: d(18),
        fontWeight: "normal",
        value: "Rack A / Gi1/0/1",
        meta: { name: "说明", visible: true, locked: false },
      }),
      createCanvasElement("qr", 3, {
        x: d(268),
        y: d(38),
        size: d(66),
        value: "https://tuckmark.local/rack-a/lan-01",
        meta: { name: "资产二维码", visible: true, locked: false },
      }),
    ]
  }

  if (presetId === "compact-note") {
    return [
      createCanvasElement("text", 0, {
        x: d(20),
        y: d(38),
        width: d(220),
        fontSize: d(24),
        value: "维护窗口",
        meta: { name: "标题", visible: true, locked: false },
      }),
      createCanvasElement("line", 1, {
        x: d(20),
        y: d(56),
        x2: d(300),
        y2: d(56),
        meta: { name: "分隔线", visible: true, locked: false },
      }),
      createCanvasElement("text", 2, {
        x: d(20),
        y: d(88),
        width: d(270),
        fontSize: d(17),
        fontWeight: "normal",
        value: "生成预览后，再执行直接打印。",
        maxLines: 3,
        meta: { name: "正文", visible: true, locked: false },
      }),
    ]
  }

  return [
    createCanvasElement("rect", 0, {
      x: d(20),
      y: d(18),
      width: d(344),
      height: d(184),
      radius: d(18),
      meta: { name: "版心", visible: true, locked: false },
    }),
    createCanvasElement("text", 1, {
      x: d(34),
      y: d(48),
      width: d(170),
      fontSize: d(28),
      value: "Koha Cat",
      meta: { name: "收件人", visible: true, locked: false },
    }),
    createCanvasElement("text", 2, {
      x: d(34),
      y: d(90),
      width: d(214),
      fontSize: d(16),
      fontWeight: "normal",
      value: "Moon St 42\nBrowser City",
      maxLines: 3,
      meta: { name: "地址", visible: true, locked: false },
    }),
    createCanvasElement("barcode", 3, {
      x: d(32),
      y: d(146),
      width: d(170),
      height: d(34),
      value: "TM-230CF680",
      meta: { name: "运单条码", visible: true, locked: false },
    }),
    createCanvasElement("qr", 4, {
      x: d(270),
      y: d(54),
      size: d(72),
      value: "https://tuckmark.local/order/TM-230CF680",
      meta: { name: "追踪二维码", visible: true, locked: false },
    }),
  ]
}

export function createDraftFromPreset(preset: CanvasDocumentPreset): CanvasDraftDocument {
  return normalizeDraftDocument({
    version: 1,
    unit: "mm",
    id: preset.id,
    presetId: preset.id,
    name: preset.name,
    source: {
      kind: "scratch",
      presetId: preset.id,
    },
    fields: [],
    width: preset.width,
    height: preset.height,
    elements: buildPresetElements(preset.id),
    editor: {
      gridEnabled: true,
      snapEnabled: true,
    },
  })
}

export function cloneDraftDocument(document: CanvasDraftDocument): CanvasDraftDocument {
  return cloneValue(document)
}

export function getPresetById(presetId: string): CanvasDocumentPreset {
  const preset = CANVAS_PRESETS.find((preset) => preset.id === presetId)
  if (preset) {
    return preset
  }

  const fallbackPreset = CANVAS_PRESETS[0]
  if (!fallbackPreset) {
    throw new Error("Canvas presets are not configured.")
  }

  return fallbackPreset
}

export function getSystemTemplateById(templateId: string): TemplateDefinition {
  const template = presetTemplateData.find((item) => item.id === templateId)
  if (template) {
    return template
  }
  throw new Error(`Unknown system template: ${templateId}`)
}

function inferLayerNameFromTemplateElement(
  element: TemplateDefinition["elements"][number],
  field?: TemplateDefinition["fields"][number]
): string {
  if (field) {
    return field.label
  }
  if ("key" in element && element.key.startsWith(STATIC_TEMPLATE_KEY_PREFIX)) {
    return element.key
      .replace(/^_+/, "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (token) => token.toUpperCase())
  }
  return CANVAS_TOOL_LABELS[element.kind]
}

export function createDraftFromSystemTemplate(template: TemplateDefinition): CanvasDraftDocument {
  const fieldMap = new Map(template.fields.map((field) => [field.key, field]))
  const resolveInitialFieldValue = (field: TemplateDefinition["fields"][number] | undefined) =>
    field ? (field.defaultValue ?? field.label) : undefined
  const getTextElementWidth = (
    element: Extract<TemplateDefinition["elements"][number], { kind: "text" }>
  ) => element.width ?? canvasDotsToMillimeters(180)
  const getTextElementHeight = (
    element: Extract<TemplateDefinition["elements"][number], { kind: "text" }>
  ) => {
    if (element.height) {
      return element.height
    }
    const text = element.value ?? resolveInitialFieldValue(fieldMap.get(element.key)) ?? ""
    const width = getTextElementWidth(element)
    const layout = resolveTextLayout({
      text,
      fontSize: element.fontSize,
      width,
      height: getTextNaturalHeight(element.fontSize, 1, element.lineHeight),
      lineHeight: element.lineHeight,
      fontFamily: element.fontFamily,
      fontWeight: element.fontWeight,
      align: element.align,
      maxLines: element.maxLines,
      verticalAlign: element.verticalAlign,
      stretchX: element.stretchX,
      stretchY: element.stretchY,
      autoWrap: element.autoWrap ?? true,
      verticalText: element.verticalText ?? false,
    })
    return layout.naturalHeight
  }
  const elements: CanvasDraftElement[] = template.elements.map((element, index) => {
    const physicalElement = scaleTemplateElementGeometry(element, 1 / CANVAS_DOTS_PER_MILLIMETER)
    const field = "key" in element ? fieldMap.get(element.key) : undefined
    const meta = {
      name: inferLayerNameFromTemplateElement(element, field),
      visible: true,
      locked: false,
    }

    switch (physicalElement.kind) {
      case "rect":
        return createCanvasElement("rect", index, {
          x: physicalElement.x,
          y: physicalElement.y,
          width: physicalElement.width,
          height: physicalElement.height,
          strokeWidth: physicalElement.strokeWidth,
          fill: physicalElement.fill,
          stroke: physicalElement.stroke,
          radius: physicalElement.radius,
          rotation: physicalElement.rotation,
          meta,
        })
      case "circle":
        return createCanvasElement("circle", index, {
          x: physicalElement.x,
          y: physicalElement.y,
          size: physicalElement.size,
          strokeWidth: physicalElement.strokeWidth,
          fill: physicalElement.fill,
          stroke: physicalElement.stroke,
          meta,
        })
      case "triangle":
        return createCanvasElement("triangle", index, {
          x: physicalElement.x,
          y: physicalElement.y,
          width: physicalElement.width,
          height: physicalElement.height,
          strokeWidth: physicalElement.strokeWidth,
          fill: physicalElement.fill,
          stroke: physicalElement.stroke,
          rotation: physicalElement.rotation,
          meta,
        })
      case "line":
        return createCanvasElement("line", index, {
          x: physicalElement.x1,
          y: physicalElement.y1,
          x2: physicalElement.x2,
          y2: physicalElement.y2,
          strokeWidth: physicalElement.strokeWidth,
          stroke: physicalElement.stroke,
          meta,
        })
      case "text": {
        const textHeight = getTextElementHeight(physicalElement)
        return createCanvasElement("text", index, {
          x: physicalElement.x,
          y: physicalElement.height
            ? physicalElement.y
            : physicalElement.y - physicalElement.fontSize,
          width: getTextElementWidth(physicalElement),
          height: textHeight,
          fontSize: physicalElement.fontSize,
          fontFamily: physicalElement.fontFamily,
          lineHeight: physicalElement.lineHeight,
          fontWeight: physicalElement.fontWeight,
          align: physicalElement.align,
          justifyAlign: physicalElement.justifyAlign,
          verticalAlign: physicalElement.verticalAlign,
          stretchX: physicalElement.stretchX,
          stretchY: physicalElement.stretchY,
          autoWrap: physicalElement.autoWrap,
          verticalText: physicalElement.verticalText ?? false,
          value: resolveInitialFieldValue(field) ?? physicalElement.value ?? "",
          maxLines: physicalElement.maxLines,
          rotation: physicalElement.rotation,
          binding: field ? { fieldKey: field.key, kind: "text" } : undefined,
          meta,
        })
      }
      case "barcode":
        return createCanvasElement("barcode", index, {
          x: physicalElement.x,
          y: physicalElement.y,
          width: physicalElement.width,
          height: physicalElement.height,
          value: resolveInitialFieldValue(field) ?? physicalElement.value ?? "",
          format: physicalElement.format,
          showValue: physicalElement.showValue,
          rotation: physicalElement.rotation,
          binding: field ? { fieldKey: field.key, kind: "barcode" } : undefined,
          meta,
        })
      case "qr":
        return createCanvasElement("qr", index, {
          x: physicalElement.x,
          y: physicalElement.y,
          size: physicalElement.size,
          value: resolveInitialFieldValue(field) ?? physicalElement.value ?? "",
          errorCorrectionLevel: physicalElement.errorCorrectionLevel,
          rotation: physicalElement.rotation,
          binding: field ? { fieldKey: field.key, kind: "qr" } : undefined,
          meta,
        })
      case "datamatrix":
        return createCanvasElement("datamatrix", index, {
          x: physicalElement.x,
          y: physicalElement.y,
          size: physicalElement.size,
          value: resolveInitialFieldValue(field) ?? physicalElement.value ?? "",
          rotation: physicalElement.rotation,
          binding: field ? { fieldKey: field.key, kind: "datamatrix" } : undefined,
          meta,
        })
      default:
        return assertNever(physicalElement)
    }
  })

  return normalizeDraftDocument({
    version: 1,
    unit: "mm",
    id: template.id,
    presetId: template.id,
    name: template.name,
    source: {
      kind: "preset-template",
      presetId: template.id,
    },
    width: canvasDotsToMillimeters(template.width),
    height: canvasDotsToMillimeters(template.height),
    fields: template.fields.map((field) => ({
      key: field.key,
      label: field.label,
      defaultValue: field.defaultValue ?? "",
      multiline: field.multiline ?? false,
      bindings: [],
    })),
    elements,
    editor: {
      gridEnabled: true,
      snapEnabled: true,
    },
  })
}

export function createDraftFromUserTemplatePackage(
  templatePackage: UserTemplatePackage
): CanvasDraftDocument {
  const template: TemplateDefinition = {
    id: templatePackage.id,
    name: templatePackage.name,
    description: templatePackage.description,
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
  }

  const draft = normalizeDraftDocument({
    ...createDraftFromSystemTemplate(template),
    id: `agent-template-${templatePackage.id}`,
    presetId: templatePackage.id,
    renderOptions: templatePackage.renderOptions,
    source: {
      kind: "scratch",
      presetId: templatePackage.id,
    },
  })
  const sampleInput = templatePackage.sampleInput
  return {
    ...draft,
    fields: draft.fields.map((field) => ({
      ...field,
      sampleValue: sampleInput[field.key],
    })),
    elements: draft.elements.map((element, index) => {
      if (!isBindableKind(element) || !element.binding) {
        return element
      }
      const sourceElement = templatePackage.elements[index]
      const literalValue =
        sourceElement?.kind === "text" ||
        sourceElement?.kind === "barcode" ||
        sourceElement?.kind === "qr" ||
        sourceElement?.kind === "datamatrix"
          ? sourceElement.value
          : undefined
      const sampleValue = sampleInput[element.binding.fieldKey]
      const value = sampleValue ?? literalValue
      return value === undefined ? element : { ...element, value }
    }),
  }
}

export function duplicateDraftAsTemplate(
  document: CanvasDraftDocument,
  name: string
): CanvasDraftDocument {
  return normalizeDraftDocument({
    ...cloneDraftDocument(document),
    id: `canvas-${crypto.randomUUID()}`,
    name,
    source: {
      kind: "scratch",
      presetId: document.presetId,
    },
    templateId: undefined,
    baseVersionId: undefined,
    lastSavedAt: undefined,
  })
}

export function renameDraftField(
  document: CanvasDraftDocument,
  fieldKey: string,
  label: string
): CanvasDraftDocument {
  return normalizeDraftDocument({
    ...document,
    fields: document.fields.map((field) => (field.key === fieldKey ? { ...field, label } : field)),
  })
}

export function setDraftFieldValue(
  document: CanvasDraftDocument,
  fieldKey: string,
  defaultValue: string
): CanvasDraftDocument {
  return normalizeDraftDocument({
    ...document,
    fields: document.fields.map((field) =>
      field.key === fieldKey ? { ...field, defaultValue } : field
    ),
  })
}

export function setDraftFieldMultiline(
  document: CanvasDraftDocument,
  fieldKey: string,
  multiline: boolean
): CanvasDraftDocument {
  return normalizeDraftDocument({
    ...document,
    fields: document.fields.map((field) =>
      field.key === fieldKey ? { ...field, multiline } : field
    ),
  })
}

export function toggleElementBinding(
  document: CanvasDraftDocument,
  elementId: string,
  enabled: boolean
): CanvasDraftDocument {
  const element = document.elements.find((item) => item.id === elementId)
  if (!element || !isBindableKind(element)) {
    return document
  }

  if (!enabled) {
    const remainingBoundElementCount = document.elements.filter(
      (item) =>
        item.id !== elementId &&
        isBindableKind(item) &&
        item.binding?.fieldKey === element.binding?.fieldKey
    ).length
    return normalizeDraftDocument({
      ...document,
      elements: document.elements.map((item) =>
        item.id === elementId ? ({ ...item, binding: undefined } as CanvasDraftElement) : item
      ),
      fields: element.binding
        ? document.fields.filter((field) =>
            field.key === element.binding?.fieldKey ? remainingBoundElementCount > 0 : true
          )
        : document.fields,
    })
  }

  if (element.binding) {
    return document
  }

  const nextFieldKey = createUniqueFieldKey(
    document.fields.map((field) => field.key),
    element.meta.name
  )

  return normalizeDraftDocument({
    ...document,
    elements: document.elements.map((item) =>
      item.id === elementId
        ? ({
            ...item,
            binding: {
              fieldKey: nextFieldKey,
              kind: item.kind,
            },
          } as CanvasDraftElement)
        : item
    ),
    fields: [
      ...document.fields,
      {
        key: nextFieldKey,
        label: element.meta.name,
        defaultValue: element.value,
        multiline: inferFieldMultiline(element),
        bindings: [],
      },
    ],
  })
}

export function bindElementToExistingField(
  document: CanvasDraftDocument,
  elementId: string,
  fieldKey: string
): CanvasDraftDocument {
  const field = document.fields.find((item) => item.key === fieldKey)
  const element = document.elements.find((item) => item.id === elementId)
  if (!field || !element || !isBindableKind(element)) {
    return document
  }

  const previousFieldKey = element.binding?.fieldKey
  const nextFields =
    previousFieldKey && previousFieldKey !== fieldKey
      ? document.fields.filter((item) => {
          if (item.key !== previousFieldKey) {
            return true
          }
          return document.elements.some(
            (candidate) =>
              candidate.id !== elementId &&
              isBindableKind(candidate) &&
              candidate.binding?.fieldKey === previousFieldKey
          )
        })
      : document.fields

  return normalizeDraftDocument({
    ...document,
    fields: nextFields,
    elements: document.elements.map((item) =>
      item.id === elementId
        ? ({
            ...item,
            binding: {
              fieldKey,
              kind: item.kind,
            },
            value: field.defaultValue,
          } as CanvasDraftElement)
        : item
    ),
  })
}

export function updateBoundElementValue(
  document: CanvasDraftDocument,
  elementId: string,
  value: string
): CanvasDraftDocument {
  const element = document.elements.find((item) => item.id === elementId)
  if (!element) {
    return document
  }

  if (!isBindableKind(element) || !element.binding) {
    return normalizeDraftDocument({
      ...document,
      elements: document.elements.map((item) =>
        item.id === elementId ? ({ ...item, value } as CanvasDraftElement) : item
      ),
    })
  }

  return setDraftFieldValue(document, element.binding.fieldKey, value)
}

export function getDraftStorageKey(presetId: string): string {
  return `${DRAFT_STORAGE_PREFIX}${presetId}`
}

export function loadStoredDraftDocument(presetId: string): CanvasDraftDocument | null {
  if (typeof window === "undefined") {
    return null
  }

  try {
    const raw = window.localStorage.getItem(getDraftStorageKey(presetId))
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as CanvasDraftDocument
    if (parsed.version !== 1 || parsed.presetId !== presetId || !Array.isArray(parsed.elements)) {
      return null
    }

    const normalized = normalizeDraftDocument(parsed)
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      window.localStorage.setItem(getDraftStorageKey(presetId), JSON.stringify(normalized))
    }

    return normalized
  } catch {
    return null
  }
}

export function persistDraftDocument(document: CanvasDraftDocument): void {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(
    getDraftStorageKey(document.presetId),
    JSON.stringify(normalizeDraftDocument(document))
  )
}

export function clearStoredDraftDocument(presetId: string): void {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.removeItem(getDraftStorageKey(presetId))
}

export function persistDraftDocumentToStorage(
  presetId: string,
  rawDocument: CanvasDraftDocument
): void {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(
    getDraftStorageKey(presetId),
    JSON.stringify(normalizeDraftDocument(rawDocument))
  )
}

export function duplicateDraftElement(
  element: CanvasDraftElement,
  _index: number
): CanvasDraftElement {
  const clone = cloneValue(element)
  clone.id = `${element.kind}-${crypto.randomUUID()}`
  clone.meta.name = `${element.meta.name} 副本`

  if (clone.kind === "line") {
    clone.x += 12
    clone.y += 12
    clone.x2 += 12
    clone.y2 += 12
    return clone
  }

  clone.x += 12
  clone.y += 12
  return clone
}

export function getElementBounds(element: CanvasDraftElement): CanvasBounds {
  switch (element.kind) {
    case "text": {
      return {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      }
    }
    case "rect":
      return {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      }
    case "circle":
      return {
        x: element.x,
        y: element.y,
        width: element.size,
        height: element.size,
      }
    case "triangle":
      return {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      }
    case "line":
      return {
        x: Math.min(element.x, element.x2),
        y: Math.min(element.y, element.y2),
        width: Math.abs(element.x2 - element.x) || element.strokeWidth,
        height: Math.abs(element.y2 - element.y) || element.strokeWidth,
      }
    case "barcode":
      return {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      }
    case "qr":
    case "datamatrix":
      return {
        x: element.x,
        y: element.y,
        width: element.size,
        height: element.size,
      }
  }
}

export function getElementGeometry(element: CanvasDraftElement): CanvasElementGeometry {
  const bounds = getElementBounds(element)

  switch (element.kind) {
    case "text": {
      const localBounds = {
        x: 0,
        y: 0,
        width: element.width,
        height: element.height,
      }
      const rotationOrigin = {
        x: localBounds.width / 2,
        y: localBounds.height / 2,
      }
      return {
        bounds,
        localBounds,
        rotationOrigin,
        stagePosition: {
          x: element.x + rotationOrigin.x,
          y: element.y + rotationOrigin.y,
        },
      }
    }
    case "rect":
    case "triangle": {
      const localBounds = {
        x: 0,
        y: 0,
        width: element.width,
        height: element.height,
      }
      const rotationOrigin = {
        x: element.width / 2,
        y: element.height / 2,
      }
      return {
        bounds,
        localBounds,
        rotationOrigin,
        stagePosition: {
          x: element.x + rotationOrigin.x,
          y: element.y + rotationOrigin.y,
        },
      }
    }
    case "circle": {
      const localBounds = {
        x: 0,
        y: 0,
        width: element.size,
        height: element.size,
      }
      const rotationOrigin = {
        x: element.size / 2,
        y: element.size / 2,
      }
      return {
        bounds,
        localBounds,
        rotationOrigin,
        stagePosition: {
          x: element.x + rotationOrigin.x,
          y: element.y + rotationOrigin.y,
        },
      }
    }
    case "line": {
      const localBounds = {
        x: Math.min(0, element.x2 - element.x),
        y: Math.min(0, element.y2 - element.y),
        width: Math.abs(element.x2 - element.x) || element.strokeWidth,
        height: Math.abs(element.y2 - element.y) || element.strokeWidth,
      }
      return {
        bounds,
        localBounds,
        rotationOrigin: { x: 0, y: 0 },
        stagePosition: { x: element.x, y: element.y },
      }
    }
    case "barcode": {
      const localBounds = {
        x: 0,
        y: 0,
        width: element.width,
        height: element.height,
      }
      const rotationOrigin = {
        x: element.width / 2,
        y: element.height / 2,
      }
      return {
        bounds,
        localBounds,
        rotationOrigin,
        stagePosition: {
          x: element.x + rotationOrigin.x,
          y: element.y + rotationOrigin.y,
        },
      }
    }
    case "qr":
    case "datamatrix": {
      const localBounds = {
        x: 0,
        y: 0,
        width: element.size,
        height: element.size,
      }
      const rotationOrigin = {
        x: element.size / 2,
        y: element.size / 2,
      }
      return {
        bounds,
        localBounds,
        rotationOrigin,
        stagePosition: {
          x: element.x + rotationOrigin.x,
          y: element.y + rotationOrigin.y,
        },
      }
    }
  }
}

export function getElementSelectionBounds(element: CanvasDraftElement): CanvasBounds {
  if (element.kind === "line") {
    return getElementBounds(element)
  }

  const geometry = getElementGeometry(element)
  const rotation =
    element.kind === "text" ||
    element.kind === "rect" ||
    element.kind === "triangle" ||
    element.kind === "barcode" ||
    element.kind === "qr" ||
    element.kind === "datamatrix"
      ? normalizeRotation(element.rotation)
      : 0

  if (!rotation) {
    return geometry.bounds
  }

  const localLeft = geometry.localBounds.x
  const localTop = geometry.localBounds.y
  const localRight = localLeft + geometry.localBounds.width
  const localBottom = localTop + geometry.localBounds.height
  const corners = [
    { x: localLeft, y: localTop },
    { x: localRight, y: localTop },
    { x: localRight, y: localBottom },
    { x: localLeft, y: localBottom },
  ].map((corner) =>
    rotatePoint(
      {
        x: geometry.stagePosition.x + corner.x - geometry.rotationOrigin.x,
        y: geometry.stagePosition.y + corner.y - geometry.rotationOrigin.y,
      },
      geometry.stagePosition,
      rotation
    )
  )

  const left = Math.min(...corners.map((corner) => corner.x))
  const top = Math.min(...corners.map((corner) => corner.y))
  const right = Math.max(...corners.map((corner) => corner.x))
  const bottom = Math.max(...corners.map((corner) => corner.y))

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
}

export function getSelectionBounds(elements: CanvasDraftElement[]): CanvasBounds | null {
  if (elements.length === 0) {
    return null
  }

  const bounds = elements.map(getElementSelectionBounds)
  const left = Math.min(...bounds.map((item) => item.x))
  const top = Math.min(...bounds.map((item) => item.y))
  const right = Math.max(...bounds.map((item) => item.x + item.width))
  const bottom = Math.max(...bounds.map((item) => item.y + item.height))

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
}

export function translateElement(
  element: CanvasDraftElement,
  deltaX: number,
  deltaY: number
): CanvasDraftElement {
  switch (element.kind) {
    case "line":
      return {
        ...element,
        x: element.x + deltaX,
        y: element.y + deltaY,
        x2: element.x2 + deltaX,
        y2: element.y2 + deltaY,
      }
    default:
      return {
        ...element,
        x: element.x + deltaX,
        y: element.y + deltaY,
      }
  }
}

export function compileDraftElement(
  element: CanvasDraftElement
): DirectCanvasDefinition["elements"][number] {
  const normalized = normalizeMonochromeElement(element)
  const resolvedKey =
    isBindableKind(normalized) && normalized.binding ? normalized.binding.fieldKey : normalized.id

  switch (normalized.kind) {
    case "text":
      return {
        kind: "text",
        key: resolvedKey,
        x: normalized.x,
        y: normalized.y,
        width: normalized.width,
        height: normalized.height,
        fontSize: normalized.fontSize,
        fontFamily: normalized.fontFamily,
        lineHeight: normalized.lineHeight,
        fontWeight: normalized.fontWeight,
        align: normalized.align,
        justifyAlign: normalized.justifyAlign,
        verticalAlign: normalized.verticalAlign,
        stretchX: normalized.stretchX,
        stretchY: normalized.stretchY,
        autoWrap: normalized.autoWrap,
        verticalText: normalized.verticalText,
        value: normalized.value,
        maxLines: normalized.maxLines,
        rotation: normalizeRotation(normalized.rotation),
      }
    case "rect":
      return {
        kind: "rect",
        x: normalized.x,
        y: normalized.y,
        width: normalized.width,
        height: normalized.height,
        strokeWidth: normalized.strokeWidth,
        fill: normalized.fill,
        stroke: normalized.stroke,
        radius: normalized.radius,
        rotation: normalizeRotation(normalized.rotation),
      }
    case "circle":
      return {
        kind: "circle",
        x: normalized.x,
        y: normalized.y,
        size: normalized.size,
        strokeWidth: normalized.strokeWidth,
        fill: normalized.fill,
        stroke: normalized.stroke,
      }
    case "triangle":
      return {
        kind: "triangle",
        x: normalized.x,
        y: normalized.y,
        width: normalized.width,
        height: normalized.height,
        strokeWidth: normalized.strokeWidth,
        fill: normalized.fill,
        stroke: normalized.stroke,
        rotation: normalizeRotation(normalized.rotation),
      }
    case "line":
      return {
        kind: "line",
        x1: normalized.x,
        y1: normalized.y,
        x2: normalized.x2,
        y2: normalized.y2,
        strokeWidth: normalized.strokeWidth,
        stroke: normalized.stroke,
      }
    case "barcode":
      return {
        kind: "barcode",
        key: resolvedKey,
        x: normalized.x,
        y: normalized.y,
        width: normalized.width,
        height: normalized.height,
        value: normalized.value,
        format: normalized.format,
        showValue: normalized.showValue,
        rotation: normalizeRotation(normalized.rotation),
      }
    case "qr":
      return {
        kind: "qr",
        key: resolvedKey,
        x: normalized.x,
        y: normalized.y,
        size: normalized.size,
        value: normalized.value,
        errorCorrectionLevel: normalized.errorCorrectionLevel,
        rotation: normalizeRotation(normalized.rotation),
      }
    case "datamatrix":
      return {
        kind: "datamatrix",
        key: resolvedKey,
        x: normalized.x,
        y: normalized.y,
        size: normalized.size,
        value: normalized.value,
        rotation: normalizeRotation(normalized.rotation),
      }
  }
}

export function compileDraftToCanvasDefinition(
  document: CanvasDraftDocument
): DirectCanvasDefinition {
  const dotsDocument = canvasDraftDocumentToDots(document)
  return {
    id: dotsDocument.id,
    name: dotsDocument.name,
    width: dotsDocument.width,
    height: dotsDocument.height,
    elements: dotsDocument.elements
      .filter((element) => element.meta.visible)
      .map((element) => compileDraftElement(element)),
  }
}

export function compileDraftToFilledCanvasDefinition(
  document: CanvasDraftDocument,
  input: Record<string, string>
): DirectCanvasDefinition {
  const dotsDocument = canvasDraftDocumentToDots(document)
  const fieldMap = new Map(
    dotsDocument.fields.map((field) => [field.key, input[field.key] ?? field.defaultValue ?? ""])
  )

  return {
    id: dotsDocument.id,
    name: dotsDocument.name,
    width: dotsDocument.width,
    height: dotsDocument.height,
    elements: dotsDocument.elements
      .filter((element) => element.meta.visible)
      .map((element) => {
        const compiled = compileDraftElement(element)
        if (
          (compiled.kind === "text" ||
            compiled.kind === "barcode" ||
            compiled.kind === "qr" ||
            compiled.kind === "datamatrix") &&
          isBindableKind(element) &&
          element.binding
        ) {
          const resolvedValue = fieldMap.get(element.binding.fieldKey) ?? element.value
          return {
            ...compiled,
            value: resolvedValue,
          }
        }
        return compiled
      }),
  }
}

export function buildTemplateFieldsFromDraft(document: CanvasDraftDocument) {
  return document.fields.map((field) => ({
    key: field.key,
    label: field.label,
    required: false,
    multiline: field.multiline,
    defaultValue: field.defaultValue,
    sampleValue: field.sampleValue,
  }))
}

function createPreviewRenderOptions(renderOptions: RenderOptions) {
  return {
    ...renderOptions,
    previewScale: 4,
  }
}

export function toCanvasPrintSource(
  document: CanvasDraftDocument,
  renderOptions: RenderOptions
): BrowserPrintSource {
  return {
    kind: "canvas",
    canvas: compileDraftToCanvasDefinition(document),
    renderOptions: createPreviewRenderOptions({
      ...document.renderOptions,
      ...renderOptions,
    }),
  }
}

export function reorderDraftElements(
  elements: CanvasDraftDocument["elements"],
  elementId: string,
  direction: "forward" | "backward"
) {
  const currentIndex = elements.findIndex((element) => element.id === elementId)
  if (currentIndex < 0) {
    return elements
  }

  const nextIndex =
    direction === "forward"
      ? Math.min(elements.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1)

  if (nextIndex === currentIndex) {
    return elements
  }

  const next = [...elements]
  const [item] = next.splice(currentIndex, 1)
  if (!item) {
    return elements
  }

  next.splice(nextIndex, 0, item)
  return next
}

export function buildStoryScenarioDocument(scenario: CanvasStoryScenario): CanvasDraftDocument {
  if (scenario === "draft-restore") {
    const preset = getPresetById("ops-tag")
    const document = createDraftFromPreset(preset)
    document.name = "已恢复机柜标签"
    document.elements = document.elements.map((element) => {
      if (element.meta.name === "设备名称" && element.kind === "text") {
        return { ...element, value: "RESTORED-04" }
      }
      if (element.meta.name === "资产二维码" && element.kind === "qr") {
        return {
          ...element,
          value: "https://tuckmark.local/rack-a/restored-04",
          x: 286,
          y: 30,
        }
      }
      return element
    })
    return document
  }

  if (scenario === "barcode-invalid") {
    const preset = getPresetById("shipping-wide")
    const document = createDraftFromPreset(preset)
    document.elements = document.elements.map((element) =>
      element.kind === "barcode"
        ? { ...element, value: "", meta: { ...element.meta, name: "待修正条码" } }
        : element
    )
    return document
  }

  if (scenario === "datamatrix-selected" || scenario === "datamatrix-invalid") {
    const document = createDraftFromPreset(getPresetById("ops-tag"))
    document.elements = [
      ...document.elements.filter((element) => element.kind !== "qr"),
      createCanvasElement("datamatrix", document.elements.length, {
        x: 33.25,
        y: 4.75,
        size: 10,
        value:
          scenario === "datamatrix-invalid" ? "" : "rack-a.lan-01|TM-0001|https://tuckmark.local",
        rotation: 0,
        meta: {
          name: scenario === "datamatrix-invalid" ? "待修正数据矩阵码" : "资产矩阵码",
          visible: true,
          locked: false,
        },
      }),
    ]
    return document
  }

  if (
    scenario === "text-selected" ||
    scenario === "text-font-metrics" ||
    scenario === "text-justify-selected" ||
    scenario === "text-justify-multiline-selected" ||
    scenario === "text-justify-centered-selected" ||
    scenario === "text-justify-top-selected" ||
    scenario === "text-centered-selected"
  ) {
    const document = createDraftFromPreset(getPresetById("ops-tag"))
    const selectedText = document.elements.find((element) => element.kind === "text")
    if (!selectedText) {
      return document
    }
    if (scenario === "text-font-metrics") {
      const sansText = {
        ...selectedText,
        x: 3,
        y: 3.2,
        value: "20kΩ\n标签 ABC",
        width: 28,
        height: 11.2,
        fontSize: 5.2,
        fontFamily: "noto-sans-sc" as const,
        lineHeight: DEFAULT_TEXT_LINE_HEIGHT,
        align: "left" as const,
        verticalAlign: "top" as const,
        stretchX: false,
        stretchY: false,
        autoWrap: false,
        verticalText: false,
        maxLines: undefined,
        meta: { ...selectedText.meta, name: "Noto Sans SC BBOX" },
      }
      const monoText = {
        ...sansText,
        id: `${selectedText.id}-mono`,
        x: 18,
        y: 10.8,
        value: "20kΩ",
        width: 14,
        height: 6.5,
        fontFamily: "ibm-plex-mono" as const,
        maxLines: 1,
        meta: { ...selectedText.meta, name: "IBM Plex Mono BBOX" },
      }
      document.elements = [
        sansText,
        monoText,
        ...document.elements.filter((element) => element.kind !== "text"),
      ]
      return document
    }
    document.elements = document.elements
      .filter((element) => element.kind !== "text" || element.id === selectedText.id)
      .map((element) =>
        element.id === selectedText.id && element.kind === "text"
          ? {
              ...element,
              x:
                scenario === "text-justify-selected"
                  ? 4.5
                  : scenario === "text-justify-multiline-selected"
                    ? 6
                    : scenario === "text-justify-centered-selected"
                      ? 2.5
                      : scenario === "text-justify-top-selected"
                        ? 10
                        : scenario === "text-centered-selected"
                          ? 2.5
                          : 4,
              y:
                scenario === "text-justify-selected"
                  ? 6.5
                  : scenario === "text-justify-multiline-selected"
                    ? 4
                    : scenario === "text-justify-centered-selected"
                      ? 2.1
                      : scenario === "text-justify-top-selected"
                        ? 3
                        : scenario === "text-centered-selected"
                          ? 2.1
                          : 4,
              value:
                scenario === "text-justify-selected"
                  ? "可编辑文本"
                  : scenario === "text-justify-multiline-selected"
                    ? "Koha Cat"
                    : scenario === "text-justify-centered-selected"
                      ? "Koha Cat"
                      : scenario === "text-justify-top-selected"
                        ? "Name"
                        : scenario === "text-centered-selected"
                          ? "MMM"
                          : "20kΩ\n3333",
              width:
                scenario === "text-justify-selected"
                  ? 22.5
                  : scenario === "text-justify-multiline-selected"
                    ? 21.3
                    : scenario === "text-justify-centered-selected"
                      ? 21.3
                      : scenario === "text-justify-top-selected"
                        ? 22.5
                        : scenario === "text-centered-selected"
                          ? 32
                          : 26,
              height:
                scenario === "text-justify-selected"
                  ? 6.6
                  : scenario === "text-justify-multiline-selected"
                    ? 6.6
                    : scenario === "text-justify-centered-selected"
                      ? 6.6
                      : scenario === "text-justify-top-selected"
                        ? 12
                        : 14,
              fontSize:
                scenario === "text-justify-selected"
                  ? 3
                  : scenario === "text-justify-multiline-selected"
                    ? 3.5
                    : scenario === "text-justify-centered-selected"
                      ? 3.5
                      : scenario === "text-justify-top-selected"
                        ? 4.3
                        : scenario === "text-centered-selected"
                          ? 8.9
                          : 5,
              fontFamily:
                scenario === "text-centered-selected" ? "arial" : DEFAULT_TEXT_FONT_FAMILY,
              lineHeight: DEFAULT_TEXT_LINE_HEIGHT,
              align:
                scenario === "text-justify-selected" ||
                scenario === "text-justify-multiline-selected" ||
                scenario === "text-justify-centered-selected" ||
                scenario === "text-justify-top-selected"
                  ? "justify"
                  : scenario === "text-centered-selected"
                    ? "center"
                    : "left",
              justifyAlign:
                scenario === "text-justify-centered-selected" ||
                scenario === "text-justify-top-selected"
                  ? "center"
                  : undefined,
              verticalAlign:
                scenario === "text-centered-selected" ||
                scenario === "text-justify-centered-selected"
                  ? "middle"
                  : scenario === "text-justify-top-selected"
                    ? "top"
                    : "top",
              stretchX: false,
              stretchY: false,
              autoWrap: scenario === "text-centered-selected" ? false : true,
              verticalText: false,
              maxLines:
                scenario === "text-justify-selected" ||
                scenario === "text-justify-centered-selected" ||
                scenario === "text-justify-top-selected" ||
                scenario === "text-centered-selected"
                  ? 1
                  : scenario === "text-justify-multiline-selected"
                    ? 2
                    : 2,
              meta: { ...element.meta, name: "文本 2" },
            }
          : element
      )
    return document
  }

  if (scenario === "rect-selected") {
    const document = createDraftFromPreset(getPresetById("ops-tag"))
    document.elements = document.elements.map((element) =>
      element.kind === "rect"
        ? {
            ...element,
            radius: 0,
            width: 28,
            height: 10,
            meta: { ...element.meta, name: "直角矩形" },
          }
        : element
    )
    return document
  }

  if (scenario === "line-selected") {
    const document = createDraftFromPreset(getPresetById("compact-note"))
    document.elements = document.elements.map((element) =>
      element.kind === "line"
        ? {
            ...element,
            x: 4,
            y: 12,
            x2: 30,
            y2: 16,
            meta: { ...element.meta, name: "端点线段" },
          }
        : element
    )
    return document
  }

  if (scenario === "circle-selected" || scenario === "triangle-selected") {
    const document = createDraftFromPreset(getPresetById("ops-tag"))
    document.elements = [
      ...document.elements,
      createCanvasElement("circle", document.elements.length, {
        x: 5,
        y: 4,
        size: 8,
        strokeWidth: 0.25,
        meta: { name: "圆形示例", visible: true, locked: false },
      }),
      createCanvasElement("triangle", document.elements.length + 1, {
        x: 17,
        y: 4,
        width: 12,
        height: 9,
        strokeWidth: 0.25,
        rotation: 0,
        meta: { name: "三角形示例", visible: true, locked: false },
      }),
    ]
    return document
  }

  const preset = getPresetById(
    scenario === "barcode-selected" ? "shipping-wide" : "ops-tag"
  )
  return createDraftFromPreset(preset)
}

export type CanvasStoryScenario =
  | "wide-default"
  | "narrow-default"
  | "marquee-selection"
  | "text-selected"
  | "text-font-metrics"
  | "text-justify-selected"
  | "text-justify-multiline-selected"
  | "text-justify-centered-selected"
  | "text-justify-top-selected"
  | "text-centered-selected"
  | "text-ready"
  | "rect-selected"
  | "circle-selected"
  | "triangle-selected"
  | "line-selected"
  | "barcode-selected"
  | "barcode-invalid"
  | "datamatrix-selected"
  | "datamatrix-invalid"
  | "output-tab"
  | "draft-restore"
