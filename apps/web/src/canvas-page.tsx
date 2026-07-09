import JsBarcode from "jsbarcode"
import type Konva from "konva"
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpToLine,
  CheckCircle2,
  Columns3,
  Copy,
  Eye,
  EyeOff,
  FileClock,
  Focus,
  Grid2x2,
  History,
  Lock,
  LockOpen,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  ScanSearch,
  StretchHorizontal,
  StretchVertical,
  TextAlignJustify,
  TextWrap,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import QRCode from "qrcode"
import React from "react"
import {
  Group,
  Circle as KonvaCircle,
  Line as KonvaLine,
  Rect as KonvaRect,
  Text as KonvaText,
  Layer,
  Stage,
  Transformer,
} from "react-konva"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_VERTICAL_ALIGN,
  encodeDataMatrix,
  getTextFontFamilyStack,
  normalizeTextLineHeight,
  resolveTextLayout,
  stableStringify,
  type TextFontFamily,
  type TextHorizontalAlign,
  type TextMeasureFunction,
  type TextVerticalAlign,
} from "../../../packages/core/src/web.js"
import {
  bindElementToExistingField,
  buildStoryScenarioDocument,
  CANVAS_HISTORY_LIMIT,
  CANVAS_PRESETS,
  CANVAS_TOOL_LABELS,
  CANVAS_WIDE_THRESHOLD,
  type CanvasStoryScenario,
  clearStoredDraftDocument,
  createCanvasElement,
  createDraftFromPreset,
  createDraftFromSystemTemplate,
  duplicateDraftAsTemplate,
  duplicateDraftElement,
  getCanvasElementClipboardText,
  getElementGeometry,
  getElementSelectionBounds,
  getPresetById,
  getSystemTemplateById,
  loadStoredDraftDocument,
  normalizeDraftDocument,
  persistDraftDocument,
  renameDraftField,
  reorderDraftElements,
  toCanvasPrintSource,
  toggleElementBinding,
  translateElement,
  updateBoundElementValue,
} from "./canvas-editor-model.js"
import { DimensionPicker } from "./components/canvas/dimension-picker.js"
import { InspectorNumberField } from "./components/canvas/inspector-number-field.js"
import { TextFontFamilySelect } from "./components/canvas/text-font-family-select.js"
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js"
import { Badge } from "./components/ui/badge.js"
import { Button } from "./components/ui/button.js"
import { Combobox } from "./components/ui/combobox.js"
import { PromptDialog } from "./components/ui/dialog.js"
import { Input } from "./components/ui/input.js"
import { Label } from "./components/ui/label.js"
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "./components/ui/popover.js"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select.js"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./components/ui/sheet.js"
import { Textarea } from "./components/ui/textarea.js"
import { defaultRenderOptions } from "./demo-data.js"
import {
  buildCanvasDimensionOptions,
  type CanvasDimension,
  getCanvasDimensionCapabilityMessage,
} from "./lib/canvas-dimensions.js"
import {
  type CanvasSelectionBox,
  normalizeSelectionBox,
  projectSelectionBoxToStageRect,
} from "./lib/canvas-selection.js"
import {
  CANVAS_DOTS_PER_MILLIMETER,
  canvasDotsToMillimeters,
  canvasMillimetersToDots,
} from "./lib/canvas-units.js"
import { recordTextFontRecentUse, recordTextFontUsageDuration } from "./lib/text-font-usage.js"
import { preloadCanvasTextFonts } from "./lib/text-fonts.js"
import { cn } from "./lib/utils.js"
import type {
  CanvasDraftDocument,
  CanvasDraftElement,
  CanvasDraftSource,
  UserTemplateHistory,
  UserTemplateVersionSnapshot,
} from "./types.js"
import {
  clearTemplateAutosaves,
  clearWorkingCopy,
  loadWorkingCopy,
  readUserTemplateHistory,
  replaceUserTemplateWorkingCopy,
  saveUserTemplate,
  saveUserTemplateAutosave,
} from "./user-template-store.js"
import type { WorkbenchController } from "./workbench-controller.js"

type CanvasPageProps = {
  controller: WorkbenchController
  initialScenario?: CanvasStoryScenario
}

const INSPECTOR_SELECT_TRIGGER_CLASS = "tm-inspector-select h-7 rounded-sm px-2 py-0 text-xs"

type StageViewport = {
  x: number
  y: number
  scale: number
}

type StageViewportSize = {
  width: number
  height: number
}

type TemplateNameDialogState = {
  mode: "save" | "save-as"
  suggestedName: string
}

type CanvasPageState = {
  routeSource: CanvasDraftSource
  presetId: string
  liveDraft: CanvasDraftDocument
  draft: CanvasDraftDocument
  versionHistory: UserTemplateHistory | null
  readOnlyVersion: UserTemplateVersionSnapshot | null
  selectedIds: string[]
  activePanel: "attributes" | "output"
  focus: "left-center" | "center-right"
  gridEnabled: boolean
  snapEnabled: boolean
  spacePressed: boolean
  viewport: StageViewport
  selectionBox: CanvasSelectionBox
  history: CanvasDraftDocument[]
  historyIndex: number
  editingId: string | null
  pendingPaste: CanvasPendingPaste | null
  outputStatus: string
  autosavesExpanded: boolean
  versionsOpen: boolean
  loading: boolean
  storageMode: "persisted" | "reset-pending"
}

const GRID_SIZE = 1
const STAGE_VIEWPORT_WIDTH = 760
const STAGE_VIEWPORT_HEIGHT = 520
const EMPTY_SELECTION_BOX: CanvasSelectionBox = { x1: 0, y1: 0, x2: 0, y2: 0, visible: false }
const ZOOM_MIN = 0.45
const ZOOM_MAX = 5
const ZOOM_STEP = 1.08
const SELECTION_HANDLE_SIZE = 1
const LINE_ENDPOINT_HANDLE_RADIUS = 0.42
const LINE_ENDPOINT_HIT_RADIUS = 0.78
const MONO_INK = "#111111"
const MONO_SURFACE = "#ffffff"
const INLINE_TEXT_EDITOR_SELECTOR = "textarea[data-tm-inline-text-editor='true']"
const CANVAS_DEFAULT_TEXT_FONT_FAMILY = getTextFontFamilyStack(DEFAULT_TEXT_FONT_FAMILY)
const TEXT_ALIGNMENT_OPTIONS: Array<{
  align: Exclude<TextHorizontalAlign, "justify">
  verticalAlign: TextVerticalAlign
  label: string
}> = [
  { align: "left", verticalAlign: "top", label: "左上" },
  { align: "center", verticalAlign: "top", label: "上中" },
  { align: "right", verticalAlign: "top", label: "右上" },
  { align: "left", verticalAlign: "middle", label: "左中" },
  { align: "center", verticalAlign: "middle", label: "居中" },
  { align: "right", verticalAlign: "middle", label: "右中" },
  { align: "left", verticalAlign: "bottom", label: "左下" },
  { align: "center", verticalAlign: "bottom", label: "下中" },
  { align: "right", verticalAlign: "bottom", label: "右下" },
]

function resolveTextGridAlign(element: Extract<CanvasDraftElement, { kind: "text" }>) {
  if (element.align === "justify") {
    return element.justifyAlign ?? "left"
  }
  return element.align === "center" || element.align === "right" ? element.align : "left"
}
const TRANSFORMER_ALL_ANCHORS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-right",
  "bottom-right",
  "bottom-center",
  "bottom-left",
  "middle-left",
]
const TRANSFORMER_CORNER_ANCHORS = ["top-left", "top-right", "bottom-left", "bottom-right"]
const PAPER_TYPE_LABELS: Record<"continuous" | "gap", string> = {
  continuous: "连续纸",
  gap: "间隙纸",
}

type LineEndpoint = "start" | "end"

type CanvasIssue = {
  title: string
  detail: string
}

type CanvasClipboardPayload = {
  version: 1
  kind: "tuckmark-canvas-elements"
  elements: CanvasDraftElement[]
}

type CanvasPendingPaste = {
  ids: string[]
  previousSelectedIds: string[]
  previousEditingId: string | null
  confirmStatus: string
}

type CanvasClipboardReadResult =
  | {
      kind: "canvas"
      payload: CanvasClipboardPayload
      signature: string
    }
  | {
      kind: "invalid"
    }
  | {
      kind: "text"
      text: string
      signature: string
    }
  | {
      kind: "empty"
    }

type CanvasToastTone = "info" | "success" | "warning" | "error"

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

const CANVAS_CLIPBOARD_FORMAT = "application/x.tuckmark-canvas-elements+json"
const CANVAS_WEB_CUSTOM_CLIPBOARD_FORMAT = `web ${CANVAS_CLIPBOARD_FORMAT}`
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isCanvasLayerMeta(value: unknown): value is CanvasDraftElement["meta"] {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.visible === "boolean" &&
    typeof value.locked === "boolean"
  )
}

function isCanvasElementBinding(
  value: unknown
): value is NonNullable<CanvasDraftElement["binding"]> {
  return (
    isRecord(value) &&
    typeof value.fieldKey === "string" &&
    (value.kind === "text" || value.kind === "barcode" || value.kind === "qr")
  )
}

function hasOptionalRotation(value: unknown) {
  return value === undefined || isFiniteNumber(value)
}

function isClipboardCanvasElement(value: unknown): value is CanvasDraftElement {
  if (!isRecord(value) || typeof value.id !== "string" || !isCanvasLayerMeta(value.meta)) {
    return false
  }
  if (value.binding !== undefined && !isCanvasElementBinding(value.binding)) {
    return false
  }

  switch (value.kind) {
    case "text":
      return (
        isFiniteNumber(value.x) &&
        isFiniteNumber(value.y) &&
        isFiniteNumber(value.width) &&
        isFiniteNumber(value.height) &&
        isFiniteNumber(value.fontSize) &&
        typeof value.fontFamily === "string" &&
        isFiniteNumber(value.lineHeight) &&
        (value.fontWeight === "normal" || value.fontWeight === "bold") &&
        typeof value.align === "string" &&
        (value.justifyAlign === undefined || typeof value.justifyAlign === "string") &&
        typeof value.verticalAlign === "string" &&
        typeof value.stretchX === "boolean" &&
        typeof value.stretchY === "boolean" &&
        typeof value.autoWrap === "boolean" &&
        typeof value.verticalText === "boolean" &&
        typeof value.value === "string" &&
        (value.maxLines === undefined || isFiniteNumber(value.maxLines)) &&
        hasOptionalRotation(value.rotation)
      )
    case "rect":
      return (
        isFiniteNumber(value.x) &&
        isFiniteNumber(value.y) &&
        isFiniteNumber(value.width) &&
        isFiniteNumber(value.height) &&
        isFiniteNumber(value.strokeWidth) &&
        typeof value.fill === "string" &&
        typeof value.stroke === "string" &&
        isFiniteNumber(value.radius) &&
        hasOptionalRotation(value.rotation)
      )
    case "circle":
      return (
        isFiniteNumber(value.x) &&
        isFiniteNumber(value.y) &&
        isFiniteNumber(value.size) &&
        isFiniteNumber(value.strokeWidth) &&
        typeof value.fill === "string" &&
        typeof value.stroke === "string"
      )
    case "triangle":
      return (
        isFiniteNumber(value.x) &&
        isFiniteNumber(value.y) &&
        isFiniteNumber(value.width) &&
        isFiniteNumber(value.height) &&
        isFiniteNumber(value.strokeWidth) &&
        typeof value.fill === "string" &&
        typeof value.stroke === "string" &&
        hasOptionalRotation(value.rotation)
      )
    case "line":
      return (
        isFiniteNumber(value.x) &&
        isFiniteNumber(value.y) &&
        isFiniteNumber(value.x2) &&
        isFiniteNumber(value.y2) &&
        isFiniteNumber(value.strokeWidth) &&
        typeof value.stroke === "string"
      )
    case "barcode":
      return (
        isFiniteNumber(value.x) &&
        isFiniteNumber(value.y) &&
        isFiniteNumber(value.width) &&
        isFiniteNumber(value.height) &&
        typeof value.value === "string" &&
        value.format === "CODE128" &&
        typeof value.showValue === "boolean" &&
        hasOptionalRotation(value.rotation)
      )
    case "qr":
      return (
        isFiniteNumber(value.x) &&
        isFiniteNumber(value.y) &&
        isFiniteNumber(value.size) &&
        typeof value.value === "string" &&
        (value.errorCorrectionLevel === "L" ||
          value.errorCorrectionLevel === "M" ||
          value.errorCorrectionLevel === "Q" ||
          value.errorCorrectionLevel === "H") &&
        hasOptionalRotation(value.rotation)
      )
    default:
      return false
  }
}

function getCanvasTextLineHeight(lineHeight?: number) {
  return normalizeTextLineHeight(lineHeight)
}

function cloneDraft(draft: CanvasDraftDocument): CanvasDraftDocument {
  return structuredClone(draft)
}

function toComparableDraft(draft: CanvasDraftDocument) {
  return {
    ...draft,
    id: undefined,
    presetId: undefined,
    renderOptions: {
      ...defaultRenderOptions,
      ...draft.renderOptions,
    },
    source: undefined,
    templateId: undefined,
    baseVersionId: undefined,
    lastSavedAt: undefined,
  }
}

function sameDraftContent(left: CanvasDraftDocument, right: CanvasDraftDocument): boolean {
  return stableStringify(toComparableDraft(left)) === stableStringify(toComparableDraft(right))
}

function getElementSelectionBoundsForIds(elements: CanvasDraftElement[]) {
  const [firstElement, ...rest] = elements
  if (!firstElement) {
    return null
  }

  const firstBounds = getElementSelectionBounds(firstElement)
  return rest.reduce(
    (bounds, element) => {
      const next = getElementSelectionBounds(element)
      const left = Math.min(bounds.x, next.x)
      const top = Math.min(bounds.y, next.y)
      const right = Math.max(bounds.x + bounds.width, next.x + next.width)
      const bottom = Math.max(bounds.y + bounds.height, next.y + next.height)

      return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      }
    },
    {
      x: firstBounds.x,
      y: firstBounds.y,
      width: firstBounds.width,
      height: firstBounds.height,
    }
  )
}

function translateElementsByIds(
  elements: CanvasDraftElement[],
  ids: Set<string>,
  deltaX: number,
  deltaY: number
) {
  if (deltaX === 0 && deltaY === 0) {
    return elements
  }

  return elements.map((element) =>
    ids.has(element.id) ? translateElement(element, deltaX, deltaY) : element
  )
}

function supportsAsyncClipboard() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext !== false &&
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.read === "function" &&
    typeof navigator.clipboard?.write === "function" &&
    typeof globalThis.ClipboardItem !== "undefined"
  )
}

function getClipboardToastTone(message: string): CanvasToastTone | null {
  if (!message) {
    return null
  }

  if (message === "移动鼠标以放置，单击确认，按 Esc 取消。") {
    return "info"
  }

  if (
    message.includes("拷贝") ||
    message.includes("粘贴") ||
    message.includes("剪贴板") ||
    message === "已取消粘贴放置。"
  ) {
    if (
      message.includes("失败") ||
      message.includes("不可用") ||
      message.includes("不支持") ||
      message.includes("只读") ||
      message.includes("没有可粘贴")
    ) {
      return "error"
    }
    if (message === "已取消粘贴放置。") {
      return "warning"
    }
    if (
      message.includes("已拷贝") ||
      message.startsWith("已粘贴") ||
      message.includes("已将剪贴板文本粘贴")
    ) {
      return "success"
    }
    return "info"
  }

  return null
}

function CanvasClipboardToast({ message, tone }: { message: string; tone: CanvasToastTone }) {
  const icon =
    tone === "success" ? (
      <CheckCircle2 className="size-4" />
    ) : tone === "error" || tone === "warning" ? (
      <AlertCircle className="size-4" />
    ) : (
      <Copy className="size-4" />
    )

  return (
    <aside
      className={cn("tm-canvas-toast", `tm-canvas-toast--${tone}`)}
      aria-live="polite"
      role="status"
    >
      <div className="tm-canvas-toast__icon">{icon}</div>
      <div className="tm-canvas-toast__message">{message}</div>
    </aside>
  )
}

function isCanvasClipboardBypassTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

function getSelectedCanvasElements(state: CanvasPageState): CanvasDraftElement[] {
  if (state.selectedIds.length === 0) {
    return []
  }
  return state.draft.elements.filter((element) => state.selectedIds.includes(element.id))
}

function createCanvasClipboardPayload(elements: CanvasDraftElement[]): CanvasClipboardPayload {
  return {
    version: 1,
    kind: "tuckmark-canvas-elements",
    elements: structuredClone(elements),
  }
}

function serializeCanvasClipboardPayload(payload: CanvasClipboardPayload) {
  return stableStringify(payload)
}

function parseCanvasClipboardPayload(value: string): CanvasClipboardPayload | null {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as Partial<CanvasClipboardPayload>
    if (
      parsed.version !== 1 ||
      parsed.kind !== "tuckmark-canvas-elements" ||
      !Array.isArray(parsed.elements) ||
      !parsed.elements.every((element) => isClipboardCanvasElement(element))
    ) {
      return null
    }
    return {
      version: 1,
      kind: "tuckmark-canvas-elements",
      elements: parsed.elements as CanvasDraftElement[],
    }
  } catch {
    return null
  }
}

function normalizeClipboardElements(
  state: CanvasPageState,
  elements: CanvasDraftElement[]
): CanvasDraftElement[] {
  return normalizeDraftDocument({
    version: 1,
    unit: "mm",
    id: "clipboard-paste",
    presetId: state.presetId,
    name: "clipboard-paste",
    source: state.routeSource,
    width: state.liveDraft.width,
    height: state.liveDraft.height,
    fields: structuredClone(state.liveDraft.fields),
    elements: structuredClone(elements),
    editor: {
      gridEnabled: state.gridEnabled,
      snapEnabled: state.snapEnabled,
    },
  }).elements
}

function buildCanvasClipboardPlainText(elements: CanvasDraftElement[]): string | null {
  const values = elements
    .map((element) => getCanvasElementClipboardText(element))
    .filter((value): value is string => value !== null)

  if (values.length === 0) {
    return null
  }

  return values.join("\n")
}

function writeCanvasClipboardToDataTransfer(
  dataTransfer: DataTransfer,
  elements: CanvasDraftElement[]
): string {
  const payload = createCanvasClipboardPayload(elements)
  const serialized = serializeCanvasClipboardPayload(payload)
  const plainText = buildCanvasClipboardPlainText(elements)
  dataTransfer.setData(CANVAS_CLIPBOARD_FORMAT, serialized)
  if (plainText !== null) {
    dataTransfer.setData("text/plain", plainText)
  }
  return serialized
}

async function writeCanvasClipboardToNavigator(elements: CanvasDraftElement[]): Promise<string> {
  const payload = createCanvasClipboardPayload(elements)
  const serialized = serializeCanvasClipboardPayload(payload)
  const clipboardItemData: Record<string, Blob> = {
    [CANVAS_WEB_CUSTOM_CLIPBOARD_FORMAT]: new Blob([serialized], {
      type: CANVAS_CLIPBOARD_FORMAT,
    }),
  }
  const plainText = buildCanvasClipboardPlainText(elements)
  if (plainText !== null) {
    clipboardItemData["text/plain"] = new Blob([plainText], {
      type: "text/plain",
    })
  }

  await navigator.clipboard.write([new ClipboardItem(clipboardItemData)])
  return serialized
}

function readCanvasClipboardFromDataTransfer(
  dataTransfer: DataTransfer
): CanvasClipboardReadResult {
  let sawStructuredPayload = false
  for (const format of [CANVAS_CLIPBOARD_FORMAT, CANVAS_WEB_CUSTOM_CLIPBOARD_FORMAT]) {
    const payloadText = dataTransfer.getData(format)
    if (!payloadText) {
      continue
    }
    sawStructuredPayload = true
    const payload = parseCanvasClipboardPayload(payloadText)
    if (payload) {
      return {
        kind: "canvas",
        payload,
        signature: serializeCanvasClipboardPayload(payload),
      }
    }
  }
  if (sawStructuredPayload) {
    return { kind: "invalid" }
  }

  const plainText = dataTransfer.getData("text/plain")
  if (plainText) {
    return {
      kind: "text",
      text: plainText,
      signature: `text:${plainText}`,
    }
  }

  return { kind: "empty" }
}

async function readCanvasClipboardFromNavigator(): Promise<CanvasClipboardReadResult> {
  const items = await navigator.clipboard.read()
  let sawStructuredPayload = false

  for (const item of items) {
    for (const format of [CANVAS_WEB_CUSTOM_CLIPBOARD_FORMAT, CANVAS_CLIPBOARD_FORMAT]) {
      if (item.types.includes(format)) {
        sawStructuredPayload = true
        const blob = await item.getType(format)
        const payload = parseCanvasClipboardPayload(await blob.text())
        if (payload) {
          return {
            kind: "canvas",
            payload,
            signature: serializeCanvasClipboardPayload(payload),
          }
        }
      }
    }
  }
  if (sawStructuredPayload) {
    return { kind: "invalid" }
  }

  for (const item of items) {
    if (item.types.includes("text/plain")) {
      const blob = await item.getType("text/plain")
      const text = await blob.text()
      if (text) {
        return {
          kind: "text",
          text,
          signature: `text:${text}`,
        }
      }
    }
  }

  return { kind: "empty" }
}

function getViewportCenterInCanvasSpace(
  viewport: StageViewport,
  viewportSize: StageViewportSize
): { x: number; y: number } {
  const displayScale = viewport.scale * CANVAS_DOTS_PER_MILLIMETER
  const left = -viewport.x / displayScale
  const top = -viewport.y / displayScale

  return {
    x: left + viewportSize.width / displayScale / 2,
    y: top + viewportSize.height / displayScale / 2,
  }
}

function createClipboardTextElement(
  state: CanvasPageState,
  text: string,
  viewportSize: StageViewportSize
): Extract<CanvasDraftElement, { kind: "text" }> {
  const seeded = createCanvasElement("text", state.liveDraft.elements.length, {
    value: text,
    height: undefined,
    maxLines: undefined,
  })

  if (seeded.kind !== "text") {
    throw new Error("unexpected clipboard text seed")
  }

  const layout = resolveTextLayout({
    text,
    fontSize: seeded.fontSize,
    width: seeded.width,
    height: seeded.height,
    lineHeight: seeded.lineHeight,
    fontFamily: seeded.fontFamily,
    fontWeight: seeded.fontWeight,
    align: seeded.align,
    maxLines: seeded.maxLines,
    verticalAlign: seeded.verticalAlign,
    stretchX: seeded.stretchX,
    stretchY: seeded.stretchY,
    autoWrap: seeded.autoWrap,
    verticalText: seeded.verticalText,
    measureText: measureCanvasTextLine,
  })
  const center = getViewportCenterInCanvasSpace(state.viewport, viewportSize)
  const width = seeded.width
  const height = layout.naturalHeight

  return {
    ...seeded,
    value: text,
    height,
    maxLines: undefined,
    x: center.x - width / 2,
    y: center.y - height / 2,
  }
}

function applyDraftPreviewUpdate(
  state: CanvasPageState,
  updater: (draft: CanvasDraftDocument) => CanvasDraftDocument
): CanvasPageState {
  const nextDraft = normalizeDraftDocument(updater(cloneDraft(state.draft)))
  nextDraft.editor.gridEnabled = state.gridEnabled
  nextDraft.editor.snapEnabled = state.snapEnabled
  return {
    ...state,
    draft: nextDraft,
    selectedIds: updateSelectionAfterDraft(state, nextDraft),
    storageMode: "persisted",
  }
}

function clearPendingPastePreview(
  state: CanvasPageState,
  options?: {
    outputStatus?: string
    restoreSelection?: boolean
  }
): CanvasPageState {
  if (!state.pendingPaste) {
    return {
      ...state,
      outputStatus: options?.outputStatus ?? state.outputStatus,
    }
  }

  const previousSelectedIds = options?.restoreSelection
    ? state.pendingPaste.previousSelectedIds.filter((id) =>
        state.liveDraft.elements.some((element) => element.id === id)
      )
    : state.selectedIds.filter((id) =>
        state.liveDraft.elements.some((element) => element.id === id)
      )

  return {
    ...state,
    draft: cloneDraft(state.liveDraft),
    selectedIds: previousSelectedIds,
    editingId: options?.restoreSelection ? state.pendingPaste.previousEditingId : state.editingId,
    pendingPaste: null,
    outputStatus: options?.outputStatus ?? state.outputStatus,
  }
}

export function cancelPendingPastePlacement(state: CanvasPageState): CanvasPageState {
  return clearPendingPastePreview(state, {
    outputStatus: "已取消粘贴放置。",
    restoreSelection: true,
  })
}

export function confirmPendingPastePlacement(state: CanvasPageState): CanvasPageState {
  if (!state.pendingPaste) {
    return state
  }

  const nextDraft = normalizeDraftDocument(cloneDraft(state.draft))
  nextDraft.editor.gridEnabled = state.gridEnabled
  nextDraft.editor.snapEnabled = state.snapEnabled
  const next = pushHistory(state, nextDraft)

  return {
    ...next,
    selectedIds: state.pendingPaste.ids.filter((id) =>
      nextDraft.elements.some((element) => element.id === id)
    ),
    editingId: null,
    pendingPaste: null,
    outputStatus: state.pendingPaste.confirmStatus,
    storageMode: "persisted",
  }
}

export function movePendingPasteToPoint(
  state: CanvasPageState,
  point: { x: number; y: number }
): CanvasPageState {
  if (!state.pendingPaste) {
    return state
  }

  const pendingElements = state.draft.elements.filter((element) =>
    state.pendingPaste?.ids.includes(element.id)
  )
  const bounds = getElementSelectionBoundsForIds(pendingElements)
  if (!bounds) {
    return clearPendingPastePreview(state)
  }

  const delta = getSelectionTranslationToPoint(bounds, point, state.snapEnabled)
  const deltaX = delta.x
  const deltaY = delta.y
  if (Math.abs(deltaX) < 0.001 && Math.abs(deltaY) < 0.001) {
    return state
  }

  const pendingIds = new Set(state.pendingPaste.ids)
  return applyDraftPreviewUpdate(state, (draft) => ({
    ...draft,
    elements: translateElementsByIds(draft.elements, pendingIds, deltaX, deltaY),
  }))
}

export function startClipboardPastePlacement(
  state: CanvasPageState,
  clipboard: CanvasClipboardReadResult,
  viewportSize: StageViewportSize,
  point?: { x: number; y: number }
): CanvasPageState {
  const baseState = state.pendingPaste
    ? clearPendingPastePreview(state, { restoreSelection: true })
    : state

  if (clipboard.kind === "invalid") {
    return {
      ...baseState,
      outputStatus: "剪贴板中的画布内容不可用。",
    }
  }

  if (clipboard.kind === "empty") {
    return {
      ...baseState,
      outputStatus: "剪贴板中没有可粘贴的画布内容。",
    }
  }

  const placementPoint = point ?? getViewportCenterInCanvasSpace(baseState.viewport, viewportSize)
  const placementHint = "移动鼠标以放置，单击确认，按 Esc 取消。"

  if (clipboard.kind === "canvas") {
    let sourceElements: CanvasDraftElement[]
    try {
      sourceElements = normalizeClipboardElements(baseState, clipboard.payload.elements)
    } catch {
      return {
        ...baseState,
        outputStatus: "剪贴板中的画布内容不可用。",
      }
    }
    if (sourceElements.length === 0) {
      return {
        ...baseState,
        outputStatus: "剪贴板中的画布内容不可用。",
      }
    }

    const nextSelectedIds: string[] = []
    const previewElements = sourceElements.map((element, index) => {
      const clone = duplicateDraftElement(element, baseState.liveDraft.elements.length + index, {
        offsetX: 0,
        offsetY: 0,
      })
      nextSelectedIds.push(clone.id)
      return clone
    })
    const previewBounds = getElementSelectionBoundsForIds(previewElements)
    if (!previewBounds) {
      return {
        ...baseState,
        outputStatus: "剪贴板中的画布内容不可用。",
      }
    }

    const delta = getSelectionTranslationToPoint(
      previewBounds,
      placementPoint,
      baseState.snapEnabled
    )
    const positionedPreviewElements = previewElements.map((element) =>
      translateElement(element, delta.x, delta.y)
    )
    const nextDraft = normalizeDraftDocument({
      ...cloneDraft(baseState.liveDraft),
      elements: [...baseState.liveDraft.elements, ...positionedPreviewElements],
    })
    nextDraft.editor.gridEnabled = baseState.gridEnabled
    nextDraft.editor.snapEnabled = baseState.snapEnabled

    return {
      ...baseState,
      draft: nextDraft,
      selectedIds: nextSelectedIds,
      editingId: null,
      pendingPaste: {
        ids: nextSelectedIds,
        previousSelectedIds: baseState.selectedIds,
        previousEditingId: baseState.editingId,
        confirmStatus:
          nextSelectedIds.length === 1
            ? "已粘贴 1 个图层。"
            : `已粘贴 ${nextSelectedIds.length} 个图层。`,
      },
      outputStatus: placementHint,
    }
  }

  const seededTextElement = createClipboardTextElement(baseState, clipboard.text, viewportSize)
  const textBounds = getElementSelectionBounds(seededTextElement)
  const textDelta = getSelectionTranslationToPoint(
    textBounds,
    placementPoint,
    baseState.snapEnabled
  )
  const nextTextElement = translateElement(seededTextElement, textDelta.x, textDelta.y) as Extract<
    CanvasDraftElement,
    { kind: "text" }
  >
  const nextDraft = normalizeDraftDocument({
    ...cloneDraft(baseState.liveDraft),
    elements: [...baseState.liveDraft.elements, nextTextElement],
  })
  nextDraft.editor.gridEnabled = baseState.gridEnabled
  nextDraft.editor.snapEnabled = baseState.snapEnabled

  return {
    ...baseState,
    draft: nextDraft,
    selectedIds: [nextTextElement.id],
    editingId: null,
    pendingPaste: {
      ids: [nextTextElement.id],
      previousSelectedIds: baseState.selectedIds,
      previousEditingId: baseState.editingId,
      confirmStatus: "已将剪贴板文本粘贴为新文本图层。",
    },
    outputStatus: placementHint,
  }
}

function hasVisibleTextSelection(state: CanvasPageState) {
  return (
    state.selectedIds.length === 1 &&
    state.draft.elements.some(
      (element) =>
        element.id === state.selectedIds[0] && element.kind === "text" && element.meta.visible
    )
  )
}

function rotateCanvasPoint(
  point: { x: number; y: number },
  origin: { x: number; y: number },
  rotation: number
): { x: number; y: number } {
  const radians = (rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  }
}

function elementContainsDraftPoint(element: CanvasDraftElement, point: { x: number; y: number }) {
  const geometry = getElementGeometry(element)
  const rotation = "rotation" in element ? (element.rotation ?? 0) : 0
  const unrotatedPoint = rotation
    ? rotateCanvasPoint(point, geometry.stagePosition, -rotation)
    : point
  const localX = unrotatedPoint.x - (geometry.stagePosition.x - geometry.rotationOrigin.x)
  const localY = unrotatedPoint.y - (geometry.stagePosition.y - geometry.rotationOrigin.y)
  return (
    localX >= geometry.localBounds.x &&
    localX <= geometry.localBounds.x + geometry.localBounds.width &&
    localY >= geometry.localBounds.y &&
    localY <= geometry.localBounds.y + geometry.localBounds.height
  )
}

function findEditableTextElementAtPoint(
  draft: CanvasDraftDocument,
  point: { x: number; y: number }
): Extract<CanvasDraftElement, { kind: "text" }> | null {
  for (const element of [...draft.elements].reverse()) {
    if (!element.meta.visible) {
      continue
    }
    if (!elementContainsDraftPoint(element, point)) {
      continue
    }
    return element.kind === "text" && !element.meta.locked ? element : null
  }
  return null
}

function createViewport(
  width: number,
  height: number,
  viewportWidth = STAGE_VIEWPORT_WIDTH,
  viewportHeight = STAGE_VIEWPORT_HEIGHT
): StageViewport {
  const displayWidth = width * CANVAS_DOTS_PER_MILLIMETER
  const displayHeight = height * CANVAS_DOTS_PER_MILLIMETER
  const scale = clamp(
    Math.min(
      viewportWidth / Math.max(displayWidth, 1),
      viewportHeight / Math.max(displayHeight, 1),
      ZOOM_MAX
    ),
    ZOOM_MIN,
    ZOOM_MAX
  )
  return {
    scale,
    x: (viewportWidth - displayWidth * scale) / 2,
    y: (viewportHeight - displayHeight * scale) / 2,
  }
}

function createScenarioDraft(scenario: CanvasStoryScenario): CanvasDraftDocument {
  if (
    scenario === "draft-restore" ||
    scenario === "text-selected" ||
    scenario === "text-font-metrics" ||
    scenario === "text-justify-selected" ||
    scenario === "text-justify-multiline-selected" ||
    scenario === "text-justify-centered-selected" ||
    scenario === "text-justify-top-selected" ||
    scenario === "text-centered-selected" ||
    scenario === "text-ready" ||
    scenario === "barcode-invalid" ||
    scenario === "datamatrix-selected" ||
    scenario === "datamatrix-invalid" ||
    scenario === "rect-selected" ||
    scenario === "circle-selected" ||
    scenario === "triangle-selected" ||
    scenario === "line-selected"
  ) {
    return buildStoryScenarioDocument(scenario)
  }

  if (
    scenario === "wide-default" ||
    scenario === "barcode-selected" ||
    scenario === "marquee-selection"
  ) {
    return createDraftFromPreset(getPresetById("shipping-wide"))
  }

  return createDraftFromPreset(getPresetById("ops-tag"))
}

function shouldUseScenarioDraft(scenario: CanvasStoryScenario): boolean {
  return (
    scenario === "draft-restore" ||
    scenario === "text-selected" ||
    scenario === "text-font-metrics" ||
    scenario === "text-justify-selected" ||
    scenario === "text-justify-multiline-selected" ||
    scenario === "text-justify-centered-selected" ||
    scenario === "text-justify-top-selected" ||
    scenario === "text-centered-selected" ||
    scenario === "text-ready" ||
    scenario === "barcode-invalid" ||
    scenario === "datamatrix-selected" ||
    scenario === "datamatrix-invalid" ||
    scenario === "rect-selected" ||
    scenario === "circle-selected" ||
    scenario === "triangle-selected" ||
    scenario === "line-selected"
  )
}

export function createCanvasStateFromDraft(
  rawDraft: CanvasDraftDocument,
  options?: {
    selectedIds?: string[]
    activePanel?: CanvasPageState["activePanel"]
    focus?: CanvasPageState["focus"]
    outputStatus?: string
    loading?: boolean
    viewport?: StageViewport
    selectionBox?: CanvasSelectionBox
    versionHistory?: UserTemplateHistory | null
    versionsOpen?: boolean
  }
): CanvasPageState {
  const draft = normalizeDraftDocument(rawDraft)
  return {
    routeSource: draft.source,
    presetId: draft.presetId,
    liveDraft: draft,
    draft,
    versionHistory: options?.versionHistory ?? null,
    readOnlyVersion: null,
    selectedIds: options?.selectedIds ?? [],
    activePanel: options?.activePanel ?? "attributes",
    focus: options?.focus ?? "left-center",
    gridEnabled: draft.editor.gridEnabled,
    snapEnabled: draft.editor.snapEnabled,
    spacePressed: false,
    viewport: options?.viewport ?? createViewport(draft.width, draft.height),
    selectionBox: options?.selectionBox ?? EMPTY_SELECTION_BOX,
    history: [cloneDraft(draft)],
    historyIndex: 0,
    editingId: null,
    pendingPaste: null,
    outputStatus: options?.outputStatus ?? "",
    autosavesExpanded: false,
    versionsOpen: options?.versionsOpen ?? false,
    loading: options?.loading ?? false,
    storageMode: "persisted",
  }
}

function getScenarioSelection(draft: CanvasDraftDocument, scenario: CanvasStoryScenario): string[] {
  if (scenario === "barcode-selected" || scenario === "barcode-invalid") {
    const barcode = draft.elements.find((element) => element.kind === "barcode")
    return barcode ? [barcode.id] : []
  }
  if (scenario === "datamatrix-selected" || scenario === "datamatrix-invalid") {
    const dataMatrix = draft.elements.find((element) => element.kind === "datamatrix")
    return dataMatrix ? [dataMatrix.id] : []
  }
  if (
    scenario === "text-selected" ||
    scenario === "text-font-metrics" ||
    scenario === "text-justify-selected" ||
    scenario === "text-justify-multiline-selected" ||
    scenario === "text-justify-centered-selected" ||
    scenario === "text-justify-top-selected" ||
    scenario === "text-centered-selected" ||
    scenario === "text-ready" ||
    scenario === "draft-restore"
  ) {
    const text = draft.elements.find((element) => element.kind === "text")
    return text ? [text.id] : []
  }
  if (scenario === "rect-selected") {
    const rect = draft.elements.find((element) => element.kind === "rect")
    return rect ? [rect.id] : []
  }
  if (scenario === "circle-selected") {
    const circle = draft.elements.find((element) => element.kind === "circle")
    return circle ? [circle.id] : []
  }
  if (scenario === "triangle-selected") {
    const triangle = draft.elements.find((element) => element.kind === "triangle")
    return triangle ? [triangle.id] : []
  }
  if (scenario === "line-selected") {
    const line = draft.elements.find((element) => element.kind === "line")
    return line ? [line.id] : []
  }
  return []
}

function getScenarioViewport(
  _draft: CanvasDraftDocument,
  scenario: CanvasStoryScenario
): StageViewport | undefined {
  if (scenario !== "marquee-selection") {
    return undefined
  }
  return {
    scale: 3.44,
    x: -370,
    y: 36,
  }
}

function getScenarioSelectionBox(scenario: CanvasStoryScenario): CanvasSelectionBox | undefined {
  if (scenario !== "marquee-selection") {
    return undefined
  }
  return {
    x1: 31.5,
    y1: 11.5,
    x2: 40,
    y2: 16,
    visible: true,
  }
}

function createCanvasState(
  presetId: string,
  scenario: CanvasStoryScenario = "wide-default"
): CanvasPageState {
  const preset = getPresetById(presetId)
  const seededDraft = createScenarioDraft(scenario)
  const shouldRestoreStoredDraft = scenario === "wide-default" || scenario === "narrow-default"
  const storedDraft = shouldRestoreStoredDraft ? loadStoredDraftDocument(preset.id) : null
  const draft =
    storedDraft ??
    (shouldUseScenarioDraft(scenario) || seededDraft.presetId === preset.id
      ? seededDraft
      : createDraftFromPreset(preset))
  return {
    ...createCanvasStateFromDraft(draft, {
      selectedIds: getScenarioSelection(draft, scenario),
      activePanel: scenario === "output-tab" ? "output" : "attributes",
      focus: scenario === "output-tab" ? "center-right" : "left-center",
      viewport: getScenarioViewport(draft, scenario),
      selectionBox: getScenarioSelectionBox(scenario),
      outputStatus:
        scenario === "draft-restore"
          ? "已恢复上次草稿。"
          : storedDraft
            ? `已恢复「${draft.name}」的最近草稿。`
            : "",
    }),
    editingId:
      scenario === "text-selected" ||
      scenario === "text-justify-selected" ||
      scenario === "text-justify-multiline-selected" ||
      scenario === "text-justify-centered-selected" ||
      scenario === "text-justify-top-selected" ||
      scenario === "text-centered-selected"
        ? (getScenarioSelection(draft, scenario)[0] ?? null)
        : null,
  }
}

function pushHistory(state: CanvasPageState, nextDraft: CanvasDraftDocument): CanvasPageState {
  const nextHistory = state.history.slice(0, state.historyIndex + 1)
  nextHistory.push(cloneDraft(nextDraft))
  const history = nextHistory.slice(-CANVAS_HISTORY_LIMIT)
  return {
    ...state,
    liveDraft: nextDraft,
    draft: nextDraft,
    history,
    historyIndex: history.length - 1,
  }
}

function updateSelectionAfterDraft(state: CanvasPageState, draft: CanvasDraftDocument) {
  return state.selectedIds.filter((id) => draft.elements.some((element) => element.id === id))
}

function applyDraftUpdate(
  state: CanvasPageState,
  updater: (draft: CanvasDraftDocument) => CanvasDraftDocument
): CanvasPageState {
  const nextDraft = normalizeDraftDocument(updater(cloneDraft(state.liveDraft)))
  nextDraft.editor.gridEnabled = state.gridEnabled
  nextDraft.editor.snapEnabled = state.snapEnabled
  const next = pushHistory(state, nextDraft)
  return {
    ...next,
    selectedIds: updateSelectionAfterDraft(state, nextDraft),
    storageMode: "persisted",
  }
}

function applyLiveDraftUpdate(
  state: CanvasPageState,
  updater: (draft: CanvasDraftDocument) => CanvasDraftDocument
): CanvasPageState {
  const nextDraft = normalizeDraftDocument(updater(cloneDraft(state.liveDraft)))
  nextDraft.editor.gridEnabled = state.gridEnabled
  nextDraft.editor.snapEnabled = state.snapEnabled
  return {
    ...state,
    liveDraft: nextDraft,
    draft: nextDraft,
    selectedIds: updateSelectionAfterDraft(state, nextDraft),
    storageMode: "persisted",
  }
}

function updateEditorAssistState(
  state: CanvasPageState,
  nextEditor: CanvasDraftDocument["editor"]
): CanvasPageState {
  return {
    ...state,
    gridEnabled: nextEditor.gridEnabled,
    snapEnabled: nextEditor.snapEnabled,
    liveDraft: {
      ...state.liveDraft,
      editor: nextEditor,
    },
    draft: {
      ...state.draft,
      editor: nextEditor,
    },
    storageMode: "persisted",
  }
}

function setSelection(state: CanvasPageState, id: string, multi: boolean): CanvasPageState {
  const isSelected = state.selectedIds.includes(id)
  if (!multi) {
    return { ...state, selectedIds: [id], editingId: null }
  }
  return {
    ...state,
    selectedIds: isSelected
      ? state.selectedIds.filter((currentId) => currentId !== id)
      : [...state.selectedIds, id],
    editingId: null,
  }
}

function snapValue(value: number, enabled: boolean) {
  if (!enabled) {
    return value
  }
  return Math.round(value / GRID_SIZE) * GRID_SIZE
}

function snapDimension(value: number, min: number, enabled: boolean) {
  if (!enabled) {
    return Math.max(min, value)
  }
  return Math.max(min, snapValue(value, true))
}

function clampRectRadius(radius: number, width: number, height: number) {
  return clamp(radius, 0, Math.max(0, Math.min(width, height) / 2))
}

function isSquareResizeElement(element: CanvasDraftElement | null) {
  return element?.kind === "qr" || element?.kind === "datamatrix" || element?.kind === "circle"
}

function blurActiveInlineTextEditor() {
  if (typeof document === "undefined") {
    return false
  }
  const activeElement = document.activeElement
  if (
    activeElement instanceof HTMLTextAreaElement &&
    activeElement.matches(INLINE_TEXT_EDITOR_SELECTOR)
  ) {
    activeElement.blur()
    return true
  }
  const inlineEditor = document.querySelector<HTMLTextAreaElement>(INLINE_TEXT_EDITOR_SELECTOR)
  if (!inlineEditor) {
    return false
  }
  inlineEditor.blur()
  return true
}

function updateLineEndpoint(
  draft: CanvasDraftDocument,
  lineId: string,
  endpoint: LineEndpoint,
  point: { x: number; y: number },
  snapEnabled: boolean
): CanvasDraftDocument {
  const nextPoint = {
    x: snapValue(point.x, snapEnabled),
    y: snapValue(point.y, snapEnabled),
  }
  return normalizeDraftDocument({
    ...draft,
    elements: draft.elements.map((element) => {
      if (element.id !== lineId || element.kind !== "line") {
        return element
      }
      return endpoint === "start"
        ? {
            ...element,
            x: nextPoint.x,
            y: nextPoint.y,
          }
        : {
            ...element,
            x2: nextPoint.x,
            y2: nextPoint.y,
          }
    }),
  })
}

function snapElementPosition(element: CanvasDraftElement, x: number, y: number, enabled: boolean) {
  const nextX = snapValue(x, enabled)
  const nextY = snapValue(y, enabled)
  if (element.kind === "line") {
    return {
      x: nextX,
      y: nextY,
      x2: snapValue(nextX + (element.x2 - element.x), enabled),
      y2: snapValue(nextY + (element.y2 - element.y), enabled),
    }
  }
  return { x: nextX, y: nextY }
}

function getSelectionTranslationToPoint(
  bounds: { x: number; y: number; width: number; height: number },
  point: { x: number; y: number },
  snapEnabled: boolean
) {
  const deltaX = point.x - (bounds.x + bounds.width / 2)
  const deltaY = point.y - (bounds.y + bounds.height / 2)
  return {
    x: snapEnabled ? snapValue(deltaX, true) : deltaX,
    y: snapEnabled ? snapValue(deltaY, true) : deltaY,
  }
}

export function getSnappedDragStagePosition(
  element: CanvasDraftElement,
  canvasPosition: { x: number; y: number },
  rotationOrigin: { x: number; y: number },
  snapEnabled: boolean
) {
  const snappedPosition = snapElementPosition(
    element,
    canvasPosition.x - rotationOrigin.x,
    canvasPosition.y - rotationOrigin.y,
    snapEnabled
  )
  return {
    x: snappedPosition.x + rotationOrigin.x,
    y: snappedPosition.y + rotationOrigin.y,
  }
}

function projectCanvasPointToStagePosition(
  point: { x: number; y: number },
  viewport: StageViewport
) {
  const displayScale = viewport.scale * CANVAS_DOTS_PER_MILLIMETER
  return {
    x: viewport.x + point.x * displayScale,
    y: viewport.y + point.y * displayScale,
  }
}

export function getSnappedDragAbsolutePosition(
  element: CanvasDraftElement,
  absolutePosition: { x: number; y: number },
  rotationOrigin: { x: number; y: number },
  viewport: StageViewport,
  snapEnabled: boolean
) {
  return projectCanvasPointToStagePosition(
    getSnappedDragStagePosition(
      element,
      projectStagePointToCanvasPosition(absolutePosition, viewport),
      rotationOrigin,
      snapEnabled
    ),
    viewport
  )
}

function projectStagePointToCanvasPosition(
  point: { x: number; y: number },
  viewport: StageViewport
) {
  const displayScale = viewport.scale * CANVAS_DOTS_PER_MILLIMETER
  return {
    x: (point.x - viewport.x) / displayScale,
    y: (point.y - viewport.y) / displayScale,
  }
}

export function createSelectionDragPreview(
  baseDraft: CanvasDraftDocument,
  draggedId: string,
  selectedIds: string[],
  stagePosition: { x: number; y: number },
  rotationOrigin: { x: number; y: number },
  snapEnabled: boolean
): {
  deltaX: number
  deltaY: number
  draft: CanvasDraftDocument
  movedIds: string[]
} | null {
  const draggedElement = baseDraft.elements.find((element) => element.id === draggedId)
  if (!draggedElement) {
    return null
  }

  const movedIds = selectedIds.includes(draggedId) ? selectedIds : [draggedId]
  const snappedPosition = snapElementPosition(
    draggedElement,
    stagePosition.x - rotationOrigin.x,
    stagePosition.y - rotationOrigin.y,
    snapEnabled
  )
  const deltaX = snappedPosition.x - draggedElement.x
  const deltaY = snappedPosition.y - draggedElement.y
  const draft = normalizeDraftDocument({
    ...cloneDraft(baseDraft),
    elements: translateElementsByIds(baseDraft.elements, new Set(movedIds), deltaX, deltaY),
  })

  return {
    deltaX,
    deltaY,
    draft,
    movedIds,
  }
}

function getStagePointer(
  stage: Konva.Stage,
  viewport: StageViewport
): { x: number; y: number } | null {
  const pointer = stage.getPointerPosition()
  if (!pointer) {
    return null
  }
  return {
    x: (pointer.x - viewport.x) / (viewport.scale * CANVAS_DOTS_PER_MILLIMETER),
    y: (pointer.y - viewport.y) / (viewport.scale * CANVAS_DOTS_PER_MILLIMETER),
  }
}

function fitViewport(
  state: CanvasPageState,
  viewportWidth = STAGE_VIEWPORT_WIDTH,
  viewportHeight = STAGE_VIEWPORT_HEIGHT
): CanvasPageState {
  return {
    ...state,
    viewport: createViewport(state.draft.width, state.draft.height, viewportWidth, viewportHeight),
  }
}

function resizeCanvasDraft(
  state: CanvasPageState,
  dimension: CanvasDimension,
  viewportWidth = STAGE_VIEWPORT_WIDTH,
  viewportHeight = STAGE_VIEWPORT_HEIGHT
): CanvasPageState {
  if (dimension.width === state.liveDraft.width && dimension.height === state.liveDraft.height) {
    return state
  }

  const next = applyDraftUpdate(state, (draft) => ({
    ...draft,
    width: dimension.width,
    height: dimension.height,
  }))
  return {
    ...fitViewport(next, viewportWidth, viewportHeight),
    outputStatus: "已更新标签尺寸。",
  }
}

function getPrintTargetWidth(controller: WorkbenchController): number {
  return (
    controller.selectedPrinter?.capabilities.printWidthDots ??
    controller.renderOptions.printWidthDots
  )
}

function getCanvasCapabilityWarning(draft: CanvasDraftDocument, controller: WorkbenchController) {
  const targetWidth = getPrintTargetWidth(controller)
  return getCanvasDimensionCapabilityMessage(draft, targetWidth)
}

function getVisibleGridBounds(
  viewport: StageViewport,
  viewportWidth = STAGE_VIEWPORT_WIDTH,
  viewportHeight = STAGE_VIEWPORT_HEIGHT
) {
  const displayScale = viewport.scale * CANVAS_DOTS_PER_MILLIMETER
  const left = -viewport.x / displayScale
  const top = -viewport.y / displayScale
  const right = left + viewportWidth / displayScale
  const bottom = top + viewportHeight / displayScale

  return {
    left,
    top,
    right,
    bottom,
    startX: Math.floor(left / GRID_SIZE) * GRID_SIZE,
    endX: Math.ceil(right / GRID_SIZE) * GRID_SIZE,
    startY: Math.floor(top / GRID_SIZE) * GRID_SIZE,
    endY: Math.ceil(bottom / GRID_SIZE) * GRID_SIZE,
  }
}

function resetDraft(state: CanvasPageState): CanvasPageState {
  if (state.routeSource.kind === "preset-template") {
    clearStoredDraftDocument(state.routeSource.presetId)
    return {
      ...createCanvasStateFromDraft(
        createDraftFromSystemTemplate(getSystemTemplateById(state.routeSource.presetId))
      ),
      outputStatus: "已重置为系统模板初始内容。",
      storageMode: "reset-pending",
    }
  }

  if (state.routeSource.kind === "user-template") {
    const restoredDraft =
      state.versionHistory?.saved.find(
        (version) => version.id === state.versionHistory?.template.currentVersionId
      )?.document ?? state.liveDraft
    return {
      ...createCanvasStateFromDraft(cloneDraft(restoredDraft), {
        versionHistory: state.versionHistory,
      }),
      outputStatus: "已恢复到当前模板的已保存版本。",
    }
  }

  clearStoredDraftDocument(state.presetId)
  return {
    ...createCanvasStateFromDraft(
      createDraftFromPreset(getPresetById(state.routeSource.presetId)),
      {
        outputStatus: "已重置为内置草稿。",
      }
    ),
    storageMode: "reset-pending",
  }
}

async function resetCanvasDraft(args: {
  state: CanvasPageState
  controller: WorkbenchController
}): Promise<CanvasPageState> {
  const { state, controller } = args

  if (state.routeSource.kind === "user-template") {
    const currentVersion =
      state.versionHistory?.saved.find(
        (version) => version.id === state.versionHistory?.template.currentVersionId
      ) ?? null

    const restoredDraft = currentVersion
      ? createRestoredDraftFromVersion(currentVersion, state.routeSource.templateId)
      : cloneDraft(state.liveDraft)

    await replaceUserTemplateWorkingCopy({
      templateId: state.routeSource.templateId,
      source: state.routeSource,
      document: restoredDraft,
      sourceVersionId: currentVersion?.id,
    })
    await clearTemplateAutosaves(state.routeSource.templateId)
    await controller.refreshUserTemplates()

    const history = await readUserTemplateHistory(state.routeSource.templateId)
    return {
      ...createCanvasStateFromDraft(restoredDraft, {
        versionHistory: history,
      }),
      outputStatus: "已恢复到当前模板的已保存版本。",
    }
  }

  await clearWorkingCopy(state.routeSource)
  return resetDraft(state)
}

function duplicateSelected(state: CanvasPageState): CanvasPageState {
  if (state.selectedIds.length === 0) {
    return state
  }

  const nextSelectedIds: string[] = []
  const nextState = applyDraftUpdate(state, (draft) => {
    const nextElements = [...draft.elements]
    const orderedIds = draft.elements
      .filter((element) => state.selectedIds.includes(element.id))
      .map((element) => element.id)
    orderedIds.forEach((id) => {
      const index = nextElements.findIndex((element) => element.id === id)
      if (index < 0) {
        return
      }
      const sourceElement = nextElements[index]
      if (!sourceElement) {
        return
      }
      const clone = duplicateDraftElement(sourceElement, nextElements.length)
      nextElements.splice(index + 1, 0, clone)
      nextSelectedIds.push(clone.id)
    })
    return { ...draft, elements: nextElements }
  })

  return {
    ...nextState,
    selectedIds: nextSelectedIds,
    outputStatus: nextSelectedIds.length > 0 ? "已创建所选图层的新副本。" : nextState.outputStatus,
  }
}

function deleteSelected(state: CanvasPageState): CanvasPageState {
  if (state.selectedIds.length === 0) {
    return state
  }
  const next = applyDraftUpdate(state, (draft) => ({
    ...draft,
    elements: draft.elements.filter((element) => !state.selectedIds.includes(element.id)),
  }))
  return {
    ...next,
    selectedIds: [],
    editingId: null,
    outputStatus: "已删除所选图层。",
  }
}

function reorderSelection(
  state: CanvasPageState,
  direction: "forward" | "backward"
): CanvasPageState {
  const id = state.selectedIds[0]
  if (!id || state.selectedIds.length !== 1) {
    return state
  }
  return applyDraftUpdate(state, (draft) => ({
    ...draft,
    elements: reorderDraftElements(draft.elements, id, direction),
  }))
}

function undoDraft(state: CanvasPageState): CanvasPageState {
  if (state.historyIndex === 0) {
    return state
  }
  const previousDraft = state.history[state.historyIndex - 1]
  if (!previousDraft) {
    return state
  }
  const nextDraft = cloneDraft(previousDraft)
  return {
    ...state,
    liveDraft: nextDraft,
    draft: nextDraft,
    historyIndex: state.historyIndex - 1,
    selectedIds: updateSelectionAfterDraft(state, nextDraft),
    editingId: null,
  }
}

function redoDraft(state: CanvasPageState): CanvasPageState {
  if (state.historyIndex >= state.history.length - 1) {
    return state
  }
  const nextHistoryDraft = state.history[state.historyIndex + 1]
  if (!nextHistoryDraft) {
    return state
  }
  const nextDraft = cloneDraft(nextHistoryDraft)
  return {
    ...state,
    liveDraft: nextDraft,
    draft: nextDraft,
    historyIndex: state.historyIndex + 1,
    selectedIds: updateSelectionAfterDraft(state, nextDraft),
    editingId: null,
  }
}

function moveSelectedByKeyboard(
  state: CanvasPageState,
  deltaX: number,
  deltaY: number
): CanvasPageState {
  if (state.selectedIds.length === 0) {
    return state
  }
  return applyDraftUpdate(state, (draft) => ({
    ...draft,
    elements: draft.elements.map((element) =>
      state.selectedIds.includes(element.id)
        ? translateElement(
            element,
            state.snapEnabled ? snapValue(deltaX, true) : deltaX,
            state.snapEnabled ? snapValue(deltaY, true) : deltaY
          )
        : element
    ),
  }))
}

export function snapTransformedElementGeometry(
  element: CanvasDraftElement,
  snapEnabled: boolean
): CanvasDraftElement {
  if (!snapEnabled) {
    return element
  }

  switch (element.kind) {
    case "line":
      return {
        ...element,
        x: snapValue(element.x, true),
        y: snapValue(element.y, true),
        x2: snapValue(element.x2, true),
        y2: snapValue(element.y2, true),
      }
    case "text": {
      const width = snapDimension(element.width, 24 / CANVAS_DOTS_PER_MILLIMETER, true)
      const height = snapDimension(element.height, 8 / CANVAS_DOTS_PER_MILLIMETER, true)
      return {
        ...element,
        x: snapValue(element.x, true),
        y: snapValue(element.y, true),
        width,
        height,
      }
    }
    case "rect": {
      const width = snapDimension(element.width, 16 / CANVAS_DOTS_PER_MILLIMETER, true)
      const height = snapDimension(element.height, 16 / CANVAS_DOTS_PER_MILLIMETER, true)
      return {
        ...element,
        x: snapValue(element.x, true),
        y: snapValue(element.y, true),
        width,
        height,
        radius: clampRectRadius(element.radius, width, height),
      }
    }
    case "triangle": {
      const width = snapDimension(element.width, 16 / CANVAS_DOTS_PER_MILLIMETER, true)
      const height = snapDimension(element.height, 16 / CANVAS_DOTS_PER_MILLIMETER, true)
      return {
        ...element,
        x: snapValue(element.x, true),
        y: snapValue(element.y, true),
        width,
        height,
      }
    }
    case "barcode": {
      const width = snapDimension(element.width, 36 / CANVAS_DOTS_PER_MILLIMETER, true)
      const height = snapDimension(element.height, 18 / CANVAS_DOTS_PER_MILLIMETER, true)
      return {
        ...element,
        x: snapValue(element.x, true),
        y: snapValue(element.y, true),
        width,
        height,
      }
    }
    case "qr":
    case "datamatrix":
    case "circle": {
      const size = snapDimension(element.size, 24 / CANVAS_DOTS_PER_MILLIMETER, true)
      return {
        ...element,
        x: snapValue(element.x, true),
        y: snapValue(element.y, true),
        size,
      }
    }
  }
}

function applyTransformedNodeToElement(
  element: CanvasDraftElement,
  node: Konva.Group
): CanvasDraftElement {
  const scaleX = node.scaleX()
  const scaleY = node.scaleY()

  if (element.kind === "line") {
    const deltaX = element.x2 - element.x
    const deltaY = element.y2 - element.y
    const start = node.getTransform().point({ x: 0, y: 0 })
    const end = node.getTransform().point({ x: deltaX, y: deltaY })
    node.scaleX(1)
    node.scaleY(1)
    node.rotation(0)
    return {
      ...element,
      x: start.x,
      y: start.y,
      x2: end.x,
      y2: end.y,
    }
  }

  if (element.kind === "text") {
    node.scaleX(1)
    node.scaleY(1)
    const nextWidth = Math.max(24 / CANVAS_DOTS_PER_MILLIMETER, element.width * scaleX)
    const nextHeight = Math.max(8 / CANVAS_DOTS_PER_MILLIMETER, element.height * scaleY)
    return {
      ...element,
      x: node.x() - nextWidth / 2,
      y: node.y() - nextHeight / 2,
      width: nextWidth,
      height: nextHeight,
      rotation: node.rotation(),
    }
  }

  if (element.kind === "rect") {
    node.scaleX(1)
    node.scaleY(1)
    const nextWidth = Math.max(16 / CANVAS_DOTS_PER_MILLIMETER, element.width * scaleX)
    const nextHeight = Math.max(16 / CANVAS_DOTS_PER_MILLIMETER, element.height * scaleY)
    return {
      ...element,
      x: node.x() - nextWidth / 2,
      y: node.y() - nextHeight / 2,
      width: nextWidth,
      height: nextHeight,
      radius: clampRectRadius(element.radius, nextWidth, nextHeight),
      rotation: node.rotation(),
    }
  }

  if (element.kind === "triangle") {
    node.scaleX(1)
    node.scaleY(1)
    const nextWidth = Math.max(16 / CANVAS_DOTS_PER_MILLIMETER, element.width * scaleX)
    const nextHeight = Math.max(16 / CANVAS_DOTS_PER_MILLIMETER, element.height * scaleY)
    return {
      ...element,
      x: node.x() - nextWidth / 2,
      y: node.y() - nextHeight / 2,
      width: nextWidth,
      height: nextHeight,
      rotation: node.rotation(),
    }
  }

  if (element.kind === "barcode") {
    node.scaleX(1)
    node.scaleY(1)
    const nextWidth = Math.max(36 / CANVAS_DOTS_PER_MILLIMETER, element.width * scaleX)
    const nextHeight = Math.max(18 / CANVAS_DOTS_PER_MILLIMETER, element.height * scaleY)
    return {
      ...element,
      x: node.x() - nextWidth / 2,
      y: node.y() - nextHeight / 2,
      width: nextWidth,
      height: nextHeight,
      rotation: node.rotation(),
    }
  }

  if (element.kind === "qr" || element.kind === "datamatrix" || element.kind === "circle") {
    node.scaleX(1)
    node.scaleY(1)
    const nextSize = Math.max(
      24 / CANVAS_DOTS_PER_MILLIMETER,
      element.size * Math.max(scaleX, scaleY)
    )
    return {
      ...element,
      x: node.x() - nextSize / 2,
      y: node.y() - nextSize / 2,
      size: nextSize,
      ...(element.kind === "qr" || element.kind === "datamatrix"
        ? { rotation: node.rotation() }
        : {}),
    }
  }

  return element
}

function applyTransformedNodesToDraft(
  draft: CanvasDraftDocument,
  nodes: Konva.Group[],
  snapEnabled = false
): CanvasDraftDocument {
  return {
    ...draft,
    elements: draft.elements.map((item) => {
      const node = nodes.find((candidate) => candidate.id() === item.id)
      return node
        ? snapTransformedElementGeometry(applyTransformedNodeToElement(item, node), snapEnabled)
        : item
    }),
  }
}

function buildBarcodeRows(
  element: Extract<CanvasDraftElement, { kind: "barcode" }>
): Array<{ x: number; width: number }> {
  const encoded: {
    encodings?: Array<{
      data: string
      options: {
        width: number
        marginLeft?: number
      }
    }>
  } = {}

  JsBarcode(encoded, element.value || "TM-0001", {
    format: element.format,
    displayValue: false,
    margin: 0,
    width: 2,
    height: Math.max(8, canvasMillimetersToDots(element.height)),
  })

  const encoding = encoded.encodings?.[0]
  if (!encoding) {
    return []
  }

  const modules: Array<{ x: number; width: number }> = []
  let cursor = encoding.options.marginLeft ?? 0
  let runStart: number | null = null
  let runWidth = 0
  for (const bit of encoding.data) {
    if (bit === "1") {
      if (runStart === null) {
        runStart = cursor
      }
      runWidth += encoding.options.width
    } else if (runStart !== null) {
      modules.push({ x: runStart, width: runWidth })
      runStart = null
      runWidth = 0
    }
    cursor += encoding.options.width
  }
  if (runStart !== null) {
    modules.push({ x: runStart, width: runWidth })
  }
  const totalWidth = Math.max(cursor, 1)
  return modules.map((module) => ({
    x: (module.x / totalWidth) * element.width,
    width: Math.max((module.width / totalWidth) * element.width, 1 / CANVAS_DOTS_PER_MILLIMETER),
  }))
}

function buildQrCells(element: Extract<CanvasDraftElement, { kind: "qr" }>) {
  const qr = QRCode.create(element.value || "https://tuckmark.local", {
    errorCorrectionLevel: element.errorCorrectionLevel,
  })
  const size = qr.modules.size
  const cell = element.size / size
  const cells: Array<{ x: number; y: number; size: number }> = []
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (!qr.modules.data[row * size + column]) {
        continue
      }
      cells.push({ x: column * cell, y: row * cell, size: cell })
    }
  }
  return cells
}

function buildDataMatrixCells(element: Extract<CanvasDraftElement, { kind: "datamatrix" }>) {
  const encoding = encodeDataMatrix(element.value)
  const cell = element.size / encoding.moduleCount
  const cells: Array<{ x: number; y: number; size: number }> = []
  for (let row = 0; row < encoding.moduleCount; row += 1) {
    for (let column = 0; column < encoding.moduleCount; column += 1) {
      if (!encoding.modules[row * encoding.moduleCount + column]) {
        continue
      }
      cells.push({ x: column * cell, y: row * cell, size: cell })
    }
  }
  return cells
}

function createCanvasIssue(title: string, detail: string): CanvasIssue {
  return { title, detail }
}

function getBarcodeIssue(
  element: Extract<CanvasDraftElement, { kind: "barcode" }>
): CanvasIssue | null {
  if (!element.value.trim()) {
    return createCanvasIssue("条码内容为空", "请填写要编码的文本后再生成预览或打印。")
  }

  try {
    buildBarcodeRows(element)
    return null
  } catch (cause) {
    return createCanvasIssue(
      "条码内容无效",
      cause instanceof Error ? cause.message : "当前内容无法生成 Code128 条码。"
    )
  }
}

function getQrIssue(element: Extract<CanvasDraftElement, { kind: "qr" }>): CanvasIssue | null {
  if (!element.value.trim()) {
    return createCanvasIssue("二维码内容为空", "请输入二维码内容后再继续。")
  }

  try {
    buildQrCells(element)
    return null
  } catch (cause) {
    return createCanvasIssue(
      "二维码内容无效",
      cause instanceof Error ? cause.message : "当前内容无法生成二维码。"
    )
  }
}

function getDataMatrixIssue(
  element: Extract<CanvasDraftElement, { kind: "datamatrix" }>
): CanvasIssue | null {
  if (!element.value.trim()) {
    return createCanvasIssue("数据矩阵码内容为空", "请输入要编码的文本后再继续。")
  }

  try {
    buildDataMatrixCells(element)
    return null
  } catch (cause) {
    return createCanvasIssue(
      "数据矩阵码内容无效",
      cause instanceof Error ? cause.message : "当前内容无法生成 Data Matrix。"
    )
  }
}

function getElementIssue(element: CanvasDraftElement): CanvasIssue | null {
  switch (element.kind) {
    case "barcode":
      return getBarcodeIssue(element)
    case "qr":
      return getQrIssue(element)
    case "datamatrix":
      return getDataMatrixIssue(element)
    default:
      return null
  }
}

function getElementCanvasWarning(
  draft: CanvasDraftDocument,
  element: CanvasDraftElement
): CanvasIssue | null {
  const bounds = getElementSelectionBounds(element)
  if (
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.x + bounds.width > draft.width ||
    bounds.y + bounds.height > draft.height
  ) {
    return createCanvasIssue(
      "元素超出画布",
      "此元素仍会保留在草稿中，但超出标签边界的部分不会出现在最终画布内。"
    )
  }
  return null
}

function getVisibleDraftIssues(draft: CanvasDraftDocument) {
  return draft.elements.flatMap((element) => {
    if (!element.meta.visible) {
      return []
    }
    const issue = getElementIssue(element)
    return issue ? [{ element, issue }] : []
  })
}

function getVisibleDraftWarnings(draft: CanvasDraftDocument) {
  return draft.elements.flatMap((element) => {
    if (!element.meta.visible) {
      return []
    }
    const issue = getElementCanvasWarning(draft, element)
    return issue ? [{ element, issue }] : []
  })
}

function CanvasSection({
  title,
  description,
  aside,
  children,
  className,
}: {
  title: string
  description?: string
  aside?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("tm-editor-section", className)}>
      <div className="tm-editor-section__head">
        <div className="tm-editor-section__copy">
          <h3 className="tm-editor-section__title">{title}</h3>
          {description ? <p className="tm-editor-section__description">{description}</p> : null}
        </div>
        {aside ? <div className="tm-editor-section__aside">{aside}</div> : null}
      </div>
      <div className="tm-editor-section__body">{children}</div>
    </section>
  )
}

function useMediaQuery(query: string) {
  const getMatches = React.useCallback(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false
    }
    return window.matchMedia(query).matches
  }, [query])

  const [matches, setMatches] = React.useState(getMatches)

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return
    }
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [query])

  return matches
}

function useElementSize<T extends HTMLElement>(element: T | null): StageViewportSize | null {
  const [size, setSize] = React.useState<StageViewportSize | null>(null)

  React.useEffect(() => {
    if (!element) {
      return
    }

    const update = () =>
      setSize({
        width: Math.max(Math.round(element.clientWidth), 1),
        height: Math.max(Math.round(element.clientHeight), 1),
      })

    update()

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update)
      return () => window.removeEventListener("resize", update)
    }

    const observer = new ResizeObserver(() => update())
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return size
}

function resolveCanvasSource(searchParams: URLSearchParams): CanvasDraftSource {
  const rawSource = searchParams.get("source")
  if (rawSource === "preset-template") {
    return {
      kind: "preset-template",
      presetId: searchParams.get("templateId") ?? getSystemTemplateById("shipping-compact").id,
    }
  }
  if (rawSource === "user-template") {
    const templateId = searchParams.get("templateId")
    if (templateId) {
      return {
        kind: "user-template",
        templateId,
      }
    }
  }
  return {
    kind: "scratch",
    presetId: searchParams.get("presetId") ?? getPresetById("shipping-wide").id,
  }
}

function resolveInitialCanvasPanel(searchParams: URLSearchParams): CanvasPageState["activePanel"] {
  return searchParams.get("panel") === "output" ? "output" : "attributes"
}

function resolveCanvasStatus(searchParams: URLSearchParams): string {
  const status = searchParams.get("status")
  if (status === "saved") {
    return "已保存新版本。"
  }
  if (status === "created") {
    return "已保存为用户模板。"
  }
  return ""
}

async function loadDraftForSource(source: CanvasDraftSource): Promise<{
  draft: CanvasDraftDocument
  versionHistory: UserTemplateHistory | null
}> {
  if (source.kind === "user-template") {
    const versionHistory = await readUserTemplateHistory(source.templateId)
    if (!versionHistory) {
      throw new Error("当前用户模板不存在，可能已经被浏览器本地数据清理。")
    }
    const workingCopy = await loadWorkingCopy(source)
    if (workingCopy?.draft) {
      return {
        draft: workingCopy.draft,
        versionHistory,
      }
    }
    const currentVersion =
      versionHistory.saved.find(
        (version) => version.id === versionHistory.template.currentVersionId
      ) ?? versionHistory.saved[0]
    if (!currentVersion) {
      throw new Error("当前用户模板缺少已保存版本。")
    }
    return {
      draft: {
        ...cloneDraft(currentVersion.document),
        source,
        templateId: source.templateId,
        baseVersionId: currentVersion.id,
      },
      versionHistory,
    }
  }

  if (source.kind === "preset-template") {
    const legacyDraft = loadStoredDraftDocument(source.presetId)
    if (legacyDraft) {
      return {
        draft: {
          ...legacyDraft,
          source,
        },
        versionHistory: null,
      }
    }
    const workingCopy = await loadWorkingCopy(source)
    if (workingCopy?.draft) {
      return {
        draft: workingCopy.draft,
        versionHistory: null,
      }
    }
    return {
      draft: createDraftFromSystemTemplate(getSystemTemplateById(source.presetId)),
      versionHistory: null,
    }
  }

  const legacyDraft = loadStoredDraftDocument(source.presetId)
  if (legacyDraft) {
    return {
      draft: {
        ...legacyDraft,
        source,
      },
      versionHistory: null,
    }
  }

  const workingCopy = await loadWorkingCopy(source)
  if (workingCopy?.draft) {
    return {
      draft: workingCopy.draft,
      versionHistory: null,
    }
  }

  return {
    draft: createDraftFromPreset(getPresetById(source.presetId)),
    versionHistory: null,
  }
}

function createRestoredDraftFromVersion(
  version: UserTemplateVersionSnapshot,
  templateId: string
): CanvasDraftDocument {
  return {
    ...cloneDraft(version.document),
    source: {
      kind: "user-template",
      templateId,
    },
    templateId,
    baseVersionId: version.id,
    lastSavedAt: undefined,
  }
}

function getAutosaveBaselineDraft(args: {
  routeSource: CanvasDraftSource
  liveDraft: CanvasDraftDocument
  readOnlyVersion: UserTemplateVersionSnapshot | null
  versionHistory: UserTemplateHistory | null
}): CanvasDraftDocument | null {
  if (args.routeSource.kind !== "user-template" || !args.liveDraft.templateId) {
    return null
  }

  if (args.readOnlyVersion) {
    return args.readOnlyVersion.document
  }

  if (args.liveDraft.baseVersionId) {
    const savedVersion =
      args.versionHistory?.saved.find((version) => version.id === args.liveDraft.baseVersionId) ??
      null
    if (savedVersion) {
      return savedVersion.document
    }
  }

  const currentVersion =
    args.versionHistory?.saved.find(
      (version) => version.id === args.versionHistory?.template.currentVersionId
    ) ??
    args.versionHistory?.saved[0] ??
    null

  return currentVersion?.document ?? null
}

function TextInlineEditor({
  element,
  viewport,
  onCommit,
  onCancel,
}: {
  element: Extract<CanvasDraftElement, { kind: "text" }>
  viewport: StageViewport
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = React.useState(element.value)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const closingRef = React.useRef(false)
  const scale = viewport.scale * CANVAS_DOTS_PER_MILLIMETER
  const width = Math.max(element.width * scale, 1)
  const height = Math.max(element.height * scale, 1)
  const rotation = element.rotation ?? 0
  const layout = resolveTextLayout({
    text: value,
    fontSize: element.fontSize,
    fontFamily: element.fontFamily,
    fontWeight: element.fontWeight,
    width: element.width,
    height: element.height,
    lineHeight: element.lineHeight,
    align: element.align,
    maxLines: element.maxLines,
    verticalAlign: element.verticalAlign,
    stretchX: element.stretchX,
    stretchY: element.stretchY,
    autoWrap: element.autoWrap,
    verticalText: element.verticalText,
    measureText: measureCanvasTextLine,
  })
  const usesCustomTextLayout = element.align === "justify" || element.verticalText
  const contentWidth = Math.max(layout.contentWidth, element.fontSize)
  const contentHeight = Math.max(layout.contentHeight, element.fontSize)
  const stretchScaleX = element.stretchX ? element.width / Math.max(contentWidth, 0.0001) : 1
  const stretchScaleY = element.stretchY ? element.height / Math.max(contentHeight, 0.0001) : 1
  const contentX = usesCustomTextLayout
    ? layout.contentX
    : element.stretchX
      ? 0
      : alignOffset(
          element.width,
          contentWidth,
          element.align === "center" ? "middle" : element.align === "right" ? "end" : "start"
        )
  const contentY = element.verticalText
    ? layout.contentY
    : element.stretchY
      ? 0
      : alignOffset(
          element.height,
          contentHeight,
          element.verticalAlign === "middle"
            ? "middle"
            : element.verticalAlign === "bottom"
              ? "end"
              : "start"
        )
  const usesBoxWrapWidth = element.autoWrap && !element.verticalText && !element.stretchX
  const editorX = (usesBoxWrapWidth ? 0 : contentX) * scale
  const editorTextOffsetY =
    element.align === "justify" && element.verticalAlign !== "top" ? 0 : layout.textOffsetY
  const editorY = (contentY + editorTextOffsetY) * scale
  const editorWidth = Math.max((usesBoxWrapWidth ? element.width : contentWidth) * scale, 1)
  const editorHeight = Math.max((element.height - contentY) * scale, element.fontSize * scale)
  const editorTransform =
    stretchScaleX !== 1 || stretchScaleY !== 1
      ? `scale(${stretchScaleX}, ${stretchScaleY})`
      : undefined

  React.useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    textarea.focus()
    textarea.select()
  }, [])

  const commit = () => {
    if (closingRef.current) {
      return
    }
    closingRef.current = true
    onCommit(value)
  }

  const cancel = () => {
    if (closingRef.current) {
      return
    }
    closingRef.current = true
    onCancel()
  }

  return (
    <div
      className="pointer-events-auto absolute z-30"
      style={{
        left: viewport.x + element.x * scale,
        top: viewport.y + element.y * scale,
        width,
        height,
        overflow: "hidden",
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: "center center",
      }}
    >
      <Textarea
        ref={textareaRef}
        aria-label="画布文本内联编辑"
        data-tm-inline-text-editor="true"
        value={value}
        wrap={element.autoWrap ? "soft" : "off"}
        className="tm-selectable-text absolute min-h-0 resize-none overflow-hidden rounded-none border-0 bg-transparent p-0 text-black shadow-none outline-none transition-none focus-visible:ring-0"
        style={{
          left: editorX,
          top: editorY,
          width: editorWidth,
          height: editorHeight,
          fontFamily: getTextFontFamilyStack(element.fontFamily),
          fontSize: `${Math.max(8, element.fontSize * scale)}px`,
          fontWeight: element.fontWeight,
          lineHeight: getCanvasTextLineHeight(element.lineHeight),
          minHeight: 0,
          boxSizing: "border-box",
          color: MONO_INK,
          caretColor: MONO_INK,
          textAlign: element.align,
          textAlignLast: element.align === "justify" ? "justify" : "auto",
          textJustify: element.align === "justify" ? "inter-character" : "auto",
          whiteSpace: element.autoWrap ? "pre-wrap" : "pre",
          writingMode: element.verticalText ? "vertical-rl" : "horizontal-tb",
          transform: editorTransform,
          transformOrigin: "top left",
        }}
        onChange={(event) => setValue(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault()
            commit()
          } else if (event.key === "Escape") {
            event.preventDefault()
            cancel()
          }
        }}
      />
    </div>
  )
}

function CanvasToolbar({
  state,
  canUndo,
  canRedo,
  isWide,
  stageViewportSize,
  readOnly,
  onReset,
  onSave,
  onSaveAs,
  onRestoreVersion,
  onReturnCurrent,
  onOpenVersions,
  onChange,
}: {
  state: CanvasPageState
  canUndo: boolean
  canRedo: boolean
  isWide: boolean
  stageViewportSize: StageViewportSize
  readOnly: boolean
  onReset: () => Promise<void>
  onSave: () => Promise<void>
  onSaveAs: () => Promise<void>
  onRestoreVersion: () => void
  onReturnCurrent: () => void
  onOpenVersions: () => void
  onChange: React.Dispatch<React.SetStateAction<CanvasPageState>>
}) {
  const interactionLocked = readOnly || state.loading || state.pendingPaste !== null

  return (
    <div className="tm-canvas-toolbar">
      {!isWide ? (
        <div className="tm-canvas-toolbar__group tm-canvas-toolbar__group--segmented">
          <Button
            size="sm"
            variant={state.focus === "left-center" ? "default" : "outline"}
            disabled={state.loading}
            onClick={() => onChange((current) => ({ ...current, focus: "left-center" }))}
          >
            工具与图层
          </Button>
          <Button
            size="sm"
            variant={state.focus === "center-right" ? "default" : "outline"}
            disabled={state.loading}
            onClick={() => onChange((current) => ({ ...current, focus: "center-right" }))}
          >
            属性与输出
          </Button>
        </div>
      ) : null}
      <div className="tm-canvas-toolbar__cluster">
        <div className="tm-canvas-toolbar__group">
          <span className="tm-canvas-toolbar__label">{readOnly ? "版本" : "历史"}</span>
          {readOnly ? (
            <>
              <Button size="sm" onClick={onRestoreVersion}>
                <History className="size-4" />
                恢复
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={state.loading}
                onClick={() => void onSaveAs()}
              >
                <Save className="size-4" />
                另存为
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={state.loading}
                onClick={onReturnCurrent}
              >
                返回当前草稿
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={!canUndo || interactionLocked}
                onClick={() => onChange((current) => undoDraft(current))}
              >
                <Undo2 className="size-4" />
                撤销
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!canRedo || interactionLocked}
                onClick={() => onChange((current) => redoDraft(current))}
              >
                <Redo2 className="size-4" />
                重做
              </Button>
            </>
          )}
        </div>
        {!readOnly ? (
          <>
            <div className="tm-canvas-toolbar__group">
              <span className="tm-canvas-toolbar__label">视图</span>
              <Button
                size="sm"
                variant="outline"
                disabled={interactionLocked}
                onClick={() =>
                  onChange((current) => ({
                    ...current,
                    viewport: {
                      ...current.viewport,
                      scale: clamp(current.viewport.scale / ZOOM_STEP, ZOOM_MIN, ZOOM_MAX),
                    },
                  }))
                }
              >
                <ZoomOut className="size-4" />
              </Button>
              <Input
                aria-label="当前缩放百分比"
                readOnly
                tabIndex={-1}
                value={`${Math.round(state.viewport.scale * 100)}%`}
                density="compact"
                size="sm"
                widthMode="content-fit"
                minWidthPx={56}
                maxWidthPx={72}
                className="tm-value-field tm-value-field--compact tm-canvas-toolbar__zoom-badge"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={interactionLocked}
                onClick={() =>
                  onChange((current) => ({
                    ...current,
                    viewport: {
                      ...current.viewport,
                      scale: clamp(current.viewport.scale * ZOOM_STEP, ZOOM_MIN, ZOOM_MAX),
                    },
                  }))
                }
              >
                <ZoomIn className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={interactionLocked}
                onClick={() =>
                  onChange((current) =>
                    fitViewport(current, stageViewportSize.width, stageViewportSize.height)
                  )
                }
              >
                <Focus className="size-4" />
                适配视图
              </Button>
            </div>
            <div className="tm-canvas-toolbar__group">
              <span className="tm-canvas-toolbar__label">辅助</span>
              <Button
                size="sm"
                variant={state.gridEnabled ? "default" : "outline"}
                disabled={interactionLocked}
                onClick={() =>
                  onChange((current) => {
                    const nextEditor = {
                      ...current.liveDraft.editor,
                      gridEnabled: !current.gridEnabled,
                    }
                    return updateEditorAssistState(current, nextEditor)
                  })
                }
              >
                <Grid2x2 className="size-4" />
                网格
              </Button>
              <Button
                size="sm"
                variant={state.snapEnabled ? "default" : "outline"}
                aria-pressed={state.snapEnabled}
                title="吸附"
                disabled={interactionLocked}
                onClick={() =>
                  onChange((current) => {
                    const nextEditor = {
                      ...current.liveDraft.editor,
                      snapEnabled: !current.snapEnabled,
                    }
                    return updateEditorAssistState(current, nextEditor)
                  })
                }
              >
                <ScanSearch className="size-4" />
                吸附
              </Button>
            </div>
          </>
        ) : null}
      </div>
      <div className="tm-canvas-toolbar__cluster tm-canvas-toolbar__cluster--tail">
        <div className="tm-canvas-toolbar__status">
          <span className="tm-canvas-toolbar__status-label">状态</span>
          <Input
            aria-label="当前画布状态"
            readOnly
            tabIndex={-1}
            value={
              readOnly
                ? "历史快照只读"
                : state.pendingPaste
                  ? "待放置预览"
                  : state.loading
                    ? "正在读取草稿"
                    : state.selectedIds.length > 0
                      ? `已选 ${state.selectedIds.length} 项`
                      : "未选择元素"
            }
            density="compact"
            size="sm"
            widthMode="content-fit"
            minWidthPx={132}
            maxWidthPx={220}
            className="tm-value-field tm-value-field--status"
          />
        </div>
        {readOnly ? null : (
          <>
            <Button size="sm" variant="outline" disabled={state.loading} onClick={onOpenVersions}>
              <History className="size-4" />
              版本历史
            </Button>
            <Button size="sm" disabled={state.loading} onClick={() => void onSave()}>
              <Save className="size-4" />
              保存
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={state.loading}
              onClick={() => void onSaveAs()}
            >
              <FileClock className="size-4" />
              另存为
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={state.loading}
              onClick={() => void onReset()}
            >
              <RotateCcw className="size-4" />
              重置草稿
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function CanvasLayerRail({
  state,
  readOnly,
  onChange,
}: {
  state: CanvasPageState
  readOnly: boolean
  onChange: React.Dispatch<React.SetStateAction<CanvasPageState>>
}) {
  const sourceDescription = state.loading
    ? "正在读取当前画布草稿。"
    : state.routeSource.kind === "scratch"
      ? `当前草稿：${state.draft.name}`
      : state.routeSource.kind === "preset-template"
        ? `系统模板：${state.draft.name}`
        : `用户模板：${state.draft.name}`
  const sourceNote = state.loading
    ? "稍后会切换到当前路由对应的草稿。"
    : state.routeSource.kind === "preset-template"
      ? "来自系统模板副本，保存后会进入本地用户模板库。"
      : state.routeSource.kind === "user-template"
        ? "已连接本地用户模板，保存会新增一个已保存版本。"
        : null

  return (
    <div className="tm-left-rail">
      <CanvasSection title="元素" description={sourceDescription}>
        <div className="grid gap-2">
          {sourceNote ? <p className="tm-note tm-note--left-rail">{sourceNote}</p> : null}
          <div className="tm-quick-tools">
            {(
              ["text", "rect", "circle", "triangle", "line", "barcode", "qr", "datamatrix"] as const
            ).map((kind) => (
              <Button
                key={kind}
                type="button"
                size="sm"
                variant="outline"
                className="tm-quick-tool"
                disabled={readOnly}
                onClick={() =>
                  onChange((current) =>
                    applyDraftUpdate(current, (draft) => ({
                      ...draft,
                      elements: [
                        ...draft.elements,
                        createCanvasElement(kind, draft.elements.length),
                      ],
                    }))
                  )
                }
              >
                <Plus className="size-4" />
                {CANVAS_TOOL_LABELS[kind]}
              </Button>
            ))}
          </div>
        </div>
      </CanvasSection>
    </div>
  )
}

function CanvasLayerPanel({
  state,
  readOnly,
  clipboardSupported,
  onCopy,
  onPaste,
  onChange,
}: {
  state: CanvasPageState
  readOnly: boolean
  clipboardSupported: boolean
  onCopy: () => Promise<void>
  onPaste: () => Promise<void>
  onChange: React.Dispatch<React.SetStateAction<CanvasPageState>>
}) {
  const selectedCount = state.selectedIds.length
  const clipboardUnsupportedTitle = clipboardSupported
    ? undefined
    : "当前环境不支持按钮拷贝或粘贴，请使用键盘快捷键。"

  if (state.loading) {
    return (
      <div className="tm-empty-state">
        <p className="tm-empty-state__title">正在读取当前画布草稿</p>
        <p className="tm-empty-state__body">稍后会显示可编辑图层列表。</p>
      </div>
    )
  }

  return (
    <CanvasSection
      title="图层"
      description={selectedCount > 0 ? `已选 ${selectedCount} 项` : "从前景到背景"}
      className="tm-inspector-section tm-inspector-section--layers"
      aside={
        <div className="tm-layer-section__actions">
          <Button
            size="sm"
            variant="outline"
            title={clipboardUnsupportedTitle}
            disabled={selectedCount === 0 || !clipboardSupported}
            onClick={() => void onCopy()}
          >
            <Copy className="size-4" />
            拷贝
          </Button>
          <Button
            size="sm"
            variant="outline"
            title={clipboardUnsupportedTitle}
            disabled={readOnly || !clipboardSupported}
            onClick={() => void onPaste()}
          >
            <ArrowDownToLine className="size-4" />
            粘贴
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={selectedCount === 0 || readOnly}
            onClick={() => onChange((current) => duplicateSelected(current))}
          >
            <Plus className="size-4" />
            新副本
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={selectedCount === 0 || readOnly}
            onClick={() => onChange((current) => deleteSelected(current))}
          >
            <Trash2 className="size-4" />
            删除
          </Button>
        </div>
      }
    >
      <div className="tm-layer-list tm-layer-list--inspector">
        {[...state.draft.elements].reverse().map((element, reverseIndex) => {
          const index = state.draft.elements.length - reverseIndex
          const selected = state.selectedIds.includes(element.id)
          const issue = getElementIssue(element)
          const warning = getElementCanvasWarning(state.draft, element)
          const selectLayer = () =>
            onChange((current) => ({
              ...setSelection(current, element.id, false),
              focus: "center-right",
              activePanel: "attributes",
            }))
          return (
            <div
              key={element.id}
              className={cn(
                "tm-choice tm-choice--layer tm-choice--layer-inspector",
                selected && "tm-choice--active",
                !element.meta.visible && "tm-choice--muted"
              )}
            >
              <div className="tm-choice__main">
                <div className="tm-choice__title-row">
                  <Input
                    aria-label={`${element.meta.name} 图层名称`}
                    readOnly
                    tabIndex={-1}
                    value={element.meta.name}
                    title={element.meta.name}
                    density="compact"
                    size="sm"
                    className="tm-choice__title"
                    onClick={selectLayer}
                  />
                </div>
                <button type="button" className="min-w-0 text-left" onClick={selectLayer}>
                  <div className="tm-choice__meta">
                    <span>图层 {index}</span>
                    <span>{CANVAS_TOOL_LABELS[element.kind]}</span>
                    {element.meta.locked ? <span>已锁定</span> : null}
                    {!element.meta.visible ? <span>已隐藏</span> : null}
                    {issue ? <span className="tm-choice__meta-error">{issue.title}</span> : null}
                    {!issue && warning ? (
                      <span className="tm-choice__meta-error">{warning.title}</span>
                    ) : null}
                  </div>
                </button>
                <div className="tm-choice__control-strip">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="tm-choice__icon-button"
                    disabled={
                      readOnly ||
                      state.selectedIds.length !== 1 ||
                      state.selectedIds[0] !== element.id
                    }
                    onClick={() => onChange((current) => reorderSelection(current, "backward"))}
                  >
                    <ArrowUpToLine className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="tm-choice__icon-button"
                    disabled={
                      readOnly ||
                      state.selectedIds.length !== 1 ||
                      state.selectedIds[0] !== element.id
                    }
                    onClick={() => onChange((current) => reorderSelection(current, "forward"))}
                  >
                    <ArrowDownToLine className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="tm-choice__icon-button"
                    aria-label={
                      element.meta.visible ? `隐藏${element.meta.name}` : `显示${element.meta.name}`
                    }
                    disabled={readOnly}
                    onClick={() =>
                      onChange((current) =>
                        applyDraftUpdate(current, (draft) => ({
                          ...draft,
                          elements: draft.elements.map((item) =>
                            item.id === element.id
                              ? { ...item, meta: { ...item.meta, visible: !item.meta.visible } }
                              : item
                          ),
                        }))
                      )
                    }
                  >
                    {element.meta.visible ? (
                      <Eye className="size-4" />
                    ) : (
                      <EyeOff className="size-4" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="tm-choice__icon-button"
                    aria-label={
                      element.meta.locked ? `解锁${element.meta.name}` : `锁定${element.meta.name}`
                    }
                    disabled={readOnly}
                    onClick={() =>
                      onChange((current) =>
                        applyDraftUpdate(current, (draft) => ({
                          ...draft,
                          elements: draft.elements.map((item) =>
                            item.id === element.id
                              ? { ...item, meta: { ...item.meta, locked: !item.meta.locked } }
                              : item
                          ),
                        }))
                      )
                    }
                  >
                    {element.meta.locked ? (
                      <Lock className="size-4" />
                    ) : (
                      <LockOpen className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </CanvasSection>
  )
}

function CanvasInspector({
  state,
  readOnly,
  clipboardSupported,
  onCopy,
  onPaste,
  onChange,
}: {
  state: CanvasPageState
  readOnly: boolean
  clipboardSupported: boolean
  onCopy: () => Promise<void>
  onPaste: () => Promise<void>
  onChange: React.Dispatch<React.SetStateAction<CanvasPageState>>
}) {
  const selectedItems = state.draft.elements.filter((item) => state.selectedIds.includes(item.id))
  const element = selectedItems[0]
  const supportsReplaceable =
    element?.kind === "text" ||
    element?.kind === "barcode" ||
    element?.kind === "qr" ||
    element?.kind === "datamatrix"
  const boundField =
    supportsReplaceable && element?.binding
      ? (state.draft.fields.find((field) => field.key === element.binding?.fieldKey) ?? null)
      : null
  const [fieldLabelDraft, setFieldLabelDraft] = React.useState(boundField?.label ?? "")

  React.useEffect(() => {
    setFieldLabelDraft(boundField?.label ?? "")
  }, [boundField?.label])

  if (selectedItems.length === 0 || !element) {
    return (
      <div className="tm-empty-state">
        <p className="tm-empty-state__title">先选择一个元素</p>
        <p className="tm-empty-state__body">
          支持 Shift 多选、框选、Delete 删除，以及双击文本原位编辑。
        </p>
      </div>
    )
  }

  if (selectedItems.length > 1) {
    return (
      <div className="grid gap-4">
        <div className="tm-empty-state">
          <p className="tm-empty-state__title">已选中 {selectedItems.length} 个元素</p>
          <p className="tm-empty-state__body">
            批量状态下保留移动、缩放、旋转和删除。若要编辑具体内容，请收敛到单个元素。
          </p>
        </div>
        <CanvasSection title="批量操作" description="对当前选择执行一次性动作。">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              title={
                clipboardSupported ? undefined : "当前环境不支持按钮拷贝或粘贴，请使用键盘快捷键。"
              }
              disabled={!clipboardSupported}
              onClick={() => void onCopy()}
            >
              <Copy className="size-4" />
              拷贝
            </Button>
            <Button
              type="button"
              variant="outline"
              title={
                clipboardSupported ? undefined : "当前环境不支持按钮拷贝或粘贴，请使用键盘快捷键。"
              }
              disabled={readOnly || !clipboardSupported}
              onClick={() => void onPaste()}
            >
              <ArrowDownToLine className="size-4" />
              粘贴
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={readOnly}
              onClick={() => onChange((current) => duplicateSelected(current))}
            >
              <Plus className="size-4" />
              新副本
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={readOnly}
              onClick={() => onChange((current) => deleteSelected(current))}
            >
              <Trash2 className="size-4" />
              删除所选
            </Button>
          </div>
        </CanvasSection>
      </div>
    )
  }

  const updateElement = (updater: (element: CanvasDraftElement) => CanvasDraftElement) => {
    onChange((current) =>
      applyDraftUpdate(current, (draft) => ({
        ...draft,
        elements: draft.elements.map((item) => (item.id === element.id ? updater(item) : item)),
      }))
    )
  }

  const renderNumberField = (
    label: string,
    value: number,
    onValueChange: (next: number) => void,
    id: string,
    step = 0.1,
    precision = 1
  ) => (
    <InspectorNumberField
      disabled={readOnly}
      id={id}
      label={label}
      precision={precision}
      step={step}
      value={value}
      onValueChange={onValueChange}
    />
  )

  const issue = getElementIssue(element)
  const warning = getElementCanvasWarning(state.draft, element)
  const hasEncodedContentIssue =
    issue != null &&
    (element.kind === "barcode" || element.kind === "qr" || element.kind === "datamatrix")

  const rotateSelectedElementBy = (delta: number) => {
    updateElement((item) =>
      "rotation" in item
        ? ({ ...item, rotation: Math.round((item.rotation ?? 0) + delta) } as CanvasDraftElement)
        : item
    )
  }

  const commitFieldLabel = (rawValue: string) => {
    if (!boundField) {
      return
    }
    const nextLabel = rawValue.trim() || element.meta.name.trim() || boundField.label
    onChange((current) =>
      applyDraftUpdate(current, (draft) => {
        const currentElement = draft.elements.find((item) => item.id === element.id)
        if (!currentElement || !("binding" in currentElement) || !currentElement.binding) {
          return draft
        }
        const currentField =
          draft.fields.find((field) => field.key === currentElement.binding?.fieldKey) ?? null
        if (!currentField) {
          return draft
        }
        const existingField =
          draft.fields.find(
            (field) =>
              field.key !== currentField.key &&
              field.label.trim().toLowerCase() === nextLabel.toLowerCase()
          ) ?? null
        return existingField
          ? bindElementToExistingField(draft, element.id, existingField.key)
          : renameDraftField(draft, currentField.key, nextLabel)
      })
    )
  }

  const fieldLabelSuggestions = state.draft.fields
    .map((field) => field.label.trim())
    .filter((label, index, labels) => label.length > 0 && labels.indexOf(label) === index)
    .map((label) => ({ label, value: label }))

  return (
    <div className="tm-inspector-stack">
      <CanvasSection
        title="内容"
        className="tm-inspector-section"
        aside={
          <Badge variant="outline" className="tm-chip tm-inspector-chip">
            {CANVAS_TOOL_LABELS[element.kind]}
          </Badge>
        }
      >
        <div className="tm-inspector-form">
          <div className="tm-inspector-inline-field">
            <Label htmlFor="layer-name" className="tm-inspector-inline-label">
              名称
            </Label>
            <Input
              id="layer-name"
              density="compact"
              size="md"
              className="tm-inspector-input"
              disabled={readOnly}
              value={element.meta.name}
              onChange={(event) => {
                const nextValue = event.currentTarget.value
                updateElement((item) => ({
                  ...item,
                  meta: { ...item.meta, name: nextValue },
                }))
              }}
            />
          </div>
          {element.kind === "text" ? (
            <div className="tm-inspector-field">
              <Label htmlFor="text-value" className="tm-inspector-label">
                文本
              </Label>
              <Textarea
                id="text-value"
                className="tm-inspector-textarea"
                disabled={readOnly}
                value={element.value}
                onChange={(event) => {
                  const nextValue = event.currentTarget.value
                  onChange((current) =>
                    applyDraftUpdate(current, (draft) =>
                      updateBoundElementValue(draft, element.id, nextValue)
                    )
                  )
                }}
              />
            </div>
          ) : null}
          {element.kind === "barcode" || element.kind === "qr" || element.kind === "datamatrix" ? (
            <div className="tm-inspector-inline-field">
              <Label htmlFor="encoded-value" className="tm-inspector-inline-label">
                编码
              </Label>
              <Input
                id="encoded-value"
                density="compact"
                size="md"
                className="tm-inspector-input"
                disabled={readOnly}
                value={element.value}
                onChange={(event) => {
                  const nextValue = event.currentTarget.value
                  onChange((current) =>
                    applyDraftUpdate(current, (draft) =>
                      updateBoundElementValue(draft, element.id, nextValue)
                    )
                  )
                }}
              />
            </div>
          ) : null}
          {hasEncodedContentIssue ? (
            <Alert variant="destructive" className="col-span-full">
              <AlertCircle className="mt-0.5 size-4" />
              <AlertTitle>{issue.title}</AlertTitle>
              <AlertDescription>{issue.detail}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </CanvasSection>

      {supportsReplaceable ? (
        <CanvasSection title="替换字段" className="tm-inspector-section">
          <div className="tm-inspector-form">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={boundField ? "default" : "outline"}
                disabled={readOnly}
                onClick={() =>
                  onChange((current) =>
                    applyDraftUpdate(current, (draft) =>
                      toggleElementBinding(draft, element.id, !boundField)
                    )
                  )
                }
              >
                {boundField ? "可替换" : "设为可替换"}
              </Button>
              <p className="text-xs text-muted-foreground">
                结构化打印时会根据这里的字段绑定来替换内容。
              </p>
            </div>

            {boundField ? (
              <div className="tm-inspector-inline-field">
                <Label htmlFor="field-label" className="tm-inspector-inline-label">
                  字段名
                </Label>
                <Combobox
                  id="field-label"
                  density="compact"
                  size="md"
                  className="tm-inspector-input"
                  disabled={readOnly}
                  placeholder="输入字段名，可复用已有字段"
                  value={fieldLabelDraft}
                  options={fieldLabelSuggestions}
                  emptyText="没有匹配字段"
                  onValueChange={setFieldLabelDraft}
                  onValueCommit={commitFieldLabel}
                />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/70 px-3 py-3 text-sm text-muted-foreground">
                当前元素保持静态值，不会出现在模板录入表里。
              </div>
            )}
          </div>
        </CanvasSection>
      ) : null}

      <CanvasSection title="几何与样式" className="tm-inspector-section">
        <div className="tm-form-grid">
          {renderNumberField(
            "X",
            element.x,
            (value) => updateElement((item) => ({ ...item, x: value })),
            "pos-x"
          )}
          {renderNumberField(
            "Y",
            element.y,
            (value) => updateElement((item) => ({ ...item, y: value })),
            "pos-y"
          )}
          {"width" in element
            ? renderNumberField(
                "宽",
                element.width,
                (value) =>
                  updateElement((item) =>
                    item.kind === "rect"
                      ? {
                          ...item,
                          width: Math.max(16, value),
                          radius: clampRectRadius(item.radius, Math.max(16, value), item.height),
                        }
                      : "width" in item
                        ? ({ ...item, width: Math.max(16, value) } as CanvasDraftElement)
                        : item
                  ),
                "size-width"
              )
            : null}
          {"height" in element
            ? renderNumberField(
                "高",
                element.height,
                (value) =>
                  updateElement((item) =>
                    item.kind === "rect"
                      ? {
                          ...item,
                          height: Math.max(12, value),
                          radius: clampRectRadius(item.radius, item.width, Math.max(12, value)),
                        }
                      : "height" in item
                        ? ({ ...item, height: Math.max(12, value) } as CanvasDraftElement)
                        : item
                  ),
                "size-height"
              )
            : null}
          {element.kind === "rect"
            ? renderNumberField(
                "圆角",
                element.radius,
                (value) =>
                  updateElement((item) =>
                    item.kind === "rect"
                      ? {
                          ...item,
                          radius: clampRectRadius(value, item.width, item.height),
                        }
                      : item
                  ),
                "rect-radius"
              )
            : null}
          {"size" in element
            ? renderNumberField(
                "边长",
                element.size,
                (value) =>
                  updateElement((item) =>
                    "size" in item
                      ? ({ ...item, size: Math.max(16, value) } as CanvasDraftElement)
                      : item
                  ),
                "size-square"
              )
            : null}
          {element.kind === "line"
            ? renderNumberField(
                "X2",
                element.x2,
                (value) =>
                  updateElement((item) => (item.kind === "line" ? { ...item, x2: value } : item)),
                "line-x2"
              )
            : null}
          {element.kind === "line"
            ? renderNumberField(
                "Y2",
                element.y2,
                (value) =>
                  updateElement((item) => (item.kind === "line" ? { ...item, y2: value } : item)),
                "line-y2"
              )
            : null}
          {"fontSize" in element
            ? renderNumberField(
                "字号",
                element.fontSize,
                (value) =>
                  updateElement((item) =>
                    "fontSize" in item
                      ? ({
                          ...item,
                          fontSize: Math.max(8 / CANVAS_DOTS_PER_MILLIMETER, value),
                        } as CanvasDraftElement)
                      : item
                  ),
                "text-font-size"
              )
            : null}
          {element.kind === "text"
            ? renderNumberField(
                "行高",
                element.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT,
                (value) =>
                  updateElement((item) =>
                    item.kind === "text"
                      ? {
                          ...item,
                          lineHeight: normalizeTextLineHeight(value),
                        }
                      : item
                  ),
                "text-line-height",
                0.1
              )
            : null}
          {element.kind === "text" ? (
            <div className="tm-inspector-inline-field tm-inspector-field--full">
              <Label htmlFor="text-font-family" className="tm-inspector-inline-label">
                字体
              </Label>
              <TextFontFamilySelect
                disabled={readOnly}
                id="text-font-family"
                value={element.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY}
                onValueChange={(value) =>
                  updateElement((item) =>
                    item.kind === "text" ? { ...item, fontFamily: value } : item
                  )
                }
                className={INSPECTOR_SELECT_TRIGGER_CLASS}
              />
            </div>
          ) : null}
          {element.kind === "text" ? (
            <div className="tm-text-controls-row tm-inspector-field--full">
              <div className="tm-inspector-field">
                <Label className="tm-inspector-label">对齐</Label>
                <fieldset className="tm-text-align-grid" aria-label="文本九宫格对齐">
                  {TEXT_ALIGNMENT_OPTIONS.map((option) => {
                    const selected =
                      resolveTextGridAlign(element) === option.align &&
                      (element.verticalAlign ?? DEFAULT_TEXT_VERTICAL_ALIGN) ===
                        option.verticalAlign
                    return (
                      <Button
                        key={`${option.verticalAlign}-${option.align}`}
                        type="button"
                        size="sm"
                        variant={selected ? "default" : "outline"}
                        className="tm-text-align-grid__button"
                        aria-label={`文本${option.label}对齐`}
                        aria-pressed={selected}
                        disabled={readOnly}
                        onClick={() =>
                          updateElement((item) =>
                            item.kind === "text"
                              ? {
                                  ...item,
                                  align: item.align === "justify" ? "justify" : option.align,
                                  justifyAlign: option.align,
                                  verticalAlign: option.verticalAlign,
                                }
                              : item
                          )
                        }
                      >
                        <span
                          className="tm-text-align-icon"
                          data-align={option.align}
                          data-vertical={option.verticalAlign}
                          aria-hidden="true"
                        >
                          <span />
                          <span />
                          <span />
                        </span>
                      </Button>
                    )
                  })}
                </fieldset>
              </div>
              <div className="tm-inspector-field">
                <Label className="tm-inspector-label">排版</Label>
                <div className="tm-inspector-toggle-row tm-inspector-toggle-row--text-flow">
                  <Button
                    type="button"
                    size="sm"
                    variant={element.autoWrap ? "default" : "outline"}
                    className="tm-inspector-toggle"
                    aria-pressed={element.autoWrap}
                    disabled={readOnly}
                    onClick={() =>
                      updateElement((item) =>
                        item.kind === "text" ? { ...item, autoWrap: !item.autoWrap } : item
                      )
                    }
                  >
                    <TextWrap className="size-3.5" />
                    自动换行
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={element.align === "justify" ? "default" : "outline"}
                    className="tm-inspector-toggle"
                    aria-pressed={element.align === "justify"}
                    disabled={readOnly}
                    onClick={() =>
                      updateElement((item) =>
                        item.kind === "text"
                          ? item.align === "justify"
                            ? { ...item, align: item.justifyAlign ?? "left" }
                            : {
                                ...item,
                                align: "justify",
                                justifyAlign: resolveTextGridAlign(item),
                              }
                          : item
                      )
                    }
                  >
                    <TextAlignJustify className="size-3.5" />
                    两端对齐
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={element.stretchX ? "default" : "outline"}
                    className="tm-inspector-toggle"
                    aria-pressed={element.stretchX}
                    disabled={readOnly}
                    onClick={() =>
                      updateElement((item) =>
                        item.kind === "text" ? { ...item, stretchX: !item.stretchX } : item
                      )
                    }
                  >
                    <StretchHorizontal className="size-3.5" />
                    水平拉升
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={element.stretchY ? "default" : "outline"}
                    className="tm-inspector-toggle"
                    aria-pressed={element.stretchY}
                    disabled={readOnly}
                    onClick={() =>
                      updateElement((item) =>
                        item.kind === "text" ? { ...item, stretchY: !item.stretchY } : item
                      )
                    }
                  >
                    <StretchVertical className="size-3.5" />
                    垂直拉升
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={element.verticalText ? "default" : "outline"}
                    className="tm-inspector-toggle"
                    aria-pressed={element.verticalText}
                    disabled={readOnly}
                    onClick={() =>
                      updateElement((item) =>
                        item.kind === "text" ? { ...item, verticalText: !item.verticalText } : item
                      )
                    }
                  >
                    <Columns3 className="size-3.5" />
                    纵向文本
                  </Button>
                  {"rotation" in element ? (
                    <InspectorNumberField
                      actions={
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="tm-inspector-stepper-button h-8 w-8 p-0"
                            aria-label="逆时针旋转 45 度"
                            disabled={readOnly}
                            onClick={() => rotateSelectedElementBy(-45)}
                          >
                            <RotateCcw className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="tm-inspector-stepper-button h-8 w-8 p-0"
                            aria-label="顺时针旋转 45 度"
                            disabled={readOnly}
                            onClick={() => rotateSelectedElementBy(45)}
                          >
                            <RotateCw className="size-3.5" />
                          </Button>
                        </>
                      }
                      className="tm-inspector-rotation-field"
                      disabled={readOnly}
                      id="element-rotation"
                      label="旋转"
                      precision={0}
                      step={1}
                      value={element.rotation ?? 0}
                      onValueChange={(value) =>
                        updateElement((item) =>
                          "rotation" in item
                            ? ({ ...item, rotation: value } as CanvasDraftElement)
                            : item
                        )
                      }
                    />
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          {element.kind !== "text" && element.kind !== "line" && "rotation" in element
            ? renderNumberField(
                "旋转",
                element.rotation ?? 0,
                (value) =>
                  updateElement((item) =>
                    "rotation" in item ? ({ ...item, rotation: value } as CanvasDraftElement) : item
                  ),
                "element-rotation",
                1,
                0
              )
            : null}
          {"strokeWidth" in element
            ? renderNumberField(
                "描边",
                element.strokeWidth,
                (value) =>
                  updateElement((item) =>
                    "strokeWidth" in item
                      ? ({ ...item, strokeWidth: Math.max(1, value) } as CanvasDraftElement)
                      : item
                  ),
                "stroke-width"
              )
            : null}
          {!issue && warning ? (
            <Alert className="col-span-full">
              <AlertCircle className="mt-0.5 size-4" />
              <AlertTitle>{warning.title}</AlertTitle>
              <AlertDescription>{warning.detail}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </CanvasSection>

      {element.kind === "barcode" || element.kind === "qr" || element.kind === "datamatrix" ? (
        <CanvasSection title="编码设置" className="tm-inspector-section">
          <div className="tm-inspector-form">
            {element.kind === "barcode" ? (
              <div className="tm-inspector-inline-field">
                <Label htmlFor="barcode-format" className="tm-inspector-inline-label">
                  格式
                </Label>
                <Select value={element.format} disabled={readOnly} onValueChange={() => undefined}>
                  <SelectTrigger
                    id="barcode-format"
                    className={INSPECTOR_SELECT_TRIGGER_CLASS}
                    disabled={readOnly}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CODE128">Code 128</SelectItem>
                  </SelectContent>
                </Select>
                <p className="tm-inspector-help">仅支持 Code 128。</p>
              </div>
            ) : null}
            {element.kind === "barcode" ? (
              <Button
                type="button"
                variant={element.showValue ? "default" : "outline"}
                size="sm"
                className="tm-inspector-toggle"
                disabled={readOnly}
                onClick={() =>
                  updateElement((item) =>
                    item.kind === "barcode" ? { ...item, showValue: !item.showValue } : item
                  )
                }
              >
                显示文本
              </Button>
            ) : null}
            {element.kind === "qr" ? (
              <div className="tm-inspector-inline-field">
                <Label htmlFor="qr-level" className="tm-inspector-inline-label">
                  容错
                </Label>
                <Select
                  value={element.errorCorrectionLevel}
                  disabled={readOnly}
                  onValueChange={(value: "L" | "M" | "Q" | "H") =>
                    updateElement((item) =>
                      item.kind === "qr" ? { ...item, errorCorrectionLevel: value } : item
                    )
                  }
                >
                  <SelectTrigger
                    id="qr-level"
                    className={INSPECTOR_SELECT_TRIGGER_CLASS}
                    disabled={readOnly}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="L">L</SelectItem>
                    <SelectItem value="M">M</SelectItem>
                    <SelectItem value="Q">Q</SelectItem>
                    <SelectItem value="H">H</SelectItem>
                  </SelectContent>
                </Select>
                <p className="tm-inspector-help">容错越高，尺寸越大。</p>
              </div>
            ) : null}
            {element.kind === "datamatrix" ? (
              <div className="rounded-xl border border-dashed border-border/70 px-3 py-3 text-sm text-muted-foreground">
                固定使用通用 ECC200 方形符号，不提供额外格式开关。
              </div>
            ) : null}
          </div>
        </CanvasSection>
      ) : null}
    </div>
  )
}

function CanvasOutput({
  controller,
  state,
  readOnly,
  onChange,
}: {
  controller: WorkbenchController
  state: CanvasPageState
  readOnly: boolean
  onChange: React.Dispatch<React.SetStateAction<CanvasPageState>>
}) {
  const source = React.useMemo(
    () => toCanvasPrintSource(state.draft, controller.renderOptions),
    [controller.renderOptions, state.draft]
  )

  const previewSource = controller.artifactData?.preview
  const previewUrl =
    previewSource?.kind === "url"
      ? previewSource.url
      : previewSource?.kind === "data-url"
        ? previewSource.dataUrl
        : null

  const printStatus = React.useMemo(() => {
    const result = controller.printResult
    if (!result) {
      return null
    }
    if ("job" in result && result.job) {
      return `打印任务 ${result.job.id} 状态 ${result.job.status}。`
    }
    if ("status" in result && typeof result.status === "string") {
      return result.status
    }
    if ("message" in result && typeof result.message === "string") {
      return result.message
    }
    return null
  }, [controller.printResult])

  const draftIssues = React.useMemo(() => getVisibleDraftIssues(state.draft), [state.draft])
  const draftWarnings = React.useMemo(() => getVisibleDraftWarnings(state.draft), [state.draft])
  const capabilityWarning = getCanvasCapabilityWarning(state.draft, controller)
  const selectedPrinterName =
    controller.selectedPrinter?.name ?? controller.browserPrinter?.name ?? "未选择输出设备"
  const canSubmitOutput = draftIssues.length === 0
  const outputHint = canSubmitOutput
    ? readOnly
      ? "当前打开的是历史快照。若要继续输出，请先恢复到当前草稿。"
      : "先生成预览，确认单色内容与编码结果，再执行打印。"
    : "当前画布存在无法输出的编码内容，请先修正后再继续。"
  const [issueBubbleOpen, setIssueBubbleOpen] = React.useState(false)
  const [errorBubbleOpen, setErrorBubbleOpen] = React.useState(false)

  React.useEffect(() => {
    if (draftIssues.length > 0) {
      setIssueBubbleOpen(true)
      return
    }
    setIssueBubbleOpen(false)
  }, [draftIssues])

  React.useEffect(() => {
    if (controller.error) {
      setErrorBubbleOpen(true)
      return
    }
    setErrorBubbleOpen(false)
  }, [controller.error])

  return (
    <div className="grid gap-4">
      <CanvasSection
        title="输出参数"
        description="这些参数会进入预览与最终打印。"
        aside={
          <Badge variant="outline" className="tm-chip">
            {selectedPrinterName}
          </Badge>
        }
      >
        <div className="tm-form-grid">
          <div className="grid gap-2">
            <Label htmlFor="print-width">打印宽度（dots）</Label>
            <Input
              id="print-width"
              type="number"
              value={String(controller.renderOptions.printWidthDots)}
              onChange={(event) => {
                const rawValue = event.currentTarget.value
                controller.setRenderOptions((current) => ({
                  ...current,
                  printWidthDots: Number(rawValue || current.printWidthDots),
                }))
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="paper-type">纸张类型</Label>
            <Select
              value={controller.renderOptions.paperType}
              onValueChange={(value: "continuous" | "gap") =>
                controller.setRenderOptions((current) => ({ ...current, paperType: value }))
              }
            >
              <SelectTrigger id="paper-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="continuous">{PAPER_TYPE_LABELS.continuous}</SelectItem>
                <SelectItem value="gap">{PAPER_TYPE_LABELS.gap}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">选择与当前标签纸匹配的走纸方式。</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="threshold">黑白阈值</Label>
            <Input
              id="threshold"
              type="number"
              value={String(controller.renderOptions.threshold)}
              onChange={(event) => {
                const rawValue = event.currentTarget.value
                controller.setRenderOptions((current) => ({
                  ...current,
                  threshold: Number(rawValue || current.threshold),
                }))
              }}
            />
            <p className="text-xs text-muted-foreground">
              阈值越低，更多灰度会被视为黑色。通常无需频繁调整。
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="x-offset">横向补偿（dots）</Label>
            <Input
              id="x-offset"
              type="number"
              value={String(controller.renderOptions.xOffsetDots)}
              onChange={(event) => {
                const rawValue = event.currentTarget.value
                controller.setRenderOptions((current) => ({
                  ...current,
                  xOffsetDots: Number(rawValue || current.xOffsetDots),
                }))
              }}
            />
            <p className="text-xs text-muted-foreground">
              用于修正打印头横向偏移；没有偏移时保持 0 即可。
            </p>
          </div>
        </div>
      </CanvasSection>

      <CanvasSection
        title="预览与动作"
        description={outputHint}
        aside={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {draftIssues.length > 0 ? (
              <Popover open={issueBubbleOpen} onOpenChange={setIssueBubbleOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="rounded-full px-3"
                    aria-label={`查看 ${draftIssues.length} 个输出问题`}
                  >
                    <AlertCircle className="size-4" />
                    输出问题 {draftIssues.length}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[22rem]">
                  <div className="grid gap-3">
                    <div className="grid gap-1">
                      <h4 className="text-sm font-semibold text-foreground">
                        有 {draftIssues.length} 个元素无法输出
                      </h4>
                      <p className="text-xs leading-5 text-muted-foreground">
                        修正这些元素后，预览与直接打印会重新开放。
                      </p>
                    </div>
                    <div className="grid gap-2">
                      {draftIssues.map(({ element, issue }) => (
                        <div
                          key={element.id}
                          className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2"
                        >
                          <p className="text-sm font-medium text-foreground">{element.meta.name}</p>
                          <p className="text-xs leading-5 text-muted-foreground">{issue.title}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-end">
                      <PopoverClose asChild>
                        <Button type="button" variant="outline" size="sm">
                          知道了
                        </Button>
                      </PopoverClose>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            ) : null}
            {controller.error ? (
              <Popover
                open={errorBubbleOpen}
                onOpenChange={(open) => {
                  setErrorBubbleOpen(open)
                  if (!open) {
                    controller.setError(null)
                  }
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="rounded-full px-3"
                    aria-label="查看操作失败详情"
                  >
                    <AlertCircle className="size-4" />
                    操作失败
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[24rem]">
                  <div className="grid gap-3">
                    <div className="grid gap-1">
                      <h4 className="text-sm font-semibold text-foreground">操作失败</h4>
                      <p className="text-sm leading-6 text-muted-foreground">{controller.error}</p>
                    </div>
                    <div className="flex justify-end">
                      <PopoverClose asChild>
                        <Button type="button" variant="outline" size="sm">
                          关闭
                        </Button>
                      </PopoverClose>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            ) : null}
            {printStatus ? (
              <Badge variant="outline" className="tm-chip">
                <CheckCircle2 className="size-3.5" />
                {printStatus}
              </Badge>
            ) : null}
          </div>
        }
      >
        <div className="grid gap-3">
          {capabilityWarning || draftWarnings.length > 0 ? (
            <Alert>
              <AlertCircle className="mt-0.5 size-4" />
              <AlertTitle>画布需要确认</AlertTitle>
              <AlertDescription>
                <div className="grid gap-1">
                  {capabilityWarning ? <p>{capabilityWarning}</p> : null}
                  {draftWarnings.length > 0 ? (
                    <p>
                      有 {draftWarnings.length} 个元素超出画布。元素会保留在草稿中，可继续预览。
                    </p>
                  ) : null}
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
          {previewUrl ? (
            <div className="tm-preview-shell">
              <img alt="canvas preview" className="tm-preview-image" src={previewUrl} />
            </div>
          ) : (
            <div className="tm-empty-state">
              <p className="tm-empty-state__title">还没有预览</p>
              <p className="tm-empty-state__body">
                先生成一个预览。舞台中的条码和二维码已经使用与最终打印一致的编码语义。
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!canSubmitOutput || readOnly}
              onClick={async () => {
                await controller.previewSource(source)
                onChange((current) => ({ ...current, outputStatus: "已生成预览。" }))
              }}
            >
              生成预览
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!canSubmitOutput || readOnly}
              onClick={async () => {
                await controller.printSourceDirect(source)
                onChange((current) => ({ ...current, outputStatus: "已提交直接打印。" }))
              }}
            >
              直接打印
            </Button>
          </div>
        </div>
      </CanvasSection>
    </div>
  )
}

type CanvasElementGroup = Konva.Group & {
  __tuckmarkOriginalGetClientRect?: Konva.Group["getClientRect"]
}

function alignOffset(
  containerSize: number,
  contentSize: number,
  align: "start" | "middle" | "end"
) {
  switch (align) {
    case "middle":
      return (containerSize - contentSize) / 2
    case "end":
      return containerSize - contentSize
    case "start":
      return 0
  }
}

let textMeasureContext: CanvasRenderingContext2D | null | undefined

const measureCanvasTextLine: TextMeasureFunction = ({ text, fontSize, fontFamily, fontWeight }) => {
  if (typeof document === "undefined") {
    return undefined
  }
  if (textMeasureContext === undefined) {
    textMeasureContext = document.createElement("canvas").getContext("2d")
  }
  if (!textMeasureContext) {
    return undefined
  }
  textMeasureContext.font = `${fontWeight === "bold" ? "bold" : "normal"} normal ${fontSize}px ${getTextFontFamilyStack(fontFamily)}`
  const metrics = textMeasureContext.measureText(text)
  return {
    width: metrics.width,
    actualBoundingBoxAscent: metrics.actualBoundingBoxAscent,
    actualBoundingBoxDescent: metrics.actualBoundingBoxDescent,
    actualBoundingBoxLeft: metrics.actualBoundingBoxLeft,
    actualBoundingBoxRight: metrics.actualBoundingBoxRight,
    fontBoundingBoxAscent: metrics.fontBoundingBoxAscent,
    fontBoundingBoxDescent: metrics.fontBoundingBoxDescent,
  }
}

function CanvasTextElementNode({
  element,
}: {
  element: Extract<CanvasDraftElement, { kind: "text" }>
}) {
  const textRef = React.useRef<Konva.Text>(null)
  const layout = resolveTextLayout({
    text: element.value,
    fontSize: element.fontSize,
    width: element.width,
    height: element.height,
    lineHeight: element.lineHeight,
    fontFamily: element.fontFamily,
    fontWeight: element.fontWeight,
    align: element.align,
    maxLines: element.maxLines,
    verticalAlign: element.verticalAlign,
    stretchX: element.stretchX,
    stretchY: element.stretchY,
    autoWrap: element.autoWrap,
    verticalText: element.verticalText,
    measureText: measureCanvasTextLine,
  })
  const usesCustomTextLayout = element.align === "justify" || element.verticalText
  const contentWidth = layout.contentWidth
  const contentHeight = layout.contentHeight
  const scaleX = element.stretchX ? element.width / Math.max(contentWidth, 0.0001) : 1
  const scaleY = element.stretchY ? element.height / Math.max(contentHeight, 0.0001) : 1
  const contentX = usesCustomTextLayout
    ? layout.contentX
    : element.stretchX
      ? 0
      : alignOffset(
          element.width,
          contentWidth,
          element.align === "center" ? "middle" : element.align === "right" ? "end" : "start"
        )
  const contentY = element.verticalText
    ? layout.contentY
    : element.stretchY
      ? 0
      : alignOffset(
          element.height,
          contentHeight,
          element.verticalAlign === "middle"
            ? "middle"
            : element.verticalAlign === "bottom"
              ? "end"
              : "start"
        )
  const textY = layout.textOffsetY
  const visibleContentLeft = clamp(contentX, 0, element.width)
  const visibleContentTop = clamp(contentY, 0, element.height)
  const visibleContentRight = clamp(contentX + contentWidth * scaleX, 0, element.width)
  const visibleContentBottom = clamp(contentY + contentHeight * scaleY, 0, element.height)
  const visibleContentWidth = Math.max(0, visibleContentRight - visibleContentLeft)
  const visibleContentHeight = Math.max(0, visibleContentBottom - visibleContentTop)
  return (
    <Group clipX={0} clipY={0} clipWidth={element.width} clipHeight={element.height}>
      {visibleContentWidth > 0 && visibleContentHeight > 0 ? (
        <KonvaRect
          x={visibleContentLeft}
          y={visibleContentTop}
          width={visibleContentWidth}
          height={visibleContentHeight}
          stroke="#ff4d5a"
          strokeWidth={0.35}
          dash={[1.2, 0.8]}
          listening={false}
        />
      ) : null}
      <Group x={contentX} y={contentY} scaleX={scaleX} scaleY={scaleY}>
        {element.verticalText
          ? layout.glyphs.map((glyph) => (
              <KonvaText
                key={`${glyph.x}-${glyph.y}-${glyph.text}`}
                x={glyph.x - element.fontSize / 2}
                y={glyph.y + textY}
                width={element.fontSize}
                text={glyph.text}
                fontSize={element.fontSize}
                fontStyle={element.fontWeight === "bold" ? "bold" : "normal"}
                fontFamily={getTextFontFamilyStack(element.fontFamily)}
                wrap="none"
                align="center"
                fill={MONO_INK}
              />
            ))
          : layout.lineLayouts.map((line, index) => (
              <KonvaText
                key={`${line.x}-${line.y}-${line.text}`}
                ref={index === 0 ? textRef : undefined}
                x={line.x}
                y={index * layout.lineHeight + textY}
                text={line.text}
                fontSize={element.fontSize}
                fontStyle={element.fontWeight === "bold" ? "bold" : "normal"}
                fontFamily={getTextFontFamilyStack(element.fontFamily)}
                lineHeight={getCanvasTextLineHeight(element.lineHeight)}
                letterSpacing={element.align === "justify" ? line.letterSpacing : 0}
                wrap="none"
                align="left"
                fill={MONO_INK}
              />
            ))}
      </Group>
    </Group>
  )
}

function renderElementNode(element: CanvasDraftElement): React.ReactNode {
  const issue = getElementIssue(element)

  switch (element.kind) {
    case "text":
      return <CanvasTextElementNode element={element} />
    case "rect":
      return (
        <KonvaRect
          x={0}
          y={0}
          width={element.width}
          height={element.height}
          fill={element.fill === "none" ? undefined : MONO_INK}
          stroke={MONO_INK}
          strokeWidth={element.strokeWidth}
          cornerRadius={element.radius}
        />
      )
    case "circle":
      return (
        <KonvaCircle
          x={element.size / 2}
          y={element.size / 2}
          radius={element.size / 2}
          fill={element.fill === "none" ? undefined : MONO_INK}
          stroke={MONO_INK}
          strokeWidth={element.strokeWidth}
        />
      )
    case "triangle":
      return (
        <KonvaLine
          x={0}
          y={0}
          points={[element.width / 2, 0, element.width, element.height, 0, element.height]}
          closed
          fill={element.fill === "none" ? undefined : MONO_INK}
          stroke={MONO_INK}
          strokeWidth={element.strokeWidth}
        />
      )
    case "line":
      return (
        <KonvaLine
          x={0}
          y={0}
          points={[0, 0, element.x2 - element.x, element.y2 - element.y]}
          stroke={MONO_INK}
          strokeWidth={element.strokeWidth}
        />
      )
    case "barcode": {
      if (issue) {
        return (
          <>
            <KonvaRect
              x={0}
              y={0}
              width={element.width}
              height={element.height}
              fill={MONO_SURFACE}
              stroke="#9c2f22"
              strokeWidth={1.5}
              dash={[6, 4]}
              cornerRadius={8}
            />
            <KonvaText
              x={canvasDotsToMillimeters(10)}
              y={canvasDotsToMillimeters(14)}
              width={element.width - canvasDotsToMillimeters(20)}
              text="条码内容无效"
              fontSize={canvasDotsToMillimeters(12)}
              fontStyle="bold"
              fontFamily={CANVAS_DEFAULT_TEXT_FONT_FAMILY}
              lineHeight={getCanvasTextLineHeight()}
              fill="#9c2f22"
            />
          </>
        )
      }

      const bars = buildBarcodeRows(element)
      return (
        <>
          {bars.map((bar) => (
            <KonvaRect
              key={`${element.id}-bar-${bar.x}-${bar.width}`}
              x={bar.x}
              y={0}
              width={bar.width}
              height={Math.max(
                element.height - (element.showValue ? canvasDotsToMillimeters(18) : 0),
                canvasDotsToMillimeters(12)
              )}
              fill="#111111"
            />
          ))}
          {element.showValue ? (
            <KonvaText
              x={0}
              y={element.height - canvasDotsToMillimeters(16)}
              width={element.width}
              text={element.value}
              align="center"
              fontSize={canvasDotsToMillimeters(12)}
              fontFamily={CANVAS_DEFAULT_TEXT_FONT_FAMILY}
              lineHeight={getCanvasTextLineHeight()}
              fill={MONO_INK}
            />
          ) : null}
        </>
      )
    }
    case "qr": {
      if (issue) {
        return (
          <>
            <KonvaRect
              x={0}
              y={0}
              width={element.size}
              height={element.size}
              fill={MONO_SURFACE}
              stroke="#9c2f22"
              strokeWidth={1.5}
              dash={[6, 4]}
              cornerRadius={10}
            />
            <KonvaText
              x={canvasDotsToMillimeters(8)}
              y={canvasDotsToMillimeters(16)}
              width={element.size - canvasDotsToMillimeters(16)}
              text={"二维码\n无效"}
              align="center"
              fontSize={canvasDotsToMillimeters(12)}
              fontStyle="bold"
              fontFamily={CANVAS_DEFAULT_TEXT_FONT_FAMILY}
              lineHeight={getCanvasTextLineHeight()}
              fill="#9c2f22"
            />
          </>
        )
      }

      const cells = buildQrCells(element)
      return (
        <>
          {cells.map((cell) => (
            <KonvaRect
              key={`${element.id}-cell-${cell.x}-${cell.y}-${cell.size}`}
              x={cell.x}
              y={cell.y}
              width={cell.size}
              height={cell.size}
              fill="#111111"
            />
          ))}
        </>
      )
    }
    case "datamatrix": {
      if (issue) {
        return (
          <>
            <KonvaRect
              x={0}
              y={0}
              width={element.size}
              height={element.size}
              fill={MONO_SURFACE}
              stroke="#9c2f22"
              strokeWidth={1.5}
              dash={[6, 4]}
              cornerRadius={10}
            />
            <KonvaText
              x={canvasDotsToMillimeters(8)}
              y={canvasDotsToMillimeters(14)}
              width={element.size - canvasDotsToMillimeters(16)}
              text={"数据矩阵码\n无效"}
              align="center"
              fontSize={canvasDotsToMillimeters(12)}
              fontStyle="bold"
              fontFamily={CANVAS_DEFAULT_TEXT_FONT_FAMILY}
              lineHeight={getCanvasTextLineHeight()}
              fill="#9c2f22"
            />
          </>
        )
      }

      const cells = buildDataMatrixCells(element)
      return (
        <>
          {cells.map((cell) => (
            <KonvaRect
              key={`${element.id}-cell-${cell.x}-${cell.y}-${cell.size}`}
              x={cell.x}
              y={cell.y}
              width={cell.size}
              height={cell.size}
              fill="#111111"
            />
          ))}
        </>
      )
    }
  }
}

function CanvasStageView({
  state,
  readOnly,
  onChange,
  onViewportSizeChange,
  onPointerChange,
}: {
  state: CanvasPageState
  readOnly: boolean
  onChange: React.Dispatch<React.SetStateAction<CanvasPageState>>
  onViewportSizeChange: (size: StageViewportSize) => void
  onPointerChange: (point: { x: number; y: number } | null) => void
}) {
  const stageRef = React.useRef<Konva.Stage | null>(null)
  const transformerRef = React.useRef<Konva.Transformer | null>(null)
  const nodeRefs = React.useRef<Record<string, Konva.Group | null>>({})
  const [stageHostElement, setStageHostElement] = React.useState<HTMLDivElement | null>(null)
  const isPanningRef = React.useRef(false)
  const panOriginRef = React.useRef<{
    pointerX: number
    pointerY: number
    viewportX: number
    viewportY: number
  } | null>(null)
  const selectionActiveRef = React.useRef(false)
  const elementDragSessionRef = React.useRef<{
    baseDraft: CanvasDraftDocument
    draggedId: string
    movedIds: string[]
    rotationOrigin: { x: number; y: number }
    lastDeltaX: number
    lastDeltaY: number
  } | null>(null)

  const measuredStageHostSize = useElementSize(stageHostElement)
  const stageViewportSize = React.useMemo(
    () => ({
      width: measuredStageHostSize?.width ?? STAGE_VIEWPORT_WIDTH,
      height: measuredStageHostSize?.height ?? STAGE_VIEWPORT_HEIGHT,
    }),
    [measuredStageHostSize]
  )
  const gridBounds = React.useMemo(
    () => getVisibleGridBounds(state.viewport, stageViewportSize.width, stageViewportSize.height),
    [state.viewport, stageViewportSize.height, stageViewportSize.width]
  )
  const paperStyle = React.useMemo(
    () => ({
      width: state.draft.width * CANVAS_DOTS_PER_MILLIMETER,
      height: state.draft.height * CANVAS_DOTS_PER_MILLIMETER,
      transform: `translate(${state.viewport.x}px, ${state.viewport.y}px) scale(${state.viewport.scale})`,
    }),
    [
      state.draft.height,
      state.draft.width,
      state.viewport.scale,
      state.viewport.x,
      state.viewport.y,
    ]
  )
  const selectedElements = React.useMemo(
    () =>
      state.selectedIds
        .map((id) => state.draft.elements.find((element) => element.id === id) ?? null)
        .filter((element): element is CanvasDraftElement => Boolean(element)),
    [state.draft.elements, state.selectedIds]
  )
  const selectedSingleElement = selectedElements.length === 1 ? selectedElements[0] : null
  const selectedLineElement =
    !state.pendingPaste && selectedSingleElement?.kind === "line" ? selectedSingleElement : null
  const transformerEnabled = !state.editingId && !selectedLineElement && !state.pendingPaste
  const transformerAnchors = isSquareResizeElement(selectedSingleElement)
    ? TRANSFORMER_CORNER_ANCHORS
    : TRANSFORMER_ALL_ANCHORS
  const transformerKeepRatio = isSquareResizeElement(selectedSingleElement)
  const transformerCanRotate = transformerEnabled && selectedSingleElement?.kind !== "circle"
  const editingTextElement = React.useMemo(
    () =>
      state.editingId
        ? (state.draft.elements.find(
            (item): item is Extract<CanvasDraftElement, { kind: "text" }> =>
              item.id === state.editingId && item.kind === "text" && item.meta.visible
          ) ?? null)
        : null,
    [state.draft.elements, state.editingId]
  )
  const editingTextGeometry = editingTextElement ? getElementGeometry(editingTextElement) : null
  const trackedTextFontFamily =
    editingTextElement?.fontFamily ??
    (selectedSingleElement?.kind === "text"
      ? (selectedSingleElement.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY)
      : null)
  const textFontUsageSessionRef = React.useRef<{
    fontFamily: TextFontFamily
    startedAt: number
  } | null>(null)

  React.useEffect(() => {
    onViewportSizeChange(stageViewportSize)
  }, [onViewportSizeChange, stageViewportSize])

  React.useEffect(() => {
    if (!trackedTextFontFamily) {
      textFontUsageSessionRef.current = null
      return
    }

    recordTextFontRecentUse(trackedTextFontFamily)
    textFontUsageSessionRef.current = {
      fontFamily: trackedTextFontFamily,
      startedAt: Date.now(),
    }

    return () => {
      if (!textFontUsageSessionRef.current) {
        return
      }
      const elapsedMs = Date.now() - textFontUsageSessionRef.current.startedAt
      recordTextFontUsageDuration(textFontUsageSessionRef.current.fontFamily, elapsedMs)
      textFontUsageSessionRef.current = null
    }
  }, [trackedTextFontFamily])

  React.useEffect(() => {
    const transformer = transformerRef.current
    if (!transformer) {
      return
    }
    const nodes = transformerEnabled
      ? state.selectedIds
          .map((id) => nodeRefs.current[id])
          .filter((node): node is Konva.Group => Boolean(node))
      : []
    transformer.nodes(nodes)
    transformer.shouldOverdrawWholeArea(true)
    transformer.getLayer()?.batchDraw()
  }, [state.selectedIds, transformerEnabled])

  const handleStageMouseDown = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (readOnly) {
      return
    }
    if (event.target.getParent()?.className === "Transformer") {
      return
    }
    const stage = event.target.getStage?.() ?? stageRef.current
    if (!stage) {
      return
    }
    if (state.editingId && blurActiveInlineTextEditor()) {
      return
    }

    const point = getStagePointer(stage, state.viewport)
    onPointerChange(point)

    if (state.pendingPaste) {
      if (event.evt.button === 1 || event.evt.button === 2 || state.spacePressed) {
        const pointer = stage.getPointerPosition()
        if (!pointer) {
          return
        }
        isPanningRef.current = true
        panOriginRef.current = {
          pointerX: pointer.x,
          pointerY: pointer.y,
          viewportX: state.viewport.x,
          viewportY: state.viewport.y,
        }
        return
      }

      if (event.evt.button === 0 && point) {
        onChange((current) => confirmPendingPastePlacement(movePendingPasteToPoint(current, point)))
      }
      return
    }

    if (event.target === stage) {
      if (event.evt.button === 1 || event.evt.button === 2 || state.spacePressed) {
        const pointer = stage.getPointerPosition()
        if (!pointer) {
          return
        }
        isPanningRef.current = true
        panOriginRef.current = {
          pointerX: pointer.x,
          pointerY: pointer.y,
          viewportX: state.viewport.x,
          viewportY: state.viewport.y,
        }
        return
      }
      if (!point) {
        return
      }
      selectionActiveRef.current = true
      onChange((current) => ({
        ...current,
        selectedIds: [],
        editingId: null,
        selectionBox: {
          x1: point.x,
          y1: point.y,
          x2: point.x,
          y2: point.y,
          visible: true,
        },
      }))
    }
  }

  const handleStageMouseMove = () => {
    if (readOnly) {
      return
    }
    const stage = stageRef.current
    if (!stage) {
      return
    }

    if (isPanningRef.current) {
      const pointer = stage.getPointerPosition()
      const panOrigin = panOriginRef.current
      if (!pointer || !panOrigin) {
        return
      }
      onChange((current) => ({
        ...current,
        viewport: {
          ...current.viewport,
          x: panOrigin.viewportX + (pointer.x - panOrigin.pointerX),
          y: panOrigin.viewportY + (pointer.y - panOrigin.pointerY),
        },
      }))
      return
    }

    const point = getStagePointer(stage, state.viewport)
    onPointerChange(point)

    if (state.pendingPaste) {
      if (point) {
        onChange((current) => movePendingPasteToPoint(current, point))
      }
      return
    }

    if (!selectionActiveRef.current || !point) {
      return
    }
    onChange((current) => ({
      ...current,
      selectionBox: {
        ...current.selectionBox,
        x2: point.x,
        y2: point.y,
      },
    }))
  }

  const handleStageMouseUp = () => {
    if (readOnly) {
      return
    }
    isPanningRef.current = false
    panOriginRef.current = null

    if (!selectionActiveRef.current) {
      return
    }
    selectionActiveRef.current = false
    onChange((current) => {
      const box = normalizeSelectionBox(current.selectionBox)
      const selectedIds =
        box.width < SELECTION_HANDLE_SIZE || box.height < SELECTION_HANDLE_SIZE
          ? current.selectedIds
          : current.draft.elements
              .filter((element) => {
                const bounds = getElementSelectionBounds(element)
                return (
                  bounds.x >= box.x &&
                  bounds.y >= box.y &&
                  bounds.x + bounds.width <= box.x + box.width &&
                  bounds.y + bounds.height <= box.y + box.height
                )
              })
              .map((element) => element.id)
      return {
        ...current,
        selectedIds,
        selectionBox: EMPTY_SELECTION_BOX,
      }
    })
  }

  const handleStageDoubleClick = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (readOnly || state.editingId) {
      return
    }
    const stage = event.target.getStage()
    if (!stage) {
      return
    }
    const point = getStagePointer(stage, state.viewport)
    if (!point) {
      return
    }
    const element = findEditableTextElementAtPoint(state.draft, point)
    if (!element) {
      return
    }
    onChange((current) => ({
      ...current,
      editingId: element.id,
      selectedIds: [element.id],
      focus: "center-right",
      activePanel: "attributes",
    }))
  }

  const selectionBoxStageRect = state.selectionBox.visible
    ? projectSelectionBoxToStageRect(normalizeSelectionBox(state.selectionBox), state.viewport)
    : null

  const applyTransformerChange = React.useCallback(
    (commitHistory: boolean) => {
      if (readOnly) {
        return
      }
      const transformer = transformerRef.current
      if (!transformer) {
        return
      }
      const nodes = transformer.nodes().filter((node): node is Konva.Group => Boolean(node))
      if (nodes.length === 0) {
        return
      }
      onChange((current) =>
        commitHistory
          ? applyDraftUpdate(current, (draft) =>
              applyTransformedNodesToDraft(draft, nodes, current.snapEnabled)
            )
          : applyLiveDraftUpdate(current, (draft) => applyTransformedNodesToDraft(draft, nodes))
      )
      transformer.forceUpdate()
      transformer.getLayer()?.batchDraw()
    },
    [onChange, readOnly]
  )

  const previewElementDragSelection = React.useCallback(
    (
      session: NonNullable<typeof elementDragSessionRef.current>,
      stagePosition: { x: number; y: number }
    ) => {
      const preview = createSelectionDragPreview(
        session.baseDraft,
        session.draggedId,
        session.movedIds,
        stagePosition,
        session.rotationOrigin,
        state.snapEnabled
      )
      if (!preview) {
        return null
      }
      return {
        ...preview,
        draft: {
          ...preview.draft,
          editor: {
            ...preview.draft.editor,
            gridEnabled: state.gridEnabled,
            snapEnabled: state.snapEnabled,
          },
        },
      }
    },
    [state.gridEnabled, state.snapEnabled]
  )

  return (
    <div className="tm-stage-shell">
      <div className="tm-stage-wrap tm-stage-wrap--editor">
        <div ref={setStageHostElement} className="tm-stage-surface">
          <div className="tm-stage-paper tm-stage-paper--base" style={paperStyle} />
          {state.gridEnabled ? (
            <div
              className="tm-stage-grid"
              style={{
                left:
                  state.viewport.x +
                  gridBounds.startX * state.viewport.scale * CANVAS_DOTS_PER_MILLIMETER,
                top:
                  state.viewport.y +
                  gridBounds.startY * state.viewport.scale * CANVAS_DOTS_PER_MILLIMETER,
                width:
                  (gridBounds.endX - gridBounds.startX) *
                  state.viewport.scale *
                  CANVAS_DOTS_PER_MILLIMETER,
                height:
                  (gridBounds.endY - gridBounds.startY) *
                  state.viewport.scale *
                  CANVAS_DOTS_PER_MILLIMETER,
                backgroundSize: `${GRID_SIZE * state.viewport.scale * CANVAS_DOTS_PER_MILLIMETER}px ${GRID_SIZE * state.viewport.scale * CANVAS_DOTS_PER_MILLIMETER}px`,
              }}
            />
          ) : null}
        </div>
        <Stage
          ref={stageRef}
          width={stageViewportSize.width}
          height={stageViewportSize.height}
          className="tm-stage tm-stage--editor tm-stage--overlay"
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onDblClick={handleStageDoubleClick}
          onWheel={(event) => {
            event.evt.preventDefault()
            const stage = event.target.getStage()
            if (!stage) {
              return
            }
            const shouldZoom = event.evt.ctrlKey || event.evt.metaKey

            if (!shouldZoom) {
              onChange((current) => ({
                ...current,
                viewport: {
                  ...current.viewport,
                  x: current.viewport.x - event.evt.deltaX,
                  y: current.viewport.y - event.evt.deltaY,
                },
              }))
              return
            }

            const pointer = stage.getPointerPosition()
            if (!pointer) {
              return
            }
            const oldScale = state.viewport.scale
            const mousePointTo = {
              x: (pointer.x - state.viewport.x) / (oldScale * CANVAS_DOTS_PER_MILLIMETER),
              y: (pointer.y - state.viewport.y) / (oldScale * CANVAS_DOTS_PER_MILLIMETER),
            }
            const direction = event.evt.deltaY > 0 ? -1 : 1
            const newScale = clamp(
              direction > 0 ? oldScale * ZOOM_STEP : oldScale / ZOOM_STEP,
              ZOOM_MIN,
              ZOOM_MAX
            )
            onChange((current) => ({
              ...current,
              viewport: {
                scale: newScale,
                x: pointer.x - mousePointTo.x * newScale * CANVAS_DOTS_PER_MILLIMETER,
                y: pointer.y - mousePointTo.y * newScale * CANVAS_DOTS_PER_MILLIMETER,
              },
            }))
          }}
        >
          <Layer>
            <Group
              x={state.viewport.x}
              y={state.viewport.y}
              scaleX={state.viewport.scale * CANVAS_DOTS_PER_MILLIMETER}
              scaleY={state.viewport.scale * CANVAS_DOTS_PER_MILLIMETER}
            >
              {state.draft.elements.map((element) => {
                if (!element.meta.visible) {
                  return null
                }
                const geometry = getElementGeometry(element)
                const bounds = geometry.bounds
                return (
                  <Group
                    key={element.id}
                    id={element.id}
                    ref={(node) => {
                      nodeRefs.current[element.id] = node
                      if (!node) {
                        return
                      }
                      const elementNode = node as CanvasElementGroup
                      if (typeof elementNode.getClientRect !== "function") {
                        return
                      }
                      elementNode.__tuckmarkOriginalGetClientRect ??=
                        elementNode.getClientRect.bind(elementNode) as Konva.Group["getClientRect"]
                      if (element.kind === "text") {
                        elementNode.getClientRect = (config) => {
                          if (config?.skipTransform) {
                            return {
                              x: geometry.localBounds.x,
                              y: geometry.localBounds.y,
                              width: geometry.localBounds.width,
                              height: geometry.localBounds.height,
                            }
                          }
                          return (
                            elementNode.__tuckmarkOriginalGetClientRect?.(config) ?? {
                              x: geometry.localBounds.x,
                              y: geometry.localBounds.y,
                              width: geometry.localBounds.width,
                              height: geometry.localBounds.height,
                            }
                          )
                        }
                      } else if (elementNode.__tuckmarkOriginalGetClientRect) {
                        elementNode.getClientRect = elementNode.__tuckmarkOriginalGetClientRect
                      }
                    }}
                    x={geometry.stagePosition.x}
                    y={geometry.stagePosition.y}
                    offsetX={geometry.rotationOrigin.x}
                    offsetY={geometry.rotationOrigin.y}
                    rotation={"rotation" in element ? (element.rotation ?? 0) : 0}
                    draggable={
                      !readOnly &&
                      !state.pendingPaste &&
                      !element.meta.locked &&
                      !state.spacePressed &&
                      !state.editingId
                    }
                    dragBoundFunc={(position) =>
                      getSnappedDragAbsolutePosition(
                        element,
                        position,
                        geometry.rotationOrigin,
                        state.viewport,
                        state.snapEnabled
                      )
                    }
                    onClick={(event) => {
                      if (state.pendingPaste) {
                        return
                      }
                      onChange((current) => ({
                        ...setSelection(
                          current,
                          element.id,
                          event.evt.shiftKey || event.evt.metaKey || event.evt.ctrlKey
                        ),
                        focus: "center-right",
                        activePanel: "attributes",
                      }))
                    }}
                    onTap={(event) => {
                      if (state.pendingPaste) {
                        return
                      }
                      onChange((current) => ({
                        ...setSelection(
                          current,
                          element.id,
                          event.evt.shiftKey || event.evt.metaKey || event.evt.ctrlKey
                        ),
                        focus: "center-right",
                        activePanel: "attributes",
                      }))
                    }}
                    onDblClick={() =>
                      readOnly || state.pendingPaste || element.meta.locked
                        ? undefined
                        : onChange((current) => ({
                            ...current,
                            editingId: element.kind === "text" ? element.id : current.editingId,
                            selectedIds: [element.id],
                          }))
                    }
                    onDragStart={(event) => {
                      if (readOnly || state.pendingPaste) {
                        return
                      }
                      event.cancelBubble = true
                      const movedIds = state.selectedIds.includes(element.id)
                        ? state.selectedIds
                        : [element.id]
                      elementDragSessionRef.current = {
                        baseDraft: cloneDraft(state.liveDraft),
                        draggedId: element.id,
                        movedIds,
                        rotationOrigin: geometry.rotationOrigin,
                        lastDeltaX: 0,
                        lastDeltaY: 0,
                      }
                      onChange((current) => ({
                        ...current,
                        selectedIds: movedIds,
                        editingId: null,
                        focus: "center-right",
                        activePanel: "attributes",
                      }))
                    }}
                    onDragMove={(event) => {
                      if (readOnly || state.pendingPaste) {
                        return
                      }
                      event.cancelBubble = true
                      const session = elementDragSessionRef.current
                      if (!session || session.draggedId !== element.id) {
                        return
                      }
                      const preview = previewElementDragSelection(session, {
                        x: event.target.x(),
                        y: event.target.y(),
                      })
                      if (!preview) {
                        return
                      }
                      if (
                        Math.abs(preview.deltaX - session.lastDeltaX) < 0.001 &&
                        Math.abs(preview.deltaY - session.lastDeltaY) < 0.001
                      ) {
                        return
                      }
                      session.lastDeltaX = preview.deltaX
                      session.lastDeltaY = preview.deltaY
                      onChange((current) => ({
                        ...current,
                        liveDraft: preview.draft,
                        draft: preview.draft,
                        selectedIds: preview.movedIds,
                        editingId: null,
                        storageMode: "persisted",
                      }))
                    }}
                    onDragEnd={(event) => {
                      if (readOnly || state.pendingPaste) {
                        return
                      }
                      event.cancelBubble = true
                      const session = elementDragSessionRef.current
                      elementDragSessionRef.current = null
                      if (!session || session.draggedId !== element.id) {
                        const position = snapElementPosition(
                          element,
                          event.target.x() - geometry.rotationOrigin.x,
                          event.target.y() - geometry.rotationOrigin.y,
                          state.snapEnabled
                        )
                        onChange((current) =>
                          applyDraftUpdate(current, (draft) => ({
                            ...draft,
                            elements: draft.elements.map((item) =>
                              item.id === element.id
                                ? ({ ...item, ...position } as CanvasDraftElement)
                                : item
                            ),
                          }))
                        )
                        return
                      }
                      const preview = previewElementDragSelection(session, {
                        x: event.target.x(),
                        y: event.target.y(),
                      })
                      if (!preview) {
                        return
                      }
                      if (Math.abs(preview.deltaX) < 0.001 && Math.abs(preview.deltaY) < 0.001) {
                        onChange((current) => ({
                          ...current,
                          selectedIds: preview.movedIds,
                          editingId: null,
                          focus: "center-right",
                          activePanel: "attributes",
                        }))
                        return
                      }
                      onChange((current) => {
                        const next = pushHistory(current, preview.draft)
                        return {
                          ...next,
                          selectedIds: preview.movedIds,
                          editingId: null,
                          focus: "center-right",
                          activePanel: "attributes",
                          storageMode: "persisted",
                        }
                      })
                    }}
                  >
                    <KonvaRect
                      x={geometry.localBounds.x}
                      y={geometry.localBounds.y}
                      width={Math.max(bounds.width, 1)}
                      height={Math.max(bounds.height, 1)}
                      fill="rgba(255,255,255,0.001)"
                    />
                    {state.editingId === element.id && element.kind === "text"
                      ? null
                      : renderElementNode(element)}
                  </Group>
                )
              })}

              {editingTextElement && editingTextGeometry ? (
                <KonvaRect
                  x={editingTextGeometry.stagePosition.x}
                  y={editingTextGeometry.stagePosition.y}
                  offsetX={editingTextGeometry.rotationOrigin.x}
                  offsetY={editingTextGeometry.rotationOrigin.y}
                  rotation={editingTextElement.rotation ?? 0}
                  width={editingTextGeometry.localBounds.width}
                  height={editingTextGeometry.localBounds.height}
                  stroke="#1d9bf0"
                  strokeWidth={1}
                  strokeScaleEnabled={false}
                  dash={[5, 3]}
                  listening={false}
                />
              ) : null}

              {selectedLineElement?.meta.visible
                ? (
                    [
                      {
                        endpoint: "start" as const,
                        x: selectedLineElement.x,
                        y: selectedLineElement.y,
                      },
                      {
                        endpoint: "end" as const,
                        x: selectedLineElement.x2,
                        y: selectedLineElement.y2,
                      },
                    ] as const
                  ).map((handle) => (
                    <Group
                      key={`${selectedLineElement.id}-${handle.endpoint}-handle`}
                      x={handle.x}
                      y={handle.y}
                      draggable={!readOnly && !selectedLineElement.meta.locked}
                      onMouseDown={(event) => {
                        event.cancelBubble = true
                      }}
                      onTouchStart={(event) => {
                        event.cancelBubble = true
                      }}
                      onDragStart={(event) => {
                        event.cancelBubble = true
                        onChange((current) => ({
                          ...current,
                          selectedIds: [selectedLineElement.id],
                          editingId: null,
                        }))
                      }}
                      onDragMove={(event) => {
                        event.cancelBubble = true
                        onChange((current) => {
                          const nextDraft = updateLineEndpoint(
                            current.draft,
                            selectedLineElement.id,
                            handle.endpoint,
                            { x: event.target.x(), y: event.target.y() },
                            current.snapEnabled
                          )
                          return {
                            ...current,
                            liveDraft: nextDraft,
                            draft: nextDraft,
                            selectedIds: updateSelectionAfterDraft(current, nextDraft),
                            storageMode: "persisted",
                          }
                        })
                      }}
                      onDragEnd={(event) => {
                        event.cancelBubble = true
                        if (readOnly) {
                          return
                        }
                        onChange((current) => {
                          const nextDraft = updateLineEndpoint(
                            current.draft,
                            selectedLineElement.id,
                            handle.endpoint,
                            { x: event.target.x(), y: event.target.y() },
                            current.snapEnabled
                          )
                          const next = pushHistory(current, nextDraft)
                          return {
                            ...next,
                            selectedIds: updateSelectionAfterDraft(current, nextDraft),
                            editingId: null,
                            storageMode: "persisted",
                          }
                        })
                      }}
                    >
                      <KonvaCircle
                        radius={LINE_ENDPOINT_HIT_RADIUS}
                        fill="rgba(255,255,255,0.001)"
                      />
                      <KonvaCircle
                        radius={LINE_ENDPOINT_HANDLE_RADIUS}
                        fill={MONO_SURFACE}
                        stroke="#1d9bf0"
                        strokeWidth={0.12}
                      />
                    </Group>
                  ))
                : null}

              <Transformer
                ref={transformerRef}
                resizeEnabled={!readOnly && transformerEnabled}
                rotateEnabled={transformerCanRotate}
                keepRatio={transformerKeepRatio}
                enabledAnchors={transformerAnchors}
                flipEnabled={false}
                ignoreStroke
                listening={!readOnly && transformerEnabled}
                boundBoxFunc={(oldBox, newBox) => {
                  if (Math.abs(newBox.width) < 16 || Math.abs(newBox.height) < 16) {
                    return oldBox
                  }
                  return newBox
                }}
                onTransform={() => applyTransformerChange(false)}
                onTransformEnd={() => applyTransformerChange(true)}
              />
            </Group>
            {selectionBoxStageRect ? (
              <KonvaRect
                x={selectionBoxStageRect.x}
                y={selectionBoxStageRect.y}
                width={selectionBoxStageRect.width}
                height={selectionBoxStageRect.height}
                fill="rgba(140,92,54,0.08)"
                stroke="#8c5c36"
                strokeWidth={1}
                strokeScaleEnabled={false}
                dash={[4, 4]}
                listening={false}
              />
            ) : null}
          </Layer>
        </Stage>

        {state.editingId && hasVisibleTextSelection(state)
          ? (() => {
              return editingTextElement ? (
                <TextInlineEditor
                  element={editingTextElement}
                  viewport={state.viewport}
                  onCommit={(value) =>
                    onChange((current) => {
                      if (value === editingTextElement.value) {
                        return {
                          ...current,
                          editingId: null,
                        }
                      }
                      const next = applyDraftUpdate(current, (draft) =>
                        updateBoundElementValue(draft, editingTextElement.id, value)
                      )
                      return {
                        ...next,
                        editingId: null,
                      }
                    })
                  }
                  onCancel={() =>
                    onChange((current) => ({
                      ...current,
                      editingId: null,
                    }))
                  }
                />
              ) : null
            })()
          : null}
      </div>
    </div>
  )
}

function formatVersionTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function CanvasVersionsPanel({
  state,
  readOnly,
  onRestoreVersion,
  onReturnCurrent,
  onOpenVersion,
  onRefresh,
  onToggleAutosaves,
}: {
  state: CanvasPageState
  readOnly: boolean
  onRestoreVersion: () => void
  onReturnCurrent: () => void
  onOpenVersion: (version: UserTemplateVersionSnapshot) => void
  onRefresh: () => Promise<void>
  onToggleAutosaves: () => void
}) {
  if (!state.liveDraft.templateId) {
    return (
      <div className="tm-empty-state">
        <p className="tm-empty-state__title">还没有版本历史</p>
        <p className="tm-empty-state__body">
          先执行一次保存，当前草稿才会进入本地模板库并开始记录版本。
        </p>
      </div>
    )
  }

  if (!state.versionHistory) {
    return (
      <div className="grid gap-3">
        <div className="tm-empty-state">
          <p className="tm-empty-state__title">正在读取版本历史</p>
          <p className="tm-empty-state__body">当前模板的已保存版本和未保存草稿会在这里展示。</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void onRefresh()}>
          刷新历史
        </Button>
      </div>
    )
  }

  return (
    <div className="tm-version-drawer">
      <div className="tm-version-drawer__actions">
        <Button type="button" variant="outline" size="sm" onClick={() => void onRefresh()}>
          刷新
        </Button>
        {readOnly ? (
          <>
            <Button type="button" size="sm" onClick={onRestoreVersion}>
              恢复
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onReturnCurrent}>
              返回当前草稿
            </Button>
          </>
        ) : null}
      </div>

      <ul className="tm-version-list" aria-label="版本列表">
        {state.versionHistory.autosaves.length > 0 ? (
          <>
            <li>
              <button
                type="button"
                className="tm-version-list__item tm-version-list__item--group"
                onClick={onToggleAutosaves}
              >
                <div className="tm-version-list__main">
                  <div className="tm-version-list__title-row">
                    <span className="tm-version-list__title">未保存版本</span>
                    <span className="tm-version-list__badge tm-version-list__badge--draft">
                      {state.autosavesExpanded
                        ? "收起"
                        : `展开 ${state.versionHistory.autosaves.length}`}
                    </span>
                  </div>
                  <div className="tm-version-list__meta">
                    <span>共 {state.versionHistory.autosaves.length} 个自动保存快照</span>
                  </div>
                </div>
              </button>
            </li>
            {state.autosavesExpanded ? (
              <li className="tm-version-list__nested">
                {state.versionHistory.autosaves.map((version) => (
                  <button
                    key={version.id}
                    type="button"
                    className={cn(
                      "tm-version-list__item tm-version-list__item--nested",
                      state.readOnlyVersion?.id === version.id && "tm-version-list__item--active"
                    )}
                    onClick={() => onOpenVersion(version)}
                  >
                    <div className="tm-version-list__main">
                      <div className="tm-version-list__title-row">
                        <span className="tm-version-list__title">{version.label}</span>
                        <span className="tm-version-list__badge tm-version-list__badge--draft">
                          自动保存
                        </span>
                      </div>
                      <div className="tm-version-list__meta">
                        <span>{formatVersionTimestamp(version.createdAt)}</span>
                        <span>#{version.version}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </li>
            ) : null}
          </>
        ) : null}

        {state.versionHistory.saved.length === 0 ? (
          <li className="rounded-xl border border-dashed border-border/70 px-3 py-3 text-sm text-muted-foreground">
            当前模板还没有已保存版本。
          </li>
        ) : (
          state.versionHistory.saved.map((version) => (
            <li key={version.id}>
              <button
                type="button"
                className={cn(
                  "tm-version-list__item",
                  state.readOnlyVersion?.id === version.id && "tm-version-list__item--active"
                )}
                onClick={() => onOpenVersion(version)}
              >
                <div className="tm-version-list__main">
                  <div className="tm-version-list__title-row">
                    <span className="tm-version-list__title">{version.label}</span>
                    <span className="tm-version-list__badge">已保存</span>
                  </div>
                  <div className="tm-version-list__meta">
                    <span>{formatVersionTimestamp(version.createdAt)}</span>
                    <span>#{version.version}</span>
                  </div>
                </div>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}

function CanvasWorkspace({ controller, initialScenario }: CanvasPageProps) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const routeSource = React.useMemo(() => resolveCanvasSource(searchParams), [searchParams])
  const initialPanel = React.useMemo(() => resolveInitialCanvasPanel(searchParams), [searchParams])
  const initialStatus = React.useMemo(() => resolveCanvasStatus(searchParams), [searchParams])
  const startupSyncPending =
    routeSource.kind === "scratch" &&
    controller.context.surface === "server-http" &&
    controller.context.mode === "runtime" &&
    !controller.startupSyncReady
  const [state, setState] = React.useState<CanvasPageState>(() =>
    initialScenario
      ? createCanvasState(CANVAS_PRESETS[0]?.id ?? "shipping-wide", initialScenario)
      : createCanvasStateFromDraft(
          createDraftFromPreset(
            getPresetById(routeSource.kind === "scratch" ? routeSource.presetId : "shipping-wide")
          ),
          {
            loading: true,
            activePanel: initialPanel,
            versionsOpen: searchParams.get("panel") === "versions",
            outputStatus: initialStatus,
          }
        )
  )
  const isWide = useMediaQuery(`(min-width: ${CANVAS_WIDE_THRESHOLD}px)`)
  const [stageViewportSize, setStageViewportSize] = React.useState<StageViewportSize>({
    width: STAGE_VIEWPORT_WIDTH,
    height: STAGE_VIEWPORT_HEIGHT,
  })
  const dimensionOptions = React.useMemo(
    () => buildCanvasDimensionOptions(controller.canvasDimensions, CANVAS_PRESETS),
    [controller.canvasDimensions]
  )
  const [templateNameDialog, setTemplateNameDialog] =
    React.useState<TemplateNameDialogState | null>(null)
  const readOnly = state.readOnlyVersion !== null
  const interactionLocked = readOnly || state.loading
  const asyncClipboardSupported = supportsAsyncClipboard()
  const [, setFontLoadGeneration] = React.useState(0)
  const stateRef = React.useRef(state)
  const interactionLockedRef = React.useRef(interactionLocked)
  const stageViewportSizeRef = React.useRef(stageViewportSize)
  const stagePointerRef = React.useRef<{ x: number; y: number } | null>(null)
  const draftFontFamilies = React.useMemo(
    () =>
      state.draft.elements.flatMap((element) =>
        element.kind === "text" ? [element.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY] : []
      ),
    [state.draft.elements]
  )

  React.useEffect(() => {
    stateRef.current = state
  }, [state])

  React.useEffect(() => {
    interactionLockedRef.current = interactionLocked
  }, [interactionLocked])

  React.useEffect(() => {
    stageViewportSizeRef.current = stageViewportSize
  }, [stageViewportSize])

  React.useEffect(() => {
    let cancelled = false
    void preloadCanvasTextFonts(draftFontFamilies).then(() => {
      if (!cancelled) {
        setFontLoadGeneration((current) => current + 1)
      }
    })
    return () => {
      cancelled = true
    }
  }, [draftFontFamilies])

  const refreshVersionHistory = React.useCallback(async () => {
    if (!state.liveDraft.templateId) {
      return
    }
    const history = await readUserTemplateHistory(state.liveDraft.templateId)
    setState((current) =>
      current.liveDraft.templateId === state.liveDraft.templateId
        ? { ...current, versionHistory: history }
        : current
    )
  }, [state.liveDraft.templateId])

  const draftWithCurrentRenderOptions = React.useCallback(
    (draft: CanvasDraftDocument): CanvasDraftDocument => ({
      ...cloneDraft(draft),
      renderOptions: {
        ...draft.renderOptions,
        ...controller.renderOptions,
      },
    }),
    [controller.renderOptions]
  )

  React.useEffect(() => {
    if (initialScenario) {
      return
    }
    if (startupSyncPending) {
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const loaded = await loadDraftForSource(routeSource)
        if (cancelled) {
          return
        }
        controller.setRenderOptions({ ...defaultRenderOptions, ...loaded.draft.renderOptions })
        setState(
          createCanvasStateFromDraft(loaded.draft, {
            loading: false,
            versionHistory: loaded.versionHistory,
            activePanel: initialPanel,
            versionsOpen: searchParams.get("panel") === "versions",
            outputStatus:
              initialStatus ||
              (routeSource.kind === "user-template"
                ? "已加载本地用户模板。"
                : routeSource.kind === "preset-template"
                  ? "已载入系统模板副本，可保存为本地模板。"
                  : ""),
          })
        )
      } catch (cause) {
        if (cancelled) {
          return
        }
        setState({
          ...createCanvasStateFromDraft(
            {
              version: 1,
              unit: "mm",
              id:
                routeSource.kind === "user-template"
                  ? routeSource.templateId
                  : routeSource.presetId,
              presetId:
                routeSource.kind === "user-template"
                  ? routeSource.templateId
                  : routeSource.presetId,
              name: "加载失败",
              source: routeSource,
              width: 48,
              height: 28,
              fields: [],
              elements: [],
              editor: {
                gridEnabled: true,
                snapEnabled: true,
              },
            },
            {
              loading: false,
              versionsOpen: searchParams.get("panel") === "versions",
              outputStatus: cause instanceof Error ? cause.message : "加载画布失败。",
            }
          ),
          storageMode: "reset-pending",
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    controller.setRenderOptions,
    initialPanel,
    initialScenario,
    initialStatus,
    routeSource,
    searchParams,
    startupSyncPending,
  ])

  const autosaveLiveDraft = state.liveDraft
  const autosaveLoading = state.loading
  const autosaveRouteSource = state.routeSource
  const autosaveReadOnlyVersion = state.readOnlyVersion
  const autosaveVersionHistory = state.versionHistory

  React.useEffect(() => {
    if (initialScenario || autosaveLoading || readOnly) {
      return
    }

    const autosaveDocument = draftWithCurrentRenderOptions(autosaveLiveDraft)
    const autosaveBaseline = getAutosaveBaselineDraft({
      liveDraft: autosaveLiveDraft,
      readOnlyVersion: autosaveReadOnlyVersion,
      routeSource: autosaveRouteSource,
      versionHistory: autosaveVersionHistory,
    })
    const shouldCreateAutosave =
      autosaveRouteSource.kind !== "user-template" ||
      !autosaveBaseline ||
      !sameDraftContent(autosaveDocument, autosaveBaseline)

    if (
      shouldCreateAutosave &&
      autosaveLiveDraft.templateId &&
      state.storageMode !== "reset-pending"
    ) {
      void saveUserTemplateAutosave({
        templateId: autosaveLiveDraft.templateId,
        source: autosaveRouteSource,
        document: autosaveDocument,
        sourceVersionId: autosaveLiveDraft.baseVersionId,
      })
    }

    if (
      (autosaveRouteSource.kind === "scratch" || autosaveRouteSource.kind === "preset-template") &&
      !startupSyncPending &&
      state.storageMode !== "reset-pending"
    ) {
      persistDraftDocument(autosaveDocument)
    }
  }, [
    autosaveLiveDraft,
    autosaveLoading,
    autosaveReadOnlyVersion,
    autosaveRouteSource,
    autosaveVersionHistory,
    draftWithCurrentRenderOptions,
    initialScenario,
    readOnly,
    state.storageMode,
    startupSyncPending,
  ])

  React.useEffect(() => {
    if (initialScenario || state.loading || startupSyncPending) {
      return
    }
    if (state.routeSource.kind === "scratch") {
      if (state.storageMode === "reset-pending") {
        controller.deleteCanvasDraft(state.presetId)
        return
      }
      controller.recordCanvasDraft(state.presetId, draftWithCurrentRenderOptions(state.liveDraft))
    }
  }, [
    controller.deleteCanvasDraft,
    controller.recordCanvasDraft,
    draftWithCurrentRenderOptions,
    initialScenario,
    startupSyncPending,
    state.liveDraft,
    state.loading,
    state.presetId,
    state.routeSource.kind,
    state.storageMode,
  ])

  React.useEffect(() => {
    if (!state.versionsOpen || !state.liveDraft.templateId || initialScenario) {
      return
    }
    void refreshVersionHistory()
  }, [initialScenario, refreshVersionHistory, state.liveDraft.templateId, state.versionsOpen])

  React.useEffect(() => {
    const fallbackViewport = createViewport(state.draft.width, state.draft.height)
    const isUsingFallbackViewport =
      Math.abs(state.viewport.scale - fallbackViewport.scale) < 0.001 &&
      Math.abs(state.viewport.x - fallbackViewport.x) < 0.5 &&
      Math.abs(state.viewport.y - fallbackViewport.y) < 0.5

    if (!isUsingFallbackViewport) {
      return
    }

    setState((current) => {
      const currentFallbackViewport = createViewport(current.draft.width, current.draft.height)
      const stillUsingFallbackViewport =
        Math.abs(current.viewport.scale - currentFallbackViewport.scale) < 0.001 &&
        Math.abs(current.viewport.x - currentFallbackViewport.x) < 0.5 &&
        Math.abs(current.viewport.y - currentFallbackViewport.y) < 0.5

      if (!stillUsingFallbackViewport) {
        return current
      }

      const nextViewport = createViewport(
        current.draft.width,
        current.draft.height,
        stageViewportSize.width,
        stageViewportSize.height
      )

      const unchanged =
        Math.abs(current.viewport.scale - nextViewport.scale) < 0.001 &&
        Math.abs(current.viewport.x - nextViewport.x) < 0.5 &&
        Math.abs(current.viewport.y - nextViewport.y) < 0.5

      return unchanged ? current : { ...current, viewport: nextViewport }
    })
  }, [
    stageViewportSize.height,
    stageViewportSize.width,
    state.draft.height,
    state.draft.width,
    state.viewport,
  ])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        return
      }
      if (event.key === " ") {
        setState((current) => ({ ...current, spacePressed: true }))
      }
      if (interactionLocked) {
        if (event.key === "Escape") {
          event.preventDefault()
          setState((current) => ({
            ...current,
            draft: current.liveDraft,
            readOnlyVersion: null,
            selectedIds: [],
            editingId: null,
            outputStatus: "已返回当前草稿。",
          }))
        }
        return
      }
      if (stateRef.current.pendingPaste) {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
          event.preventDefault()
          setState((current) => cancelPendingPastePlacement(current))
          return
        }
        if (event.key === "Escape") {
          event.preventDefault()
          setState((current) => cancelPendingPastePlacement(current))
          return
        }
        if (event.key === "Enter") {
          event.preventDefault()
          setState((current) => confirmPendingPastePlacement(current))
          return
        }
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault()
        setState((current) => (event.shiftKey ? redoDraft(current) : undoDraft(current)))
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
        event.preventDefault()
        setState((current) => redoDraft(current))
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault()
        setState((current) => duplicateSelected(current))
        return
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault()
        setState((current) => deleteSelected(current))
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setState((current) => ({ ...current, selectedIds: [], editingId: null }))
        return
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        setState((current) => moveSelectedByKeyboard(current, event.shiftKey ? -10 : -1, 0))
        return
      }
      if (event.key === "ArrowRight") {
        event.preventDefault()
        setState((current) => moveSelectedByKeyboard(current, event.shiftKey ? 10 : 1, 0))
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setState((current) => moveSelectedByKeyboard(current, 0, event.shiftKey ? -10 : -1))
        return
      }
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setState((current) => moveSelectedByKeyboard(current, 0, event.shiftKey ? 10 : 1))
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") {
        setState((current) => ({ ...current, spacePressed: false }))
      }
    }

    const handleWindowBlur = () => {
      setState((current) => ({ ...current, spacePressed: false }))
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("blur", handleWindowBlur)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      window.removeEventListener("blur", handleWindowBlur)
    }
  }, [interactionLocked])

  React.useEffect(() => {
    const handleCopy = (event: ClipboardEvent) => {
      if (isCanvasClipboardBypassTarget(event.target) || !event.clipboardData) {
        return
      }

      const selectedElements = getSelectedCanvasElements(stateRef.current)
      if (selectedElements.length === 0) {
        return
      }

      event.preventDefault()
      writeCanvasClipboardToDataTransfer(event.clipboardData, selectedElements)
      setState((current) => ({
        ...current,
        outputStatus: "已拷贝所选图层。",
      }))
    }

    const handlePaste = (event: ClipboardEvent) => {
      if (isCanvasClipboardBypassTarget(event.target) || !event.clipboardData) {
        return
      }

      if (interactionLockedRef.current) {
        event.preventDefault()
        if (stateRef.current.readOnlyVersion) {
          setState((current) => ({
            ...current,
            outputStatus: "当前快照只读，无法粘贴。",
          }))
        }
        return
      }

      event.preventDefault()
      const clipboard = readCanvasClipboardFromDataTransfer(event.clipboardData)
      setState((current) =>
        startClipboardPastePlacement(
          current,
          clipboard,
          stageViewportSizeRef.current,
          stagePointerRef.current ?? undefined
        )
      )
    }

    window.addEventListener("copy", handleCopy)
    window.addEventListener("paste", handlePaste)
    return () => {
      window.removeEventListener("copy", handleCopy)
      window.removeEventListener("paste", handlePaste)
    }
  }, [])

  const openVersion = React.useCallback((version: UserTemplateVersionSnapshot) => {
    setState((current) => ({
      ...current,
      draft: cloneDraft(version.document),
      readOnlyVersion: version,
      selectedIds: [],
      editingId: null,
      versionsOpen: true,
      focus: "center-right",
      outputStatus: `正在查看 ${version.label}。`,
    }))
  }, [])

  const returnToCurrentDraft = React.useCallback(() => {
    setState((current) => ({
      ...current,
      draft: current.liveDraft,
      readOnlyVersion: null,
      selectedIds: [],
      editingId: null,
      outputStatus: "已返回当前草稿。",
    }))
  }, [])

  const handleRestoreVersion = React.useCallback(async () => {
    const snapshot =
      state.readOnlyVersion && state.liveDraft.templateId
        ? {
            readOnlyVersion: state.readOnlyVersion,
            templateId: state.liveDraft.templateId,
            versionHistory: state.versionHistory,
          }
        : null

    if (!snapshot) {
      return
    }

    const restoredDraft = createRestoredDraftFromVersion(
      snapshot.readOnlyVersion,
      snapshot.templateId
    )
    await replaceUserTemplateWorkingCopy({
      templateId: snapshot.templateId,
      source: { kind: "user-template", templateId: snapshot.templateId },
      document: restoredDraft,
      sourceVersionId: snapshot.readOnlyVersion.id,
    })
    await clearTemplateAutosaves(snapshot.templateId)
    await controller.refreshUserTemplates()

    const history = await readUserTemplateHistory(snapshot.templateId)
    setState(() =>
      createCanvasStateFromDraft(restoredDraft, {
        versionHistory: history ?? snapshot.versionHistory,
        focus: "center-right",
        versionsOpen: true,
        outputStatus: `已从 ${snapshot.readOnlyVersion.label} 恢复到当前草稿。`,
      })
    )
  }, [controller, state.liveDraft.templateId, state.readOnlyVersion, state.versionHistory])

  const saveNamedTemplate = React.useCallback(
    async (mode: "save" | "save-as", nextName: string) => {
      const baseDraft =
        readOnly && state.readOnlyVersion ? state.readOnlyVersion.document : state.liveDraft
      const existingTemplateId =
        mode === "save" && !readOnly ? state.liveDraft.templateId : undefined

      if (!nextName) {
        return
      }

      const documentForSave =
        mode === "save" && existingTemplateId
          ? {
              ...draftWithCurrentRenderOptions(baseDraft),
              name: nextName,
            }
          : duplicateDraftAsTemplate(draftWithCurrentRenderOptions(baseDraft), nextName)

      const result = await saveUserTemplate({
        name: nextName,
        document: documentForSave,
        templateId: existingTemplateId,
        sourceVersionId:
          mode === "save" && !readOnly ? state.liveDraft.baseVersionId : state.readOnlyVersion?.id,
      })

      if (!existingTemplateId && state.routeSource.kind !== "user-template") {
        await clearWorkingCopy(state.routeSource)
      }
      await clearTemplateAutosaves(result.template.id)
      controller.recordCanvasDimension({
        width: result.workingCopy.draft.width,
        height: result.workingCopy.draft.height,
      })
      await controller.refreshUserTemplates()

      const history = await readUserTemplateHistory(result.template.id)
      navigate(
        `/canvas?source=user-template&templateId=${result.template.id}&panel=versions&status=${
          mode === "save" && existingTemplateId ? "saved" : "created"
        }`,
        { replace: true }
      )
      setState(
        createCanvasStateFromDraft(result.workingCopy.draft, {
          versionHistory: history,
          focus: "center-right",
          versionsOpen: true,
          outputStatus:
            mode === "save" && existingTemplateId ? "已保存新版本。" : "已保存为用户模板。",
        })
      )
    },
    [
      controller.refreshUserTemplates,
      draftWithCurrentRenderOptions,
      navigate,
      readOnly,
      state.liveDraft,
      state.readOnlyVersion,
      state.routeSource,
      controller.recordCanvasDimension,
    ]
  )

  const persistNamedTemplate = React.useCallback(
    async (mode: "save" | "save-as") => {
      const baseDraft =
        readOnly && state.readOnlyVersion ? state.readOnlyVersion.document : state.liveDraft
      const existingTemplateId =
        mode === "save" && !readOnly ? state.liveDraft.templateId : undefined
      const suggestedName =
        mode === "save" && existingTemplateId
          ? state.liveDraft.name
          : baseDraft.name || "未命名模板"

      if (mode === "save" && existingTemplateId) {
        await saveNamedTemplate(mode, suggestedName)
        return
      }

      setTemplateNameDialog({
        mode,
        suggestedName,
      })
    },
    [readOnly, saveNamedTemplate, state.liveDraft, state.readOnlyVersion]
  )

  const handleResetDraft = React.useCallback(async () => {
    const nextState = await resetCanvasDraft({
      state,
      controller,
    })
    setState(nextState)
  }, [controller, state])

  const handleCopyToClipboard = React.useCallback(async () => {
    if (!asyncClipboardSupported) {
      setState((current) => ({
        ...current,
        outputStatus: "当前环境不支持按钮拷贝，请使用键盘快捷键。",
      }))
      return
    }

    const selectedElements = getSelectedCanvasElements(stateRef.current)
    if (selectedElements.length === 0) {
      return
    }

    try {
      await writeCanvasClipboardToNavigator(selectedElements)
      setState((current) => ({
        ...current,
        outputStatus: "已拷贝所选图层。",
      }))
    } catch {
      setState((current) => ({
        ...current,
        outputStatus: "拷贝失败，请检查浏览器剪贴板权限。",
      }))
    }
  }, [asyncClipboardSupported])

  const handlePasteFromClipboard = React.useCallback(async () => {
    if (!asyncClipboardSupported) {
      setState((current) => ({
        ...current,
        outputStatus: "当前环境不支持按钮粘贴，请使用键盘快捷键。",
      }))
      return
    }

    if (interactionLockedRef.current) {
      return
    }

    try {
      const clipboard = await readCanvasClipboardFromNavigator()
      setState((current) =>
        startClipboardPastePlacement(
          current,
          clipboard,
          stageViewportSizeRef.current,
          stagePointerRef.current ?? undefined
        )
      )
    } catch {
      setState((current) => ({
        ...current,
        outputStatus: "粘贴失败，请检查浏览器剪贴板权限。",
      }))
    }
  }, [asyncClipboardSupported])

  const canUndo = state.historyIndex > 0
  const canRedo = state.historyIndex < state.history.length - 1
  const inspectorReadOnly = interactionLocked || state.pendingPaste !== null
  const clipboardToastTone = getClipboardToastTone(state.outputStatus)
  const handleStagePointerChange = (point: { x: number; y: number } | null) => {
    stagePointerRef.current = point
  }

  return (
    <section className="tm-workspace">
      <CanvasToolbar
        state={state}
        canUndo={canUndo}
        canRedo={canRedo}
        isWide={isWide}
        stageViewportSize={stageViewportSize}
        readOnly={readOnly}
        onReset={handleResetDraft}
        onSave={() => persistNamedTemplate("save")}
        onSaveAs={() => persistNamedTemplate("save-as")}
        onRestoreVersion={handleRestoreVersion}
        onReturnCurrent={returnToCurrentDraft}
        onOpenVersions={() =>
          setState((current) => ({
            ...current,
            versionsOpen: true,
          }))
        }
        onChange={setState}
      />

      <div
        className={cn(
          "tm-pane-grid",
          isWide
            ? "tm-pane-grid--triple"
            : state.focus === "left-center"
              ? "tm-pane-grid--focus-left"
              : "tm-pane-grid--focus-right"
        )}
      >
        <aside className="tm-pane tm-pane--left">
          <div className="tm-pane__header">
            <div className="tm-pane__headline">
              <h2>工具栏</h2>
            </div>
          </div>
          <div className="tm-pane__body">
            <CanvasLayerRail state={state} readOnly={inspectorReadOnly} onChange={setState} />
          </div>
        </aside>

        <section className="tm-pane tm-pane--center">
          <div className="tm-pane__header">
            <div className="tm-pane__headline">
              <h2>标签编辑台</h2>
              <p>
                {readOnly
                  ? "历史快照只读查看。"
                  : startupSyncPending
                    ? "正在恢复同设备草稿。"
                    : state.loading
                      ? "正在读取当前画布草稿。"
                      : "单色编辑，所见即所得。"}
              </p>
            </div>
            <div className="tm-pane__meta">
              <DimensionPicker
                variant="inline"
                disabled={interactionLocked}
                options={dimensionOptions}
                value={{ width: state.draft.width, height: state.draft.height }}
                onCommit={(dimension) =>
                  setState((current) =>
                    resizeCanvasDraft(
                      current,
                      dimension,
                      stageViewportSize.width,
                      stageViewportSize.height
                    )
                  )
                }
              />
            </div>
          </div>
          <div className="tm-pane__body tm-pane__body--canvas-stage">
            {clipboardToastTone ? (
              <CanvasClipboardToast message={state.outputStatus} tone={clipboardToastTone} />
            ) : null}
            {state.outputStatus && !clipboardToastTone ? (
              <div className="tm-pane__notice">{state.outputStatus}</div>
            ) : null}
            {startupSyncPending || state.loading ? (
              <div className="tm-empty-state">
                <p className="tm-empty-state__title">
                  {startupSyncPending ? "正在恢复同设备草稿" : "正在读取画布"}
                </p>
                <p className="tm-empty-state__body">
                  {startupSyncPending
                    ? "稍后会继续打开当前预设的最近草稿。"
                    : "稍后会切换到当前路由对应的模板草稿。"}
                </p>
              </div>
            ) : (
              <CanvasStageView
                state={state}
                readOnly={interactionLocked}
                onChange={setState}
                onViewportSizeChange={setStageViewportSize}
                onPointerChange={handleStagePointerChange}
              />
            )}
          </div>
        </section>

        <aside className="tm-pane tm-pane--right tm-pane--canvas-inspector">
          <div className="tm-pane__header">
            <div className="tm-pane__headline">
              <h2>{state.activePanel === "attributes" ? "当前元素属性" : "打印输出"}</h2>
              <p>
                {state.activePanel === "attributes"
                  ? readOnly
                    ? "当前打开的是只读快照。"
                    : state.loading
                      ? "正在读取当前画布草稿。"
                      : "单选编辑，多选走批量操作。"
                  : state.activePanel === "output"
                    ? "先预览，再打印。"
                    : ""}
              </p>
            </div>
            <div className="tm-pane__tabs">
              <Button
                size="sm"
                variant={state.activePanel === "attributes" ? "default" : "outline"}
                disabled={state.loading}
                onClick={() =>
                  setState((current) => ({
                    ...current,
                    activePanel: "attributes",
                    focus: "center-right",
                  }))
                }
              >
                属性
              </Button>
              <Button
                size="sm"
                variant={state.activePanel === "output" ? "default" : "outline"}
                disabled={state.loading}
                onClick={() =>
                  setState((current) => ({
                    ...current,
                    activePanel: "output",
                    focus: "center-right",
                  }))
                }
              >
                输出
              </Button>
            </div>
          </div>
          <div className="tm-pane__body">
            <div className="tm-pane__stack">
              {state.activePanel === "attributes" ? (
                <CanvasInspector
                  state={state}
                  readOnly={inspectorReadOnly}
                  clipboardSupported={asyncClipboardSupported}
                  onCopy={handleCopyToClipboard}
                  onPaste={handlePasteFromClipboard}
                  onChange={setState}
                />
              ) : (
                <CanvasOutput
                  controller={controller}
                  state={state}
                  readOnly={inspectorReadOnly}
                  onChange={setState}
                />
              )}
              <CanvasLayerPanel
                state={state}
                readOnly={inspectorReadOnly}
                clipboardSupported={asyncClipboardSupported}
                onCopy={handleCopyToClipboard}
                onPaste={handlePasteFromClipboard}
                onChange={setState}
              />
            </div>
          </div>
        </aside>
      </div>
      <Sheet
        open={state.versionsOpen}
        onOpenChange={(open) =>
          setState((current) => ({
            ...current,
            versionsOpen: open,
          }))
        }
      >
        <SheetTrigger asChild>
          <span className="hidden" />
        </SheetTrigger>
        <SheetContent side="right" className="tm-version-sheet">
          <SheetHeader className="tm-version-sheet__header">
            <SheetTitle>版本历史</SheetTitle>
            <SheetDescription>已保存版本与未保存草稿都以列表形式收在这里。</SheetDescription>
          </SheetHeader>
          <div className="tm-version-sheet__body">
            <CanvasVersionsPanel
              state={state}
              readOnly={readOnly}
              onRestoreVersion={handleRestoreVersion}
              onReturnCurrent={returnToCurrentDraft}
              onOpenVersion={openVersion}
              onRefresh={refreshVersionHistory}
              onToggleAutosaves={() =>
                setState((current) => ({
                  ...current,
                  autosavesExpanded: !current.autosavesExpanded,
                }))
              }
            />
          </div>
        </SheetContent>
      </Sheet>
      <PromptDialog
        open={templateNameDialog !== null}
        title="保存为用户模板"
        description="为这个浏览器本地模板命名。保存后会进入版本历史，可以继续编辑。"
        label="模板名称"
        defaultValue={templateNameDialog?.suggestedName ?? ""}
        cancelLabel="取消"
        confirmLabel="保存"
        requiredMessage="请输入模板名称。"
        onOpenChange={(open) => {
          if (!open) {
            setTemplateNameDialog(null)
          }
        }}
        onConfirm={(nextName) => {
          const mode = templateNameDialog?.mode ?? "save-as"
          setTemplateNameDialog(null)
          void saveNamedTemplate(mode, nextName)
        }}
      />
    </section>
  )
}

export { CanvasWorkspace }
