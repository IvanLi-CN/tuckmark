import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Eye,
  MoreHorizontal,
  Printer,
  RotateCcw,
  SquarePen,
  Trash2,
  Type,
} from "lucide-react"
import React from "react"
import { createPortal } from "react-dom"
import {
  buildSvg,
  DEFAULT_TEXT_FONT_FAMILY,
  getTemplateById,
  resolveTextLayout,
} from "../../../packages/core/src/web.js"

import type { BrowserPrintSource } from "./browser-print-payload.js"
import {
  buildTemplateFieldsFromDraft,
  compileDraftToFilledCanvasDefinition,
  createDraftFromSystemTemplate,
  getElementSelectionBounds,
} from "./canvas-editor-model.js"
import { ActionButton } from "./components/ui/action-button.js"
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js"
import { Badge } from "./components/ui/badge.js"
import { Button } from "./components/ui/button.js"
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card.js"
import { Input } from "./components/ui/input.js"
import { Label } from "./components/ui/label.js"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select.js"
import { buildInputFromTemplate } from "./demo-data.js"
import { formatCanvasDimension } from "./lib/canvas-dimensions.js"
import { canvasDotsToMillimeters, canvasMillimetersToDots } from "./lib/canvas-units.js"
import { cn } from "./lib/utils.js"
import type {
  CanvasDraftDocument,
  CanvasDraftElement,
  RenderOptions,
  Template,
  TemplateField,
  UserTemplateSummary,
} from "./types.js"
import type { WorkbenchController } from "./workbench-controller.js"

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

type TemplateListMode = "large" | "list"
type TemplateActionKind = "edit" | "rename" | "archive"
type TemplateActionMenuState = {
  entry: TemplateCardEntry
  x: number
  y: number
}

export const WIDE_TRIPLE_THRESHOLD = 1280
export const TEMPLATE_STACKED_PREVIEW_THRESHOLD = 960
export const TEMPLATE_PREVIEW_DEBOUNCE_MS = 320

const TEMPLATE_INDEX_COLUMN_WIDTH = 44
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

function toSingleLineFieldValue(value: string) {
  return value
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
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

export function ArchivedTemplateManagementCard({
  controller,
}: {
  controller: WorkbenchController
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
  controller: WorkbenchController
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
  controller: WorkbenchController
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
  controller: WorkbenchController
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
