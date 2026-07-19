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

import { restoreRuntimeFromConfiguredDirectoryIfNeeded } from "./data-directory-service.js"

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
      version: 1,
      updatedAt: args.updatedAt ?? "1970-01-01T00:00:00.000Z",
      defaultRenderOptions: {
        printWidthDots: 384,
        paperType: "continuous",
        threshold: 150,
        xOffsetDots: 0,
      },
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
            yield {
              kind: "file",
              name: entryName,
              async getFile() {
                return {
                  name: entryName,
                  size: entryValue.length,
                  lastModified: 0,
                  async text() {
                    return entryValue
                  },
                } as File
              },
            } as FileSystemFileHandle
            continue
          }
          yield createDirectory(entryName, entryValue)
        }
      },
      async getDirectoryHandle(entryName: string) {
        const next = value[entryName]
        if (!next || typeof next === "string") {
          throw new Error(`Missing directory: ${entryName}`)
        }
        return createDirectory(entryName, next)
      },
      async getFileHandle(entryName: string) {
        const next = value[entryName]
        if (typeof next !== "string") {
          throw new Error(`Missing file: ${entryName}`)
        }
        return {
          kind: "file",
          name: entryName,
          async getFile() {
            return {
              name: entryName,
              size: next.length,
              lastModified: 0,
              async text() {
                return next
              },
            } as File
          },
        } as FileSystemFileHandle
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
