import {
  type DirectCanvasDefinition,
  estimateCharsPerLine,
  wrapText,
} from "../../../packages/core/src/web.js"

import type { BrowserPrintSource } from "./browser-print-payload.js"
import type {
  CanvasDocumentPreset,
  CanvasDraftDocument,
  CanvasDraftElement,
  CanvasElement,
  RenderOptions,
} from "./types.js"

export const CANVAS_PRESETS: CanvasDocumentPreset[] = [
  {
    id: "shipping-wide",
    name: "快递单宽版",
    width: 384,
    height: 224,
    description: "适合完整收件信息与条码。",
  },
  {
    id: "ops-tag",
    name: "机柜标签",
    width: 384,
    height: 160,
    description: "适合短文本、二维码与设备标识。",
  },
  {
    id: "compact-note",
    name: "紧凑便签",
    width: 320,
    height: 128,
    description: "适合短说明和操作提示。",
  },
]

export const CANVAS_TOOL_LABELS: Record<CanvasElement["kind"], string> = {
  text: "文本",
  rect: "矩形",
  line: "线段",
  barcode: "条码",
  qr: "二维码",
}

export const CANVAS_HISTORY_LIMIT = 50
export const CANVAS_MIN_WIDTH = 960
export const CANVAS_WIDE_THRESHOLD = 1280

const DRAFT_STORAGE_VERSION = 1
const DRAFT_STORAGE_PREFIX = `tuckmark:canvas-draft:v${DRAFT_STORAGE_VERSION}:`
const MONO_FILL = "none"
const MONO_STROKE = "#111111"
const MONO_SOLID_FILL = "#111111"

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
    case "rect":
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

function normalizeDraftDocument(document: CanvasDraftDocument): CanvasDraftDocument {
  return {
    ...document,
    elements: document.elements.map((element) => normalizeMonochromeElement(element)),
  }
}

export function createCanvasElement(
  kind: CanvasElement["kind"],
  index: number,
  overrides?: Partial<CanvasDraftElement>
): CanvasDraftElement {
  const seedX = 28 + (index % 3) * 18
  const seedY = 24 + (index % 4) * 16

  const base = (() => {
    switch (kind) {
      case "text":
        return {
          id: `text-${crypto.randomUUID()}`,
          kind,
          x: seedX,
          y: seedY + 26,
          width: 180,
          fontSize: 24,
          fontWeight: "bold" as const,
          align: "left" as const,
          value: "可编辑文本",
          maxLines: 2,
          rotation: 0,
          meta: createLayerMeta(kind, index),
        }
      case "rect":
        return {
          id: `rect-${crypto.randomUUID()}`,
          kind,
          x: seedX,
          y: seedY,
          width: 152,
          height: 68,
          strokeWidth: 2,
          fill: MONO_FILL,
          stroke: MONO_STROKE,
          radius: 14,
          rotation: 0,
          meta: createLayerMeta(kind, index),
        }
      case "line":
        return {
          id: `line-${crypto.randomUUID()}`,
          kind,
          x: seedX,
          y: seedY + 12,
          x2: seedX + 160,
          y2: seedY + 12,
          strokeWidth: 3,
          stroke: MONO_STROKE,
          meta: createLayerMeta(kind, index),
        }
      case "barcode":
        return {
          id: `barcode-${crypto.randomUUID()}`,
          kind,
          x: seedX,
          y: seedY,
          width: 168,
          height: 52,
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
          size: 76,
          value: "https://tuckmark.local/item/TM-0001",
          errorCorrectionLevel: "M" as const,
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
  if (presetId === "ops-tag") {
    return [
      createCanvasElement("rect", 0, {
        width: 340,
        height: 118,
        x: 20,
        y: 20,
        meta: { name: "容器底板", visible: true, locked: false },
      }),
      createCanvasElement("text", 1, {
        x: 36,
        y: 52,
        width: 180,
        fontSize: 28,
        value: "LAN-01",
        meta: { name: "设备名称", visible: true, locked: false },
      }),
      createCanvasElement("text", 2, {
        x: 36,
        y: 92,
        width: 180,
        fontSize: 18,
        fontWeight: "normal",
        value: "Rack A / Gi1/0/1",
        meta: { name: "说明", visible: true, locked: false },
      }),
      createCanvasElement("qr", 3, {
        x: 268,
        y: 38,
        size: 66,
        value: "https://tuckmark.local/rack-a/lan-01",
        meta: { name: "资产二维码", visible: true, locked: false },
      }),
    ]
  }

  if (presetId === "compact-note") {
    return [
      createCanvasElement("text", 0, {
        x: 20,
        y: 38,
        width: 220,
        fontSize: 24,
        value: "维护窗口",
        meta: { name: "标题", visible: true, locked: false },
      }),
      createCanvasElement("line", 1, {
        x: 20,
        y: 56,
        x2: 300,
        y2: 56,
        meta: { name: "分隔线", visible: true, locked: false },
      }),
      createCanvasElement("text", 2, {
        x: 20,
        y: 88,
        width: 270,
        fontSize: 17,
        fontWeight: "normal",
        value: "生成预览后，再执行直接打印。",
        maxLines: 3,
        meta: { name: "正文", visible: true, locked: false },
      }),
    ]
  }

  return [
    createCanvasElement("rect", 0, {
      x: 20,
      y: 18,
      width: 344,
      height: 184,
      radius: 18,
      meta: { name: "版心", visible: true, locked: false },
    }),
    createCanvasElement("text", 1, {
      x: 34,
      y: 48,
      width: 170,
      fontSize: 28,
      value: "Koha Cat",
      meta: { name: "收件人", visible: true, locked: false },
    }),
    createCanvasElement("text", 2, {
      x: 34,
      y: 90,
      width: 214,
      fontSize: 16,
      fontWeight: "normal",
      value: "Moon St 42\nBrowser City",
      maxLines: 3,
      meta: { name: "地址", visible: true, locked: false },
    }),
    createCanvasElement("barcode", 3, {
      x: 32,
      y: 146,
      width: 170,
      height: 34,
      value: "TM-230CF680",
      meta: { name: "运单条码", visible: true, locked: false },
    }),
    createCanvasElement("qr", 4, {
      x: 270,
      y: 54,
      size: 72,
      value: "https://tuckmark.local/order/TM-230CF680",
      meta: { name: "追踪二维码", visible: true, locked: false },
    }),
  ]
}

export function createDraftFromPreset(preset: CanvasDocumentPreset): CanvasDraftDocument {
  return {
    version: 1,
    id: preset.id,
    presetId: preset.id,
    name: preset.name,
    width: preset.width,
    height: preset.height,
    elements: buildPresetElements(preset.id),
    editor: {
      gridEnabled: true,
      snapEnabled: true,
    },
  }
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

function getTextRenderMetrics(element: Extract<CanvasDraftElement, { kind: "text" }>) {
  const lines = wrapText(
    element.value,
    estimateCharsPerLine(element.fontSize, element.width),
    element.maxLines
  )
  const lineCount = Math.max(lines.length, 1)
  const lineHeight = element.fontSize + 4
  const height = Math.max(lineHeight, element.fontSize + (lineCount - 1) * lineHeight)
  return {
    lineCount,
    lineHeight,
    height,
  }
}

export function getElementBounds(element: CanvasDraftElement): CanvasBounds {
  switch (element.kind) {
    case "text": {
      const metrics = getTextRenderMetrics(element)
      return {
        x: element.x,
        y: element.y - element.fontSize,
        width: element.width,
        height: metrics.height,
      }
    }
    case "rect":
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
        y: -element.fontSize,
        width: element.width,
        height: bounds.height,
      }
      const rotationOrigin = {
        x: localBounds.width / 2,
        y: localBounds.y + localBounds.height / 2,
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
    case "rect": {
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
    case "qr": {
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
    element.kind === "barcode" ||
    element.kind === "qr"
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

  switch (normalized.kind) {
    case "text":
      return {
        kind: "text",
        key: normalized.id,
        x: normalized.x,
        y: normalized.y,
        width: normalized.width,
        fontSize: normalized.fontSize,
        fontWeight: normalized.fontWeight,
        align: normalized.align,
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
        key: normalized.id,
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
        key: normalized.id,
        x: normalized.x,
        y: normalized.y,
        size: normalized.size,
        value: normalized.value,
        errorCorrectionLevel: normalized.errorCorrectionLevel,
        rotation: normalizeRotation(normalized.rotation),
      }
  }
}

export function compileDraftToCanvasDefinition(
  document: CanvasDraftDocument
): DirectCanvasDefinition {
  return {
    id: document.id,
    name: document.name,
    width: document.width,
    height: document.height,
    elements: document.elements
      .filter((element) => element.meta.visible)
      .map((element) => compileDraftElement(element)),
  }
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
    renderOptions: createPreviewRenderOptions(renderOptions),
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

  const preset = getPresetById(scenario === "barcode-selected" ? "shipping-wide" : "ops-tag")
  return createDraftFromPreset(preset)
}

export type CanvasStoryScenario =
  | "wide-default"
  | "narrow-default"
  | "text-selected"
  | "barcode-selected"
  | "barcode-invalid"
  | "output-tab"
  | "draft-restore"
