import {
  AlertCircle,
  Archive,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  Info,
  Layers3,
  LayoutGrid,
  LayoutList,
  LayoutTemplate,
  MonitorCog,
  MoreHorizontal,
  Package2,
  PencilRuler,
  Plus,
  Printer,
  RefreshCcw,
  RotateCcw,
  Rows3,
  ScanSearch,
  Settings2,
  SquarePen,
  Trash2,
  Type,
  Undo2,
  Upload,
  Wifi,
} from "lucide-react"
import React from "react"
import { createPortal } from "react-dom"
import {
  Circle as KonvaCircle,
  Line as KonvaLine,
  Rect as KonvaRect,
  Text as KonvaText,
  Layer,
  Stage,
} from "react-konva"
import {
  BrowserRouter,
  MemoryRouter,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom"
import {
  buildSvg,
  DEFAULT_TEXT_FONT_FAMILY,
  getTemplateById,
  parseUserTemplatePackage,
  resolveTextLayout,
} from "../../../packages/core/src/web.js"

import type { ApiClient } from "./api-client.js"
import { AppLaunchSplash } from "./app-launch-splash.js"
import type { BrowserPrintSource } from "./browser-print-payload.js"
import {
  buildTemplateFieldsFromDraft,
  type CanvasStoryScenario,
  compileDraftToFilledCanvasDefinition,
  createDraftFromSystemTemplate,
  createDraftFromUserTemplatePackage,
  getElementSelectionBounds,
} from "./canvas-editor-model.js"
import { CanvasWorkspace } from "./canvas-page.js"
import { ProductMark } from "./components/product-mark.js"
import { ActionButton } from "./components/ui/action-button.js"
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js"
import { Badge } from "./components/ui/badge.js"
import { Button } from "./components/ui/button.js"
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card.js"
import { PromptDialog } from "./components/ui/dialog.js"
import { Input } from "./components/ui/input.js"
import { Label } from "./components/ui/label.js"
import { SegmentedTabs } from "./components/ui/segmented-tabs.js"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select.js"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./components/ui/sheet.js"
import { Textarea } from "./components/ui/textarea.js"
import { DataDirectoryNudgeToast } from "./data-directory-nudge-toast.js"
import { buildInputFromTemplate, defaultRenderOptions } from "./demo-data.js"
import { FooterBuildMeta } from "./footer-build-meta.js"
import { formatCanvasDimension } from "./lib/canvas-dimensions.js"
import { canvasDotsToMillimeters, canvasMillimetersToDots } from "./lib/canvas-units.js"
import { cn } from "./lib/utils.js"
import { usePwaAssetWarmup } from "./pwa-asset-warmup.js"
import type { PwaUpdateSnapshot } from "./pwa-lifecycle.js"
import { applyPwaUpdate, PwaUpdateToast, usePwaUpdate } from "./pwa-update-toast.js"
import { buildStartupSplashState, type WorkbenchHydrationState } from "./startup-contract.js"
import { SystemDataStorageCard } from "./system-data-storage-card.js"
import type {
  AppContext,
  CanvasDocumentPreset,
  CanvasDraftDocument,
  CanvasDraftElement,
  CanvasElement,
  RenderOptions,
  Template,
  TemplateField,
  UserTemplateSummary,
} from "./types.js"
import {
  loadWorkingCopy,
  readUserTemplateHistory,
  saveUserTemplate,
} from "./user-template-store.js"
import {
  createInitialTemplateRows,
  useWorkbenchController,
  type WorkbenchDeviceDrawerFeedback,
  type WorkbenchStoryStateOverrides,
} from "./workbench-controller.js"
import { preloadWorkbenchNavigationIntent, useWorkbenchNavigate } from "./workbench-navigation.js"
import {
  normalizeWorkbenchRoutePath,
  preloadDeferredWorkbenchRoutes,
  useDeferredWorkbenchRouteModule,
} from "./workbench-route-registry.js"

type AppProps = {
  client?: ApiClient
  context?: AppContext
  bootstrapState?: {
    currentRouteChunkReady?: boolean
  }
  canvasScenario?: CanvasStoryScenario
  pwaUpdateSnapshot?: PwaUpdateSnapshot
  startupShell?: "auto" | "disabled"
  theme?: "auto" | "light" | "dark"
}

function ThemeScope({
  theme = "auto",
  children,
}: {
  theme?: "auto" | "light" | "dark"
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "tm-theme-scope",
        theme === "light" && "tm-theme-scope--light",
        theme === "dark" && "tm-theme-scope--dark dark"
      )}
    >
      {children}
    </div>
  )
}

type TemplateRow = {
  id: string
  values: Record<string, string>
}

type TemplateCardEntry =
  | {
      kind: "system"
      id: string
      template: Template
    }
  | {
      kind: "user"
      id: string
      template: UserTemplateSummary
      draft: CanvasDraftDocument | null
    }

type TemplateFocus = "left-center" | "center-right"
type CanvasFocus = "left-center" | "center-right"
type TemplateListMode = "large" | "list"
type TemplateNarrowStage = "list" | "table"
type TemplateActionKind = "edit" | "rename" | "archive"

type TemplateArchiveToastState = {
  nonce: string
  templateId: string
  templateName: string
}

type TemplateActionMenuState = {
  entry: TemplateCardEntry
  x: number
  y: number
}

type CanvasDraft = {
  id: string
  name: string
  width: number
  height: number
  elements: CanvasElement[]
}

type RouteLink = {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const NAV_LINKS: RouteLink[] = [
  { to: "/", label: "主页", icon: Package2 },
  { to: "/templates", label: "模板", icon: LayoutTemplate },
  { to: "/canvas", label: "画布", icon: PencilRuler },
  { to: "/system", label: "系统", icon: MonitorCog },
]

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49v-1.73c-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.1-1.49-1.1-1.49-.9-.63.07-.62.07-.62 1 .07 1.52 1.05 1.52 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.28 9.28 0 0 1 12 6.99c.85 0 1.7.12 2.5.34 1.9-1.33 2.74-1.05 2.74-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9v2.79c0 .27.18.59.69.49A10.16 10.16 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
    </svg>
  )
}

const CANVAS_PRESETS: CanvasDocumentPreset[] = [
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

const CANVAS_TOOL_LABELS: Record<CanvasElement["kind"], string> = {
  text: "文本",
  rect: "矩形",
  circle: "圆形",
  triangle: "三角形",
  line: "线条",
  barcode: "Code128",
  qr: "QR",
  datamatrix: "数据矩阵码",
}

export const WIDE_TRIPLE_THRESHOLD = 1280
const SUPPORTED_MIN_WIDTH = 1024
export const TEMPLATE_STACKED_PREVIEW_THRESHOLD = 960
const TEMPLATE_INDEX_COLUMN_WIDTH = 44
export const TEMPLATE_PREVIEW_DEBOUNCE_MS = 320
const ARCHIVE_TOAST_DURATION_MS = 5_000
const TEMPLATE_PREVIEW_ROOT_PATTERN =
  /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="[^"]+" height="[^"]+" viewBox="[^"]+">/
const TEMPLATE_PREVIEW_OVERFLOW_PADDING_MM = 1.25
const TEMPLATE_CARD_LONG_PRESS_MS = 420
const TEMPLATE_CARD_LONG_PRESS_MOVE_TOLERANCE = 10

function buildTemplateMenuActionItems(entry: TemplateCardEntry): Array<{
  kind: TemplateActionKind
  label: string
  icon: React.ComponentType<{ className?: string }>
}> {
  if (entry.kind === "system") {
    return [{ kind: "edit", label: "编辑", icon: SquarePen }]
  }

  return [
    { kind: "edit", label: "编辑", icon: SquarePen },
    { kind: "rename", label: "重命名", icon: Type },
    { kind: "archive", label: "归档", icon: Archive },
  ]
}

type TemplatePreviewBounds = {
  left: number
  top: number
  right: number
  bottom: number
}

function toTemplatePreviewBounds(args: {
  left: number
  top: number
  width: number
  height: number
}): TemplatePreviewBounds {
  return {
    left: args.left,
    top: args.top,
    right: args.left + args.width,
    bottom: args.top + args.height,
  }
}

function unionTemplatePreviewBounds(
  current: TemplatePreviewBounds,
  next: TemplatePreviewBounds
): TemplatePreviewBounds {
  return {
    left: Math.min(current.left, next.left),
    top: Math.min(current.top, next.top),
    right: Math.max(current.right, next.right),
    bottom: Math.max(current.bottom, next.bottom),
  }
}

function rotateTemplatePreviewBounds(
  bounds: TemplatePreviewBounds,
  origin: { x: number; y: number },
  rotation = 0
): TemplatePreviewBounds {
  if (!rotation) {
    return bounds
  }

  const radians = (rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const corners = [
    { x: bounds.left, y: bounds.top },
    { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom },
    { x: bounds.left, y: bounds.bottom },
  ].map((point) => {
    const offsetX = point.x - origin.x
    const offsetY = point.y - origin.y
    return {
      x: origin.x + offsetX * cos - offsetY * sin,
      y: origin.y + offsetX * sin + offsetY * cos,
    }
  })

  return {
    left: Math.min(...corners.map((point) => point.x)),
    top: Math.min(...corners.map((point) => point.y)),
    right: Math.max(...corners.map((point) => point.x)),
    bottom: Math.max(...corners.map((point) => point.y)),
  }
}

function resolvePreviewDraftElements(
  draft: CanvasDraftDocument,
  input: Record<string, string>
): CanvasDraftElement[] {
  const fieldMap = new Map(
    draft.fields.map((field) => [field.key, input[field.key] ?? field.defaultValue ?? ""])
  )

  return draft.elements
    .filter((element) => element.meta.visible)
    .map((element) => {
      if (
        (element.kind === "text" ||
          element.kind === "barcode" ||
          element.kind === "qr" ||
          element.kind === "datamatrix") &&
        element.binding
      ) {
        return {
          ...element,
          value: fieldMap.get(element.binding.fieldKey) ?? element.value,
        }
      }

      return element
    })
}

function getTextPreviewBounds(
  element: Extract<CanvasDraftElement, { kind: "text" }>
): TemplatePreviewBounds {
  const layout = resolveTextLayout({
    text: element.value,
    fontSize: element.fontSize,
    width: element.width,
    height: element.height,
    lineHeight: element.lineHeight,
    fontFamily: element.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY,
    fontWeight: element.fontWeight,
    align: element.align,
    maxLines: element.maxLines,
    verticalAlign: element.verticalAlign,
    stretchXGrow: element.stretchXGrow,
    stretchXShrink: element.stretchXShrink,
    stretchYGrow: element.stretchYGrow,
    stretchYShrink: element.stretchYShrink,
    stretchX: element.stretchX ?? false,
    stretchY: element.stretchY ?? false,
    autoWrap: element.autoWrap ?? true,
    adaptiveFontSize: element.adaptiveFontSize ?? false,
    verticalText: element.verticalText ?? false,
  })

  const contentBounds = toTemplatePreviewBounds({
    left: element.x + layout.contentX + layout.textOffsetX * layout.scaleX,
    top: element.y + layout.contentY + layout.textOffsetY * layout.scaleY,
    width: Math.max(layout.contentWidth * layout.scaleX, 0.0001),
    height: Math.max(layout.contentHeight * layout.scaleY, 0.0001),
  })

  return rotateTemplatePreviewBounds(
    contentBounds,
    {
      x: element.x + element.width / 2,
      y: element.y + element.height / 2,
    },
    element.rotation
  )
}

function getDraftElementPreviewBounds(element: CanvasDraftElement): TemplatePreviewBounds {
  if (element.kind === "text") {
    return getTextPreviewBounds(element)
  }

  const bounds = getElementSelectionBounds(element)
  return toTemplatePreviewBounds({
    left: bounds.x,
    top: bounds.y,
    width: bounds.width,
    height: bounds.height,
  })
}

function applyTemplatePreviewViewport(
  svg: string,
  viewBox: { left: number; top: number; width: number; height: number }
): string {
  const root = `<svg xmlns="http://www.w3.org/2000/svg" width="${viewBox.width}" height="${viewBox.height}" viewBox="${viewBox.left} ${viewBox.top} ${viewBox.width} ${viewBox.height}">`
  return svg
    .replace(TEMPLATE_PREVIEW_ROOT_PATTERN, root)
    .replaceAll(' overflow="hidden"', ' overflow="visible"')
}

function buildDraftPreviewSvg(
  draft: CanvasDraftDocument,
  input: Record<string, string>
): string | null {
  try {
    const previewElements = resolvePreviewDraftElements(draft, input)
    const compiled = compileDraftToFilledCanvasDefinition(draft, input)
    const canvasBounds = toTemplatePreviewBounds({
      left: 0,
      top: 0,
      width: draft.width,
      height: draft.height,
    })
    const combinedBounds = previewElements.reduce(
      (bounds, element) =>
        unionTemplatePreviewBounds(bounds, getDraftElementPreviewBounds(element)),
      canvasBounds
    )
    const leftPadding = combinedBounds.left < 0 ? TEMPLATE_PREVIEW_OVERFLOW_PADDING_MM : 0
    const topPadding = combinedBounds.top < 0 ? TEMPLATE_PREVIEW_OVERFLOW_PADDING_MM : 0
    const rightPadding =
      combinedBounds.right > draft.width ? TEMPLATE_PREVIEW_OVERFLOW_PADDING_MM : 0
    const bottomPadding =
      combinedBounds.bottom > draft.height ? TEMPLATE_PREVIEW_OVERFLOW_PADDING_MM : 0
    const left = canvasMillimetersToDots(combinedBounds.left - leftPadding)
    const top = canvasMillimetersToDots(combinedBounds.top - topPadding)
    const right = canvasMillimetersToDots(combinedBounds.right + rightPadding)
    const bottom = canvasMillimetersToDots(combinedBounds.bottom + bottomPadding)

    return applyTemplatePreviewViewport(
      buildSvg(compiled.width, compiled.height, compiled.elements, {}),
      {
        left,
        top,
        width: Math.max(right - left, 1),
        height: Math.max(bottom - top, 1),
      }
    )
  } catch {
    return null
  }
}

export function useMediaQuery(query: string): boolean {
  const getValue = React.useCallback(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false
    }
    return window.matchMedia(query).matches
  }, [query])

  const [matches, setMatches] = React.useState(getValue)

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

export function useElementClientWidth<T extends HTMLElement>(element: T | null) {
  const [width, setWidth] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (!element) {
      return
    }

    const update = () => setWidth(Math.round(element.clientWidth))
    update()

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update)
      return () => window.removeEventListener("resize", update)
    }

    const observer = new ResizeObserver(() => update())
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return width
}

function formatRelativeTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  const deltaMinutes = Math.round((Date.now() - date.getTime()) / 60_000)
  if (deltaMinutes < 1) {
    return "刚刚"
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes} 分钟前`
  }
  const deltaHours = Math.round(deltaMinutes / 60)
  if (deltaHours < 24) {
    return `${deltaHours} 小时前`
  }
  const deltaDays = Math.round(deltaHours / 24)
  return `${deltaDays} 天前`
}

function _formatTemplateSize(template: Template): string {
  if (template.width && template.height) {
    return formatCanvasDimension({
      width: canvasDotsToMillimeters(template.width),
      height: canvasDotsToMillimeters(template.height),
    })
  }
  return "尺寸待定"
}

function formatTemplateCardSize(entry: TemplateCardEntry): string {
  if (!entry.template.width || !entry.template.height) {
    return "尺寸待定"
  }
  if (entry.kind === "user") {
    return formatCanvasDimension({
      width: entry.template.width,
      height: entry.template.height,
    })
  }
  return formatCanvasDimension({
    width: canvasDotsToMillimeters(entry.template.width),
    height: canvasDotsToMillimeters(entry.template.height),
  })
}

function buildTemplatePreviewSvg(template: Template): string | null {
  try {
    const preset = getTemplateById(template.id)
    const input = Object.fromEntries(
      preset.fields.map((field) => [field.key, field.defaultValue ?? field.label])
    )
    return buildDraftPreviewSvg(createDraftFromSystemTemplate(preset), input)
  } catch {
    return null
  }
}

function buildUserTemplatePreviewSvg(draft: CanvasDraftDocument | null): string | null {
  if (!draft) {
    return null
  }

  try {
    const input = buildInputFromTemplate({
      id: draft.id,
      name: draft.name,
      description: "",
      width: draft.width,
      height: draft.height,
      fields: buildTemplateFieldsFromDraft(draft),
    })
    return buildDraftPreviewSvg(draft, input)
  } catch {
    return null
  }
}

export function toTemplateFieldList(template: Template | UserTemplateSummary): TemplateField[] {
  if ("required" in (template.fields[0] ?? {})) {
    return template.fields as TemplateField[]
  }
  return template.fields.map((field) => ({
    key: field.key,
    label: field.label,
    required: false,
    multiline: field.multiline,
    defaultValue: field.defaultValue,
    sampleValue: field.sampleValue,
  }))
}

export function toDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function createPreviewRenderOptions(renderOptions: RenderOptions) {
  return {
    ...renderOptions,
    previewScale: 4,
  }
}

export function createTemplatePrintSource(
  template: Template,
  row: TemplateRow,
  renderOptions: RenderOptions
): BrowserPrintSource {
  return {
    kind: "template",
    templateId: template.id,
    rowId: row.id,
    input: row.values,
    renderOptions: createPreviewRenderOptions(renderOptions),
  }
}

export function createUserTemplatePrintSource(
  template: UserTemplateSummary,
  draft: CanvasDraftDocument,
  row: TemplateRow,
  renderOptions: RenderOptions
): BrowserPrintSource {
  return {
    kind: "canvas",
    canvas: compileDraftToFilledCanvasDefinition(draft, row.values),
    renderOptions: createPreviewRenderOptions(renderOptions),
    templateUsage: {
      id: template.id,
      name: template.name,
      description: template.description,
    },
  }
}

function createCanvasElement(kind: CanvasElement["kind"], index: number): CanvasElement {
  const seedX = 28 + (index % 3) * 18
  const seedY = 24 + (index % 4) * 16

  switch (kind) {
    case "text":
      return {
        id: `text-${crypto.randomUUID()}`,
        kind,
        x: seedX,
        y: seedY,
        width: 180,
        height: 22,
        fontSize: 22,
        fontFamily: DEFAULT_TEXT_FONT_FAMILY,
        lineHeight: 1.2,
        fontWeight: "bold",
        align: "left",
        verticalAlign: "top",
        stretchXGrow: false,
        stretchXShrink: true,
        stretchYGrow: false,
        stretchYShrink: false,
        autoWrap: false,
        adaptiveFontSize: true,
        verticalText: false,
        value: "Editable text",
        maxLines: 2,
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
        fill: "#ffffff",
        stroke: "#111111",
        radius: 14,
      }
    case "circle":
      return {
        id: `circle-${crypto.randomUUID()}`,
        kind,
        x: seedX,
        y: seedY,
        size: 72,
        strokeWidth: 2,
        fill: "none",
        stroke: "#111111",
      }
    case "triangle":
      return {
        id: `triangle-${crypto.randomUUID()}`,
        kind,
        x: seedX,
        y: seedY,
        width: 120,
        height: 86,
        strokeWidth: 2,
        fill: "none",
        stroke: "#111111",
        rotation: 0,
      }
    case "line":
      return {
        id: `line-${crypto.randomUUID()}`,
        kind,
        x: seedX,
        y: seedY + 10,
        x2: seedX + 160,
        y2: seedY + 10,
        strokeWidth: 3,
        stroke: "#111111",
      }
    case "barcode":
      return {
        id: `barcode-${crypto.randomUUID()}`,
        kind,
        x: seedX,
        y: seedY,
        width: 144,
        height: 48,
        value: "TM-0001",
        format: "CODE128",
        showValue: false,
      }
    case "qr":
      return {
        id: `qr-${crypto.randomUUID()}`,
        kind,
        x: seedX,
        y: seedY,
        size: 72,
        value: "https://tuckmark.local/item/TM-0001",
        errorCorrectionLevel: "M",
      }
    case "datamatrix":
      return {
        id: `datamatrix-${crypto.randomUUID()}`,
        kind,
        x: seedX,
        y: seedY,
        size: 72,
        value: "TM-0001",
        rotation: 0,
      }
  }
}

function createDraftFromPreset(preset: CanvasDocumentPreset): CanvasDraft {
  return {
    id: preset.id,
    name: preset.name,
    width: preset.width,
    height: preset.height,
    elements: [
      createCanvasElement("rect", 0),
      createCanvasElement("text", 1),
      createCanvasElement("line", 2),
      createCanvasElement("barcode", 3),
      createCanvasElement("qr", 4),
    ],
  }
}

function toSingleLineFieldValue(value: string) {
  return value
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
}

let templateColumnMeasureContext: CanvasRenderingContext2D | null | undefined

function canMeasureTemplateColumnsWithCanvas() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false
  }
  return !/jsdom/i.test(navigator.userAgent)
}

export function getTemplateColumnWidthRange(field: Template["fields"][number]) {
  return {
    minWidth: 44,
    maxWidth: field.multiline ? 240 : 180,
  }
}

function measureTemplateColumnTextWidth(value: string) {
  const text = value || "—"
  if (typeof document === "undefined" || !canMeasureTemplateColumnsWithCanvas()) {
    return Math.max(Array.from(text).length, 1) * 7.25
  }

  templateColumnMeasureContext ??= document.createElement("canvas").getContext("2d")
  if (!templateColumnMeasureContext) {
    return Math.max(Array.from(text).length, 1) * 7.25
  }

  templateColumnMeasureContext.font =
    '500 12px "DM Sans", "Noto Sans SC", "PingFang SC", sans-serif'
  return templateColumnMeasureContext.measureText(text).width
}

function getTemplateColumnWidth(field: Template["fields"][number], rows: TemplateRow[]) {
  const { minWidth, maxWidth } = getTemplateColumnWidthRange(field)
  const contentWidth = Math.max(
    measureTemplateColumnTextWidth(field.label),
    ...rows.map((row) =>
      measureTemplateColumnTextWidth(toSingleLineFieldValue(row.values[field.key] ?? ""))
    )
  )

  return Math.min(Math.max(Math.ceil(contentWidth), minWidth), maxWidth)
}

export function resolveTemplateColumnLayout(
  fields: Template["fields"],
  rows: TemplateRow[],
  availableTableWidth: number | null
) {
  const baseWidths = fields.map((field) => getTemplateColumnWidth(field, rows))
  const ranges = fields.map((field) => getTemplateColumnWidthRange(field))
  const maxWidths = ranges.map((range) => range.maxWidth)
  const resolvedWidths = [...baseWidths]

  if (availableTableWidth !== null) {
    const targetContentWidth = Math.max(availableTableWidth - TEMPLATE_INDEX_COLUMN_WIDTH, 0)
    let remainingWidth = targetContentWidth - resolvedWidths.reduce((sum, width) => sum + width, 0)
    let expandable = resolvedWidths
      .map((width, index) => ({
        width,
        index,
        capacity: (maxWidths[index] ?? width) - width,
      }))
      .filter((item) => item.capacity > 0.5)

    while (remainingWidth > 0.5 && expandable.length > 0) {
      const share = remainingWidth / expandable.length
      let consumed = 0

      for (const item of expandable) {
        const currentWidth = resolvedWidths[item.index] ?? item.width
        const maxWidth = maxWidths[item.index] ?? currentWidth
        const nextWidth = Math.min(currentWidth + share, maxWidth)
        const delta = nextWidth - currentWidth
        if (delta <= 0) {
          continue
        }
        resolvedWidths[item.index] = nextWidth
        consumed += delta
      }

      if (consumed <= 0.5) {
        break
      }

      remainingWidth -= consumed
      expandable = resolvedWidths
        .map((width, index) => ({
          width,
          index,
          capacity: (maxWidths[index] ?? width) - width,
        }))
        .filter((item) => item.capacity > 0.5)
    }
  }

  const roundedWidths = resolvedWidths.map((width) => Math.round(width))
  const contentWidth = roundedWidths.reduce((sum, width) => sum + width, 0)
  const tableWidth = Math.max(availableTableWidth ?? 0, TEMPLATE_INDEX_COLUMN_WIDTH + contentWidth)

  return {
    columnWidths: Object.fromEntries(
      fields.map((field, index) => [field.key, roundedWidths[index] ?? 0])
    ),
    tableWidth,
  }
}

function toCanvasPrintSource(
  canvas: CanvasDraft,
  renderOptions: RenderOptions
): BrowserPrintSource {
  return {
    kind: "canvas",
    canvas: {
      id: canvas.id,
      name: canvas.name,
      width: canvas.width,
      height: canvas.height,
      elements: canvas.elements.map((element) => {
        switch (element.kind) {
          case "text":
            return {
              kind: "text" as const,
              key: element.id,
              x: element.x,
              y: element.y,
              width: element.width,
              height: element.height,
              fontSize: element.fontSize,
              fontFamily: element.fontFamily,
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
              value: element.value,
              maxLines: element.maxLines,
              rotation: element.rotation ?? 0,
            }
          case "rect":
            return {
              kind: "rect" as const,
              x: element.x,
              y: element.y,
              width: element.width,
              height: element.height,
              strokeWidth: element.strokeWidth,
              fill: element.fill,
              stroke: element.stroke,
              radius: element.radius,
              rotation: element.rotation ?? 0,
            }
          case "circle":
            return {
              kind: "circle" as const,
              x: element.x,
              y: element.y,
              size: element.size,
              strokeWidth: element.strokeWidth,
              fill: element.fill,
              stroke: element.stroke,
            }
          case "triangle":
            return {
              kind: "triangle" as const,
              x: element.x,
              y: element.y,
              width: element.width,
              height: element.height,
              strokeWidth: element.strokeWidth,
              fill: element.fill,
              stroke: element.stroke,
              rotation: element.rotation ?? 0,
            }
          case "line":
            return {
              kind: "line" as const,
              x1: element.x,
              y1: element.y,
              x2: element.x2,
              y2: element.y2,
              strokeWidth: element.strokeWidth,
              stroke: element.stroke,
            }
          case "barcode":
            return {
              kind: "barcode" as const,
              key: element.id,
              x: element.x,
              y: element.y,
              width: element.width,
              height: element.height,
              value: element.value,
              format: element.format,
              showValue: element.showValue,
              rotation: element.rotation ?? 0,
            }
          case "qr":
            return {
              kind: "qr" as const,
              key: element.id,
              x: element.x,
              y: element.y,
              size: element.size,
              value: element.value,
              errorCorrectionLevel: element.errorCorrectionLevel,
              rotation: element.rotation ?? 0,
            }
          case "datamatrix":
            return {
              kind: "datamatrix" as const,
              key: element.id,
              x: element.x,
              y: element.y,
              size: element.size,
              value: element.value,
              rotation: element.rotation ?? 0,
            }
          default:
            return element satisfies never
        }
      }),
    },
    renderOptions: createPreviewRenderOptions(renderOptions),
  }
}

function useWorkbenchPages(controller: ReturnType<typeof useWorkbenchController>) {
  const [userTemplatePreviewDrafts, setUserTemplatePreviewDrafts] = React.useState<
    Record<string, CanvasDraftDocument | null>
  >({})
  const templateEntries = React.useMemo<TemplateCardEntry[]>(
    () => [
      ...controller.templates.map((template) => ({
        kind: "system" as const,
        id: `system:${template.id}`,
        template,
      })),
      ...controller.userTemplates.map((template) => ({
        kind: "user" as const,
        id: `user:${template.id}`,
        template,
        draft: userTemplatePreviewDrafts[template.id] ?? template.document ?? null,
      })),
    ],
    [controller.templates, controller.userTemplates, userTemplatePreviewDrafts]
  )
  const [templateEntryId, setTemplateEntryId] = React.useState(() => templateEntries[0]?.id ?? "")
  const activeTemplateEntry = React.useMemo(
    () => templateEntries.find((entry) => entry.id === templateEntryId) ?? null,
    [templateEntries, templateEntryId]
  )
  const activeTemplate = activeTemplateEntry?.template ?? null

  const [templateRows, setTemplateRows] = React.useState<TemplateRow[]>(() =>
    createInitialTemplateRows(controller.templates[0], 3)
  )
  const [activeUserTemplateDraft, setActiveUserTemplateDraft] =
    React.useState<CanvasDraftDocument | null>(null)
  const [activeUserTemplateDraftLoading, setActiveUserTemplateDraftLoading] = React.useState(false)
  const [selectedRowId, setSelectedRowId] = React.useState<string>("")
  const [editingTemplateCell, setEditingTemplateCell] = React.useState<{
    rowId: string
    fieldKey: string
  } | null>(null)
  const [templateFocus, setTemplateFocus] = React.useState<TemplateFocus>("left-center")
  const [templateNarrowStage, setTemplateNarrowStage] = React.useState<TemplateNarrowStage>("list")
  const syncRenderOptionsFromDraft = React.useCallback(
    (draft: CanvasDraftDocument | null) => {
      const nextOptions = {
        ...defaultRenderOptions,
        ...draft?.renderOptions,
      }
      if (
        controller.renderOptions.printWidthDots === nextOptions.printWidthDots &&
        controller.renderOptions.paperType === nextOptions.paperType &&
        controller.renderOptions.threshold === nextOptions.threshold &&
        controller.renderOptions.xOffsetDots === nextOptions.xOffsetDots
      ) {
        return
      }
      controller.setRenderOptions(nextOptions)
    },
    [controller.renderOptions, controller.setRenderOptions]
  )

  React.useEffect(() => {
    if (!activeTemplateEntry || !activeTemplate) {
      setTemplateRows([])
      setSelectedRowId("")
      return
    }

    const templateFields = toTemplateFieldList(activeTemplate)
    setTemplateRows((currentRows) => {
      if (currentRows.length > 0 && currentRows[0]?.id.startsWith(activeTemplate.id)) {
        const schemaMatchesCurrentRows =
          Object.keys(currentRows[0]?.values ?? {}).join("|") ===
          templateFields.map((field) => field.key).join("|")
        if (schemaMatchesCurrentRows) {
          return currentRows
        }
      }
      return createInitialTemplateRows(
        {
          id: activeTemplate.id,
          name: activeTemplate.name,
          description: activeTemplate.description,
          width: activeTemplate.width,
          height: activeTemplate.height,
          fields: templateFields,
        },
        3
      )
    })
  }, [activeTemplate, activeTemplateEntry])

  React.useEffect(() => {
    if (controller.userTemplates.length === 0) {
      setUserTemplatePreviewDrafts({})
      return
    }

    let cancelled = false
    void (async () => {
      const previews = await Promise.all(
        controller.userTemplates.map(async (template) => {
          const workingCopy = await loadWorkingCopy({
            kind: "user-template",
            templateId: template.id,
          })
          if (workingCopy?.draft) {
            return [template.id, workingCopy.draft] as const
          }
          const history = await readUserTemplateHistory(template.id)
          const version =
            history?.saved.find((item) => item.id === history.template.currentVersionId) ??
            history?.saved[0] ??
            null
          return [template.id, version?.document ?? null] as const
        })
      )

      if (!cancelled) {
        setUserTemplatePreviewDrafts(Object.fromEntries(previews))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [controller.userTemplates])

  React.useEffect(() => {
    if (activeTemplateEntry?.kind !== "user") {
      setActiveUserTemplateDraft(null)
      setActiveUserTemplateDraftLoading(false)
      syncRenderOptionsFromDraft(null)
      return
    }

    let cancelled = false
    const templateId = activeTemplateEntry.template.id
    const cachedDraft = activeTemplateEntry.draft ?? activeTemplateEntry.template.document ?? null
    setActiveUserTemplateDraft(cachedDraft)
    if (cachedDraft) {
      syncRenderOptionsFromDraft(cachedDraft)
      setActiveUserTemplateDraftLoading(false)
      return () => {
        cancelled = true
      }
    }

    setActiveUserTemplateDraftLoading(true)
    void (async () => {
      try {
        const workingCopy = await loadWorkingCopy({
          kind: "user-template",
          templateId,
        })
        const version = workingCopy?.draft ?? null
        if (!cancelled) {
          if (version) {
            setActiveUserTemplateDraft(version)
            syncRenderOptionsFromDraft(version)
            return
          }
          const history = await readUserTemplateHistory(templateId)
          const savedVersion =
            history?.saved.find((item) => item.id === history.template.currentVersionId) ??
            history?.saved[0] ??
            null
          if (!cancelled) {
            const draft = savedVersion?.document ?? null
            setActiveUserTemplateDraft(draft)
            syncRenderOptionsFromDraft(draft)
          }
        }
      } finally {
        if (!cancelled) {
          setActiveUserTemplateDraftLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeTemplateEntry, syncRenderOptionsFromDraft])

  React.useEffect(() => {
    if (!templateRows.some((row) => row.id === selectedRowId)) {
      setSelectedRowId(templateRows[0]?.id ?? "")
    }
  }, [selectedRowId, templateRows])

  React.useEffect(() => {
    if (!editingTemplateCell) {
      return
    }
    const row = templateRows.find((item) => item.id === editingTemplateCell.rowId)
    const hasField =
      (activeTemplateEntry?.kind === "user"
        ? activeTemplateEntry.template.fields
        : activeTemplate?.fields
      )?.some((field) => field.key === editingTemplateCell.fieldKey) ?? false
    if (!row || !hasField) {
      setEditingTemplateCell(null)
    }
  }, [activeTemplate, activeTemplateEntry, editingTemplateCell, templateRows])

  const selectedTemplateRow = React.useMemo(
    () => templateRows.find((row) => row.id === selectedRowId) ?? templateRows[0] ?? null,
    [selectedRowId, templateRows]
  )
  const resolvedActiveUserTemplateDraft = React.useMemo(
    () =>
      activeTemplateEntry?.kind === "user"
        ? (activeUserTemplateDraft ??
          activeTemplateEntry.draft ??
          activeTemplateEntry.template.document)
        : null,
    [activeTemplateEntry, activeUserTemplateDraft]
  )
  const lastAutoPreviewKeyRef = React.useRef<string | null>(null)
  const autoPreviewInFlightKeyRef = React.useRef<string | null>(null)
  const templateAutoPreviewTimerRef = React.useRef<number | null>(null)

  const clearTemplateAutoPreviewTimer = React.useCallback(() => {
    if (templateAutoPreviewTimerRef.current === null) {
      return
    }
    window.clearTimeout(templateAutoPreviewTimerRef.current)
    templateAutoPreviewTimerRef.current = null
  }, [])

  React.useEffect(() => {
    lastAutoPreviewKeyRef.current = null
    autoPreviewInFlightKeyRef.current = null
    clearTemplateAutoPreviewTimer()
  }, [clearTemplateAutoPreviewTimer])

  React.useEffect(() => clearTemplateAutoPreviewTimer, [clearTemplateAutoPreviewTimer])

  const [canvasPresetId, setCanvasPresetId] = React.useState(CANVAS_PRESETS[0]?.id ?? "")
  const [canvasDraft, setCanvasDraft] = React.useState<CanvasDraft>(() =>
    createDraftFromPreset(
      CANVAS_PRESETS[0] ??
        CANVAS_PRESETS[0] ?? {
          id: "fallback",
          name: "Fallback",
          width: 384,
          height: 224,
          description: "",
        }
    )
  )
  const [selectedCanvasElementId, setSelectedCanvasElementId] = React.useState<string>(
    () => canvasDraft.elements[0]?.id ?? ""
  )
  const [canvasFocus, setCanvasFocus] = React.useState<CanvasFocus>("left-center")

  const canvasPreset = React.useMemo(
    () => CANVAS_PRESETS.find((item) => item.id === canvasPresetId) ?? CANVAS_PRESETS[0],
    [canvasPresetId]
  )

  React.useEffect(() => {
    if (!canvasPreset) {
      return
    }
    setCanvasDraft((currentDraft) => {
      if (currentDraft.id === canvasPreset.id) {
        return currentDraft
      }
      return createDraftFromPreset(canvasPreset)
    })
  }, [canvasPreset])

  React.useEffect(() => {
    if (!canvasDraft.elements.some((element) => element.id === selectedCanvasElementId)) {
      setSelectedCanvasElementId(canvasDraft.elements[0]?.id ?? "")
    }
  }, [canvasDraft.elements, selectedCanvasElementId])

  const selectedCanvasElement = React.useMemo(
    () =>
      canvasDraft.elements.find((element) => element.id === selectedCanvasElementId) ??
      canvasDraft.elements[0] ??
      null,
    [canvasDraft.elements, selectedCanvasElementId]
  )

  const addTemplateRow = React.useCallback(() => {
    if (!activeTemplate) {
      return
    }
    const fields = toTemplateFieldList(activeTemplate)
    const row: TemplateRow = {
      id: `${activeTemplate.id}-${crypto.randomUUID()}`,
      values: buildInputFromTemplate({
        id: activeTemplate.id,
        name: activeTemplate.name,
        description: activeTemplate.description,
        width: activeTemplate.width,
        height: activeTemplate.height,
        fields,
      }),
    }
    setTemplateRows((currentRows) => [...currentRows, row])
    setSelectedRowId(row.id)
    setEditingTemplateCell(fields[0] ? { rowId: row.id, fieldKey: fields[0].key } : null)
    setTemplateFocus("left-center")
    setTemplateNarrowStage("table")
  }, [activeTemplate])

  const duplicateTemplateRow = React.useCallback(() => {
    if (!selectedTemplateRow) {
      return
    }
    const row: TemplateRow = {
      id: `${selectedTemplateRow.id}-copy-${crypto.randomUUID()}`,
      values: { ...selectedTemplateRow.values },
    }
    setTemplateRows((currentRows) => {
      const index = currentRows.findIndex((item) => item.id === selectedTemplateRow.id)
      if (index < 0) {
        return [...currentRows, row]
      }
      const next = [...currentRows]
      next.splice(index + 1, 0, row)
      return next
    })
    setSelectedRowId(row.id)
    const fields =
      activeTemplateEntry?.kind === "user"
        ? activeTemplateEntry.template.fields
        : activeTemplate?.fields
    setEditingTemplateCell(fields?.[0] ? { rowId: row.id, fieldKey: fields[0].key } : null)
    setTemplateFocus("left-center")
    setTemplateNarrowStage("table")
  }, [activeTemplate, activeTemplateEntry, selectedTemplateRow])

  const deleteTemplateRow = React.useCallback(() => {
    if (!selectedTemplateRow) {
      return
    }
    setTemplateRows((currentRows) => currentRows.filter((row) => row.id !== selectedTemplateRow.id))
    setEditingTemplateCell(null)
    setTemplateFocus("left-center")
    setTemplateNarrowStage("table")
  }, [selectedTemplateRow])

  const previewTemplateRow = React.useCallback(
    async (row: TemplateRow, focusTarget: "preserve" | "right") => {
      if (!activeTemplate) {
        controller.setError("先选择模板与一行数据。")
        return
      }
      const userTemplateDraftReady =
        activeTemplateEntry?.kind !== "user" ||
        (!!resolvedActiveUserTemplateDraft && !activeUserTemplateDraftLoading)
      if (!userTemplateDraftReady) {
        controller.setError("正在读取本地模板草稿，请稍后再预览。")
        return
      }

      const source =
        activeTemplateEntry?.kind === "user" && resolvedActiveUserTemplateDraft
          ? createUserTemplatePrintSource(
              activeTemplateEntry.template,
              resolvedActiveUserTemplateDraft,
              row,
              controller.renderOptions
            )
          : createTemplatePrintSource(activeTemplate as Template, row, controller.renderOptions)
      const previewKey = JSON.stringify(source)
      const result = await controller.previewSource(source)

      if (result !== undefined) {
        lastAutoPreviewKeyRef.current = previewKey
        if (focusTarget === "right") {
          setTemplateFocus("center-right")
        }
      }
    },
    [
      activeTemplate,
      activeTemplateEntry,
      resolvedActiveUserTemplateDraft,
      activeUserTemplateDraftLoading,
      controller,
    ]
  )

  const autoPreviewTemplateRow = React.useCallback(
    async (row: TemplateRow) => {
      if (!activeTemplate) {
        return
      }
      const userTemplateDraftReady =
        activeTemplateEntry?.kind !== "user" ||
        (!!resolvedActiveUserTemplateDraft && !activeUserTemplateDraftLoading)
      if (!userTemplateDraftReady) {
        return
      }
      clearTemplateAutoPreviewTimer()

      const source =
        activeTemplateEntry?.kind === "user" && resolvedActiveUserTemplateDraft
          ? createUserTemplatePrintSource(
              activeTemplateEntry.template,
              resolvedActiveUserTemplateDraft,
              row,
              controller.renderOptions
            )
          : createTemplatePrintSource(activeTemplate as Template, row, controller.renderOptions)
      const previewKey = JSON.stringify(source)
      if (
        lastAutoPreviewKeyRef.current === previewKey ||
        autoPreviewInFlightKeyRef.current === previewKey
      ) {
        return
      }

      autoPreviewInFlightKeyRef.current = previewKey
      try {
        await previewTemplateRow(row, "preserve")
      } finally {
        if (autoPreviewInFlightKeyRef.current === previewKey) {
          autoPreviewInFlightKeyRef.current = null
        }
      }
    },
    [
      activeTemplate,
      activeTemplateEntry,
      resolvedActiveUserTemplateDraft,
      clearTemplateAutoPreviewTimer,
      controller.renderOptions,
      previewTemplateRow,
      activeUserTemplateDraftLoading,
    ]
  )

  const updateTemplateField = React.useCallback(
    (rowId: string, fieldKey: string, value: string) => {
      const nextValue = toSingleLineFieldValue(value)
      const nextSelectedRow =
        selectedTemplateRow?.id === rowId
          ? {
              ...selectedTemplateRow,
              values: {
                ...selectedTemplateRow.values,
                [fieldKey]: nextValue,
              },
            }
          : null

      setTemplateRows((currentRows) =>
        currentRows.map((row) =>
          row.id === rowId
            ? {
                ...row,
                values: {
                  ...row.values,
                  [fieldKey]: nextValue,
                },
              }
            : row
        )
      )
      if (nextSelectedRow) {
        clearTemplateAutoPreviewTimer()
        templateAutoPreviewTimerRef.current = window.setTimeout(() => {
          templateAutoPreviewTimerRef.current = null
          void autoPreviewTemplateRow(nextSelectedRow)
        }, TEMPLATE_PREVIEW_DEBOUNCE_MS)
      }
      setTemplateFocus("left-center")
      setTemplateNarrowStage("table")
    },
    [autoPreviewTemplateRow, clearTemplateAutoPreviewTimer, selectedTemplateRow]
  )

  const previewSelectedTemplateRow = React.useCallback(async () => {
    if (!selectedTemplateRow) {
      controller.setError("先选择模板与一行数据。")
      return
    }
    clearTemplateAutoPreviewTimer()
    await previewTemplateRow(selectedTemplateRow, "right")
  }, [clearTemplateAutoPreviewTimer, controller, previewTemplateRow, selectedTemplateRow])

  const printSelectedTemplateRow = React.useCallback(async () => {
    if (!activeTemplate || !selectedTemplateRow) {
      controller.setError("先选择模板与一行数据。")
      return
    }
    const userTemplateDraftReady =
      activeTemplateEntry?.kind !== "user" ||
      (!!resolvedActiveUserTemplateDraft && !activeUserTemplateDraftLoading)
    if (!userTemplateDraftReady) {
      controller.setError("正在读取本地模板草稿，请稍后再打印。")
      return
    }
    await controller.printSourceDirect(
      activeTemplateEntry?.kind === "user" && resolvedActiveUserTemplateDraft
        ? createUserTemplatePrintSource(
            activeTemplateEntry.template,
            resolvedActiveUserTemplateDraft,
            selectedTemplateRow,
            controller.renderOptions
          )
        : {
            kind: "template",
            templateId: activeTemplate.id,
            rowId: selectedTemplateRow.id,
            input: selectedTemplateRow.values,
            renderOptions: createPreviewRenderOptions(controller.renderOptions),
          }
    )
    setTemplateFocus("center-right")
  }, [
    activeTemplate,
    activeTemplateEntry,
    resolvedActiveUserTemplateDraft,
    activeUserTemplateDraftLoading,
    controller,
    selectedTemplateRow,
  ])

  const archiveTemplateEntry = React.useCallback(
    async (entryId: string) => {
      const entry = templateEntries.find((item) => item.id === entryId)
      if (entry?.kind !== "user") {
        return null
      }

      if (templateEntryId === entryId) {
        const visibleUserEntries = templateEntries.filter((item) => item.kind === "user")
        const currentIndex = visibleUserEntries.findIndex((item) => item.id === entryId)
        const fallbackEntry =
          visibleUserEntries[currentIndex + 1] ?? visibleUserEntries[currentIndex - 1] ?? null
        setTemplateEntryId(fallbackEntry?.id ?? "")
      }

      setTemplateFocus("left-center")
      setTemplateNarrowStage("list")
      setEditingTemplateCell(null)
      return controller.archiveTemplate(entry.template.id)
    },
    [controller, templateEntries, templateEntryId]
  )

  const addCanvasElement = React.useCallback((kind: CanvasElement["kind"]) => {
    setCanvasDraft((currentDraft) => {
      const nextElement = createCanvasElement(kind, currentDraft.elements.length)
      setSelectedCanvasElementId(nextElement.id)
      return {
        ...currentDraft,
        elements: [...currentDraft.elements, nextElement],
      }
    })
    setCanvasFocus("left-center")
  }, [])

  const updateCanvasElement = React.useCallback(
    (elementId: string, updater: (element: CanvasElement) => CanvasElement) => {
      setCanvasDraft((currentDraft) => ({
        ...currentDraft,
        elements: currentDraft.elements.map((element) =>
          element.id === elementId ? updater(element) : element
        ),
      }))
    },
    []
  )

  const removeCanvasElement = React.useCallback(() => {
    if (!selectedCanvasElementId) {
      return
    }
    setCanvasDraft((currentDraft) => ({
      ...currentDraft,
      elements: currentDraft.elements.filter((element) => element.id !== selectedCanvasElementId),
    }))
    setCanvasFocus("left-center")
  }, [selectedCanvasElementId])

  const previewCanvas = React.useCallback(async () => {
    await controller.previewSource(toCanvasPrintSource(canvasDraft, controller.renderOptions))
    setCanvasFocus("center-right")
  }, [canvasDraft, controller])

  const printCanvas = React.useCallback(async () => {
    await controller.printSourceDirect(toCanvasPrintSource(canvasDraft, controller.renderOptions))
    setCanvasFocus("center-right")
  }, [canvasDraft, controller])

  return {
    activeTemplateEntry,
    activeUserTemplateDraft,
    activeTemplate,
    addCanvasElement,
    addTemplateRow,
    canvasDraft,
    canvasFocus,
    canvasPresetId,
    deleteTemplateRow,
    duplicateTemplateRow,
    previewCanvas,
    previewSelectedTemplateRow,
    printCanvas,
    printSelectedTemplateRow,
    archiveTemplateEntry,
    removeCanvasElement,
    autoPreviewTemplateRow,
    selectedCanvasElement,
    selectedCanvasElementId,
    activeUserTemplateDraftLoading,
    editingTemplateCell,
    selectedTemplateRow,
    selectedRowId,
    setCanvasDraft,
    setCanvasFocus,
    setCanvasPresetId,
    setEditingTemplateCell,
    setSelectedCanvasElementId,
    setSelectedRowId,
    setTemplateFocus,
    setTemplateEntryId,
    setTemplateNarrowStage,
    templateFocus,
    templateEntries,
    templateNarrowStage,
    templateEntryId,
    templateRows,
    updateCanvasElement,
    updateTemplateField,
  }
}

function ArchiveUndoToast({
  toast,
  onUndo,
}: {
  toast: TemplateArchiveToastState
  onUndo: () => void | Promise<void>
}) {
  return (
    <div className="tm-archive-toast" role="status" aria-live="polite" key={toast.nonce}>
      <div className="tm-archive-toast__progress" aria-hidden="true" />
      <div className="tm-archive-toast__icon">
        <Archive className="size-4" />
      </div>
      <div className="tm-archive-toast__body">
        <div className="tm-archive-toast__title">已归档模板</div>
        <div className="tm-archive-toast__description">{toast.templateName}</div>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="tm-archive-toast__button"
        onClick={() => {
          void onUndo()
        }}
      >
        <Undo2 className="size-4" />
        <span>撤销</span>
      </Button>
    </div>
  )
}

function WorkbenchLayout({
  controller,
  hydrationState,
  onRouteIntent,
  pwaUpdateSnapshot,
  archiveToast,
  onUndoArchiveToast,
  shellHidden = false,
}: {
  controller: ReturnType<typeof useWorkbenchController>
  hydrationState: WorkbenchHydrationState
  onRouteIntent: (pathname: string) => void
  pwaUpdateSnapshot?: PwaUpdateSnapshot
  archiveToast: TemplateArchiveToastState | null
  onUndoArchiveToast: () => void | Promise<void>
  shellHidden?: boolean
}) {
  const location = useLocation()
  const navigate = useWorkbenchNavigate()
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const runtimePwaUpdate = usePwaUpdate(controller.context)
  const pwaUpdate = pwaUpdateSnapshot ?? runtimePwaUpdate
  const isCanvasRoute = location.pathname === "/canvas"
  const handleDrawerOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        controller.resetDeviceDrawerState()
      }
      setDrawerOpen(nextOpen)
    },
    [controller]
  )

  const surfaceLabel =
    controller.context.surface === "server-http" ? "Server HTTP" : "Browser static"
  const modeLabel = controller.context.mode === "demo" ? "Demo mode" : "Runtime mode"
  const handlePrimaryNavClick = React.useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, pathname: string) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey ||
        normalizeWorkbenchRoutePath(location.pathname) === normalizeWorkbenchRoutePath(pathname)
      ) {
        return
      }
      event.preventDefault()
      void navigate(pathname)
    },
    [location.pathname, navigate]
  )

  return (
    <div
      className={cn("tm-shell", "tm-selectable-none", isCanvasRoute && "tm-shell--canvas")}
      hidden={shellHidden}
      aria-hidden={shellHidden}
      data-deferred-hydration-pending={hydrationState.deferredHydrationPending ? "true" : "false"}
      data-offline-warmup-status={hydrationState.offlineWarmupStatus}
      data-shell-ready={hydrationState.shellReady ? "true" : "false"}
    >
      <header className="tm-header tm-selectable-none">
        <div className="tm-header__left">
          <ProductMark />
          <nav className="tm-nav" aria-label="Main navigation">
            {NAV_LINKS.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  onPointerEnter={() => onRouteIntent(item.to)}
                  onPointerDown={() => onRouteIntent(item.to)}
                  onFocus={() => onRouteIntent(item.to)}
                  onClick={(event) => handlePrimaryNavClick(event, item.to)}
                  className={({ isActive }) =>
                    cn("tm-nav__link", "tm-selectable-none", isActive && "tm-nav__link--active")
                  }
                >
                  <Icon className="size-4" />
                  <span>{item.label}</span>
                </NavLink>
              )
            })}
          </nav>
        </div>
        <div className="tm-header__right">
          <div className="tm-header__status">
            <Badge variant="outline">{surfaceLabel}</Badge>
            <Badge variant={controller.context.mode === "demo" ? "secondary" : "outline"}>
              {modeLabel}
            </Badge>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="rounded-full px-4"
            onClick={() => setDrawerOpen(true)}
          >
            <Printer className="size-4" />
            <span>
              {controller.selectedPrinter?.name ?? controller.browserPrinter?.name ?? "选择设备"}
            </span>
          </Button>
        </div>
      </header>

      <main className={cn("tm-main", isCanvasRoute && "tm-main--canvas")}>
        <Outlet />
      </main>

      <footer className="tm-footer tm-selectable-none">
        <div className="tm-footer__row">
          <span>{surfaceLabel}</span>
          <span>{modeLabel}</span>
          <span>{location.pathname}</span>
        </div>
        <div className="tm-footer__row tm-footer__row--right">
          <span>Service API: {controller.serviceApiUsable ? "available" : "disabled"}</span>
          <span>
            Browser direct: {controller.browserDirectConfigured ? "available" : "disabled"}
          </span>
          <a
            className="tm-footer__link"
            href={__TUCKMARK_REPOSITORY_URL__}
            target="_blank"
            rel="noreferrer"
          >
            <GitHubMark className="size-3.5" />
            GitHub
          </a>
          <FooterBuildMeta
            appVersion={__TUCKMARK_APP_VERSION__}
            buildRef={__TUCKMARK_BUILD_REF__}
          />
          <a href={__TUCKMARK_RIGHTS_URL__} target="_blank" rel="noreferrer">
            © 2026 Ivan Li
          </a>
        </div>
      </footer>

      <PwaUpdateToast
        snapshot={pwaUpdate}
        onUpdate={() => {
          if (pwaUpdateSnapshot) {
            return
          }
          applyPwaUpdate(pwaUpdate)
        }}
      />

      {archiveToast ? (
        <ArchiveUndoToast
          key={archiveToast.nonce}
          toast={archiveToast}
          onUndo={onUndoArchiveToast}
        />
      ) : null}

      <DataDirectoryNudgeToast
        open={controller.directorySetupNudgeOpen}
        onDismiss={controller.dismissDirectorySetupNudge}
        onOpenSystem={() => {
          controller.dismissDirectorySetupNudge()
          navigate("/system")
        }}
      />

      <DeviceDrawer
        controller={controller}
        open={drawerOpen}
        onOpenChange={handleDrawerOpenChange}
      />
    </div>
  )
}

function DeviceDrawerFeedbackAlert({
  feedback,
  onDismiss,
}: {
  feedback: WorkbenchDeviceDrawerFeedback
  onDismiss: () => void
}) {
  const isError = feedback.tone === "error"

  return (
    <Alert variant={isError ? "destructive" : "default"}>
      {isError ? <AlertCircle className="mt-0.5 size-4" /> : <Info className="mt-0.5 size-4" />}
      <AlertTitle>{feedback.title}</AlertTitle>
      <AlertDescription className="grid gap-3">
        <span>{feedback.message}</span>
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onDismiss}>
            关闭
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}

function DeviceDrawer({
  controller,
  open,
  onOpenChange,
}: {
  controller: ReturnType<typeof useWorkbenchController>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const drawerBusy = controller.deviceDrawerBusyAction !== null
  const serviceApiFeedback =
    controller.deviceDrawerFeedback?.section === "service-api"
      ? controller.deviceDrawerFeedback
      : null
  const browserDirectFeedback =
    controller.deviceDrawerFeedback?.section === "browser-direct"
      ? controller.deviceDrawerFeedback
      : null
  const refreshBusy = controller.deviceDrawerBusyAction === "refresh-setup"
  const probeBusy = controller.deviceDrawerBusyAction === "probe-printer"
  const connectBusy = controller.deviceDrawerBusyAction === "connect-browser-printer"

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full max-w-[420px] flex-col">
        <SheetHeader>
          <SheetTitle>设备与打印路径</SheetTitle>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
          <Card className="tm-panel">
            <CardHeader className="pb-4">
              <CardTitle as="h3" className="text-base">
                打印路径状态
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <StatusPill
                label="Service API"
                value={controller.serviceApiUsable ? "已启用" : "不可用"}
                tone={controller.serviceApiUsable ? "ok" : "muted"}
              />
              <StatusPill
                label="Browser Direct"
                value={controller.browserDirectConfigured ? "已配置" : "已关闭"}
                tone={controller.browserDirectConfigured ? "ok" : "muted"}
              />
              <StatusPill
                label="Probe"
                value={controller.probeResult?.message ?? "等待探测"}
                tone={controller.probeResult?.ok ? "ok" : controller.probeResult ? "warn" : "muted"}
              />
            </CardContent>
          </Card>

          <Card className="tm-panel">
            <CardHeader className="pb-4">
              <CardTitle as="h3" className="text-base">
                Service API 打印机
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Select
                value={controller.selectedPrinter?.id ?? ""}
                onValueChange={(value) => controller.rememberPrinterSelection(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择 service-api 打印机" />
                </SelectTrigger>
                <SelectContent>
                  {controller.printers.length === 0 ? (
                    <SelectItem value="__none" disabled>
                      暂无可用设备
                    </SelectItem>
                  ) : (
                    controller.printers.map((printer) => (
                      <SelectItem key={printer.id} value={printer.id}>
                        {printer.name ?? printer.id}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={drawerBusy}
                  onClick={() => void controller.refreshDeviceDrawerSetup()}
                >
                  <RefreshCcw className={cn("size-4", refreshBusy && "animate-spin")} />
                  <span>{refreshBusy ? "刷新中…" : "刷新设备"}</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={drawerBusy}
                  onClick={() => void controller.probeDeviceDrawerPrinter()}
                >
                  <ScanSearch className={cn("size-4", probeBusy && "animate-pulse")} />
                  <span>{probeBusy ? "探测中…" : "探测设备"}</span>
                </Button>
              </div>
              {serviceApiFeedback ? (
                <DeviceDrawerFeedbackAlert
                  feedback={serviceApiFeedback}
                  onDismiss={controller.clearDeviceDrawerFeedback}
                />
              ) : null}
            </CardContent>
          </Card>

          <Card className="tm-panel">
            <CardHeader className="pb-4">
              <CardTitle as="h3" className="text-base">
                浏览器直连
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm">
                {controller.browserPrinter ? (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{controller.browserPrinter.name}</div>
                      <div className="text-muted-foreground">已连接</div>
                    </div>
                    <Badge variant="secondary">Browser P2</Badge>
                  </div>
                ) : (
                  <div className="text-muted-foreground">当前没有浏览器直连打印机会话。</div>
                )}
              </div>
              <Button
                type="button"
                disabled={drawerBusy}
                onClick={() => void controller.connectPhysicalPrinter()}
              >
                <Wifi className="size-4" />
                <span>
                  {connectBusy
                    ? controller.browserPrinter
                      ? "重新连接中…"
                      : "连接中…"
                    : controller.browserPrinter
                      ? "重新连接浏览器直连打印机"
                      : "连接浏览器直连打印机"}
                </span>
              </Button>
              {browserDirectFeedback ? (
                <DeviceDrawerFeedbackAlert
                  feedback={browserDirectFeedback}
                  onDismiss={controller.clearDeviceDrawerFeedback}
                />
              ) : null}
            </CardContent>
          </Card>

          {controller.probeResult ? (
            <Alert variant={controller.probeResult.ok ? "default" : "destructive"}>
              {controller.probeResult.ok ? (
                <CheckCircle2 className="mt-0.5 size-4" />
              ) : (
                <AlertCircle className="mt-0.5 size-4" />
              )}
              <AlertTitle>{controller.probeResult.stage}</AlertTitle>
              <AlertDescription>{controller.probeResult.message}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function StatusPill({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "ok" | "warn" | "muted"
}) {
  return (
    <div className="tm-selectable-none flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-medium",
          tone === "ok" && "text-emerald-700",
          tone === "warn" && "text-amber-700",
          tone === "muted" && "text-foreground"
        )}
      >
        {value}
      </span>
    </div>
  )
}

function DashboardPage({ controller }: { controller: ReturnType<typeof useWorkbenchController> }) {
  const navigate = useWorkbenchNavigate()

  return (
    <section className="tm-dashboard">
      <div className="tm-hero">
        <div className="tm-hero__copy">
          <Badge variant="outline">Tuckmark</Badge>
          <h1>打印工作台</h1>
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={() => navigate("/templates")}>
              <LayoutTemplate className="size-4" />
              <span>进入模板</span>
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate("/canvas")}>
              <PencilRuler className="size-4" />
              <span>进入画布</span>
            </Button>
          </div>
        </div>
        <div className="tm-hero__facts">
          <Card className="tm-panel">
            <CardHeader className="pb-4">
              <CardTitle as="h2" className="text-base">
                快捷入口
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                onClick={() => navigate("/templates")}
              >
                <LayoutTemplate className="size-4" />
                <span>模板列表</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                onClick={() => navigate("/canvas")}
              >
                <PencilRuler className="size-4" />
                <span>画布编辑</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                onClick={() => navigate("/system")}
              >
                <MonitorCog className="size-4" />
                <span>系统设置</span>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="tm-dashboard__grid">
        <Card className="tm-panel">
          <CardHeader>
            <CardTitle as="h2">最近使用的模板</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {controller.recentActivity.templates.length === 0 ? (
              <EmptyMini text="还没有模板使用记录。" />
            ) : (
              controller.recentActivity.templates.map((entry) => (
                <div key={entry.id} className="tm-list-item">
                  <div className="font-medium">{entry.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatRelativeTime(entry.usedAt)}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="tm-panel">
          <CardHeader>
            <CardTitle as="h2">最近打印</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {controller.recentActivity.prints.length === 0 ? (
              <EmptyMini text="还没有打印记录。" />
            ) : (
              controller.recentActivity.prints.map((entry) => (
                <div key={entry.id} className="tm-list-item">
                  <div>
                    <div className="font-medium">{entry.title}</div>
                    <div className="text-sm text-muted-foreground">
                      {entry.kind} · {entry.printerName}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatRelativeTime(entry.printedAt)}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="tm-panel">
          <CardHeader>
            <CardTitle as="h2">设备状态</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <StatusPill
              label="Service API"
              value={controller.serviceApiUsable ? "available" : "disabled"}
              tone={controller.serviceApiUsable ? "ok" : "muted"}
            />
            <StatusPill
              label="Browser Direct"
              value={controller.browserDirectConfigured ? "available" : "disabled"}
              tone={controller.browserDirectConfigured ? "ok" : "muted"}
            />
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

function TemplatesPage({
  controller,
  state,
  onPresentArchiveToast,
}: {
  controller: ReturnType<typeof useWorkbenchController>
  state: ReturnType<typeof useWorkbenchPages>
  onPresentArchiveToast: (template: UserTemplateSummary) => void
}) {
  const navigate = useWorkbenchNavigate()
  const isTriple = useMediaQuery(`(min-width: ${WIDE_TRIPLE_THRESHOLD}px)`)
  const stacksPreviewBelowTable = !useMediaQuery(
    `(min-width: ${TEMPLATE_STACKED_PREVIEW_THRESHOLD}px)`
  )
  const usesSingleOutletFlow = !isTriple
  const showsTableStage = state.templateNarrowStage === "table"
  const showsDisabledPreviewRail =
    usesSingleOutletFlow && state.templateNarrowStage === "list" && !stacksPreviewBelowTable
  const usesSplitTableAndPreview =
    usesSingleOutletFlow && showsTableStage && !stacksPreviewBelowTable
  const showsListOnlyPane =
    usesSingleOutletFlow && state.templateNarrowStage === "list" && stacksPreviewBelowTable
  const showTemplateListPane = !usesSingleOutletFlow || state.templateNarrowStage === "list"
  const showTemplateTablePane = !usesSingleOutletFlow || showsTableStage
  const showTemplatePreviewPane =
    !usesSingleOutletFlow || showsTableStage || showsDisabledPreviewRail
  const activeUserTemplatePending =
    state.activeTemplateEntry?.kind === "user" &&
    state.activeUserTemplateDraftLoading &&
    !state.activeTemplateEntry.draft &&
    !state.activeTemplateEntry.template.document
  const templatePreviewDisabled =
    showsDisabledPreviewRail ||
    !state.activeTemplateEntry ||
    !state.selectedTemplateRow ||
    activeUserTemplatePending
  const [listMode, setListMode] = React.useState<TemplateListMode>("large")
  const [actionMenu, setActionMenu] = React.useState<TemplateActionMenuState | null>(null)
  const [renameDialog, setRenameDialog] = React.useState<{
    templateId: string
    currentName: string
  } | null>(null)
  const importInputId = React.useId()
  const importInputRef = React.useRef<HTMLInputElement | null>(null)
  const [importStatus, setImportStatus] = React.useState("")
  const [tableShellElement, setTableShellElement] = React.useState<HTMLDivElement | null>(null)
  const tableShellWidth = useElementClientWidth(tableShellElement)
  const activeTemplateFields = state.activeTemplate ? toTemplateFieldList(state.activeTemplate) : []
  const systemEntries = React.useMemo(
    () => state.templateEntries.filter((entry) => entry.kind === "system"),
    [state.templateEntries]
  )
  const userEntries = React.useMemo(
    () => state.templateEntries.filter((entry) => entry.kind === "user"),
    [state.templateEntries]
  )
  const templateColumnLayout = React.useMemo(
    () => resolveTemplateColumnLayout(activeTemplateFields, state.templateRows, tableShellWidth),
    [activeTemplateFields, state.templateRows, tableShellWidth]
  )

  React.useEffect(() => {
    void Promise.all([controller.refreshUserTemplates(), controller.refreshArchivedUserTemplates()])
  }, [controller.refreshArchivedUserTemplates, controller.refreshUserTemplates])

  React.useEffect(() => {
    if (actionMenu && !state.templateEntries.some((entry) => entry.id === actionMenu.entry.id)) {
      setActionMenu(null)
    }
  }, [actionMenu, state.templateEntries])

  React.useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }
      if (
        target.closest(".tm-template-card") ||
        target.closest(".tm-template-action-menu") ||
        target.closest("[role='dialog']")
      ) {
        return
      }
      setActionMenu(null)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActionMenu(null)
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [])

  const importTemplatePackage = React.useCallback(
    async (file: File) => {
      try {
        const templatePackage = parseUserTemplatePackage(JSON.parse(await file.text()))
        const draft = createDraftFromUserTemplatePackage(templatePackage)
        await saveUserTemplate({
          name: templatePackage.name,
          description: templatePackage.description,
          document: draft,
        })
        await Promise.all([
          controller.refreshUserTemplates(),
          controller.refreshArchivedUserTemplates(),
        ])
        setImportStatus(`已导入 ${templatePackage.name}`)
      } catch (error) {
        setImportStatus(error instanceof Error ? `导入失败：${error.message}` : "导入失败。")
      } finally {
        if (importInputRef.current) {
          importInputRef.current.value = ""
        }
      }
    },
    [controller.refreshArchivedUserTemplates, controller.refreshUserTemplates]
  )

  const editTemplateEntry = React.useCallback(
    (entryId: string) => {
      const entry = state.templateEntries.find((item) => item.id === entryId)
      if (!entry) {
        return
      }
      navigate(
        entry.kind === "system"
          ? `/canvas?source=preset-template&templateId=${entry.template.id}`
          : `/canvas?source=user-template&templateId=${entry.template.id}`
      )
    },
    [navigate, state.templateEntries]
  )

  const archiveTemplateEntry = React.useCallback(
    async (entryId: string) => {
      const archived = await state.archiveTemplateEntry(entryId)
      if (!archived) {
        return
      }
      setActionMenu(null)
      onPresentArchiveToast(archived)
    },
    [onPresentArchiveToast, state]
  )

  const openRenameTemplateDialog = React.useCallback((entry: TemplateCardEntry) => {
    if (entry.kind !== "user") {
      return
    }
    setActionMenu(null)
    setRenameDialog({
      templateId: entry.template.id,
      currentName: entry.template.name,
    })
  }, [])

  const handleTemplateAction = React.useCallback(
    async (entry: TemplateCardEntry, action: TemplateActionKind) => {
      if (action === "edit") {
        editTemplateEntry(entry.id)
        setActionMenu(null)
        return
      }
      if (action === "rename") {
        openRenameTemplateDialog(entry)
        return
      }
      await archiveTemplateEntry(entry.id)
    },
    [archiveTemplateEntry, editTemplateEntry, openRenameTemplateDialog]
  )

  const handleTemplateSelect = React.useCallback(
    (entryId: string) => {
      state.setTemplateEntryId(entryId)
      if (usesSingleOutletFlow) {
        state.setTemplateNarrowStage("table")
        return
      }
      state.setTemplateFocus("left-center")
    },
    [state, usesSingleOutletFlow]
  )

  const openTemplateActionMenu = React.useCallback(
    (entry: TemplateCardEntry, position: { x: number; y: number }) => {
      state.setTemplateEntryId(entry.id)
      setActionMenu({
        entry,
        x: position.x,
        y: position.y,
      })
    },
    [state]
  )

  const handleTemplateContextMenu = React.useCallback(
    (entry: TemplateCardEntry, event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault()
      openTemplateActionMenu(entry, { x: event.clientX, y: event.clientY })
    },
    [openTemplateActionMenu]
  )

  return (
    <section className="tm-workspace">
      <div
        className={cn(
          "tm-pane-grid",
          "tm-pane-grid--template",
          showsListOnlyPane && "tm-pane-grid--single-pane",
          showsDisabledPreviewRail && "tm-pane-grid--preview-side",
          usesSplitTableAndPreview && "tm-pane-grid--focus-right",
          isTriple && "tm-pane-grid--triple",
          stacksPreviewBelowTable && "tm-pane-grid--stacked-preview"
        )}
      >
        {showTemplateListPane ? (
          <aside className="tm-pane tm-pane--left">
            <PaneHeader
              icon={LayoutTemplate}
              title="模板列表"
              actions={
                <div className="tm-template-list__header-actions">
                  <SegmentedTabs
                    ariaLabel="模板列表视图"
                    value={listMode}
                    onValueChange={(nextMode) =>
                      setListMode(nextMode === "list" ? "list" : "large")
                    }
                    items={[
                      { value: "large", name: "大图", icon: LayoutGrid },
                      { value: "list", name: "列表", icon: LayoutList },
                    ]}
                  />
                </div>
              }
            />
            <div className="tm-template-list__primary-actions">
              <input
                ref={importInputRef}
                id={importInputId}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                aria-label="选择模板包文件"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  if (file) {
                    void importTemplatePackage(file)
                  }
                }}
              />
              <ActionButton
                type="button"
                name="导入模板"
                icon={Upload}
                mode="icon-text"
                size="sm"
                variant="outline"
                onClick={() => importInputRef.current?.click()}
              />
              <ActionButton
                type="button"
                name="新增模板"
                icon={Plus}
                mode="icon-text"
                size="sm"
                variant="outline"
                onClick={() => navigate("/canvas")}
              />
            </div>
            <div
              className={cn(
                "tm-pane__body",
                "tm-template-list",
                listMode === "large" ? "tm-template-list--large" : "tm-template-list--list"
              )}
            >
              <TemplateGroup
                title="系统模板"
                entries={systemEntries}
                listMode={listMode}
                activeEntryId={state.activeTemplateEntry?.id ?? ""}
                onSelect={handleTemplateSelect}
                onContextMenu={handleTemplateContextMenu}
                onOpenMenu={openTemplateActionMenu}
              />
              <TemplateGroup
                title="我的模板"
                entries={userEntries}
                listMode={listMode}
                activeEntryId={state.activeTemplateEntry?.id ?? ""}
                emptyText="还没有保存到浏览器本地的用户模板。"
                emptyAction={
                  <ActionButton
                    type="button"
                    name="新增模板"
                    icon={Plus}
                    mode="icon-text"
                    size="sm"
                    variant="outline"
                    className="tm-template-list__empty-action-button"
                    onClick={() => navigate("/canvas")}
                  />
                }
                onSelect={handleTemplateSelect}
                onContextMenu={handleTemplateContextMenu}
                onOpenMenu={openTemplateActionMenu}
              />
              {importStatus ? (
                <div className="tm-template-list__status" role="status">
                  {importStatus}
                </div>
              ) : null}
            </div>
            <TemplateActionMenu state={actionMenu} onAction={handleTemplateAction} />
            <PromptDialog
              open={renameDialog !== null}
              title="重命名模板"
              description="更新模板名称，不影响现有版本历史与归档状态。"
              label="模板名称"
              defaultValue={renameDialog?.currentName ?? ""}
              confirmLabel="保存"
              requiredMessage="请输入模板名称。"
              onOpenChange={(open) => {
                if (!open) {
                  setRenameDialog(null)
                }
              }}
              onConfirm={(value) => {
                if (!renameDialog) {
                  return
                }
                if (value === renameDialog.currentName) {
                  return
                }
                void controller.renameTemplate(renameDialog.templateId, value)
              }}
            />
          </aside>
        ) : null}

        {showTemplateTablePane ? (
          <section className="tm-pane tm-pane--center">
            <PaneHeader
              icon={Rows3}
              title="批量录入表"
              actions={
                <div className="flex flex-wrap gap-2">
                  {usesSingleOutletFlow ? (
                    <ActionButton
                      type="button"
                      name="返回模板"
                      icon={ChevronLeft}
                      mode="icon-text"
                      variant="outline"
                      size="sm"
                      onClick={() => state.setTemplateNarrowStage("list")}
                    />
                  ) : null}
                  <ActionButton
                    type="button"
                    name="新增行"
                    icon={Plus}
                    mode="icon-text"
                    variant="outline"
                    size="sm"
                    onClick={state.addTemplateRow}
                  />
                  <ActionButton
                    type="button"
                    name="复制行"
                    icon={Copy}
                    mode="icon-text"
                    variant="outline"
                    size="sm"
                    onClick={state.duplicateTemplateRow}
                  />
                  <ActionButton
                    type="button"
                    name="删除行"
                    icon={Trash2}
                    mode="icon-text"
                    variant="outline"
                    size="sm"
                    onClick={state.deleteTemplateRow}
                  />
                </div>
              }
            />
            <div className="tm-pane__body tm-pane__body--table">
              <div className="tm-table-shell" ref={setTableShellElement}>
                <table
                  className="tm-table"
                  style={{ width: `${templateColumnLayout.tableWidth}px` }}
                >
                  <colgroup>
                    <col style={{ width: `${TEMPLATE_INDEX_COLUMN_WIDTH}px` }} />
                    {activeTemplateFields.map((field) => (
                      <col
                        key={field.key}
                        style={{
                          width: `${templateColumnLayout.columnWidths[field.key] ?? getTemplateColumnWidthRange(field).minWidth}px`,
                        }}
                      />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th>
                        <span className="tm-table__header-label">行</span>
                      </th>
                      {activeTemplateFields.map((field) => (
                        <th key={field.key}>
                          <span className="tm-table__header-label">{field.label}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {state.templateRows.length === 0 ? (
                      <tr>
                        <td colSpan={activeTemplateFields.length + 1}>
                          <EmptyMini text="当前模板还没有数据行。" />
                        </td>
                      </tr>
                    ) : (
                      state.templateRows.map((row, rowIndex) => (
                        <tr
                          key={row.id}
                          className={cn(row.id === state.selectedRowId && "tm-table__row--active")}
                          onClick={() => {
                            state.setSelectedRowId(row.id)
                            state.setTemplateNarrowStage("table")
                            void state.autoPreviewTemplateRow(row)
                          }}
                        >
                          <td>
                            <span className="tm-table__row-index">{rowIndex + 1}</span>
                          </td>
                          {activeTemplateFields.map((field) => {
                            const value = toSingleLineFieldValue(row.values[field.key] ?? "")
                            const isEditing =
                              state.editingTemplateCell?.rowId === row.id &&
                              state.editingTemplateCell?.fieldKey === field.key
                            const columnWidth =
                              templateColumnLayout.columnWidths[field.key] ??
                              getTemplateColumnWidthRange(field).minWidth
                            const columnStyle = {
                              width: `${columnWidth}px`,
                              minWidth: `${columnWidth}px`,
                              maxWidth: `${columnWidth}px`,
                            } satisfies React.CSSProperties

                            return (
                              <td key={field.key}>
                                {isEditing ? (
                                  <Input
                                    value={value}
                                    className="tm-table__input tm-table__input--editing"
                                    density="compact"
                                    size="xs"
                                    style={columnStyle}
                                    autoFocus
                                    onFocus={() => {
                                      state.setSelectedRowId(row.id)
                                      state.setTemplateNarrowStage("table")
                                      void state.autoPreviewTemplateRow(row)
                                    }}
                                    onBlur={() => {
                                      state.setEditingTemplateCell(null)
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === "Escape") {
                                        event.currentTarget.blur()
                                      }
                                    }}
                                    onChange={(event) => {
                                      const nextValue = event.currentTarget.value
                                      state.updateTemplateField(row.id, field.key, nextValue)
                                    }}
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    className="tm-table__cell"
                                    style={columnStyle}
                                    onFocus={() => {
                                      state.setSelectedRowId(row.id)
                                      state.setTemplateNarrowStage("table")
                                      void state.autoPreviewTemplateRow(row)
                                    }}
                                    onClick={() => {
                                      state.setSelectedRowId(row.id)
                                      state.setEditingTemplateCell({
                                        rowId: row.id,
                                        fieldKey: field.key,
                                      })
                                      state.setTemplateNarrowStage("table")
                                    }}
                                  >
                                    {value || "—"}
                                  </button>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}

        {showTemplatePreviewPane && !stacksPreviewBelowTable ? (
          <aside className="tm-pane tm-pane--right">
            <TemplatesPrintRail
              controller={controller}
              state={state}
              disabled={templatePreviewDisabled}
              unavailableMessage={
                activeUserTemplatePending
                  ? "正在读取本地模板草稿。"
                  : "先选择模板后查看预览与打印。"
              }
              onFocusRight={() => state.setTemplateFocus("center-right")}
            />
          </aside>
        ) : null}

        {showTemplatePreviewPane && stacksPreviewBelowTable ? (
          <aside className="tm-pane tm-pane--right">
            <TemplatesPrintRail
              controller={controller}
              state={state}
              disabled={templatePreviewDisabled}
              unavailableMessage={
                activeUserTemplatePending
                  ? "正在读取本地模板草稿。"
                  : "先选择模板后查看预览与打印。"
              }
              onFocusRight={() => state.setTemplateFocus("center-right")}
            />
          </aside>
        ) : null}
      </div>
    </section>
  )
}

// biome-ignore lint/correctness/noUnusedVariables: legacy canvas surface remains as reference while /canvas uses CanvasWorkspace.
function CanvasPageLegacy({
  controller,
  state,
}: {
  controller: ReturnType<typeof useWorkbenchController>
  state: ReturnType<typeof useWorkbenchPages>
}) {
  const isTriple = useMediaQuery(`(min-width: ${WIDE_TRIPLE_THRESHOLD}px)`)
  const supportsFormal = useMediaQuery(`(min-width: ${SUPPORTED_MIN_WIDTH}px)`)

  return (
    <section className="tm-workspace">
      {!isTriple && supportsFormal ? (
        <FocusPairSwitch
          leftLabel="工具"
          rightLabel="属性"
          value={state.canvasFocus}
          onChange={state.setCanvasFocus}
        />
      ) : null}

      <div
        className={cn(
          "tm-pane-grid",
          isTriple && "tm-pane-grid--triple",
          !isTriple &&
            supportsFormal &&
            state.canvasFocus === "center-right" &&
            "tm-pane-grid--focus-right"
        )}
      >
        <aside className="tm-pane tm-pane--left">
          <PaneHeader icon={Layers3} title="工具与图层" />
          <div className="tm-pane__body">
            <div className="grid gap-3">
              <Label>文档预设</Label>
              <Select
                value={state.canvasPresetId}
                onValueChange={(value) => {
                  state.setCanvasPresetId(value)
                  state.setCanvasFocus("left-center")
                }}
              >
                <SelectTrigger>
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
              <div className="grid gap-2">
                {(
                  [
                    "text",
                    "rect",
                    "circle",
                    "triangle",
                    "line",
                    "barcode",
                    "qr",
                    "datamatrix",
                  ] as Array<CanvasElement["kind"]>
                ).map((kind) => (
                  <Button
                    key={kind}
                    type="button"
                    variant="outline"
                    className="justify-start"
                    onClick={() => state.addCanvasElement(kind)}
                  >
                    <Plus className="size-4" />
                    <span>添加 {CANVAS_TOOL_LABELS[kind]}</span>
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-3">
              <Label>图层</Label>
              <div className="grid gap-2">
                {state.canvasDraft.elements.map((element) => (
                  <button
                    key={element.id}
                    type="button"
                    className={cn(
                      "tm-choice",
                      element.id === state.selectedCanvasElementId && "tm-choice--active"
                    )}
                    onClick={() => {
                      state.setSelectedCanvasElementId(element.id)
                      state.setCanvasFocus("left-center")
                    }}
                  >
                    <div>
                      <div className="font-medium">{CANVAS_TOOL_LABELS[element.kind]}</div>
                      <div className="text-sm text-muted-foreground">{element.id.slice(0, 12)}</div>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <section className="tm-pane tm-pane--center">
          <PaneHeader
            icon={PencilRuler}
            title="舞台"
            actions={
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  {state.canvasDraft.width} × {state.canvasDraft.height}
                </Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={state.removeCanvasElement}
                >
                  删除选中
                </Button>
              </div>
            }
          />
          <div className="tm-pane__body">
            <CanvasStage state={state} />
          </div>
        </section>

        <aside className="tm-pane tm-pane--right">
          <PaneHeader
            icon={Settings2}
            title="属性与打印"
            actions={
              <div className="flex flex-wrap gap-2">
                <ActionButton
                  type="button"
                  name="生成预览"
                  icon={Eye}
                  mode="icon-text"
                  variant="outline"
                  size="sm"
                  onClick={() => void state.previewCanvas()}
                />
                <ActionButton
                  type="button"
                  name="直接打印"
                  icon={Printer}
                  mode="icon-text"
                  size="sm"
                  onClick={() => void state.printCanvas()}
                />
              </div>
            }
          />
          <div className="tm-pane__body">
            <CanvasInspector state={state} />
            <RenderOptionsForm
              controller={controller}
              onFocusRight={() => state.setCanvasFocus("center-right")}
            />
            <PreviewCard controller={controller} />
          </div>
        </aside>
      </div>
    </section>
  )
}

export function ArchivedTemplateManagementCard({
  controller,
}: {
  controller: ReturnType<typeof useWorkbenchController>
}) {
  return (
    <Card className="tm-panel">
      <CardHeader>
        <CardTitle as="h2">模板归档</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {controller.archivedUserTemplates.length === 0 ? (
          <EmptyMini text="当前没有已归档的用户模板。" />
        ) : (
          controller.archivedUserTemplates.map((template) => (
            <div key={template.id} className="tm-archive-list-item">
              <div className="tm-archive-list-item__main">
                <div className="tm-archive-list-item__title-row">
                  <div className="tm-archive-list-item__title">{template.name}</div>
                  <Badge variant="outline">
                    {formatCanvasDimension({
                      width: template.width,
                      height: template.height,
                    })}
                  </Badge>
                </div>
                <div className="tm-archive-list-item__meta">
                  <span>{template.description || "浏览器本地模板"}</span>
                  <span>
                    归档于 {formatRelativeTime(template.archivedAt ?? template.updatedAt)}
                  </span>
                </div>
              </div>
              <div className="tm-archive-list-item__actions">
                <ActionButton
                  type="button"
                  name="恢复模板"
                  icon={RotateCcw}
                  mode="icon-text"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void controller.restoreArchivedTemplate(template.id)
                  }}
                />
                <ActionButton
                  type="button"
                  name="彻底删除"
                  icon={Trash2}
                  mode="icon-text"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void controller.purgeArchivedTemplate(template.id)
                  }}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function SystemPage({ controller }: { controller: ReturnType<typeof useWorkbenchController> }) {
  return (
    <section className="tm-system">
      <div className="tm-system__grid">
        <SystemDataStorageCard
          busy={controller.dataDirectoryBusy}
          dialog={controller.dataDirectoryDialog}
          status={controller.dataDirectoryStatus}
          onCancelDialog={controller.cancelDataDirectoryDialog}
          onChooseDirectory={() => void controller.chooseDataDirectory()}
          onConfirmAttachment={(mode) => void controller.confirmDataDirectoryAttachment(mode)}
          onConfirmImport={() => void controller.confirmImportDataArchive()}
          onConfirmRestore={() => void controller.confirmRestoreBackup()}
          onCreateBackup={() => void controller.createManualDataBackup()}
          onExportArchive={() => void controller.exportDataArchive()}
          onInspectImportArchive={(file) => void controller.inspectImportDataArchive(file)}
          onInspectRestoreBackup={(entry) => void controller.inspectRestoreBackup(entry)}
          onRequestPermission={() => void controller.requestDataDirectoryPermission()}
          onSyncNow={() => void controller.syncDataDirectoryNow()}
          onTakeOverWrites={controller.takeOverDataDirectoryWrites}
        />

        <ArchivedTemplateManagementCard controller={controller} />

        <Card className="tm-panel">
          <CardHeader>
            <CardTitle as="h2">应用设置</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-muted-foreground">
            <div className="tm-list-item">
              <span>模式</span>
              <strong>{controller.context.mode === "demo" ? "Demo" : "Runtime"}</strong>
            </div>
            <div className="tm-list-item">
              <span>运行面</span>
              <strong>
                {controller.context.surface === "server-http" ? "Server HTTP" : "Browser static"}
              </strong>
            </div>
            <div className="tm-list-item">
              <span>当前设备</span>
              <strong>
                {controller.selectedPrinter?.name ?? controller.browserPrinter?.name ?? "未选择"}
              </strong>
            </div>
            <div className="tm-list-item">
              <div className="grid gap-1">
                <span>文字 BBOX</span>
                <span className="text-xs text-muted-foreground">控制画布里的红色虚线文字框。</span>
              </div>
              <Button
                type="button"
                size="sm"
                variant={controller.showTextBoundingBoxes ? "default" : "outline"}
                aria-pressed={controller.showTextBoundingBoxes}
                onClick={() => controller.updateShowTextBoundingBoxes((current) => !current)}
              >
                {controller.showTextBoundingBoxes ? "隐藏文字 BBOX" : "显示文字 BBOX"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="tm-panel">
          <CardHeader>
            <CardTitle as="h2">默认打印参数</CardTitle>
          </CardHeader>
          <CardContent>
            <RenderOptionsForm controller={controller} onFocusRight={() => undefined} compact />
          </CardContent>
        </Card>

        <Card className="tm-panel">
          <CardHeader>
            <CardTitle as="h2">设备管理与探测</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Button type="button" variant="outline" onClick={() => void controller.refreshSetup()}>
              <RefreshCcw className="size-4" />
              <span>刷新打印机列表</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void controller.probeSelectedPrinter()}
            >
              <ScanSearch className="size-4" />
              <span>探测当前设备</span>
            </Button>
            {controller.probeResult ? (
              <Alert variant={controller.probeResult.ok ? "default" : "destructive"}>
                {controller.probeResult.ok ? (
                  <CheckCircle2 className="mt-0.5 size-4" />
                ) : (
                  <AlertCircle className="mt-0.5 size-4" />
                )}
                <AlertTitle>{controller.probeResult.stage}</AlertTitle>
                <AlertDescription>{controller.probeResult.message}</AlertDescription>
              </Alert>
            ) : (
              <EmptyMini text="尚未执行探测。" />
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

export function PaneHeader({
  icon: Icon,
  title,
  actions,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  actions?: React.ReactNode
}) {
  return (
    <div className="tm-pane__header">
      <div className="tm-pane__headline">
        <div className="tm-pane__eyebrow">
          <Icon className="size-4" />
          <h2>{title}</h2>
        </div>
      </div>
      {actions}
    </div>
  )
}

export function TemplatesPrintRail({
  controller,
  state,
  disabled = false,
  unavailableMessage,
  onFocusRight,
}: {
  controller: ReturnType<typeof useWorkbenchController>
  state: {
    previewSelectedTemplateRow: () => Promise<void>
    printSelectedTemplateRow: () => Promise<void>
  }
  disabled?: boolean
  unavailableMessage?: string
  onFocusRight: () => void
}) {
  return (
    <>
      <PaneHeader
        icon={Printer}
        title="预览与打印"
        actions={
          <div className="flex flex-wrap gap-2">
            <ActionButton
              type="button"
              name="生成预览"
              icon={Eye}
              mode="icon-text"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => void state.previewSelectedTemplateRow()}
            />
            <ActionButton
              type="button"
              name="直接打印"
              icon={Printer}
              mode="icon-text"
              size="sm"
              disabled={disabled}
              onClick={() => void state.printSelectedTemplateRow()}
            />
          </div>
        }
      />
      <div className="tm-pane__body">
        <RenderOptionsForm
          controller={controller}
          disabled={disabled}
          onFocusRight={onFocusRight}
        />
        <PreviewCard
          controller={controller}
          disabled={disabled}
          emptyText={unavailableMessage ?? "先生成一个预览。"}
        />
      </div>
    </>
  )
}

function FocusPairSwitch({
  leftLabel,
  rightLabel,
  value,
  onChange,
}: {
  leftLabel: string
  rightLabel: string
  value: "left-center" | "center-right"
  onChange: (value: "left-center" | "center-right") => void
}) {
  return (
    <div className="tm-focus-switch" role="tablist" aria-label="workspace focus">
      <Button
        type="button"
        size="sm"
        variant={value === "left-center" ? "default" : "outline"}
        onClick={() => onChange("left-center")}
      >
        {leftLabel}
      </Button>
      <Button
        type="button"
        size="sm"
        variant={value === "center-right" ? "default" : "outline"}
        onClick={() => onChange("center-right")}
      >
        {rightLabel}
      </Button>
    </div>
  )
}

export function EmptyMini({ children, text }: { children?: React.ReactNode; text: string }) {
  return (
    <div className="tm-template-list__empty-box">
      <div>{text}</div>
      {children}
    </div>
  )
}

export function TemplateActionMenu({
  state,
  onAction,
}: {
  state: TemplateActionMenuState | null
  onAction: (entry: TemplateCardEntry, action: TemplateActionKind) => void | Promise<void>
}) {
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = React.useState({ left: 12, top: 12 })

  React.useLayoutEffect(() => {
    if (!state) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      const menu = menuRef.current
      if (!menu) {
        return
      }
      const rect = menu.getBoundingClientRect()
      const left = Math.min(state.x, window.innerWidth - rect.width - 12)
      const top = Math.min(state.y, window.innerHeight - rect.height - 12)
      setPosition({
        left: Math.max(12, left),
        top: Math.max(12, top),
      })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [state])

  React.useEffect(() => {
    if (!state) {
      return
    }
    const firstItem = menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")
    firstItem?.focus()
  }, [state])

  if (!state) {
    return null
  }

  const actions = buildTemplateMenuActionItems(state.entry)

  return createPortal(
    <div
      ref={menuRef}
      className="tm-template-action-menu"
      role="menu"
      aria-label={`${state.entry.template.name} 操作`}
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
      }}
    >
      {actions.map((action) => {
        const Icon = action.icon
        return (
          <button
            key={`${state.entry.id}:${action.kind}:menu`}
            type="button"
            role="menuitem"
            className={cn(
              "tm-template-action-menu__item",
              action.kind === "archive" && "tm-template-action-menu__item--archive"
            )}
            onClick={() => {
              void onAction(state.entry, action.kind)
            }}
          >
            <Icon className="size-4" />
            <span>{action.label}</span>
          </button>
        )
      })}
    </div>,
    document.body
  )
}

function TemplateCard({
  entry,
  active,
  mode,
  onClick,
  onContextMenu,
  onOpenMenu,
}: {
  entry: TemplateCardEntry
  active: boolean
  mode: TemplateListMode
  onClick: () => void
  onContextMenu: (entry: TemplateCardEntry, event: React.MouseEvent<HTMLElement>) => void
  onOpenMenu: (entry: TemplateCardEntry, position: { x: number; y: number }) => void
}) {
  const template = entry.template
  const previewSvg = React.useMemo(
    () =>
      entry.kind === "user"
        ? buildUserTemplatePreviewSvg(entry.draft)
        : buildTemplatePreviewSvg(entry.template),
    [entry]
  )
  const previewSrc = previewSvg ? toDataUrl(previewSvg) : null
  const longPressTimerRef = React.useRef<number | null>(null)
  const longPressPointerIdRef = React.useRef<number | null>(null)
  const longPressOriginRef = React.useRef<{ x: number; y: number } | null>(null)
  const longPressPositionRef = React.useRef<{ x: number; y: number } | null>(null)
  const suppressSurfaceClickRef = React.useRef(false)
  const suppressContextMenuUntilRef = React.useRef(0)

  const cancelLongPress = React.useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    longPressPointerIdRef.current = null
    longPressOriginRef.current = null
    longPressPositionRef.current = null
  }, [])

  React.useEffect(() => cancelLongPress, [cancelLongPress])

  const openMenuFromTrigger = React.useCallback(
    (target: HTMLElement) => {
      const rect = target.getBoundingClientRect()
      onOpenMenu(entry, {
        x: rect.right - 8,
        y: rect.bottom + 8,
      })
    },
    [entry, onOpenMenu]
  )

  const handleSurfaceClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (suppressSurfaceClickRef.current) {
        suppressSurfaceClickRef.current = false
        event.preventDefault()
        event.stopPropagation()
        return
      }
      onClick()
    },
    [onClick]
  )

  const handleSurfacePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === "mouse" || event.button !== 0) {
        return
      }
      cancelLongPress()
      if (event.currentTarget.setPointerCapture) {
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // Pointer capture can be unavailable for synthetic or downgraded pointer sequences.
        }
      }
      longPressPointerIdRef.current = event.pointerId
      longPressOriginRef.current = { x: event.clientX, y: event.clientY }
      longPressPositionRef.current = { x: event.clientX, y: event.clientY }
      const currentTarget = event.currentTarget
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null
        suppressSurfaceClickRef.current = true
        suppressContextMenuUntilRef.current = Date.now() + 900
        const position = longPressPositionRef.current
        if (position) {
          onOpenMenu(entry, position)
          return
        }
        openMenuFromTrigger(currentTarget)
      }, TEMPLATE_CARD_LONG_PRESS_MS)
    },
    [cancelLongPress, entry, onOpenMenu, openMenuFromTrigger]
  )

  const handleSurfacePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (
        event.pointerType === "mouse" ||
        event.pointerId !== longPressPointerIdRef.current ||
        !longPressOriginRef.current
      ) {
        return
      }
      longPressPositionRef.current = { x: event.clientX, y: event.clientY }
      const distance = Math.hypot(
        event.clientX - longPressOriginRef.current.x,
        event.clientY - longPressOriginRef.current.y
      )
      if (distance > TEMPLATE_CARD_LONG_PRESS_MOVE_TOLERANCE) {
        cancelLongPress()
      }
    },
    [cancelLongPress]
  )

  const handleSurfacePointerFinish = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.pointerId === longPressPointerIdRef.current) {
        try {
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        } catch {
          // Ignore release failures when the pointer was never captured.
        }
        cancelLongPress()
      }
    },
    [cancelLongPress]
  )

  const handleCardContextMenu = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (Date.now() < suppressContextMenuUntilRef.current) {
        event.preventDefault()
        return
      }
      onContextMenu(entry, event)
    },
    [entry, onContextMenu]
  )

  return (
    <article
      className={cn(
        "tm-template-card",
        mode === "large" && "tm-template-card--grid",
        mode === "list" && "tm-template-card--list",
        active && "tm-template-card--active"
      )}
      onContextMenu={handleCardContextMenu}
    >
      <div className="tm-template-card__main">
        <button
          type="button"
          className="tm-template-card__surface"
          onClick={handleSurfaceClick}
          onPointerDown={handleSurfacePointerDown}
          onPointerMove={handleSurfacePointerMove}
          onPointerUp={handleSurfacePointerFinish}
          onPointerCancel={handleSurfacePointerFinish}
          onLostPointerCapture={handleSurfacePointerFinish}
        >
          <div className="tm-template-card__preview">
            {previewSrc ? (
              <img
                src={previewSrc}
                alt={`${template.name} preview`}
                className="tm-template-card__image"
              />
            ) : (
              <div className="tm-template-card__placeholder">{template.name}</div>
            )}
          </div>
          <div className="tm-template-card__meta">
            <div className="tm-template-card__name">{template.name}</div>
            <div className="tm-template-card__size">{formatTemplateCardSize(entry)}</div>
          </div>
        </button>
        {mode === "list" || mode === "large" ? (
          <div
            className={cn(
              "tm-template-card__menu-trigger-wrap",
              mode === "large" && "tm-template-card__menu-trigger-wrap--grid"
            )}
          >
            <Button
              type="button"
              variant="bare"
              size="icon"
              className="tm-template-card__menu-trigger"
              aria-label={`${template.name} 更多操作`}
              aria-haspopup="menu"
              onClick={(event) => {
                event.stopPropagation()
                openMenuFromTrigger(event.currentTarget)
              }}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  )
}

export function TemplateGroup({
  title,
  entries,
  listMode,
  activeEntryId,
  emptyText = "当前分组没有模板。",
  emptyAction,
  onSelect,
  onContextMenu,
  onOpenMenu,
}: {
  title: string
  entries: TemplateCardEntry[]
  listMode: TemplateListMode
  activeEntryId: string
  emptyText?: string
  emptyAction?: React.ReactNode
  onSelect: (entryId: string) => void
  onContextMenu: (entry: TemplateCardEntry, event: React.MouseEvent<HTMLElement>) => void
  onOpenMenu: (entry: TemplateCardEntry, position: { x: number; y: number }) => void
}) {
  return (
    <section className="tm-template-group">
      <div className="tm-template-list__section-title tm-selectable-none text-sm font-medium text-muted-foreground">
        {title}
      </div>
      {entries.length === 0 ? (
        <div className="tm-template-list__section-empty">
          <EmptyMini text={emptyText}>
            {emptyAction ? (
              <div className="tm-template-list__section-empty-action">{emptyAction}</div>
            ) : null}
          </EmptyMini>
        </div>
      ) : (
        <div
          className={cn(
            "tm-template-group__grid",
            listMode === "large"
              ? "tm-template-group__grid--large"
              : "tm-template-group__grid--list"
          )}
        >
          {entries.map((entry) => (
            <TemplateCard
              key={entry.id}
              entry={entry}
              active={activeEntryId === entry.id}
              mode={listMode}
              onClick={() => onSelect(entry.id)}
              onContextMenu={onContextMenu}
              onOpenMenu={onOpenMenu}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export function RenderOptionsForm({
  controller,
  onFocusRight,
  compact = false,
  disabled = false,
}: {
  controller: ReturnType<typeof useWorkbenchController>
  onFocusRight: () => void
  compact?: boolean
  disabled?: boolean
}) {
  const options = controller.renderOptions

  return (
    <Card className="tm-panel">
      <CardHeader className={compact ? "pb-4" : undefined}>
        <CardTitle as="h3" className="text-base">
          打印参数
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className={cn("tm-form-grid", compact && "tm-form-grid--compact")}>
          <div className="grid gap-2">
            <Label htmlFor="print-width">宽度 dots</Label>
            <Input
              id="print-width"
              type="number"
              value={String(options.printWidthDots)}
              disabled={disabled}
              onFocus={onFocusRight}
              onChange={(event) => {
                const rawValue = event.currentTarget.value
                controller.updateRenderOptions((current) => ({
                  ...current,
                  printWidthDots: Number(rawValue || current.printWidthDots),
                }))
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="paper-type">纸张类型</Label>
            <Select
              value={options.paperType}
              disabled={disabled}
              onValueChange={(value: "continuous" | "gap") =>
                controller.updateRenderOptions((current) => ({
                  ...current,
                  paperType: value,
                }))
              }
            >
              <SelectTrigger id="paper-type" disabled={disabled} onFocus={onFocusRight}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="continuous">continuous</SelectItem>
                <SelectItem value="gap">gap</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="threshold">Threshold</Label>
            <Input
              id="threshold"
              type="number"
              value={String(options.threshold)}
              disabled={disabled}
              onFocus={onFocusRight}
              onChange={(event) => {
                const rawValue = event.currentTarget.value
                controller.updateRenderOptions((current) => ({
                  ...current,
                  threshold: Number(rawValue || current.threshold),
                }))
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="x-offset">X offset</Label>
            <Input
              id="x-offset"
              type="number"
              value={String(options.xOffsetDots)}
              disabled={disabled}
              onFocus={onFocusRight}
              onChange={(event) => {
                const rawValue = event.currentTarget.value
                controller.updateRenderOptions((current) => ({
                  ...current,
                  xOffsetDots: Number(rawValue || current.xOffsetDots),
                }))
              }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function PreviewCard({
  controller,
  disabled = false,
  emptyText = "先生成一个预览。",
}: {
  controller: ReturnType<typeof useWorkbenchController>
  disabled?: boolean
  emptyText?: string
}) {
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

  return (
    <Card className="tm-panel">
      <CardHeader className="pb-4">
        <CardTitle as="h3" className="text-base">
          打印预览
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {!disabled && controller.artifactData ? (
          <div className="tm-preview-shell">
            <img
              alt="preview artifact"
              className="tm-preview-image"
              src={
                controller.artifactData.preview.kind === "url"
                  ? controller.artifactData.preview.url
                  : controller.artifactData.preview.dataUrl
              }
            />
          </div>
        ) : (
          <EmptyMini text={emptyText} />
        )}

        {!disabled && controller.error ? (
          <Alert variant="destructive">
            <AlertCircle className="mt-0.5 size-4" />
            <AlertTitle>操作失败</AlertTitle>
            <AlertDescription>{controller.error}</AlertDescription>
          </Alert>
        ) : null}

        {!disabled && printStatus ? (
          <Alert>
            <CheckCircle2 className="mt-0.5 size-4" />
            <AlertTitle>打印状态</AlertTitle>
            <AlertDescription>{printStatus}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}

function CanvasStage({ state }: { state: ReturnType<typeof useWorkbenchPages> }) {
  const stageScale = 1.45
  const width = state.canvasDraft.width * stageScale
  const height = state.canvasDraft.height * stageScale

  return (
    <div className="tm-stage-wrap">
      <Stage width={width} height={height} className="tm-stage">
        <Layer scaleX={stageScale} scaleY={stageScale}>
          <KonvaRect
            x={0}
            y={0}
            width={state.canvasDraft.width}
            height={state.canvasDraft.height}
            fill="#ffffff"
            cornerRadius={18}
            shadowBlur={14}
            shadowOpacity={0.08}
            shadowOffsetY={6}
          />
          {state.canvasDraft.elements.map((element) => {
            const isSelected = element.id === state.selectedCanvasElementId
            if (element.kind === "text") {
              return (
                <KonvaText
                  key={element.id}
                  x={element.x}
                  y={element.y}
                  width={element.width}
                  text={element.value}
                  fontSize={element.fontSize}
                  fontStyle={element.fontWeight === "bold" ? "bold" : "normal"}
                  fill={isSelected ? "#8b4c21" : "#241a14"}
                  draggable
                  onClick={() => state.setSelectedCanvasElementId(element.id)}
                  onDragEnd={(event) =>
                    state.updateCanvasElement(element.id, (current) =>
                      current.kind === "text"
                        ? {
                            ...current,
                            x: event.target.x(),
                            y: event.target.y(),
                          }
                        : current
                    )
                  }
                />
              )
            }

            if (element.kind === "rect") {
              return (
                <KonvaRect
                  key={element.id}
                  x={element.x}
                  y={element.y}
                  width={element.width}
                  height={element.height}
                  fill={element.fill}
                  stroke={isSelected ? "#8b4c21" : element.stroke}
                  strokeWidth={element.strokeWidth}
                  cornerRadius={element.radius}
                  draggable
                  onClick={() => state.setSelectedCanvasElementId(element.id)}
                  onDragEnd={(event) =>
                    state.updateCanvasElement(element.id, (current) =>
                      current.kind === "rect"
                        ? {
                            ...current,
                            x: event.target.x(),
                            y: event.target.y(),
                          }
                        : current
                    )
                  }
                />
              )
            }

            if (element.kind === "circle") {
              return (
                <KonvaCircle
                  key={element.id}
                  x={element.x + element.size / 2}
                  y={element.y + element.size / 2}
                  radius={element.size / 2}
                  fill={element.fill === "none" ? undefined : element.fill}
                  stroke={isSelected ? "#8b4c21" : element.stroke}
                  strokeWidth={element.strokeWidth}
                  draggable
                  onClick={() => state.setSelectedCanvasElementId(element.id)}
                  onDragEnd={(event) =>
                    state.updateCanvasElement(element.id, (current) =>
                      current.kind === "circle"
                        ? {
                            ...current,
                            x: event.target.x() - current.size / 2,
                            y: event.target.y() - current.size / 2,
                          }
                        : current
                    )
                  }
                />
              )
            }

            if (element.kind === "triangle") {
              return (
                <KonvaLine
                  key={element.id}
                  x={element.x}
                  y={element.y}
                  points={[element.width / 2, 0, element.width, element.height, 0, element.height]}
                  closed
                  fill={element.fill === "none" ? undefined : element.fill}
                  stroke={isSelected ? "#8b4c21" : element.stroke}
                  strokeWidth={element.strokeWidth}
                  draggable
                  onClick={() => state.setSelectedCanvasElementId(element.id)}
                  onDragEnd={(event) =>
                    state.updateCanvasElement(element.id, (current) =>
                      current.kind === "triangle"
                        ? {
                            ...current,
                            x: event.target.x(),
                            y: event.target.y(),
                          }
                        : current
                    )
                  }
                />
              )
            }

            if (element.kind === "line") {
              return (
                <KonvaLine
                  key={element.id}
                  points={[element.x, element.y, element.x2, element.y2]}
                  stroke={isSelected ? "#8b4c21" : element.stroke}
                  strokeWidth={element.strokeWidth}
                  draggable
                  onClick={() => state.setSelectedCanvasElementId(element.id)}
                  onDragEnd={(event) =>
                    state.updateCanvasElement(element.id, (current) =>
                      current.kind === "line"
                        ? {
                            ...current,
                            x: event.target.x(),
                            y: event.target.y(),
                            x2: event.target.x() + (element.x2 - element.x),
                            y2: event.target.y() + (element.y2 - element.y),
                          }
                        : current
                    )
                  }
                />
              )
            }

            if (element.kind === "barcode") {
              return (
                <KonvaRect
                  key={element.id}
                  x={element.x}
                  y={element.y}
                  width={element.width}
                  height={element.height}
                  fill="#ffffff"
                  stroke={isSelected ? "#8b4c21" : "#2d231b"}
                  strokeWidth={2}
                  cornerRadius={8}
                  dash={[4, 4]}
                  draggable
                  onClick={() => state.setSelectedCanvasElementId(element.id)}
                  onDragEnd={(event) =>
                    state.updateCanvasElement(element.id, (current) =>
                      current.kind === "barcode"
                        ? {
                            ...current,
                            x: event.target.x(),
                            y: event.target.y(),
                          }
                        : current
                    )
                  }
                />
              )
            }

            if (element.kind === "qr") {
              return (
                <KonvaRect
                  key={element.id}
                  x={element.x}
                  y={element.y}
                  width={element.size}
                  height={element.size}
                  fill="#ffffff"
                  stroke={isSelected ? "#8b4c21" : "#2d231b"}
                  strokeWidth={2}
                  cornerRadius={8}
                  draggable
                  onClick={() => state.setSelectedCanvasElementId(element.id)}
                  onDragEnd={(event) =>
                    state.updateCanvasElement(element.id, (current) =>
                      current.kind === "qr"
                        ? {
                            ...current,
                            x: event.target.x(),
                            y: event.target.y(),
                          }
                        : current
                    )
                  }
                />
              )
            }

            if (element.kind === "datamatrix") {
              return (
                <KonvaRect
                  key={element.id}
                  x={element.x}
                  y={element.y}
                  width={element.size}
                  height={element.size}
                  fill="#ffffff"
                  stroke={isSelected ? "#8b4c21" : "#2d231b"}
                  strokeWidth={2}
                  cornerRadius={8}
                  draggable
                  onClick={() => state.setSelectedCanvasElementId(element.id)}
                  onDragEnd={(event) =>
                    state.updateCanvasElement(element.id, (current) =>
                      current.kind === "datamatrix"
                        ? {
                            ...current,
                            x: event.target.x(),
                            y: event.target.y(),
                          }
                        : current
                    )
                  }
                />
              )
            }

            return null
          })}
        </Layer>
      </Stage>
    </div>
  )
}

function CanvasInspector({ state }: { state: ReturnType<typeof useWorkbenchPages> }) {
  const element = state.selectedCanvasElement
  if (!element) {
    return <EmptyMini text="先选择一个元素。" />
  }

  const setNumeric = (key: string, value: number) => {
    state.updateCanvasElement(element.id, (current) => {
      if (
        current.kind === "text" &&
        (key === "x" || key === "y" || key === "width" || key === "fontSize")
      ) {
        return { ...current, [key]: value }
      }
      if (
        current.kind === "rect" &&
        ["x", "y", "width", "height", "strokeWidth", "radius"].includes(key)
      ) {
        return { ...current, [key]: value }
      }
      if (current.kind === "circle" && ["x", "y", "size", "strokeWidth"].includes(key)) {
        return { ...current, [key]: value }
      }
      if (
        current.kind === "triangle" &&
        ["x", "y", "width", "height", "strokeWidth"].includes(key)
      ) {
        return { ...current, [key]: value }
      }
      if (current.kind === "line" && ["x", "y", "x2", "y2", "strokeWidth"].includes(key)) {
        return { ...current, [key]: value }
      }
      if (current.kind === "barcode" && ["x", "y", "width", "height"].includes(key)) {
        return { ...current, [key]: value }
      }
      if (current.kind === "qr" && ["x", "y", "size"].includes(key)) {
        return { ...current, [key]: value }
      }
      if (current.kind === "datamatrix" && ["x", "y", "size"].includes(key)) {
        return { ...current, [key]: value }
      }
      return current
    })
  }

  return (
    <Card className="tm-panel">
      <CardHeader className="pb-4">
        <CardTitle as="h3" className="text-base">
          选中元素属性
        </CardTitle>
        <Badge variant="outline">{CANVAS_TOOL_LABELS[element.kind]}</Badge>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="tm-form-grid tm-form-grid--compact">
          <div className="grid gap-2">
            <Label>X</Label>
            <Input
              type="number"
              value={String(element.x)}
              onChange={(event) => setNumeric("x", Number(event.currentTarget.value || 0))}
            />
          </div>
          <div className="grid gap-2">
            <Label>Y</Label>
            <Input
              type="number"
              value={String(element.y)}
              onChange={(event) => setNumeric("y", Number(event.currentTarget.value || 0))}
            />
          </div>
        </div>

        {element.kind === "text" ? (
          <>
            <Textarea
              value={element.value}
              onChange={(event) => {
                const nextValue = event.currentTarget.value
                state.updateCanvasElement(element.id, (current) =>
                  current.kind === "text" ? { ...current, value: nextValue } : current
                )
              }}
            />
            <div className="tm-form-grid tm-form-grid--compact">
              <div className="grid gap-2">
                <Label>宽度</Label>
                <Input
                  type="number"
                  value={String(element.width)}
                  onChange={(event) => setNumeric("width", Number(event.currentTarget.value || 0))}
                />
              </div>
              <div className="grid gap-2">
                <Label>字号</Label>
                <Input
                  type="number"
                  value={String(element.fontSize)}
                  onChange={(event) =>
                    setNumeric("fontSize", Number(event.currentTarget.value || 0))
                  }
                />
              </div>
            </div>
          </>
        ) : null}

        {element.kind === "rect" || element.kind === "triangle" ? (
          <div className="tm-form-grid tm-form-grid--compact">
            <div className="grid gap-2">
              <Label>宽度</Label>
              <Input
                type="number"
                value={String(element.width)}
                onChange={(event) => setNumeric("width", Number(event.currentTarget.value || 0))}
              />
            </div>
            <div className="grid gap-2">
              <Label>高度</Label>
              <Input
                type="number"
                value={String(element.height)}
                onChange={(event) => setNumeric("height", Number(event.currentTarget.value || 0))}
              />
            </div>
          </div>
        ) : null}

        {element.kind === "circle" ? (
          <div className="tm-form-grid tm-form-grid--compact">
            <div className="grid gap-2">
              <Label>边长</Label>
              <Input
                type="number"
                value={String(element.size)}
                onChange={(event) => setNumeric("size", Number(event.currentTarget.value || 0))}
              />
            </div>
          </div>
        ) : null}

        {element.kind === "line" ? (
          <div className="tm-form-grid tm-form-grid--compact">
            <div className="grid gap-2">
              <Label>X2</Label>
              <Input
                type="number"
                value={String(element.x2)}
                onChange={(event) => setNumeric("x2", Number(event.currentTarget.value || 0))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Y2</Label>
              <Input
                type="number"
                value={String(element.y2)}
                onChange={(event) => setNumeric("y2", Number(event.currentTarget.value || 0))}
              />
            </div>
          </div>
        ) : null}

        {element.kind === "barcode" ? (
          <Textarea
            value={element.value}
            onChange={(event) => {
              const nextValue = event.currentTarget.value
              state.updateCanvasElement(element.id, (current) =>
                current.kind === "barcode" ? { ...current, value: nextValue } : current
              )
            }}
          />
        ) : null}

        {element.kind === "qr" ? (
          <Textarea
            value={element.value}
            onChange={(event) => {
              const nextValue = event.currentTarget.value
              state.updateCanvasElement(element.id, (current) =>
                current.kind === "qr" ? { ...current, value: nextValue } : current
              )
            }}
          />
        ) : null}

        {element.kind === "datamatrix" ? (
          <Textarea
            value={element.value}
            onChange={(event) => {
              const nextValue = event.currentTarget.value
              state.updateCanvasElement(element.id, (current) =>
                current.kind === "datamatrix" ? { ...current, value: nextValue } : current
              )
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

function RouteLoadingPanel() {
  return (
    <div className="tm-route-loading" role="status" aria-live="polite" aria-label="正在打开页面">
      <div className="tm-route-loading__line tm-route-loading__line--title" />
      <div className="tm-route-loading__line tm-route-loading__line--body" />
    </div>
  )
}

function DashboardRoute({
  controller,
  onRouteChunkReady,
}: {
  controller: ReturnType<typeof useWorkbenchController>
  onRouteChunkReady: () => void
}) {
  React.useEffect(() => {
    onRouteChunkReady()
  }, [onRouteChunkReady])

  return <DashboardPage controller={controller} />
}

function TemplatesRouteBoundary({
  controller,
  onPresentArchiveToast,
  onRouteChunkReady,
}: {
  controller: ReturnType<typeof useWorkbenchController>
  onPresentArchiveToast: (template: UserTemplateSummary) => void
  onRouteChunkReady: () => void
}) {
  const routeModule = useDeferredWorkbenchRouteModule("/templates")
  if (!routeModule) {
    return <RouteLoadingPanel />
  }

  const TemplatesRoute = routeModule.default as React.ComponentType<{
    controller: ReturnType<typeof useWorkbenchController>
    onPresentArchiveToast?: (template: UserTemplateSummary) => void
    onRouteChunkReady?: () => void
  }>
  return (
    <TemplatesRoute
      controller={controller}
      onPresentArchiveToast={onPresentArchiveToast}
      onRouteChunkReady={onRouteChunkReady}
    />
  )
}

function CanvasRouteBoundary({
  controller,
  initialScenario,
  onRouteChunkReady,
}: {
  controller: ReturnType<typeof useWorkbenchController>
  initialScenario?: CanvasStoryScenario
  onRouteChunkReady: () => void
}) {
  const routeModule = useDeferredWorkbenchRouteModule("/canvas")
  if (!routeModule) {
    return <RouteLoadingPanel />
  }

  const CanvasRoute = routeModule.default as React.ComponentType<{
    controller: ReturnType<typeof useWorkbenchController>
    initialScenario?: CanvasStoryScenario
    onRouteChunkReady?: () => void
  }>
  return (
    <CanvasRoute
      controller={controller}
      initialScenario={initialScenario}
      onRouteChunkReady={onRouteChunkReady}
    />
  )
}

function SystemRouteBoundary({
  controller,
  onRouteChunkReady,
}: {
  controller: ReturnType<typeof useWorkbenchController>
  onRouteChunkReady: () => void
}) {
  const routeModule = useDeferredWorkbenchRouteModule("/system")
  if (!routeModule) {
    return <RouteLoadingPanel />
  }

  const SystemRoute = routeModule.default as React.ComponentType<{
    controller: ReturnType<typeof useWorkbenchController>
    onRouteChunkReady?: () => void
  }>
  return <SystemRoute controller={controller} onRouteChunkReady={onRouteChunkReady} />
}

function LazyWorkbenchRouter({
  controller,
  canvasScenario,
  hydrationState,
  onRouteIntent,
  onPresentArchiveToast,
  onRouteChunkReady,
  pwaUpdateSnapshot,
  archiveToast,
  onUndoArchiveToast,
  shellHidden = false,
}: {
  controller: ReturnType<typeof useWorkbenchController>
  canvasScenario?: CanvasStoryScenario
  hydrationState: WorkbenchHydrationState
  onRouteIntent: (pathname: string) => void
  onPresentArchiveToast: (template: UserTemplateSummary) => void
  onRouteChunkReady: () => void
  pwaUpdateSnapshot?: PwaUpdateSnapshot
  archiveToast: TemplateArchiveToastState | null
  onUndoArchiveToast: () => void | Promise<void>
  shellHidden?: boolean
}) {
  return (
    <Routes>
      <Route
        element={
          <WorkbenchLayout
            controller={controller}
            hydrationState={hydrationState}
            onRouteIntent={onRouteIntent}
            pwaUpdateSnapshot={pwaUpdateSnapshot}
            archiveToast={archiveToast}
            onUndoArchiveToast={onUndoArchiveToast}
            shellHidden={shellHidden}
          />
        }
      >
        <Route
          path="/"
          element={<DashboardRoute controller={controller} onRouteChunkReady={onRouteChunkReady} />}
        />
        <Route
          path="/templates"
          element={
            <TemplatesRouteBoundary
              controller={controller}
              onPresentArchiveToast={onPresentArchiveToast}
              onRouteChunkReady={onRouteChunkReady}
            />
          }
        />
        <Route
          path="/canvas"
          element={
            <CanvasRouteBoundary
              controller={controller}
              initialScenario={canvasScenario}
              onRouteChunkReady={onRouteChunkReady}
            />
          }
        />
        <Route
          path="/system"
          element={
            <SystemRouteBoundary controller={controller} onRouteChunkReady={onRouteChunkReady} />
          }
        />
      </Route>
    </Routes>
  )
}

function EagerWorkbenchRouter({
  controller,
  canvasScenario,
  hydrationState,
  onRouteIntent,
  onPresentArchiveToast,
  onRouteChunkReady,
  pwaUpdateSnapshot,
  archiveToast,
  onUndoArchiveToast,
  shellHidden = false,
}: {
  controller: ReturnType<typeof useWorkbenchController>
  canvasScenario?: CanvasStoryScenario
  hydrationState: WorkbenchHydrationState
  onRouteIntent: (pathname: string) => void
  onPresentArchiveToast: (template: UserTemplateSummary) => void
  onRouteChunkReady: () => void
  pwaUpdateSnapshot?: PwaUpdateSnapshot
  archiveToast: TemplateArchiveToastState | null
  onUndoArchiveToast: () => void | Promise<void>
  shellHidden?: boolean
}) {
  const pageState = useWorkbenchPages(controller)

  return (
    <Routes>
      <Route
        element={
          <WorkbenchLayout
            controller={controller}
            hydrationState={hydrationState}
            onRouteIntent={onRouteIntent}
            pwaUpdateSnapshot={pwaUpdateSnapshot}
            archiveToast={archiveToast}
            onUndoArchiveToast={onUndoArchiveToast}
            shellHidden={shellHidden}
          />
        }
      >
        <Route
          path="/"
          element={<DashboardRoute controller={controller} onRouteChunkReady={onRouteChunkReady} />}
        />
        <Route
          path="/templates"
          element={
            <>
              <RouteReadyEffect onReady={onRouteChunkReady} />
              <TemplatesPage
                controller={controller}
                state={pageState}
                onPresentArchiveToast={onPresentArchiveToast}
              />
            </>
          }
        />
        <Route
          path="/canvas"
          element={
            <>
              <RouteReadyEffect onReady={onRouteChunkReady} />
              <CanvasWorkspace controller={controller} initialScenario={canvasScenario} />
            </>
          }
        />
        <Route
          path="/system"
          element={
            <>
              <RouteReadyEffect onReady={onRouteChunkReady} />
              <SystemPage controller={controller} />
            </>
          }
        />
      </Route>
    </Routes>
  )
}

function RouteReadyEffect({ onReady }: { onReady: () => void }) {
  React.useEffect(() => {
    onReady()
  }, [onReady])

  return null
}

export function WorkbenchApp({
  bootstrapState,
  client,
  context,
  canvasScenario,
  pwaUpdateSnapshot,
  startupShell = "disabled",
  theme = "auto",
}: AppProps) {
  const initialRoutePathRef = React.useRef(
    normalizeWorkbenchRoutePath(typeof window !== "undefined" ? window.location.pathname : "/")
  )
  const initialRoutePath = initialRoutePathRef.current
  const controller = useWorkbenchController({
    client,
    context,
    initialRoutePath,
  })
  const [currentRouteChunkReady, setCurrentRouteChunkReady] = React.useState(
    initialRoutePath === "/" || Boolean(bootstrapState?.currentRouteChunkReady)
  )
  const [archiveToast, setArchiveToast] = React.useState<TemplateArchiveToastState | null>(null)
  const routeWarmupStartedRef = React.useRef(false)
  const offlineWarmupStatus = usePwaAssetWarmup(controller.context, controller.startupSyncReady)

  React.useEffect(() => {
    if (!archiveToast) {
      return
    }
    const timer = window.setTimeout(() => {
      setArchiveToast(null)
    }, ARCHIVE_TOAST_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [archiveToast])

  React.useEffect(() => {
    if (!archiveToast) {
      return
    }
    if (
      !controller.archivedUserTemplates.some((template) => template.id === archiveToast.templateId)
    ) {
      setArchiveToast(null)
    }
  }, [archiveToast, controller.archivedUserTemplates])

  React.useEffect(() => {
    if (initialRoutePath === "/") {
      setCurrentRouteChunkReady(true)
      return
    }
    setCurrentRouteChunkReady(Boolean(bootstrapState?.currentRouteChunkReady))
  }, [bootstrapState?.currentRouteChunkReady, initialRoutePath])

  const hydrationState = React.useMemo<WorkbenchHydrationState>(
    () => ({
      shellReady: currentRouteChunkReady && controller.startupSyncReady,
      currentRouteReady: currentRouteChunkReady && controller.startupSyncReady,
      deferredHydrationPending: controller.deferredHydrationPending,
      offlineWarmupPending: offlineWarmupStatus === "pending",
      offlineWarmupStatus,
    }),
    [
      controller.deferredHydrationPending,
      controller.startupSyncReady,
      currentRouteChunkReady,
      offlineWarmupStatus,
    ]
  )
  const launchSplashState = React.useMemo(
    () =>
      buildStartupSplashState({
        currentRouteChunkReady,
        currentRouteDataReady: controller.startupSyncReady,
        deferredHydrationPending: controller.deferredHydrationPending,
        offlineWarmupStatus,
      }),
    [
      controller.deferredHydrationPending,
      controller.startupSyncReady,
      currentRouteChunkReady,
      offlineWarmupStatus,
    ]
  )
  const handleRouteChunkReady = React.useCallback(() => {
    setCurrentRouteChunkReady(true)
  }, [])
  const handleRouteIntent = React.useCallback((pathname: string) => {
    preloadWorkbenchNavigationIntent(pathname)
  }, [])
  const handlePresentArchiveToast = React.useCallback((template: UserTemplateSummary) => {
    setArchiveToast({
      nonce:
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}`,
      templateId: template.id,
      templateName: template.name,
    })
  }, [])
  const handleUndoArchiveToast = React.useCallback(async () => {
    if (!archiveToast) {
      return
    }
    await controller.restoreArchivedTemplate(archiveToast.templateId)
    setArchiveToast(null)
  }, [archiveToast, controller])

  React.useEffect(() => {
    if (!hydrationState.shellReady || routeWarmupStartedRef.current) {
      return
    }
    routeWarmupStartedRef.current = true
    void preloadDeferredWorkbenchRoutes().catch(() => undefined)
  }, [hydrationState.shellReady])

  const shellHidden = startupShell === "auto" && !hydrationState.shellReady
  const RouterComponent =
    import.meta.env.MODE === "test" ? EagerWorkbenchRouter : LazyWorkbenchRouter

  const router = controller.context.basePath ? (
    <BrowserRouter basename={controller.context.basePath}>
      <RouterComponent
        controller={controller}
        canvasScenario={canvasScenario}
        hydrationState={hydrationState}
        onRouteIntent={handleRouteIntent}
        onPresentArchiveToast={handlePresentArchiveToast}
        onRouteChunkReady={handleRouteChunkReady}
        pwaUpdateSnapshot={pwaUpdateSnapshot}
        archiveToast={archiveToast}
        onUndoArchiveToast={handleUndoArchiveToast}
        shellHidden={shellHidden}
      />
    </BrowserRouter>
  ) : (
    <BrowserRouter>
      <RouterComponent
        controller={controller}
        canvasScenario={canvasScenario}
        hydrationState={hydrationState}
        onRouteIntent={handleRouteIntent}
        onPresentArchiveToast={handlePresentArchiveToast}
        onRouteChunkReady={handleRouteChunkReady}
        pwaUpdateSnapshot={pwaUpdateSnapshot}
        archiveToast={archiveToast}
        onUndoArchiveToast={handleUndoArchiveToast}
        shellHidden={shellHidden}
      />
    </BrowserRouter>
  )

  return (
    <ThemeScope theme={theme}>
      {router}
      {shellHidden ? (
        <div className="tm-startup-overlay">
          <AppLaunchSplash
            detailText={launchSplashState.detailText}
            statusText={launchSplashState.statusText}
            theme={theme}
          />
        </div>
      ) : null}
    </ThemeScope>
  )
}

export function WorkbenchAppStory({
  client,
  context,
  canvasScenario,
  bootstrapState,
  pwaUpdateSnapshot,
  theme = "auto",
  initialEntries = ["/"],
  hydrationStateOverride,
  storyStateOverrides,
}: AppProps & {
  initialEntries?: string[]
  hydrationStateOverride?: Partial<WorkbenchHydrationState>
  storyStateOverrides?: WorkbenchStoryStateOverrides
}) {
  const initialRoutePath = normalizeWorkbenchRoutePath(initialEntries[0] ?? "/")
  const controller = useWorkbenchController({
    client,
    context,
    initialRoutePath,
    storyStateOverrides,
  })
  const hydrationState: WorkbenchHydrationState = {
    shellReady: true,
    currentRouteReady: true,
    deferredHydrationPending: controller.deferredHydrationPending,
    offlineWarmupPending: false,
    offlineWarmupStatus: "complete",
    ...hydrationStateOverride,
  }
  return (
    <ThemeScope theme={theme}>
      <MemoryRouter initialEntries={initialEntries}>
        <LazyWorkbenchRouter
          controller={controller}
          canvasScenario={canvasScenario}
          hydrationState={hydrationState}
          onRouteIntent={() => undefined}
          onPresentArchiveToast={() => undefined}
          onRouteChunkReady={() => {
            void bootstrapState
          }}
          pwaUpdateSnapshot={pwaUpdateSnapshot}
          archiveToast={null}
          onUndoArchiveToast={() => undefined}
        />
      </MemoryRouter>
    </ThemeScope>
  )
}
