// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"

import type { RuntimeStoreSnapshot } from "./runtime-store-contract.js"

const handleStoreMocks = vi.hoisted(() => ({
  clearStoredDataDirectoryHandle: vi.fn(),
  loadStoredDataDirectoryHandle: vi.fn(),
  saveDataDirectoryHandle: vi.fn(),
  supportsDirectoryHandles: vi.fn(() => true),
}))

const runtimeStoreMocks = vi.hoisted(() => ({
  exportRuntimeSnapshot: vi.fn(),
  replaceRuntimeSnapshot: vi.fn(),
}))

vi.mock("./data-directory-handle-store.js", () => handleStoreMocks)
vi.mock("./user-template-store.js", () => runtimeStoreMocks)

import {
  attachDataDirectory,
  exportRuntimeArchive,
  importRuntimeArchive,
  restoreRuntimeFromConfiguredDirectoryIfNeeded,
  syncConfiguredDataDirectory,
} from "./data-directory-service.js"
import {
  readBrowserLocalInventorySnapshot,
  writeBrowserLocalInventorySnapshot,
} from "./inventory-browser-storage.js"

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    clear() {
      entries.clear()
    },
    getItem(key) {
      return entries.get(key) ?? null
    },
    key(index) {
      return Array.from(entries.keys())[index] ?? null
    },
    removeItem(key) {
      entries.delete(key)
    },
    setItem(key, value) {
      entries.set(key, value)
    },
  }
}

function installLocalStorage(storage: Storage): void {
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(window, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  })
}

function createSnapshot(args: {
  templateIds: string[]
  versionCount: number
  workingCopyCount: number
  updatedAt: string | null
}): RuntimeStoreSnapshot {
  const templates = args.templateIds.map((id) => ({
    id,
    name: id,
    description: "",
    width: 30,
    height: 20,
    createdAt: "2026-07-17T07:00:00.000Z",
    updatedAt: args.updatedAt ?? "2026-07-17T07:00:00.000Z",
    currentVersionId: `version-${id}-1`,
    fieldOrder: [],
  }))
  const versions = Array.from({ length: args.versionCount }, (_, index) => {
    const templateId =
      args.templateIds[index % Math.max(args.templateIds.length, 1)] ?? "template-a"
    return {
      id: `version-${templateId}-${index + 1}`,
      templateId,
      version: index + 1,
      kind: "saved" as const,
      createdAt: args.updatedAt ?? "2026-07-17T07:00:00.000Z",
      label: `Version ${index + 1}`,
      sourceVersionId: undefined,
      document: {
        version: 1 as const,
        id: `draft-${templateId}-${index + 1}`,
        presetId: templateId,
        name: templateId,
        width: 240,
        height: 160,
        elements: [],
        fields: [],
        source: { kind: "user-template" as const, templateId },
        templateId,
        lastSavedAt: args.updatedAt ?? "2026-07-17T07:00:00.000Z",
        editor: {
          gridEnabled: true,
          snapEnabled: true,
        },
      },
    }
  })
  const workingCopies = Array.from({ length: args.workingCopyCount }, (_, index) => {
    const templateId =
      args.templateIds[index % Math.max(args.templateIds.length, 1)] ?? "template-a"
    return {
      sourceKey: `user:${templateId}:${index + 1}`,
      source: { kind: "user-template" as const, templateId },
      templateId,
      updatedAt: args.updatedAt ?? "2026-07-17T07:00:00.000Z",
      baseVersionId: versions[index]?.id,
      draft: {
        version: 1 as const,
        id: `working-${templateId}-${index + 1}`,
        presetId: templateId,
        name: templateId,
        width: 240,
        height: 160,
        elements: [],
        fields: [],
        source: { kind: "user-template" as const, templateId },
        templateId,
        lastSavedAt: args.updatedAt ?? "2026-07-17T07:00:00.000Z",
        editor: {
          gridEnabled: true,
          snapEnabled: true,
        },
      },
    }
  })
  return {
    schema: "tuckmark.runtime-export.v1",
    exportedAt: "2026-07-17T07:00:00.000Z",
    snapshotUpdatedAt: args.updatedAt,
    settings: {
      version: 2,
      updatedAt: args.updatedAt ?? "1970-01-01T00:00:00.000Z",
      documentDefaults: {
        paperType: "continuous",
        threshold: 150,
      },
      printerModelPresets: {},
      printerDeviceCalibrations: {},
      permissionNudgeSeen: true,
      showTextBoundingBoxes: false,
    },
    templates,
    versions,
    workingCopies,
  }
}

interface DirectoryEntries {
  [key: string]: string | DirectoryEntries
}

function createDirectoryHandle(
  name: string,
  tree: DirectoryEntries,
  permission: PermissionState = "granted"
): FileSystemDirectoryHandle {
  const createFile = (fileName: string, directory: DirectoryEntries): FileSystemFileHandle =>
    ({
      kind: "file",
      name: fileName,
      async getFile() {
        const content = directory[fileName]
        if (typeof content !== "string") {
          throw new Error(`Missing file: ${fileName}`)
        }
        return {
          name: fileName,
          size: content.length,
          lastModified: 0,
          async text() {
            return content
          },
        } as File
      },
      async createWritable() {
        return {
          async write(value: string) {
            directory[fileName] = value
          },
          async close() {},
        } as FileSystemWritableFileStream
      },
    }) as FileSystemFileHandle

  const createDirectory = (
    directoryName: string,
    value: DirectoryEntries
  ): FileSystemDirectoryHandle =>
    ({
      kind: "directory",
      name: directoryName,
      async *values() {
        for (const [entryName, entryValue] of Object.entries(value)) {
          if (typeof entryValue === "string") {
            yield createFile(entryName, value)
            continue
          }
          yield createDirectory(entryName, entryValue)
        }
      },
      async getDirectoryHandle(entryName: string, options?: FileSystemGetDirectoryOptions) {
        let next = value[entryName]
        if (next === undefined && options?.create) {
          next = {}
          value[entryName] = next
        }
        if (!next || typeof next === "string") {
          throw new Error(`Missing directory: ${entryName}`)
        }
        return createDirectory(entryName, next)
      },
      async getFileHandle(entryName: string, options?: FileSystemGetFileOptions) {
        let next = value[entryName]
        if (next === undefined && options?.create) {
          next = ""
          value[entryName] = next
        }
        if (typeof next !== "string") {
          throw new Error(`Missing file: ${entryName}`)
        }
        return createFile(entryName, value)
      },
      async removeEntry(entryName: string) {
        delete value[entryName]
      },
      async queryPermission() {
        return permission
      },
      async requestPermission() {
        return permission
      },
    }) as FileSystemDirectoryHandle
  return createDirectory(name, tree)
}

function snapshotToDirectoryTree(snapshot: RuntimeStoreSnapshot): DirectoryEntries {
  const templates = Object.fromEntries(
    snapshot.templates.map((template) => [
      template.id,
      {
        "template.json": JSON.stringify(template),
        versions: Object.fromEntries(
          snapshot.versions
            .filter((version) => version.templateId === template.id)
            .map((version) => [`${version.id}.json`, JSON.stringify(version)])
        ),
        "working-copy.json": JSON.stringify(
          snapshot.workingCopies.find(
            (entry) => entry.source.kind === "user-template" && entry.templateId === template.id
          ) ?? null
        ),
      },
    ])
  )

  for (const [, directory] of Object.entries(templates)) {
    if ((directory as { "working-copy.json": string | null })["working-copy.json"] === "null") {
      delete (directory as { "working-copy.json"?: string })["working-copy.json"]
    }
    if (Object.keys((directory as { versions: Record<string, string> }).versions).length === 0) {
      delete (directory as { versions?: Record<string, string> }).versions
    }
  }

  const drafts = Object.fromEntries(
    snapshot.workingCopies
      .filter((entry) => entry.source.kind !== "user-template")
      .map((entry) => {
        const directory = entry.source.kind === "scratch" ? "scratch" : "preset-template"
        const ref =
          entry.source.kind === "user-template" ? entry.source.templateId : entry.source.presetId
        return [`${directory}/${ref}.json`, JSON.stringify(entry)]
      })
  )

  const draftTree: DirectoryEntries = {}
  for (const [path, value] of Object.entries(drafts)) {
    const [section, fileName] = path.split("/")
    draftTree[section] ??= {}
    ;(draftTree[section] as DirectoryEntries)[fileName] = value
  }

  return {
    "manifest.json": JSON.stringify({
      schema: "tuckmark.data-dir-manifest.v1",
      generatedAt: "2026-07-17T07:30:00.000Z",
      snapshotUpdatedAt: snapshot.snapshotUpdatedAt,
      source: "runtime-sync",
      files: {
        settings: "settings/app-settings.json",
        templatesDir: "templates",
        draftsDir: "drafts",
        backupsDir: "backups",
      },
      counts: {
        templates: snapshot.templates.length,
        versions: snapshot.versions.length,
        workingCopies: snapshot.workingCopies.length,
      },
    }),
    settings: {
      "app-settings.json": JSON.stringify(snapshot.settings),
    },
    templates,
    drafts: draftTree,
  }
}

function readInventoryMaterialFromTree(tree: DirectoryEntries, materialId: string): unknown {
  const inventory = tree.inventory as DirectoryEntries
  const materials = inventory.materials as DirectoryEntries
  return JSON.parse(materials[`${materialId}.json`] as string)
}

beforeEach(() => {
  handleStoreMocks.loadStoredDataDirectoryHandle.mockReset()
  handleStoreMocks.supportsDirectoryHandles.mockReturnValue(true)
  runtimeStoreMocks.exportRuntimeSnapshot.mockReset()
  runtimeStoreMocks.replaceRuntimeSnapshot.mockReset()
  installLocalStorage(createMemoryStorage())
})

describe("restoreRuntimeFromConfiguredDirectoryIfNeeded", () => {
  it("restores the configured directory snapshot when it is newer than the runtime store", async () => {
    const runtimeSnapshot = createSnapshot({
      templateIds: ["template-a"],
      versionCount: 1,
      workingCopyCount: 1,
      updatedAt: "2026-07-17T07:00:00.000Z",
    })
    const directorySnapshot = createSnapshot({
      templateIds: ["template-a", "template-b"],
      versionCount: 2,
      workingCopyCount: 2,
      updatedAt: "2026-07-17T07:20:00.000Z",
    })
    runtimeStoreMocks.exportRuntimeSnapshot.mockResolvedValue(runtimeSnapshot)
    handleStoreMocks.loadStoredDataDirectoryHandle.mockResolvedValue(
      createDirectoryHandle("Tuckmark", snapshotToDirectoryTree(directorySnapshot))
    )

    const result = await restoreRuntimeFromConfiguredDirectoryIfNeeded()

    expect(result).toBe("restored")
    expect(runtimeStoreMocks.replaceRuntimeSnapshot).toHaveBeenCalledTimes(1)
    expect(runtimeStoreMocks.replaceRuntimeSnapshot.mock.calls[0][0]).toMatchObject({
      snapshotUpdatedAt: "2026-07-17T07:20:00.000Z",
      templates: expect.arrayContaining([
        expect.objectContaining({ id: "template-a" }),
        expect.objectContaining({ id: "template-b" }),
      ]),
    })
  })

  it("restores the directory snapshot when timestamps match but the mirror dominates the runtime counts", async () => {
    const runtimeSnapshot = createSnapshot({
      templateIds: ["template-a"],
      versionCount: 1,
      workingCopyCount: 1,
      updatedAt: "2026-07-17T07:20:00.000Z",
    })
    const directorySnapshot = createSnapshot({
      templateIds: ["template-a", "template-b"],
      versionCount: 2,
      workingCopyCount: 2,
      updatedAt: "2026-07-17T07:20:00.000Z",
    })
    runtimeStoreMocks.exportRuntimeSnapshot.mockResolvedValue(runtimeSnapshot)
    handleStoreMocks.loadStoredDataDirectoryHandle.mockResolvedValue(
      createDirectoryHandle("Tuckmark", snapshotToDirectoryTree(directorySnapshot))
    )

    const result = await restoreRuntimeFromConfiguredDirectoryIfNeeded()

    expect(result).toBe("restored")
    expect(runtimeStoreMocks.replaceRuntimeSnapshot).toHaveBeenCalledTimes(1)
  })

  it("keeps the runtime snapshot when it is newer than the directory mirror", async () => {
    const runtimeSnapshot = createSnapshot({
      templateIds: ["template-a", "template-b"],
      versionCount: 2,
      workingCopyCount: 2,
      updatedAt: "2026-07-17T07:30:00.000Z",
    })
    const directorySnapshot = createSnapshot({
      templateIds: ["template-a"],
      versionCount: 1,
      workingCopyCount: 1,
      updatedAt: "2026-07-17T07:00:00.000Z",
    })
    runtimeStoreMocks.exportRuntimeSnapshot.mockResolvedValue(runtimeSnapshot)
    handleStoreMocks.loadStoredDataDirectoryHandle.mockResolvedValue(
      createDirectoryHandle("Tuckmark", snapshotToDirectoryTree(directorySnapshot))
    )

    const result = await restoreRuntimeFromConfiguredDirectoryIfNeeded()

    expect(result).toBe("skipped")
    expect(runtimeStoreMocks.replaceRuntimeSnapshot).not.toHaveBeenCalled()
  })
})

describe("browser-local inventory archives", () => {
  const localInventorySnapshot = {
    materials: [
      {
        id: "material-local",
        fullName: "TPS62933DRLR",
        description: "同步降压 28V",
        packagingRemark: "编带",
        currentQuantity: 12,
        createdAt: "2026-07-17T07:00:00.000Z",
        updatedAt: "2026-07-17T07:00:00.000Z",
        labelBindings: [],
      },
    ],
    adjustments: [
      {
        id: "adjustment-local",
        materialId: "material-local",
        kind: "in" as const,
        quantityDelta: 12,
        targetQuantity: null,
        quantityAfter: 12,
        note: "initial stock",
        actor: "web",
        createdAt: "2026-07-17T07:00:00.000Z",
      },
    ],
  }

  it("restores archive inventory into browser-local storage without an attached directory", async () => {
    handleStoreMocks.loadStoredDataDirectoryHandle.mockResolvedValue(null)
    const snapshot = createSnapshot({
      templateIds: [],
      versionCount: 0,
      workingCopyCount: 0,
      updatedAt: "2026-07-17T07:00:00.000Z",
    })

    await importRuntimeArchive({
      coordinator: {
        runAsWriter: async <T>(task: () => Promise<T>) => await task(),
      } as never,
      snapshot,
      inventorySnapshot: localInventorySnapshot,
    })

    expect(runtimeStoreMocks.replaceRuntimeSnapshot).toHaveBeenCalledWith(snapshot)
    expect(readBrowserLocalInventorySnapshot()).toMatchObject(localInventorySnapshot)
  })

  it("includes browser-local inventory in an exported archive", async () => {
    handleStoreMocks.loadStoredDataDirectoryHandle.mockResolvedValue(null)
    runtimeStoreMocks.exportRuntimeSnapshot.mockResolvedValue(
      createSnapshot({
        templateIds: [],
        versionCount: 0,
        workingCopyCount: 0,
        updatedAt: "2026-07-17T07:00:00.000Z",
      })
    )
    writeBrowserLocalInventorySnapshot(localInventorySnapshot)
    const createObjectUrl = vi.fn<(blob: Blob) => string>(() => "blob:tuckmark-test")
    const revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl })
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)

    await exportRuntimeArchive()

    const blob = createObjectUrl.mock.calls[0]?.[0]
    expect(blob).toBeInstanceOf(Blob)
    if (!blob) {
      throw new Error("Missing exported archive blob")
    }
    expect(await blob.text()).toContain("inventory/materials/material-local.json")
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:tuckmark-test")
  })
})

describe("inventory directory preservation", () => {
  const localInventorySnapshot = {
    materials: [
      {
        id: "material-local",
        fullName: "TPS62933DRLR",
        description: "同步降压 28V",
        packagingRemark: "编带",
        currentQuantity: 12,
        createdAt: "2026-07-17T07:00:00.000Z",
        updatedAt: "2026-07-17T07:00:00.000Z",
        labelBindings: [],
      },
    ],
    adjustments: [],
  }

  const coordinator = {
    runAsWriter: async <T>(task: () => Promise<T>) => await task(),
  } as never

  it("initializes a first attached directory with browser-local inventory", async () => {
    const snapshot = createSnapshot({
      templateIds: [],
      versionCount: 0,
      workingCopyCount: 0,
      updatedAt: "2026-07-17T07:00:00.000Z",
    })
    const tree: DirectoryEntries = {}
    runtimeStoreMocks.exportRuntimeSnapshot.mockResolvedValue(snapshot)
    handleStoreMocks.loadStoredDataDirectoryHandle.mockResolvedValue(null)
    writeBrowserLocalInventorySnapshot(localInventorySnapshot)

    await attachDataDirectory({
      handle: createDirectoryHandle("Tuckmark", tree),
      mode: "overwrite-current",
    })

    expect(readInventoryMaterialFromTree(tree, "material-local")).toMatchObject({
      id: "material-local",
      currentQuantity: 12,
    })
  })

  it("preserves directory inventory during routine runtime synchronization", async () => {
    const snapshot = createSnapshot({
      templateIds: [],
      versionCount: 0,
      workingCopyCount: 0,
      updatedAt: "2026-07-17T07:00:00.000Z",
    })
    const tree: DirectoryEntries = {
      ...snapshotToDirectoryTree(snapshot),
      inventory: {
        materials: {
          "material-local.json": JSON.stringify(localInventorySnapshot.materials[0]),
        },
        adjustments: {},
      },
    }
    const handle = createDirectoryHandle("Tuckmark", tree)
    runtimeStoreMocks.exportRuntimeSnapshot.mockResolvedValue(snapshot)
    handleStoreMocks.loadStoredDataDirectoryHandle.mockResolvedValue(handle)

    await syncConfiguredDataDirectory({ coordinator })

    expect(readInventoryMaterialFromTree(tree, "material-local")).toMatchObject({
      id: "material-local",
      currentQuantity: 12,
    })
  })
})
