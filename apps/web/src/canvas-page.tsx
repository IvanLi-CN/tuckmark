import JsBarcode from "jsbarcode"
import type Konva from "konva"
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpToLine,
  CheckCircle2,
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
  Save,
  ScanSearch,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import QRCode from "qrcode"
import React from "react"
import {
  Group,
  Line as KonvaLine,
  Rect as KonvaRect,
  Text as KonvaText,
  Layer,
  Stage,
  Transformer,
} from "react-konva"
import { useNavigate, useSearchParams } from "react-router-dom"
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
  getElementGeometry,
  getElementSelectionBounds,
  getPresetById,
  getSystemTemplateById,
  loadStoredDraftDocument,
  persistDraftDocument,
  renameDraftField,
  reorderDraftElements,
  toCanvasPrintSource,
  toggleElementBinding,
  translateElement,
  updateBoundElementValue,
} from "./canvas-editor-model.js"
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js"
import { Badge } from "./components/ui/badge.js"
import { Button } from "./components/ui/button.js"
import { Combobox } from "./components/ui/combobox.js"
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
  saveUserTemplate,
  saveUserTemplateAutosave,
} from "./user-template-store.js"
import type { WorkbenchController } from "./workbench-controller.js"

type CanvasPageProps = {
  controller: WorkbenchController
  initialScenario?: CanvasStoryScenario
}

type CanvasSelectionBox = {
  x1: number
  y1: number
  x2: number
  y2: number
  visible: boolean
}

type StageViewport = {
  x: number
  y: number
  scale: number
}

type StageViewportSize = {
  width: number
  height: number
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
  outputStatus: string
  autosavesExpanded: boolean
  versionsOpen: boolean
  loading: boolean
  storageMode: "persisted" | "reset-pending"
}

const GRID_SIZE = 20
const STAGE_VIEWPORT_WIDTH = 760
const STAGE_VIEWPORT_HEIGHT = 520
const ZOOM_MIN = 0.45
const ZOOM_MAX = 3
const ZOOM_STEP = 1.08
const SELECTION_HANDLE_SIZE = 8
const MONO_INK = "#111111"
const MONO_SURFACE = "#ffffff"
const CANVAS_TEXT_FONT_FAMILY = "ui-sans-serif, system-ui, sans-serif"
const PAPER_TYPE_LABELS: Record<"continuous" | "gap", string> = {
  continuous: "连续纸",
  gap: "间隙纸",
}

type CanvasIssue = {
  title: string
  detail: string
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getCanvasTextLineHeight(fontSize: number) {
  return (fontSize + 4) / fontSize
}

function normalizeRect(box: CanvasSelectionBox) {
  const x = Math.min(box.x1, box.x2)
  const y = Math.min(box.y1, box.y2)
  const width = Math.abs(box.x2 - box.x1)
  const height = Math.abs(box.y2 - box.y1)
  return { x, y, width, height }
}

function cloneDraft(draft: CanvasDraftDocument): CanvasDraftDocument {
  return structuredClone(draft)
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

function createViewport(
  width: number,
  height: number,
  viewportWidth = STAGE_VIEWPORT_WIDTH,
  viewportHeight = STAGE_VIEWPORT_HEIGHT
): StageViewport {
  const scale = clamp(
    Math.min(viewportWidth / Math.max(width, 1), viewportHeight / Math.max(height, 1), ZOOM_MAX),
    ZOOM_MIN,
    ZOOM_MAX
  )
  return {
    scale,
    x: (viewportWidth - width * scale) / 2,
    y: (viewportHeight - height * scale) / 2,
  }
}

function createScenarioDraft(scenario: CanvasStoryScenario): CanvasDraftDocument {
  if (scenario === "draft-restore") {
    return buildStoryScenarioDocument("draft-restore")
  }

  if (scenario === "wide-default" || scenario === "barcode-selected") {
    return createDraftFromPreset(getPresetById("shipping-wide"))
  }

  return createDraftFromPreset(getPresetById("ops-tag"))
}

function createCanvasStateFromDraft(
  draft: CanvasDraftDocument,
  options?: {
    selectedIds?: string[]
    activePanel?: CanvasPageState["activePanel"]
    focus?: CanvasPageState["focus"]
    outputStatus?: string
    loading?: boolean
    versionHistory?: UserTemplateHistory | null
    versionsOpen?: boolean
  }
): CanvasPageState {
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
    viewport: createViewport(draft.width, draft.height),
    selectionBox: { x1: 0, y1: 0, x2: 0, y2: 0, visible: false },
    history: [cloneDraft(draft)],
    historyIndex: 0,
    editingId: null,
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
  if (scenario === "text-selected" || scenario === "draft-restore") {
    const text = draft.elements.find((element) => element.kind === "text")
    return text ? [text.id] : []
  }
  return []
}

function createCanvasState(
  presetId: string,
  scenario: CanvasStoryScenario = "wide-default"
): CanvasPageState {
  const preset = getPresetById(presetId)
  const seededDraft = createScenarioDraft(scenario)
  const storedDraft =
    scenario === "draft-restore" ? seededDraft : loadStoredDraftDocument(preset.id)
  const draft =
    storedDraft ??
    (seededDraft.presetId === preset.id ? seededDraft : createDraftFromPreset(preset))
  return {
    ...createCanvasStateFromDraft(draft, {
      selectedIds: getScenarioSelection(draft, scenario),
      activePanel: scenario === "output-tab" ? "output" : "attributes",
      focus: scenario === "output-tab" ? "center-right" : "left-center",
      outputStatus:
        scenario === "draft-restore"
          ? "已恢复上次草稿。"
          : storedDraft
            ? `已恢复「${draft.name}」的最近草稿。`
            : "",
    }),
    editingId:
      scenario === "text-selected" ? (getScenarioSelection(draft, scenario)[0] ?? null) : null,
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
  const nextDraft = updater(cloneDraft(state.liveDraft))
  nextDraft.editor.gridEnabled = state.gridEnabled
  nextDraft.editor.snapEnabled = state.snapEnabled
  const next = pushHistory(state, nextDraft)
  return {
    ...next,
    selectedIds: updateSelectionAfterDraft(state, nextDraft),
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

function getStagePointer(
  stage: Konva.Stage,
  viewport: StageViewport
): { x: number; y: number } | null {
  const pointer = stage.getPointerPosition()
  if (!pointer) {
    return null
  }
  return {
    x: (pointer.x - viewport.x) / viewport.scale,
    y: (pointer.y - viewport.y) / viewport.scale,
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

function getVisibleGridBounds(
  viewport: StageViewport,
  viewportWidth = STAGE_VIEWPORT_WIDTH,
  viewportHeight = STAGE_VIEWPORT_HEIGHT
) {
  const left = -viewport.x / viewport.scale
  const top = -viewport.y / viewport.scale
  const right = left + viewportWidth / viewport.scale
  const bottom = top + viewportHeight / viewport.scale

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
    return {
      ...createCanvasStateFromDraft(
        createDraftFromSystemTemplate(getSystemTemplateById(state.routeSource.presetId))
      ),
      outputStatus: "已重置为系统模板初始内容。",
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
    outputStatus: nextSelectedIds.length > 0 ? "已复制所选图层。" : nextState.outputStatus,
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
  persistDraftDocument(nextDraft)
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
  persistDraftDocument(nextDraft)
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
    const nextWidth = Math.max(24, element.width * scaleX)
    const nextFontSize = Math.max(8, element.fontSize * scaleY)
    const nextHeight = Math.max(
      nextFontSize + 4,
      nextFontSize + (Math.max(element.maxLines ?? 1, 1) - 1) * (nextFontSize + 4)
    )
    return {
      ...element,
      x: node.x() - nextWidth / 2,
      y: node.y() - (-nextFontSize + nextHeight / 2),
      width: nextWidth,
      fontSize: nextFontSize,
      rotation: node.rotation(),
    }
  }

  if (element.kind === "rect") {
    node.scaleX(1)
    node.scaleY(1)
    const nextWidth = Math.max(16, element.width * scaleX)
    const nextHeight = Math.max(16, element.height * scaleY)
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
    const nextWidth = Math.max(36, element.width * scaleX)
    const nextHeight = Math.max(18, element.height * scaleY)
    return {
      ...element,
      x: node.x() - nextWidth / 2,
      y: node.y() - nextHeight / 2,
      width: nextWidth,
      height: nextHeight,
      rotation: node.rotation(),
    }
  }

  node.scaleX(1)
  node.scaleY(1)
  const nextSize = Math.max(24, element.size * Math.max(scaleX, scaleY))
  return {
    ...element,
    x: node.x() - nextSize / 2,
    y: node.y() - nextSize / 2,
    size: nextSize,
    rotation: node.rotation(),
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
    height: Math.max(8, Math.round(element.height)),
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
    width: Math.max((module.width / totalWidth) * element.width, 1),
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

function getElementIssue(element: CanvasDraftElement): CanvasIssue | null {
  switch (element.kind) {
    case "barcode":
      return getBarcodeIssue(element)
    case "qr":
      return getQrIssue(element)
    default:
      return null
  }
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

  const workingCopy = await loadWorkingCopy(source)
  if (workingCopy?.draft) {
    return {
      draft: workingCopy.draft,
      versionHistory: null,
    }
  }

  if (source.kind === "preset-template") {
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

  return (
    <div
      className="pointer-events-auto absolute z-20"
      style={{
        left: viewport.x + element.x * viewport.scale,
        top: viewport.y + (element.y - element.fontSize) * viewport.scale,
        width: Math.max(element.width * viewport.scale, 160),
      }}
    >
      <Textarea
        autoFocus
        value={value}
        className="min-h-[92px] resize-none border-primary/35 bg-white/96 shadow-lg"
        style={{
          fontFamily: CANVAS_TEXT_FONT_FAMILY,
          fontSize: `${Math.max(12, element.fontSize * viewport.scale * 0.68)}px`,
          lineHeight: getCanvasTextLineHeight(element.fontSize),
        }}
        onChange={(event) => setValue(event.currentTarget.value)}
        onBlur={() => onCommit(value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault()
            onCommit(value)
          } else if (event.key === "Escape") {
            event.preventDefault()
            onCancel()
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
  onSave: () => Promise<void>
  onSaveAs: () => Promise<void>
  onRestoreVersion: () => void
  onReturnCurrent: () => void
  onOpenVersions: () => void
  onChange: React.Dispatch<React.SetStateAction<CanvasPageState>>
}) {
  return (
    <div className="tm-canvas-toolbar">
      {!isWide ? (
        <div className="tm-canvas-toolbar__group tm-canvas-toolbar__group--segmented">
          <Button
            size="sm"
            variant={state.focus === "left-center" ? "default" : "outline"}
            onClick={() => onChange((current) => ({ ...current, focus: "left-center" }))}
          >
            工具与图层
          </Button>
          <Button
            size="sm"
            variant={state.focus === "center-right" ? "default" : "outline"}
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
              <Button size="sm" variant="outline" onClick={() => void onSaveAs()}>
                <Save className="size-4" />
                另存为
              </Button>
              <Button size="sm" variant="outline" onClick={onReturnCurrent}>
                返回当前草稿
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={!canUndo}
                onClick={() => onChange((current) => undoDraft(current))}
              >
                <Undo2 className="size-4" />
                撤销
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!canRedo}
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
              <Badge variant="outline" className="tm-canvas-toolbar__zoom-badge">
                {Math.round(state.viewport.scale * 100)}%
              </Badge>
              <Button
                size="sm"
                variant="outline"
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
                onClick={() =>
                  onChange((current) => ({
                    ...current,
                    gridEnabled: !current.gridEnabled,
                    draft: {
                      ...current.draft,
                      editor: { ...current.draft.editor, gridEnabled: !current.gridEnabled },
                    },
                    storageMode: "persisted",
                  }))
                }
              >
                <Grid2x2 className="size-4" />
                网格
              </Button>
              <Button
                size="sm"
                variant={state.snapEnabled ? "default" : "outline"}
                onClick={() =>
                  onChange((current) => ({
                    ...current,
                    snapEnabled: !current.snapEnabled,
                    draft: {
                      ...current.draft,
                      editor: { ...current.draft.editor, snapEnabled: !current.snapEnabled },
                    },
                    storageMode: "persisted",
                  }))
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
          <Badge variant="outline">
            {readOnly
              ? "历史快照只读"
              : state.selectedIds.length > 0
                ? `已选 ${state.selectedIds.length} 项`
                : "未选择元素"}
          </Badge>
        </div>
        {readOnly ? null : (
          <>
            <Button size="sm" variant="outline" onClick={onOpenVersions}>
              <History className="size-4" />
              版本历史
            </Button>
            <Button size="sm" onClick={() => void onSave()}>
              <Save className="size-4" />
              保存
            </Button>
            <Button size="sm" variant="outline" onClick={() => void onSaveAs()}>
              <FileClock className="size-4" />
              另存为
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onChange((current) => resetDraft(current))}
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
  const sourceDescription =
    state.routeSource.kind === "scratch"
      ? `当前草稿：${state.draft.name}`
      : state.routeSource.kind === "preset-template"
        ? `系统模板：${state.draft.name}`
        : `用户模板：${state.draft.name}`
  const sourceNote =
    state.routeSource.kind === "preset-template"
      ? "来自系统模板副本，保存后会进入本地用户模板库。"
      : state.routeSource.kind === "user-template"
        ? "已连接本地用户模板，保存会新增一个已保存版本。"
        : null

  return (
    <div className="tm-left-rail">
      <CanvasSection title="尺寸与元素" description={sourceDescription}>
        <div className="grid gap-2">
          {state.routeSource.kind === "scratch" ? (
            <Select
              value={state.presetId}
              disabled={readOnly}
              onValueChange={(value) => onChange(() => createCanvasState(value))}
            >
              <SelectTrigger disabled={readOnly}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CANVAS_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {sourceNote ? <p className="tm-note tm-note--left-rail">{sourceNote}</p> : null}
          <div className="tm-quick-tools">
            {(["text", "rect", "line", "barcode", "qr"] as const).map((kind) => (
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
  onChange,
}: {
  state: CanvasPageState
  readOnly: boolean
  onChange: React.Dispatch<React.SetStateAction<CanvasPageState>>
}) {
  const selectedCount = state.selectedIds.length

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
            disabled={selectedCount === 0 || readOnly}
            onClick={() => onChange((current) => duplicateSelected(current))}
          >
            <Copy className="size-4" />
            复制
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
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() =>
                    onChange((current) => ({
                      ...setSelection(current, element.id, false),
                      focus: "center-right",
                      activePanel: "attributes",
                    }))
                  }
                >
                  <div className="tm-choice__title-row">
                    <div className="tm-choice__title" title={element.meta.name}>
                      {element.meta.name}
                    </div>
                  </div>
                  <div className="tm-choice__meta">
                    <span>图层 {index}</span>
                    <span>{CANVAS_TOOL_LABELS[element.kind]}</span>
                    {element.meta.locked ? <span>已锁定</span> : null}
                    {!element.meta.visible ? <span>已隐藏</span> : null}
                    {issue ? <span className="tm-choice__meta-error">{issue.title}</span> : null}
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
  onChange,
}: {
  state: CanvasPageState
  readOnly: boolean
  onChange: React.Dispatch<React.SetStateAction<CanvasPageState>>
}) {
  const selectedItems = state.draft.elements.filter((item) => state.selectedIds.includes(item.id))
  const element = selectedItems[0]
  const supportsReplaceable =
    element?.kind === "text" || element?.kind === "barcode" || element?.kind === "qr"
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
              disabled={readOnly}
              onClick={() => onChange((current) => duplicateSelected(current))}
            >
              <Copy className="size-4" />
              复制所选
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
    id: string
  ) => (
    <div className="tm-inspector-inline-field">
      <Label htmlFor={id} className="tm-inspector-inline-label">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        density="compact"
        size="md"
        className="tm-inspector-input"
        disabled={readOnly}
        value={String(value)}
        onChange={(event) => onValueChange(Number(event.currentTarget.value || 0))}
      />
    </div>
  )

  const issue = getElementIssue(element)

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
              名
            </Label>
            <Input
              id="layer-name"
              density="compact"
              size="md"
              className="tm-inspector-input"
              disabled={readOnly}
              value={element.meta.name}
              onChange={(event) =>
                updateElement((item) => ({
                  ...item,
                  meta: { ...item.meta, name: event.currentTarget.value },
                }))
              }
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
                onChange={(event) =>
                  onChange((current) =>
                    applyDraftUpdate(current, (draft) =>
                      updateBoundElementValue(draft, element.id, event.currentTarget.value)
                    )
                  )
                }
              />
            </div>
          ) : null}
          {element.kind === "barcode" || element.kind === "qr" ? (
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
                onChange={(event) =>
                  onChange((current) =>
                    applyDraftUpdate(current, (draft) =>
                      updateBoundElementValue(draft, element.id, event.currentTarget.value)
                    )
                  )
                }
              />
            </div>
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
                    "width" in item
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
                    "height" in item
                      ? ({ ...item, height: Math.max(12, value) } as CanvasDraftElement)
                      : item
                  ),
                "size-height"
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
                      ? ({ ...item, fontSize: Math.max(8, value) } as CanvasDraftElement)
                      : item
                  ),
                "text-font-size"
              )
            : null}
          {element.kind !== "line" && "rotation" in element
            ? renderNumberField(
                "旋转",
                element.rotation ?? 0,
                (value) =>
                  updateElement((item) =>
                    "rotation" in item ? ({ ...item, rotation: value } as CanvasDraftElement) : item
                  ),
                "element-rotation"
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
          {issue ? (
            <Alert variant="destructive" className="col-span-full">
              <AlertCircle className="mt-0.5 size-4" />
              <AlertTitle>{issue.title}</AlertTitle>
              <AlertDescription>{issue.detail}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </CanvasSection>

      {element.kind === "barcode" || element.kind === "qr" ? (
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
                    className="tm-inspector-select"
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
                  <SelectTrigger id="qr-level" className="tm-inspector-select" disabled={readOnly}>
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
              onChange={(event) =>
                controller.setRenderOptions((current) => ({
                  ...current,
                  printWidthDots: Number(event.currentTarget.value || current.printWidthDots),
                }))
              }
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
              onChange={(event) =>
                controller.setRenderOptions((current) => ({
                  ...current,
                  threshold: Number(event.currentTarget.value || current.threshold),
                }))
              }
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
              onChange={(event) =>
                controller.setRenderOptions((current) => ({
                  ...current,
                  xOffsetDots: Number(event.currentTarget.value || current.xOffsetDots),
                }))
              }
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

function renderElementNode(element: CanvasDraftElement): React.ReactNode {
  const issue = getElementIssue(element)

  switch (element.kind) {
    case "text":
      return (
        <KonvaText
          x={0}
          y={-element.fontSize}
          width={element.width}
          text={element.value}
          fontSize={element.fontSize}
          fontStyle={element.fontWeight === "bold" ? "bold" : "normal"}
          fontFamily={CANVAS_TEXT_FONT_FAMILY}
          lineHeight={getCanvasTextLineHeight(element.fontSize)}
          align={element.align}
          fill={MONO_INK}
        />
      )
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
              x={10}
              y={14}
              width={element.width - 20}
              text="条码内容无效"
              fontSize={12}
              fontStyle="bold"
              fontFamily={CANVAS_TEXT_FONT_FAMILY}
              lineHeight={getCanvasTextLineHeight(12)}
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
              height={Math.max(element.height - (element.showValue ? 18 : 0), 12)}
              fill="#111111"
            />
          ))}
          {element.showValue ? (
            <KonvaText
              x={0}
              y={element.height - 16}
              width={element.width}
              text={element.value}
              align="center"
              fontSize={12}
              fontFamily={CANVAS_TEXT_FONT_FAMILY}
              lineHeight={getCanvasTextLineHeight(12)}
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
              x={8}
              y={16}
              width={element.size - 16}
              text="二维码\n无效"
              align="center"
              fontSize={12}
              fontStyle="bold"
              fontFamily={CANVAS_TEXT_FONT_FAMILY}
              lineHeight={getCanvasTextLineHeight(12)}
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
  }
}

function CanvasStageView({
  state,
  readOnly,
  onChange,
  onViewportSizeChange,
}: {
  state: CanvasPageState
  readOnly: boolean
  onChange: React.Dispatch<React.SetStateAction<CanvasPageState>>
  onViewportSizeChange: (size: StageViewportSize) => void
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
      width: state.draft.width,
      height: state.draft.height,
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

  React.useEffect(() => {
    onViewportSizeChange(stageViewportSize)
  }, [onViewportSizeChange, stageViewportSize])

  React.useEffect(() => {
    const transformer = transformerRef.current
    if (!transformer) {
      return
    }
    const nodes = state.selectedIds
      .map((id) => nodeRefs.current[id])
      .filter((node): node is Konva.Group => Boolean(node))
    transformer.nodes(nodes)
    transformer.shouldOverdrawWholeArea(true)
    transformer.getLayer()?.batchDraw()
  }, [state.selectedIds])

  const handleStageMouseDown = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (readOnly) {
      return
    }
    if (event.target.getParent()?.className === "Transformer") {
      return
    }
    const stage = event.target.getStage()
    if (!stage) {
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
      const point = getStagePointer(stage, state.viewport)
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

    if (!selectionActiveRef.current) {
      return
    }

    const point = getStagePointer(stage, state.viewport)
    if (!point) {
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
      const box = normalizeRect(current.selectionBox)
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
        selectionBox: { x1: 0, y1: 0, x2: 0, y2: 0, visible: false },
      }
    })
  }

  return (
    <div className="tm-stage-shell">
      <div className="tm-stage-wrap tm-stage-wrap--editor">
        <div ref={setStageHostElement} className="tm-stage-surface">
          <div className="tm-stage-paper tm-stage-paper--base" style={paperStyle} />
          {state.gridEnabled ? (
            <div
              className="tm-stage-grid"
              style={{
                left: state.viewport.x + gridBounds.startX * state.viewport.scale,
                top: state.viewport.y + gridBounds.startY * state.viewport.scale,
                width: (gridBounds.endX - gridBounds.startX) * state.viewport.scale,
                height: (gridBounds.endY - gridBounds.startY) * state.viewport.scale,
                backgroundSize: `${GRID_SIZE * state.viewport.scale}px ${GRID_SIZE * state.viewport.scale}px`,
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
              x: (pointer.x - state.viewport.x) / oldScale,
              y: (pointer.y - state.viewport.y) / oldScale,
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
                x: pointer.x - mousePointTo.x * newScale,
                y: pointer.y - mousePointTo.y * newScale,
              },
            }))
          }}
        >
          <Layer>
            <Group
              x={state.viewport.x}
              y={state.viewport.y}
              scaleX={state.viewport.scale}
              scaleY={state.viewport.scale}
            >
              {state.draft.elements.map((element) => {
                if (!element.meta.visible) {
                  return null
                }
                const geometry = getElementGeometry(element)
                const bounds = geometry.bounds
                const issue = getElementIssue(element)
                return (
                  <Group
                    key={element.id}
                    id={element.id}
                    ref={(node) => {
                      nodeRefs.current[element.id] = node
                    }}
                    x={geometry.stagePosition.x}
                    y={geometry.stagePosition.y}
                    offsetX={geometry.rotationOrigin.x}
                    offsetY={geometry.rotationOrigin.y}
                    rotation={element.kind === "line" ? 0 : (element.rotation ?? 0)}
                    draggable={!readOnly && !element.meta.locked && !state.spacePressed}
                    onClick={(event) =>
                      onChange((current) => ({
                        ...setSelection(
                          current,
                          element.id,
                          event.evt.shiftKey || event.evt.metaKey || event.evt.ctrlKey
                        ),
                        focus: "center-right",
                        activePanel: "attributes",
                      }))
                    }
                    onTap={(event) =>
                      onChange((current) => ({
                        ...setSelection(
                          current,
                          element.id,
                          event.evt.shiftKey || event.evt.metaKey || event.evt.ctrlKey
                        ),
                        focus: "center-right",
                        activePanel: "attributes",
                      }))
                    }
                    onDblClick={() =>
                      readOnly
                        ? undefined
                        : onChange((current) => ({
                            ...current,
                            editingId: element.kind === "text" ? element.id : current.editingId,
                            selectedIds: [element.id],
                          }))
                    }
                    onDragEnd={(event) => {
                      if (readOnly) {
                        return
                      }
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
                    }}
                  >
                    <KonvaRect
                      x={geometry.localBounds.x}
                      y={geometry.localBounds.y}
                      width={Math.max(bounds.width, 1)}
                      height={Math.max(bounds.height, 1)}
                      fill="rgba(255,255,255,0.001)"
                    />
                    {!issue ? renderElementNode(element) : null}
                  </Group>
                )
              })}

              {state.selectionBox.visible ? (
                <KonvaRect
                  x={normalizeRect(state.selectionBox).x}
                  y={normalizeRect(state.selectionBox).y}
                  width={normalizeRect(state.selectionBox).width}
                  height={normalizeRect(state.selectionBox).height}
                  fill="rgba(140,92,54,0.08)"
                  stroke="#8c5c36"
                  dash={[4, 4]}
                  listening={false}
                />
              ) : null}

              <Transformer
                ref={transformerRef}
                resizeEnabled={!readOnly}
                rotateEnabled
                enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]}
                flipEnabled={false}
                listening={!readOnly}
                boundBoxFunc={(oldBox, newBox) => {
                  if (Math.abs(newBox.width) < 16 || Math.abs(newBox.height) < 16) {
                    return oldBox
                  }
                  return newBox
                }}
                onTransformEnd={() => {
                  if (readOnly) {
                    return
                  }
                  const transformer = transformerRef.current
                  if (!transformer) {
                    return
                  }
                  const nodes = transformer.nodes()
                  if (nodes.length === 0) {
                    return
                  }
                  onChange((current) =>
                    applyDraftUpdate(current, (draft) => ({
                      ...draft,
                      elements: draft.elements.map((item) => {
                        const node = nodes.find(
                          (candidate): candidate is Konva.Group => candidate.id() === item.id
                        )
                        if (!node) {
                          return item
                        }
                        return applyTransformedNodeToElement(item, node)
                      }),
                    }))
                  )
                }}
              />
            </Group>
          </Layer>
        </Stage>

        {state.editingId && hasVisibleTextSelection(state)
          ? (() => {
              const element = state.draft.elements.find(
                (item): item is Extract<CanvasDraftElement, { kind: "text" }> =>
                  item.id === state.editingId && item.kind === "text"
              )
              return element ? (
                <TextInlineEditor
                  element={element}
                  viewport={state.viewport}
                  onCommit={(value) =>
                    onChange((current) => {
                      const next = applyDraftUpdate(current, (draft) =>
                        updateBoundElementValue(draft, element.id, value)
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
  const readOnly = state.readOnlyVersion !== null

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
        const fallbackDraft = createDraftFromPreset(getPresetById("shipping-wide"))
        setState(
          createCanvasStateFromDraft(fallbackDraft, {
            loading: false,
            versionsOpen: searchParams.get("panel") === "versions",
            outputStatus: cause instanceof Error ? cause.message : "加载画布失败。",
          })
        )
      }
    })()

    return () => {
      cancelled = true
    }
  }, [initialPanel, initialScenario, initialStatus, routeSource, searchParams, startupSyncPending])

  React.useEffect(() => {
    if (initialScenario || state.loading || readOnly) {
      return
    }

    void saveUserTemplateAutosave({
      templateId: state.liveDraft.templateId,
      source: state.routeSource,
      document: state.liveDraft,
      sourceVersionId: state.liveDraft.baseVersionId,
    })

    if (state.routeSource.kind === "scratch" && !startupSyncPending) {
      persistDraftDocument(state.liveDraft)
    }
  }, [
    initialScenario,
    readOnly,
    startupSyncPending,
    state.liveDraft,
    state.loading,
    state.routeSource,
  ])

  React.useEffect(() => {
    if (
      initialScenario ||
      state.loading ||
      state.routeSource.kind !== "scratch" ||
      startupSyncPending
    ) {
      return
    }
    if (state.storageMode === "reset-pending") {
      controller.deleteCanvasDraft(state.presetId)
      return
    }
    controller.recordCanvasDraft(state.presetId, state.liveDraft)
  }, [
    controller.deleteCanvasDraft,
    controller.recordCanvasDraft,
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
      if (readOnly) {
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
  }, [readOnly])

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

  const handleRestoreVersion = React.useCallback(() => {
    setState((current) => {
      if (!current.readOnlyVersion || !current.liveDraft.templateId) {
        return current
      }
      const restoredDraft = createRestoredDraftFromVersion(
        current.readOnlyVersion,
        current.liveDraft.templateId
      )
      return createCanvasStateFromDraft(restoredDraft, {
        versionHistory: current.versionHistory,
        focus: "center-right",
        versionsOpen: true,
        outputStatus: `已从 ${current.readOnlyVersion.label} 恢复到当前草稿。`,
      })
    })
  }, [])

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
      const promptLabel = mode === "save" && existingTemplateId ? suggestedName : "请输入模板名称"
      const nextName =
        mode === "save" && existingTemplateId
          ? suggestedName
          : window.prompt(promptLabel, suggestedName)?.trim()

      if (!nextName) {
        return
      }

      const documentForSave =
        mode === "save" && existingTemplateId
          ? {
              ...cloneDraft(baseDraft),
              name: nextName,
            }
          : duplicateDraftAsTemplate(baseDraft, nextName)

      const result = await saveUserTemplate({
        name: nextName,
        document: documentForSave,
        templateId: existingTemplateId,
        sourceVersionId:
          mode === "save" && !readOnly ? state.liveDraft.baseVersionId : state.readOnlyVersion?.id,
      })

      if (!existingTemplateId) {
        await clearWorkingCopy(state.routeSource)
      }
      await clearTemplateAutosaves(result.template.id)
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
      navigate,
      readOnly,
      state.liveDraft,
      state.readOnlyVersion,
      state.routeSource,
    ]
  )

  const canUndo = state.historyIndex > 0
  const canRedo = state.historyIndex < state.history.length - 1

  return (
    <section className="tm-workspace">
      <CanvasToolbar
        state={state}
        canUndo={canUndo}
        canRedo={canRedo}
        isWide={isWide}
        stageViewportSize={stageViewportSize}
        readOnly={readOnly}
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
              <p>
                {state.draft.width} × {state.draft.height} dots
              </p>
            </div>
          </div>
          <div className="tm-pane__body">
            <CanvasLayerRail state={state} readOnly={readOnly} onChange={setState} />
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
                    ? "正在同步最近草稿。"
                    : "单色编辑，所见即所得。"}
              </p>
            </div>
            <div className="tm-pane__meta">
              <Badge variant="outline" className="tm-chip">
                {state.draft.width} × {state.draft.height}
              </Badge>
              <Badge variant="outline" className="tm-chip">
                {readOnly
                  ? (state.readOnlyVersion?.label ?? "只读快照")
                  : state.selectedIds.length > 0
                    ? `已选 ${state.selectedIds.length} 项`
                    : "待选择"}
              </Badge>
            </div>
          </div>
          <div className="tm-pane__body tm-pane__body--canvas-stage">
            {state.outputStatus ? (
              <div className="tm-pane__notice">{state.outputStatus}</div>
            ) : null}
            {startupSyncPending ? (
              <div className="tm-empty-state">
                <p className="tm-empty-state__title">正在恢复同设备草稿</p>
                <p className="tm-empty-state__body">稍后会继续打开当前预设的最近草稿。</p>
              </div>
            ) : (
              <CanvasStageView
                state={state}
                readOnly={readOnly}
                onChange={setState}
                onViewportSizeChange={setStageViewportSize}
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
                <CanvasInspector state={state} readOnly={readOnly} onChange={setState} />
              ) : (
                <CanvasOutput
                  controller={controller}
                  state={state}
                  readOnly={readOnly}
                  onChange={setState}
                />
              )}
              <CanvasLayerPanel state={state} readOnly={readOnly} onChange={setState} />
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
    </section>
  )
}

export { CanvasWorkspace }
