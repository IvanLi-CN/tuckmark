// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

const dataDirectoryServiceMocks = vi.hoisted(() => ({
  collectDirectoryFilesFromDirectoryHandle: vi.fn(),
  loadConfiguredDataDirectoryHandle: vi.fn(),
  removeEntryIfPresentFromDirectoryHandle: vi.fn(),
  resolveDirectoryHandleFromDirectoryHandle: vi.fn(),
  writeTextFileToDirectoryHandle: vi.fn(),
}))

vi.mock("./data-directory-service.js", () => dataDirectoryServiceMocks)

import {
  applyInventoryMaterialAdjustment,
  listInventoryAdjustments,
  listInventoryMaterials,
  saveInventoryMaterial,
} from "./inventory-data-store.js"

const localStorageState = new Map<string, string>()
const fakeLocalStorage = {
  get length() {
    return localStorageState.size
  },
  clear() {
    localStorageState.clear()
  },
  getItem(key: string) {
    return localStorageState.get(key) ?? null
  },
  key(index: number) {
    return Array.from(localStorageState.keys())[index] ?? null
  },
  removeItem(key: string) {
    localStorageState.delete(key)
  },
  setItem(key: string, value: string) {
    localStorageState.set(key, value)
  },
} satisfies Storage

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: fakeLocalStorage,
})
if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: fakeLocalStorage,
  })
}

afterEach(() => {
  dataDirectoryServiceMocks.collectDirectoryFilesFromDirectoryHandle.mockReset()
  dataDirectoryServiceMocks.loadConfiguredDataDirectoryHandle.mockReset()
  dataDirectoryServiceMocks.removeEntryIfPresentFromDirectoryHandle.mockReset()
  dataDirectoryServiceMocks.resolveDirectoryHandleFromDirectoryHandle.mockReset()
  dataDirectoryServiceMocks.writeTextFileToDirectoryHandle.mockReset()
  localStorageState.clear()
})

describe("inventory-data-store", () => {
  it("falls back to browser-local inventory storage when no data directory is configured", async () => {
    dataDirectoryServiceMocks.loadConfiguredDataDirectoryHandle.mockResolvedValue(null)

    await saveInventoryMaterial({
      fullName: "TPS62933DRLR",
      baseName: "TPS62933",
      variantName: "DRLR",
      packageName: "SOT-583",
      description: "同步降压 28V",
      matrixCode: "P2-Y404125469",
      packagingRemark: "编带一盘 3000pcs",
      labelBindings: [],
    })

    const materials = await listInventoryMaterials()
    expect(materials).toHaveLength(1)
    expect(materials[0]?.fullName).toBe("TPS62933DRLR")
    expect(materials[0]?.currentQuantity).toBe(0)
  })

  it("persists local inventory adjustments and updates the cached quantity", async () => {
    dataDirectoryServiceMocks.loadConfiguredDataDirectoryHandle.mockResolvedValue(null)

    const material = await saveInventoryMaterial({
      fullName: "XT60H-F",
      baseName: "XT60H",
      variantName: "F",
      packageName: "Connector",
      description: "黄铜镀金母头",
      packagingRemark: "散装备件",
      labelBindings: [],
    })

    await applyInventoryMaterialAdjustment({
      materialId: material.id,
      input: {
        kind: "in",
        quantity: 12,
        note: "补货",
        actor: "web",
      },
    })

    const materials = await listInventoryMaterials()
    const adjustments = await listInventoryAdjustments(material.id)

    expect(materials[0]?.currentQuantity).toBe(12)
    expect(adjustments).toHaveLength(1)
    expect(adjustments[0]?.quantityAfter).toBe(12)
    expect(adjustments[0]?.note).toBe("补货")
  })
})
