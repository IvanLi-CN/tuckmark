import { defaultRenderOptions } from "./demo-data.js"
import type { RuntimeStoreAppSettings } from "./runtime-store-contract.js"

const EMPTY_UPDATED_AT = "1970-01-01T00:00:00.000Z"

export function createDefaultRuntimeAppSettings(): RuntimeStoreAppSettings {
  return {
    version: 1,
    updatedAt: EMPTY_UPDATED_AT,
    defaultRenderOptions: { ...defaultRenderOptions },
    permissionNudgeSeen: false,
  }
}

export function normalizeRuntimeAppSettings(
  value: Partial<RuntimeStoreAppSettings> | null | undefined
): RuntimeStoreAppSettings {
  const defaults = createDefaultRuntimeAppSettings()
  return {
    version: 1,
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
  }
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
