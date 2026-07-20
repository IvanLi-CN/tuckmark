import type { BrowserPrinterSession } from "./browser-printer.js"
import type {
  DocumentRenderOptions,
  PaperType,
  Printer,
  PrinterDeviceCalibration,
  PrinterModelPreset,
  PrintStrengthLevel,
  RenderOptions,
} from "./types.js"

export const DEFAULT_PRINTER_DPI = 203
export const DEFAULT_PRINTER_MODEL = "generic"
export const LEGACY_MODEL_PRESET_KEY = "__legacy_model__"
export const LEGACY_DEVICE_CALIBRATION_KEY = "__legacy_device__"
export const OFFSET_RANGE_MM = 5
export const OFFSET_SNAP_MM = 0.25
export const P2_MODEL_PRESET: PrinterModelPreset = {
  printerDpi: 203,
  printWidthDots: 384,
}

export const defaultDocumentRenderOptions: DocumentRenderOptions = {
  paperType: "continuous",
  threshold: 150,
}

export const defaultPrinterDeviceCalibration: PrinterDeviceCalibration = {
  xOffsetMm: 0,
  yOffsetMm: 0,
  printStrengthLevel: 0,
}

export const defaultResolvedRenderOptions: RenderOptions = {
  printerModel: DEFAULT_PRINTER_MODEL,
  printerDpi: DEFAULT_PRINTER_DPI,
  printWidthDots: P2_MODEL_PRESET.printWidthDots,
  ...defaultDocumentRenderOptions,
  xOffsetDots: 0,
  yOffsetDots: 0,
  printStrengthLevel: 0,
}

export type ResolvedPrinterIdentity = {
  printerModel: string
  printerDisplayName: string
  deviceDisplayName: string
  deviceKey: string | null
  capabilityPrintWidthDots: number
  capabilityDpi: number
}

export type ResolvedOutputSettings = {
  renderOptions: RenderOptions
  printerIdentity: ResolvedPrinterIdentity
  appliedModelPreset: PrinterModelPreset
  recommendedModelPreset: PrinterModelPreset
  appliedDeviceCalibration: PrinterDeviceCalibration
}

function normalizePaperType(value: unknown): PaperType {
  return value === "gap" ? "gap" : "continuous"
}

export function normalizeThreshold(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return defaultDocumentRenderOptions.threshold
  }
  return Math.max(0, Math.min(255, Math.round(numeric)))
}

export function normalizePositiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback
  }
  return Math.round(numeric)
}

export function normalizePrintStrengthLevel(value: unknown): PrintStrengthLevel {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return 0
  }
  return Math.max(-2, Math.min(2, Math.round(numeric))) as PrintStrengthLevel
}

export function snapOffsetMillimeters(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return 0
  }
  const snapped = Math.round(numeric / OFFSET_SNAP_MM) * OFFSET_SNAP_MM
  const clamped = Math.max(-OFFSET_RANGE_MM, Math.min(OFFSET_RANGE_MM, snapped))
  return Number(clamped.toFixed(2))
}

export function millimetersToDotsAtDpi(millimeters: number, dpi: number): number {
  return Math.round((millimeters * dpi) / 25.4)
}

export function dotsToMillimetersAtDpi(dots: number, dpi: number): number {
  return Number(((dots * 25.4) / dpi).toFixed(2))
}

export function pickDocumentRenderOptions(
  value: Partial<RenderOptions> | Partial<DocumentRenderOptions> | null | undefined
): DocumentRenderOptions {
  return {
    paperType: normalizePaperType(value?.paperType),
    threshold: normalizeThreshold(value?.threshold),
  }
}

export function parsePrinterModelFromName(name: string | null | undefined): string {
  const normalized = name?.trim()
  if (!normalized) {
    return DEFAULT_PRINTER_MODEL
  }
  const [prefix] = normalized.split("-")
  return prefix?.trim() || normalized
}

export function buildRecommendedModelPreset(
  printerModel: string,
  capability?: { dpi?: number; printWidthDots?: number }
): PrinterModelPreset {
  if (printerModel === "P2") {
    return { ...P2_MODEL_PRESET }
  }
  return {
    printerDpi: normalizePositiveInteger(capability?.dpi, DEFAULT_PRINTER_DPI),
    printWidthDots: normalizePositiveInteger(
      capability?.printWidthDots,
      P2_MODEL_PRESET.printWidthDots
    ),
  }
}

export function clampModelPresetToCapability(
  preset: PrinterModelPreset,
  capabilityPrintWidthDots: number
): PrinterModelPreset {
  return {
    printerDpi: normalizePositiveInteger(preset.printerDpi, DEFAULT_PRINTER_DPI),
    printWidthDots: Math.min(
      normalizePositiveInteger(preset.printWidthDots, capabilityPrintWidthDots),
      capabilityPrintWidthDots
    ),
  }
}

function normalizeDeviceCalibration(
  value: Partial<PrinterDeviceCalibration> | null | undefined
): PrinterDeviceCalibration {
  return {
    xOffsetMm: snapOffsetMillimeters(value?.xOffsetMm),
    yOffsetMm: snapOffsetMillimeters(value?.yOffsetMm),
    printStrengthLevel: normalizePrintStrengthLevel(value?.printStrengthLevel),
  }
}

function normalizeModelPreset(
  value: Partial<PrinterModelPreset> | null | undefined,
  fallback: PrinterModelPreset
): PrinterModelPreset {
  return {
    printerDpi: normalizePositiveInteger(value?.printerDpi, fallback.printerDpi),
    printWidthDots: normalizePositiveInteger(value?.printWidthDots, fallback.printWidthDots),
  }
}

export function resolvePrinterIdentity(args: {
  selectedPrinter: Printer | null
  browserPrinter: BrowserPrinterSession | null
}): ResolvedPrinterIdentity {
  const selectedPrinter = args.selectedPrinter
  const browserPrinter = args.browserPrinter
  const selectedName = selectedPrinter?.name
  const browserName = browserPrinter?.name
  const explicitModel = selectedPrinter?.model?.trim()
  const printerModel =
    explicitModel && explicitModel.length > 0
      ? explicitModel
      : parsePrinterModelFromName(selectedName ?? browserName)
  const deviceDisplayName = selectedName ?? browserName ?? "未选择输出设备"
  const capabilityPrintWidthDots = normalizePositiveInteger(
    selectedPrinter?.capabilities.printWidthDots,
    P2_MODEL_PRESET.printWidthDots
  )
  const capabilityDpi = normalizePositiveInteger(
    selectedPrinter?.capabilities.dpi,
    selectedPrinter?.model === "P2" ? P2_MODEL_PRESET.printerDpi : DEFAULT_PRINTER_DPI
  )
  const deviceKey =
    selectedPrinter?.id ?? browserPrinter?.deviceId ?? selectedName ?? browserName ?? null

  return {
    printerModel,
    printerDisplayName: printerModel,
    deviceDisplayName,
    deviceKey,
    capabilityPrintWidthDots,
    capabilityDpi,
  }
}

export function resolveOutputSettings(args: {
  documentDefaults: DocumentRenderOptions
  draftRenderOptions?: Partial<DocumentRenderOptions> | null
  printerModelPresets: Record<string, PrinterModelPreset>
  printerDeviceCalibrations: Record<string, PrinterDeviceCalibration>
  selectedPrinter: Printer | null
  browserPrinter: BrowserPrinterSession | null
}): ResolvedOutputSettings {
  const printerIdentity = resolvePrinterIdentity({
    selectedPrinter: args.selectedPrinter,
    browserPrinter: args.browserPrinter,
  })
  const recommendedModelPreset = buildRecommendedModelPreset(printerIdentity.printerModel, {
    dpi: printerIdentity.capabilityDpi,
    printWidthDots: printerIdentity.capabilityPrintWidthDots,
  })
  const modelPresetCandidate =
    args.printerModelPresets[printerIdentity.printerModel] ??
    args.printerModelPresets[LEGACY_MODEL_PRESET_KEY] ??
    recommendedModelPreset
  const appliedModelPreset = clampModelPresetToCapability(
    normalizeModelPreset(modelPresetCandidate, recommendedModelPreset),
    printerIdentity.capabilityPrintWidthDots
  )
  const deviceCalibrationCandidate =
    (printerIdentity.deviceKey
      ? args.printerDeviceCalibrations[printerIdentity.deviceKey]
      : undefined) ?? args.printerDeviceCalibrations[LEGACY_DEVICE_CALIBRATION_KEY]
  const appliedDeviceCalibration = normalizeDeviceCalibration(deviceCalibrationCandidate)
  const documentRenderOptions = {
    ...defaultDocumentRenderOptions,
    ...pickDocumentRenderOptions(args.documentDefaults),
    ...pickDocumentRenderOptions(args.draftRenderOptions),
  }

  return {
    printerIdentity,
    appliedModelPreset,
    recommendedModelPreset,
    appliedDeviceCalibration,
    renderOptions: {
      printerModel: printerIdentity.printerModel,
      printerDpi: appliedModelPreset.printerDpi,
      printWidthDots: appliedModelPreset.printWidthDots,
      paperType: documentRenderOptions.paperType,
      threshold: documentRenderOptions.threshold,
      xOffsetDots: millimetersToDotsAtDpi(
        appliedDeviceCalibration.xOffsetMm,
        appliedModelPreset.printerDpi
      ),
      yOffsetDots: millimetersToDotsAtDpi(
        appliedDeviceCalibration.yOffsetMm,
        appliedModelPreset.printerDpi
      ),
      printStrengthLevel: appliedDeviceCalibration.printStrengthLevel,
    },
  }
}
