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

  it("preserves device details when a material is later edited", async () => {
    dataDirectoryServiceMocks.loadConfiguredDataDirectoryHandle.mockResolvedValue(null)
    const created = await saveInventoryMaterial({
      fullName: "Mock imported regulator",
      description: "initial description",
      deviceDetails: "- Input range\n- Package evidence",
      packagingRemark: "reel",
      labelBindings: [],
    })

    const edited = await saveInventoryMaterial({
      id: created.id,
      fullName: created.fullName,
      description: "edited description",
      packagingRemark: created.packagingRemark,
      labelBindings: created.labelBindings,
    })

    expect(edited.deviceDetails).toBe(created.deviceDetails)
  })

  it("propagates directory read failures instead of treating them as an empty inventory", async () => {
    const handle = {
      queryPermission: vi.fn().mockResolvedValue("granted"),
    } as unknown as FileSystemDirectoryHandle
    dataDirectoryServiceMocks.loadConfiguredDataDirectoryHandle.mockResolvedValue(handle)
    dataDirectoryServiceMocks.resolveDirectoryHandleFromDirectoryHandle.mockRejectedValue(
      Object.assign(new Error("permission denied"), { name: "NotAllowedError" })
    )

    await expect(listInventoryMaterials()).rejects.toThrow("permission denied")
  })

  it("replays a pending adjustment transaction before serving directory inventory", async () => {
    const handle = {
      queryPermission: vi.fn().mockResolvedValue("granted"),
    } as unknown as FileSystemDirectoryHandle
    const material = {
      id: "inventory-material-pending",
      fullName: "PENDING-TEST",
      description: "",
      packagingRemark: "",
      currentQuantity: 6,
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
      archivedAt: null,
      labelBindings: [],
    }
    const adjustment = {
      id: "inventory-adjustment-pending",
      materialId: material.id,
      kind: "in",
      quantityDelta: 6,
      targetQuantity: null,
      quantityAfter: 6,
      note: "恢复",
      actor: "web",
      createdAt: "2026-07-27T00:00:00.000Z",
    }
    dataDirectoryServiceMocks.loadConfiguredDataDirectoryHandle.mockResolvedValue(handle)
    dataDirectoryServiceMocks.resolveDirectoryHandleFromDirectoryHandle.mockResolvedValue(
      {} as FileSystemDirectoryHandle
    )
    dataDirectoryServiceMocks.collectDirectoryFilesFromDirectoryHandle
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(
        new Map([
          [
            "inventory/transactions/inventory-adjustment-pending.json",
            JSON.stringify({
              schema: "tuckmark.inventory-adjustment-transaction.v1",
              material,
              adjustment,
            }),
          ],
        ])
      )
      .mockResolvedValueOnce(
        new Map([["inventory/materials/inventory-material-pending.json", JSON.stringify(material)]])
      )

    await expect(listInventoryMaterials()).resolves.toEqual([expect.objectContaining(material)])
    expect(dataDirectoryServiceMocks.writeTextFileToDirectoryHandle).toHaveBeenNthCalledWith(
      1,
      handle,
      `inventory/materials/${material.id}.json`,
      expect.any(String)
    )
    expect(dataDirectoryServiceMocks.writeTextFileToDirectoryHandle).toHaveBeenNthCalledWith(
      2,
      handle,
      `inventory/adjustments/${adjustment.id}.json`,
      expect.any(String)
    )
    expect(dataDirectoryServiceMocks.removeEntryIfPresentFromDirectoryHandle).toHaveBeenCalledWith(
      expect.anything(),
      `${adjustment.id}.json`
    )
  })

  it("replays a pending Agent import before serving directory inventory", async () => {
    const handle = {
      queryPermission: vi.fn().mockResolvedValue("granted"),
    } as unknown as FileSystemDirectoryHandle
    const material = {
      id: "inventory-material-agent-import-pending",
      fullName: "PENDING-AGENT-IMPORT",
      description: "",
      packagingRemark: "",
      currentQuantity: 4,
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
      archivedAt: null,
      labelBindings: [],
    }
    dataDirectoryServiceMocks.loadConfiguredDataDirectoryHandle.mockResolvedValue(handle)
    dataDirectoryServiceMocks.resolveDirectoryHandleFromDirectoryHandle.mockResolvedValue(
      {} as FileSystemDirectoryHandle
    )
    dataDirectoryServiceMocks.collectDirectoryFilesFromDirectoryHandle
      .mockResolvedValueOnce(
        new Map([
          [
            "inventory/agent-import-transactions/recover.json",
            JSON.stringify({
              schema: "tuckmark.agent-import-transaction.v1",
              writes: [
                {
                  relativePath: `inventory/materials/${material.id}.json`,
                  value: material,
                },
              ],
            }),
          ],
        ])
      )
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(
        new Map([[`inventory/materials/${material.id}.json`, JSON.stringify(material)]])
      )

    await expect(listInventoryMaterials()).resolves.toEqual([expect.objectContaining(material)])
    expect(dataDirectoryServiceMocks.writeTextFileToDirectoryHandle).toHaveBeenCalledWith(
      handle,
      `inventory/materials/${material.id}.json`,
      expect.any(String)
    )
    expect(dataDirectoryServiceMocks.removeEntryIfPresentFromDirectoryHandle).toHaveBeenCalledWith(
      expect.anything(),
      "recover.json"
    )
  })
})
