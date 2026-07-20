import {
  DEFAULT_PRINTER_DPI,
  defaultDocumentRenderOptions,
  dotsToMillimetersAtDpi,
  LEGACY_DEVICE_CALIBRATION_KEY,
  LEGACY_MODEL_PRESET_KEY,
  normalizePositiveInteger,
  normalizePrintStrengthLevel,
  pickDocumentRenderOptions,
  snapOffsetMillimeters,
} from "./output-settings.js"
import type {
  LegacyRuntimeStoreAppSettings,
  RuntimeStoreAppSettings,
} from "./runtime-store-contract.js"
import type { PrinterDeviceCalibration, PrinterModelPreset } from "./types.js"

const EMPTY_UPDATED_AT = "1970-01-01T00:00:00.000Z"
const RUNTIME_APP_SETTINGS_VERSION = 2

function getStoredSettingsVersion(
  value: Partial<RuntimeStoreAppSettings> | null | undefined
): number {
  return typeof value?.version === "number" && Number.isFinite(value.version) ? value.version : 0
}

export function createDefaultRuntimeAppSettings(): RuntimeStoreAppSettings {
  return {
    version: RUNTIME_APP_SETTINGS_VERSION,
    updatedAt: EMPTY_UPDATED_AT,
    documentDefaults: { ...defaultDocumentRenderOptions },
    printerModelPresets: {},
    printerDeviceCalibrations: {},
    permissionNudgeSeen: false,
    showTextBoundingBoxes: false,
  }
}

function normalizePrinterModelPresets(
  value: Record<string, Partial<PrinterModelPreset>> | null | undefined
): Record<string, PrinterModelPreset> {
  if (!value) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key.trim().length > 0)
      .map(([key, preset]) => [
        key,
        {
          printerDpi: normalizePositiveInteger(preset?.printerDpi, DEFAULT_PRINTER_DPI),
          printWidthDots: normalizePositiveInteger(preset?.printWidthDots, 384),
        },
      ])
  )
}

function normalizePrinterDeviceCalibrations(
  value: Record<string, Partial<PrinterDeviceCalibration>> | null | undefined
): Record<string, PrinterDeviceCalibration> {
  if (!value) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key.trim().length > 0)
      .map(([key, calibration]) => [
        key,
        {
          xOffsetMm: snapOffsetMillimeters(calibration?.xOffsetMm),
          yOffsetMm: snapOffsetMillimeters(calibration?.yOffsetMm),
          printStrengthLevel: normalizePrintStrengthLevel(calibration?.printStrengthLevel),
        },
      ])
  )
}

export function normalizeRuntimeAppSettings(
  value:
    | Partial<RuntimeStoreAppSettings>
    | Partial<LegacyRuntimeStoreAppSettings>
    | null
    | undefined
): RuntimeStoreAppSettings {
  const defaults = createDefaultRuntimeAppSettings()
  const storedVersion = getStoredSettingsVersion(value)
  const legacyValue =
    value && "defaultRenderOptions" in value
      ? (value as Partial<LegacyRuntimeStoreAppSettings>)
      : undefined
  const currentValue =
    value && "documentDefaults" in value ? (value as Partial<RuntimeStoreAppSettings>) : undefined
  const legacyRenderOptions = legacyValue?.defaultRenderOptions
  const legacyPrinterDpi = normalizePositiveInteger(
    legacyRenderOptions?.printerDpi,
    DEFAULT_PRINTER_DPI
  )
  const legacyPrinterWidth = normalizePositiveInteger(legacyRenderOptions?.printWidthDots, 384)
  const legacyXOffsetMm = dotsToMillimetersAtDpi(
    Number(legacyRenderOptions?.xOffsetDots ?? 0),
    legacyPrinterDpi
  )
  return {
    version: RUNTIME_APP_SETTINGS_VERSION,
    updatedAt:
      typeof value?.updatedAt === "string" && value.updatedAt.length > 0
        ? value.updatedAt
        : defaults.updatedAt,
    documentDefaults: {
      ...defaults.documentDefaults,
      ...pickDocumentRenderOptions(legacyRenderOptions),
      ...pickDocumentRenderOptions(currentValue?.documentDefaults),
    },
    printerModelPresets: {
      ...(legacyRenderOptions
        ? {
            [LEGACY_MODEL_PRESET_KEY]: {
              printerDpi: legacyPrinterDpi,
              printWidthDots: legacyPrinterWidth,
            },
          }
        : {}),
      ...normalizePrinterModelPresets(currentValue?.printerModelPresets),
    },
    printerDeviceCalibrations: {
      ...(legacyRenderOptions
        ? {
            [LEGACY_DEVICE_CALIBRATION_KEY]: {
              xOffsetMm: snapOffsetMillimeters(legacyXOffsetMm),
              yOffsetMm: 0,
              printStrengthLevel: normalizePrintStrengthLevel(
                legacyRenderOptions?.printStrengthLevel
              ),
            },
          }
        : {}),
      ...normalizePrinterDeviceCalibrations(currentValue?.printerDeviceCalibrations),
    },
    permissionNudgeSeen:
      typeof value?.permissionNudgeSeen === "boolean"
        ? value.permissionNudgeSeen
        : defaults.permissionNudgeSeen,
    showTextBoundingBoxes:
      storedVersion >= RUNTIME_APP_SETTINGS_VERSION &&
      typeof currentValue?.showTextBoundingBoxes === "boolean"
        ? currentValue.showTextBoundingBoxes
        : defaults.showTextBoundingBoxes,
  }
}

export function requiresRuntimeAppSettingsMigration(
  value: Partial<RuntimeStoreAppSettings> | null | undefined
): boolean {
  return getStoredSettingsVersion(value) < RUNTIME_APP_SETTINGS_VERSION
}

export function withUpdatedRuntimeAppSettings(
  current: RuntimeStoreAppSettings,
  next: Partial<Omit<RuntimeStoreAppSettings, "version" | "updatedAt">>
): RuntimeStoreAppSettings {
  return normalizeRuntimeAppSettings({
    ...current,
    ...next,
    updatedAt: new Date().toISOString(),
  })
}
