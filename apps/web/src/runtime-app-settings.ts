import { defaultRenderOptions } from "./demo-data.js"
import type { RuntimeStoreAppSettings } from "./runtime-store-contract.js"

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
    defaultRenderOptions: { ...defaultRenderOptions },
    permissionNudgeSeen: false,
    showTextBoundingBoxes: false,
  }
}

export function normalizeRuntimeAppSettings(
  value: Partial<RuntimeStoreAppSettings> | null | undefined
): RuntimeStoreAppSettings {
  const defaults = createDefaultRuntimeAppSettings()
  const storedVersion = getStoredSettingsVersion(value)
  return {
    version: RUNTIME_APP_SETTINGS_VERSION,
    updatedAt:
      typeof value?.updatedAt === "string" && value.updatedAt.length > 0
        ? value.updatedAt
        : defaults.updatedAt,
    defaultRenderOptions: {
      ...defaults.defaultRenderOptions,
      ...value?.defaultRenderOptions,
    },
    permissionNudgeSeen:
      typeof value?.permissionNudgeSeen === "boolean"
        ? value.permissionNudgeSeen
        : defaults.permissionNudgeSeen,
    showTextBoundingBoxes:
      storedVersion >= RUNTIME_APP_SETTINGS_VERSION &&
      typeof value?.showTextBoundingBoxes === "boolean"
        ? value.showTextBoundingBoxes
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
