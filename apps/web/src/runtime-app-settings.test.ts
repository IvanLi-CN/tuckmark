import { describe, expect, it } from "vitest"

import {
  createDefaultRuntimeAppSettings,
  normalizeRuntimeAppSettings,
} from "./runtime-app-settings.js"

describe("runtime-app-settings", () => {
  it("resets the text bbox toggle to off when migrating legacy settings", () => {
    const migrated = normalizeRuntimeAppSettings({
      version: 1,
      updatedAt: "2026-07-19T00:00:00.000Z",
      permissionNudgeSeen: true,
      showTextBoundingBoxes: true,
    })

    expect(migrated.version).toBe(2)
    expect(migrated.permissionNudgeSeen).toBe(true)
    expect(migrated.showTextBoundingBoxes).toBe(false)
  })

  it("preserves the text bbox toggle for current settings payloads", () => {
    const current = normalizeRuntimeAppSettings({
      ...createDefaultRuntimeAppSettings(),
      updatedAt: "2026-07-19T00:00:00.000Z",
      showTextBoundingBoxes: true,
    })

    expect(current.version).toBe(2)
    expect(current.showTextBoundingBoxes).toBe(true)
  })
})
