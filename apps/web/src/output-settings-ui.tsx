import React from "react"

import { Badge } from "./components/ui/badge.js"
import { Button } from "./components/ui/button.js"
import { Input } from "./components/ui/input.js"
import { Label } from "./components/ui/label.js"
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
import {
  dotsToMillimetersAtDpi,
  millimetersToDotsAtDpi,
  OFFSET_RANGE_MM,
  resolvePositionedPrintFrame,
  snapOffsetMillimeters,
} from "./output-settings.js"
import type {
  PaperType,
  PrinterDeviceCalibration,
  PrinterModelPreset,
  RenderOptions,
} from "./types.js"

const PRINT_STRENGTH_OPTIONS = [-2, -1, 0, 1, 2] as const
const OFFSET_HANDLE_RADIUS_PX = 7

function formatStrengthLabel(value: number): string {
  if (value > 0) {
    return `+${value}`
  }
  return String(value)
}

function normalizePresetDraft(preset: PrinterModelPreset) {
  return {
    printerDpi: String(preset.printerDpi),
    printWidthDots: String(preset.printWidthDots),
    printWidthMillimeters: dotsToMillimetersAtDpi(preset.printWidthDots, preset.printerDpi).toFixed(
      2
    ),
  }
}

function parsePositiveInt(value: string, fallback: number): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback
  }
  return Math.round(numeric)
}

function parseMillimeters(value: string, fallback: number): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback
  }
  return Number(numeric.toFixed(2))
}

function formatOffsetSummary(calibration: PrinterDeviceCalibration): string {
  return `X ${calibration.xOffsetMm.toFixed(2)} mm · Y ${calibration.yOffsetMm.toFixed(2)} mm`
}

function OffsetPad({
  calibration,
  disabled,
  onChange,
}: {
  calibration: PrinterDeviceCalibration
  disabled?: boolean
  onChange: (next: React.SetStateAction<PrinterDeviceCalibration>) => void
}) {
  const padRef = React.useRef<HTMLDivElement>(null)

  const updateFromPoint = React.useCallback(
    (clientX: number, clientY: number) => {
      const rect = padRef.current?.getBoundingClientRect()
      if (!rect) {
        return
      }
      const relativeX = (clientX - rect.left) / rect.width
      const relativeY = (clientY - rect.top) / rect.height
      const xOffsetMm = snapOffsetMillimeters((relativeX * 2 - 1) * OFFSET_RANGE_MM)
      const yOffsetMm = snapOffsetMillimeters((relativeY * 2 - 1) * OFFSET_RANGE_MM)
      onChange((current) => ({
        ...current,
        xOffsetMm,
        yOffsetMm,
      }))
    },
    [onChange]
  )

  return (
    <div className="grid gap-2">
      <div
        ref={padRef}
        className="relative aspect-[3/1] w-full overflow-hidden rounded-[1.1rem] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,243,236,0.96))] shadow-inner"
        onPointerDown={(event) => {
          if (disabled) {
            return
          }
          event.preventDefault()
          updateFromPoint(event.clientX, event.clientY)
          const handleMove = (moveEvent: PointerEvent) => {
            updateFromPoint(moveEvent.clientX, moveEvent.clientY)
          }
          const handleUp = () => {
            window.removeEventListener("pointermove", handleMove)
            window.removeEventListener("pointerup", handleUp)
          }
          window.addEventListener("pointermove", handleMove)
          window.addEventListener("pointerup", handleUp, { once: true })
        }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(120,93,62,0.08)_1px,transparent_1px),linear-gradient(180deg,rgba(120,93,62,0.08)_1px,transparent_1px)] bg-[size:16px_16px]" />
        <div className="pointer-events-none absolute inset-x-3 top-1/2 border-t border-dashed border-border/80" />
        <div className="pointer-events-none absolute inset-y-3 left-1/2 border-l border-dashed border-border/80" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(196,138,91,0.14),transparent_60%)]" />
        <div
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/80 bg-primary shadow-[0_0_0_4px_rgba(196,138,91,0.18)]"
          style={{
            left: `clamp(${OFFSET_HANDLE_RADIUS_PX}px, ${((calibration.xOffsetMm / OFFSET_RANGE_MM + 1) / 2) * 100}%, calc(100% - ${OFFSET_HANDLE_RADIUS_PX}px))`,
            top: `clamp(${OFFSET_HANDLE_RADIUS_PX}px, ${((calibration.yOffsetMm / OFFSET_RANGE_MM + 1) / 2) * 100}%, calc(100% - ${OFFSET_HANDLE_RADIUS_PX}px))`,
          }}
        />
        <div className="pointer-events-none absolute left-3 top-2.5 text-[10px] font-medium text-muted-foreground">
          Y-
        </div>
        <div className="pointer-events-none absolute bottom-2.5 left-3 text-[10px] font-medium text-muted-foreground">
          Y+
        </div>
        <div className="pointer-events-none absolute right-3 top-2.5 text-[10px] font-medium text-muted-foreground">
          X+
        </div>
        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-muted-foreground">
          X-
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label htmlFor="print-offset-x" className="text-xs text-muted-foreground">
            X 偏移 (mm)
          </Label>
          <Input
            id="print-offset-x"
            type="number"
            size="sm"
            step="0.25"
            min={-OFFSET_RANGE_MM}
            max={OFFSET_RANGE_MM}
            value={calibration.xOffsetMm.toFixed(2)}
            disabled={disabled}
            onChange={(event) => {
              const next = snapOffsetMillimeters(event.currentTarget.value)
              onChange((current) => ({ ...current, xOffsetMm: next }))
            }}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="print-offset-y" className="text-xs text-muted-foreground">
            Y 偏移 (mm)
          </Label>
          <Input
            id="print-offset-y"
            type="number"
            size="sm"
            step="0.25"
            min={-OFFSET_RANGE_MM}
            max={OFFSET_RANGE_MM}
            value={calibration.yOffsetMm.toFixed(2)}
            disabled={disabled}
            onChange={(event) => {
              const next = snapOffsetMillimeters(event.currentTarget.value)
              onChange((current) => ({ ...current, yOffsetMm: next }))
            }}
          />
        </div>
      </div>
    </div>
  )
}

function AdvancedSettingsSheet({
  disabled,
  printerModel,
  capabilityPrintWidthDots,
  appliedPreset,
  recommendedPreset,
  onSave,
}: {
  disabled?: boolean
  printerModel: string
  capabilityPrintWidthDots: number
  appliedPreset: PrinterModelPreset
  recommendedPreset: PrinterModelPreset
  onSave: (preset: PrinterModelPreset) => Promise<unknown> | unknown
}) {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState(() => normalizePresetDraft(appliedPreset))
  const [saveError, setSaveError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      return
    }
    setDraft(normalizePresetDraft(appliedPreset))
    setSaveError(null)
  }, [appliedPreset, open])

  const draftPrinterDpi = parsePositiveInt(draft.printerDpi, appliedPreset.printerDpi)
  const draftPrintWidthDots = parsePositiveInt(draft.printWidthDots, appliedPreset.printWidthDots)
  const draftWidthMillimeters = parseMillimeters(
    draft.printWidthMillimeters,
    dotsToMillimetersAtDpi(draftPrintWidthDots, draftPrinterDpi)
  )

  const syncDraft = React.useCallback((preset: PrinterModelPreset) => {
    setDraft(normalizePresetDraft(preset))
    setSaveError(null)
  }, [])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-lg"
          disabled={disabled}
        >
          高级设置
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-[26rem]">
        <SheetHeader className="border-b border-border/70 px-6 pb-4">
          <SheetTitle>{printerModel} 高级设置</SheetTitle>
          <SheetDescription>型号级参数。只有点击保存后才会应用到后续预览和打印。</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[1.25rem] border border-border/70 bg-muted/20 px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  型号
                </div>
                <div className="mt-2 text-sm font-semibold text-foreground">{printerModel}</div>
              </div>
              <div className="rounded-[1.25rem] border border-border/70 bg-muted/20 px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  当前上限
                </div>
                <div className="mt-2 text-sm font-semibold text-foreground">
                  {capabilityPrintWidthDots} dots
                </div>
              </div>
            </div>

            <div className="grid gap-4 rounded-[1.5rem] border border-border/70 bg-background/80 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="advanced-printer-dpi">像素密度 (DPI)</Label>
                  <Input
                    id="advanced-printer-dpi"
                    type="number"
                    min={1}
                    step={1}
                    value={draft.printerDpi}
                    onChange={(event) => {
                      const nextDpi = parsePositiveInt(event.currentTarget.value, draftPrinterDpi)
                      setDraft((current) => ({
                        ...current,
                        printerDpi: event.currentTarget.value,
                        printWidthMillimeters: dotsToMillimetersAtDpi(
                          parsePositiveInt(current.printWidthDots, draftPrintWidthDots),
                          nextDpi
                        ).toFixed(2),
                      }))
                    }}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="advanced-print-width-dots">打印宽度 (dots)</Label>
                  <Input
                    id="advanced-print-width-dots"
                    type="number"
                    min={1}
                    step={1}
                    value={draft.printWidthDots}
                    onChange={(event) => {
                      const nextDots = parsePositiveInt(
                        event.currentTarget.value,
                        draftPrintWidthDots
                      )
                      setDraft((current) => ({
                        ...current,
                        printWidthDots: event.currentTarget.value,
                        printWidthMillimeters: dotsToMillimetersAtDpi(
                          nextDots,
                          parsePositiveInt(current.printerDpi, draftPrinterDpi)
                        ).toFixed(2),
                      }))
                    }}
                  />
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="advanced-print-width-mm">打印宽度 (mm)</Label>
                <Input
                  id="advanced-print-width-mm"
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={draft.printWidthMillimeters}
                  onChange={(event) => {
                    const nextMillimeters = parseMillimeters(
                      event.currentTarget.value,
                      draftWidthMillimeters
                    )
                    const nextDpi = parsePositiveInt(draft.printerDpi, draftPrinterDpi)
                    setDraft((current) => ({
                      ...current,
                      printWidthMillimeters: event.currentTarget.value,
                      printWidthDots: String(millimetersToDotsAtDpi(nextMillimeters, nextDpi)),
                    }))
                  }}
                />
              </div>

              <p className="text-xs leading-5 text-muted-foreground">
                宽度保存不能超过 {capabilityPrintWidthDots}{" "}
                dots；实际生效取型号值与设备能力的较小者。
              </p>
            </div>

            {saveError ? (
              <div className="rounded-[1.25rem] border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {saveError}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-6 py-4">
          <Button type="button" variant="ghost" onClick={() => syncDraft(recommendedPreset)}>
            重置
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false)
                setSaveError(null)
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={async () => {
                const normalizedPreset: PrinterModelPreset = {
                  printerDpi: draftPrinterDpi,
                  printWidthDots: draftPrintWidthDots,
                }
                if (normalizedPreset.printWidthDots > capabilityPrintWidthDots) {
                  setSaveError(`打印宽度不能超过当前设备能力 ${capabilityPrintWidthDots} dots。`)
                  return
                }
                await onSave(normalizedPreset)
                setOpen(false)
              }}
            >
              保存
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function OutputSettingsControls({
  disabled,
  paperType,
  onPaperTypeChange,
  deviceCalibration,
  onDeviceCalibrationChange,
  printerIdentity,
  appliedModelPreset,
  recommendedModelPreset,
  onSaveModelPreset,
}: {
  disabled?: boolean
  paperType: PaperType
  onPaperTypeChange: (next: PaperType) => void
  deviceCalibration: PrinterDeviceCalibration
  onDeviceCalibrationChange: (next: React.SetStateAction<PrinterDeviceCalibration>) => void
  printerIdentity: {
    printerModel: string
    deviceDisplayName: string
    deviceKey: string | null
    capabilityPrintWidthDots: number
  }
  appliedModelPreset: PrinterModelPreset
  recommendedModelPreset: PrinterModelPreset
  onSaveModelPreset: (preset: PrinterModelPreset) => Promise<unknown> | unknown
}) {
  const calibrationDisabled = disabled || printerIdentity.deviceKey === null

  return (
    <div className="grid gap-3">
      <section className="rounded-[1.25rem] border border-border/70 bg-background/80 p-3.5 shadow-sm">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex flex-1 flex-wrap items-center gap-2.5">
              <span className="flex min-h-8 max-w-full items-center truncate text-sm font-semibold text-foreground">
                {printerIdentity.deviceDisplayName}
              </span>
              <Badge variant="outline" className="tm-chip h-8 shrink-0 px-3">
                {printerIdentity.printerModel}
              </Badge>
            </div>
            <div className="shrink-0 self-center">
              <AdvancedSettingsSheet
                disabled={disabled}
                printerModel={printerIdentity.printerModel}
                capabilityPrintWidthDots={printerIdentity.capabilityPrintWidthDots}
                appliedPreset={appliedModelPreset}
                recommendedPreset={recommendedModelPreset}
                onSave={onSaveModelPreset}
              />
            </div>
          </div>
          <div className="grid gap-2.5 border-t border-border/60 pt-3">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
              <Label htmlFor="paper-type" className="text-xs text-muted-foreground">
                纸张类型
              </Label>
              <Select value={paperType} disabled={disabled} onValueChange={onPaperTypeChange}>
                <SelectTrigger id="paper-type" disabled={disabled} className="h-9 rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="continuous">连续纸</SelectItem>
                  <SelectItem value="gap">间隙纸</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">打印强度</Label>
                <span className="text-[11px] text-muted-foreground">
                  {printerIdentity.deviceKey ? "仅影响实打" : "选择设备后可调"}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {PRINT_STRENGTH_OPTIONS.map((level) => (
                  <Button
                    key={level}
                    type="button"
                    size="sm"
                    variant={deviceCalibration.printStrengthLevel === level ? "default" : "outline"}
                    disabled={calibrationDisabled}
                    className="rounded-lg px-0"
                    onClick={() =>
                      onDeviceCalibrationChange((current) => ({
                        ...current,
                        printStrengthLevel: level,
                      }))
                    }
                  >
                    {formatStrengthLabel(level)}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[1.25rem] border border-border/70 bg-background/80 p-3 shadow-sm">
        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <Label>二维偏移</Label>
              <span className="text-[11px] text-muted-foreground">
                {formatOffsetSummary(deviceCalibration)}
              </span>
            </div>
          </div>
          <OffsetPad
            calibration={deviceCalibration}
            disabled={calibrationDisabled}
            onChange={onDeviceCalibrationChange}
          />
        </div>
      </section>
    </div>
  )
}

export function PositionedPreview({
  previewUrl,
  artifactWidth,
  artifactHeight,
  renderOptions,
  emptyText,
}: {
  previewUrl: string | null
  artifactWidth: number | null | undefined
  artifactHeight: number | null | undefined
  renderOptions: RenderOptions
  emptyText: string
}) {
  if (!previewUrl || !artifactWidth || !artifactHeight) {
    return (
      <div className="tm-empty-state">
        <p className="tm-empty-state__title">还没有预览</p>
        <p className="tm-empty-state__body">{emptyText}</p>
      </div>
    )
  }

  const placement = resolvePositionedPrintFrame(renderOptions, artifactWidth, artifactHeight)
  const frameWidth = placement.frameWidthDots
  const frameHeight = placement.frameHeightDots
  const frameWidthMillimeters = dotsToMillimetersAtDpi(frameWidth, renderOptions.printerDpi)
  const xOffsetMillimeters = dotsToMillimetersAtDpi(
    renderOptions.xOffsetDots,
    renderOptions.printerDpi
  )
  const yOffsetMillimeters = dotsToMillimetersAtDpi(
    renderOptions.yOffsetDots,
    renderOptions.printerDpi
  )

  return (
    <div className="tm-preview-shell">
      <div className="grid w-full gap-2">
        <div
          className="relative mx-auto w-full max-w-[24rem] overflow-hidden rounded-[20px] border border-border/70 bg-white shadow-sm"
          style={{ aspectRatio: `${frameWidth} / ${frameHeight}` }}
        >
          <div className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-dashed border-stone-300" />
          <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-stone-300" />
          <img
            alt="preview artifact"
            className="absolute max-w-none"
            src={previewUrl}
            style={{
              width: `${(artifactWidth / frameWidth) * 100}%`,
              height: `${(artifactHeight / frameHeight) * 100}%`,
              left: `${(placement.contentLeftDots / frameWidth) * 100}%`,
              top: `${(placement.contentTopDots / frameHeight) * 100}%`,
            }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>有效打印宽度 {frameWidthMillimeters.toFixed(2)} mm</span>
          <span>
            X {xOffsetMillimeters.toFixed(2)} mm · Y {yOffsetMillimeters.toFixed(2)} mm
          </span>
        </div>
      </div>
    </div>
  )
}
