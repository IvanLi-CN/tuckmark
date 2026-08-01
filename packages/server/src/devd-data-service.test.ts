import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  DevdDataConflictError,
  DevdDataService,
  DevdDataUnavailableError,
} from "./devd-data-service.js"

const cleanupPaths: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    cleanupPaths.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

function mockDocument(name: string) {
  return {
    version: 1 as const,
    unit: "mm" as const,
    id: "mock-document",
    presetId: "custom",
    name,
    source: { kind: "scratch" as const, presetId: "custom" },
    width: 48,
    height: 24,
    fields: [{ key: "name", label: "Name", required: false, multiline: false }],
    elements: [],
    editor: { gridEnabled: true, snapEnabled: true },
  }
}

describe("DevdDataService", () => {
  it("claims an empty directory before the first data mutation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-data-"))
    cleanupPaths.push(root)

    new DevdDataService(root)

    await expect(
      readFile(path.join(root, ".tuckmark", "devd-owner.json"), "utf8")
    ).resolves.toContain("tuckmark.devd-owner.v1")
  })

  it("rejects a second live owner and recovers a stale process lock", async () => {
    const liveRoot = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-data-"))
    const staleRoot = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-data-"))
    cleanupPaths.push(liveRoot, staleRoot)

    new DevdDataService(liveRoot)
    expect(() => new DevdDataService(liveRoot)).toThrow(DevdDataUnavailableError)

    await mkdir(path.join(staleRoot, ".tuckmark"), { recursive: true })
    await writeFile(
      path.join(staleRoot, ".tuckmark", "devd-live.lock"),
      JSON.stringify({
        schema: "tuckmark.devd-live-lock.v1",
        pid: 2147483647,
        token: "stale-mock-owner",
        claimedAt: "2030-07-01T00:00:00.000Z",
      })
    )
    new DevdDataService(staleRoot)
    await expect(
      readFile(path.join(staleRoot, ".tuckmark", "devd-live.lock"), "utf8")
    ).resolves.toContain(`"pid":${process.pid}`)
  })

  it("recovers a lock whose PID was reused by another process", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-data-"))
    cleanupPaths.push(root)
    await mkdir(path.join(root, ".tuckmark"), { recursive: true })
    await writeFile(
      path.join(root, ".tuckmark", "devd-live.lock"),
      JSON.stringify({
        schema: "tuckmark.devd-live-lock.v1",
        pid: process.pid,
        token: "reused-pid-mock-owner",
        claimedAt: "2030-07-01T00:00:00.000Z",
        processStartIdentity: "stale-mock-process-start",
      })
    )

    new DevdDataService(root)

    await expect(
      readFile(path.join(root, ".tuckmark", "devd-live.lock"), "utf8")
    ).resolves.not.toContain("reused-pid-mock-owner")
  })

  it("reclaims a recovery guard left behind by a stopped process", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-data-"))
    cleanupPaths.push(root)
    const controlDirectory = path.join(root, ".tuckmark")
    await mkdir(controlDirectory, { recursive: true })
    await writeFile(
      path.join(controlDirectory, "devd-live.lock.recovery"),
      JSON.stringify({
        schema: "tuckmark.devd-live-lock.v1",
        pid: 2147483647,
        token: "stale-mock-recovery",
        claimedAt: "2030-07-01T00:00:00.000Z",
      })
    )

    new DevdDataService(root)

    await expect(
      readFile(path.join(controlDirectory, "devd-live.lock"), "utf8")
    ).resolves.toContain(`"pid":${process.pid}`)
    await expect(
      stat(path.join(controlDirectory, "devd-live.lock.recovery"))
    ).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("persists a template command and rejects a stale revision", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-data-"))
    cleanupPaths.push(root)
    const service = new DevdDataService(root)

    expect((await service.status()).revision).toBe(0)

    const saved = await service.mutateRuntime({
      command: "save-template",
      expectedRevision: 0,
      args: { name: "Mock cable", document: mockDocument("Mock cable") },
    })
    expect(saved.revision).toBe(1)
    expect((await service.runtimeSnapshot()).templates).toHaveLength(1)

    await expect(
      service.mutateRuntime({
        command: "rename-template",
        expectedRevision: 0,
        args: { templateId: saved.data.template.id, name: "Stale rename" },
      })
    ).rejects.toBeInstanceOf(DevdDataConflictError)
  })

  it("persists scratch and preset working copies at source-specific paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-data-"))
    cleanupPaths.push(root)
    const service = new DevdDataService(root)

    await service.mutateRuntime({
      command: "replace-working-copy",
      expectedRevision: 0,
      args: {
        source: { kind: "scratch", presetId: "custom" },
        document: mockDocument("Scratch mock"),
      },
    })
    await service.mutateRuntime({
      command: "replace-working-copy",
      expectedRevision: 1,
      args: {
        source: { kind: "preset-template", presetId: "shipping-wide" },
        document: {
          ...mockDocument("Preset mock"),
          presetId: "shipping-wide",
          source: { kind: "preset-template", presetId: "shipping-wide" },
        },
      },
    })

    await expect(
      readFile(path.join(root, "drafts", "scratch", "custom.json"), "utf8")
    ).resolves.toContain("Scratch mock")
    await expect(
      readFile(path.join(root, "drafts", "preset-template", "shipping-wide.json"), "utf8")
    ).resolves.toContain("Preset mock")
    expect((await service.runtimeSnapshot()).workingCopies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceKey: "scratch:custom" }),
        expect.objectContaining({ sourceKey: "preset:shipping-wide" }),
      ])
    )
  })

  it("persists template recommendations carried by an imported draft", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-data-"))
    cleanupPaths.push(root)
    const service = new DevdDataService(root)

    await service.mutateRuntime({
      command: "save-template",
      expectedRevision: 0,
      args: {
        name: "Recommended mock template",
        document: {
          ...mockDocument("Recommended mock template"),
          recommendedUses: [{ scope: "electronics", weight: 90 }],
        },
      },
    })

    expect((await service.runtimeSnapshot()).templates[0]).toMatchObject({
      recommendedUses: [{ scope: "electronics", weight: 90 }],
    })
  })

  it("retains bounded saved and autosaved versions at the established cadence", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"))
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-data-"))
    cleanupPaths.push(root)
    const service = new DevdDataService(root)
    let revision = 0
    let templateId = ""

    for (let version = 1; version <= 21; version += 1) {
      const saved = await service.mutateRuntime({
        command: "save-template",
        expectedRevision: revision,
        args: {
          ...(templateId ? { templateId } : {}),
          name: "Retained mock template",
          document: mockDocument(`Saved ${version}`),
        },
      })
      revision = saved.revision
      templateId = saved.data.template.id
      vi.advanceTimersByTime(1)
    }

    let snapshot = await service.runtimeSnapshot()
    const savedVersions = snapshot.versions.filter(
      (version) => version.templateId === templateId && version.kind === "saved"
    )
    expect(savedVersions).toHaveLength(20)
    expect(savedVersions.map((version) => version.version).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 2)
    )

    await service.mutateRuntime({
      command: "save-autosave",
      expectedRevision: revision,
      args: {
        templateId,
        source: { kind: "user-template", templateId },
        document: mockDocument("Too soon"),
      },
    })
    revision += 1
    expect(
      (await service.runtimeSnapshot()).versions.filter((version) => version.kind === "autosave")
    ).toHaveLength(1)

    for (let autosave = 2; autosave <= 11; autosave += 1) {
      vi.advanceTimersByTime(5 * 60 * 1000)
      const saved = await service.mutateRuntime({
        command: "save-autosave",
        expectedRevision: revision,
        args: {
          templateId,
          source: { kind: "user-template", templateId },
          document: mockDocument(`Autosave ${autosave}`),
        },
      })
      revision = saved.revision
    }

    snapshot = await service.runtimeSnapshot()
    const autosaves = snapshot.versions
      .filter((version) => version.templateId === templateId && version.kind === "autosave")
      .sort((left, right) => left.version - right.version)
    expect(autosaves).toHaveLength(10)
    expect(autosaves.at(0)?.version).toBe(23)
    expect(autosaves.at(-1)?.version).toBe(32)
  })

  it("writes only runtime records changed by a routine command", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-data-"))
    cleanupPaths.push(root)
    const service = new DevdDataService(root)
    const first = await service.mutateRuntime({
      command: "save-template",
      expectedRevision: 0,
      args: { name: "Unchanged mock template", document: mockDocument("Unchanged mock template") },
    })
    const second = await service.mutateRuntime({
      command: "save-template",
      expectedRevision: 1,
      args: { name: "Renamed mock template", document: mockDocument("Renamed mock template") },
    })
    const untouchedPath = path.join(root, "templates", first.data.template.id, "template.json")
    const before = await stat(untouchedPath)

    await new Promise((resolve) => setTimeout(resolve, 20))
    await service.mutateRuntime({
      command: "rename-template",
      expectedRevision: 2,
      args: { templateId: second.data.template.id, name: "Renamed mock template again" },
    })

    expect((await stat(untouchedPath)).mtimeMs).toBe(before.mtimeMs)
  })

  it("writes only inventory records changed by a routine adjustment", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-data-"))
    cleanupPaths.push(root)
    const service = new DevdDataService(root)
    await service.mutateInventory({
      command: "save-material",
      expectedRevision: 0,
      args: { id: "unchanged-material", fullName: "Unchanged mock material" },
    })
    await service.mutateInventory({
      command: "save-material",
      expectedRevision: 1,
      args: { id: "adjusted-material", fullName: "Adjusted mock material" },
    })
    const untouchedPath = path.join(root, "inventory", "materials", "unchanged-material.json")
    const before = await stat(untouchedPath)

    await new Promise((resolve) => setTimeout(resolve, 20))
    await service.mutateInventory({
      command: "apply-adjustment",
      expectedRevision: 2,
      args: { materialId: "adjusted-material", input: { kind: "in", quantity: 3 } },
    })

    expect((await stat(untouchedPath)).mtimeMs).toBe(before.mtimeMs)
  })

  it("rejects purging a template referenced by an inventory label", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-data-"))
    cleanupPaths.push(root)
    const service = new DevdDataService(root)
    const saved = await service.mutateRuntime({
      command: "save-template",
      expectedRevision: 0,
      args: { name: "Mock label", document: mockDocument("Mock label") },
    })
    const templateId = saved.data.template.id
    const timestamp = "2026-07-01T00:00:00.000Z"
    await service.mutateInventory({
      command: "save-material",
      expectedRevision: 1,
      args: {
        id: "mock-material",
        fullName: "Mock material",
        labelBindings: [
          {
            id: "mock-binding",
            templateSource: "user-template",
            templateId,
            templateName: "Mock label",
            printQuantity: 1,
            fieldOverrides: {},
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
      },
    })

    await expect(
      service.mutateRuntime({
        command: "purge-template",
        expectedRevision: 2,
        args: { templateId },
      })
    ).rejects.toThrow("still referenced by the inventory material")
    expect((await service.runtimeSnapshot()).templates.map((template) => template.id)).toContain(
      templateId
    )
  })

  it("creates a complete manual backup of every durable data domain", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-data-"))
    cleanupPaths.push(root)
    const service = new DevdDataService(root)
    const timestamp = "2026-08-01T00:00:00.000Z"
    const saved = await service.mutateRuntime({
      command: "save-template",
      expectedRevision: 0,
      args: { name: "Backup mock label", document: mockDocument("Backup mock label") },
    })
    const templateId = saved.data.template.id as string
    await service.mutateRuntime({
      command: "replace-working-copy",
      expectedRevision: 1,
      args: {
        source: { kind: "scratch", presetId: "backup-scratch" },
        document: mockDocument("Backup scratch"),
      },
    })
    await service.mutateInventory({
      command: "save-material",
      expectedRevision: 2,
      args: {
        id: "backup-material",
        fullName: "Backup mock material",
        baseName: "Backup",
        variantName: "Mock",
        packageName: "SOT-583",
        matrixCode: "BACKUP-MOCK-001",
        description: "Complete backup fixture",
        packagingRemark: "reel",
        labelBindings: [
          {
            id: "backup-binding",
            templateSource: "user-template",
            templateId,
            templateName: "Backup mock label",
            printQuantity: 2,
            fieldOverrides: { value: "backup" },
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
        datasheets: [
          {
            title: "Mock datasheet",
            url: "https://example.test/backup.pdf",
            source: "manufacturer",
          },
        ],
      },
    })
    await service.mutateInventory({
      command: "apply-adjustment",
      expectedRevision: 3,
      args: {
        materialId: "backup-material",
        input: { kind: "in", quantity: 12, note: "backup fixture", actor: "test" },
      },
    })
    const expected = await service.exportArchive()

    const backup = await service.createBackup(4)
    const persisted = JSON.parse(
      await readFile(path.join(root, "backups", "manual", backup.data.name), "utf8")
    )

    expect(backup.revision).toBe(5)
    expect(persisted).toMatchObject({ schema: "tuckmark.devd-data-archive.v1" })
    expect(persisted.runtime.settings).toEqual(expected.runtime.settings)
    expect(persisted.runtime.templates).toEqual(expected.runtime.templates)
    expect(persisted.runtime.versions).toEqual(expected.runtime.versions)
    expect(persisted.runtime.workingCopies).toEqual(expected.runtime.workingCopies)
    expect(persisted.inventory).toEqual(expected.inventory)
  })

  it("rejects conflicting archive merges and protects replace imports", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-data-"))
    cleanupPaths.push(root)
    const service = new DevdDataService(root)
    const archive = await service.exportArchive()
    archive.runtime.templates.push({
      id: "same-template",
      name: "Imported",
      description: "",
      width: 40,
      height: 30,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archivedAt: null,
      currentVersionId: "same-version",
      fieldOrder: [],
    })
    archive.runtime.versions.push({
      id: "same-version",
      templateId: "same-template",
      version: 1,
      kind: "saved",
      createdAt: "2026-07-01T00:00:00.000Z",
      label: "Mock imported version",
      document: mockDocument("Imported"),
    })
    await service.mutateRuntime({
      command: "replace-snapshot",
      expectedRevision: 0,
      args: { snapshot: archive.runtime },
    })
    await service.mutateRuntime({
      command: "replace-working-copy",
      expectedRevision: 1,
      args: {
        source: { kind: "scratch", presetId: "custom" },
        document: mockDocument("Discarded scratch mock"),
      },
    })
    const inspection = await service.inspectArchive(archive)
    expect(inspection.conflicts).toContain("template:same-template")
    await expect(
      service.importArchive({
        archive,
        archiveHash: inspection.archiveHash,
        mode: "merge",
        expectedRevision: 2,
      })
    ).rejects.toThrow("Archive merge conflicts")

    const replaced = await service.importArchive({
      archive,
      archiveHash: inspection.archiveHash,
      mode: "replace",
      expectedRevision: 2,
    })
    expect(replaced.revision).toBe(3)
    expect((await readdir(path.join(root, "backups", "protection"))).length).toBe(1)
    await expect(
      readFile(path.join(root, "drafts", "scratch", "custom.json"), "utf8")
    ).rejects.toMatchObject({
      code: "ENOENT",
    })
    expect((await service.runtimeSnapshot()).workingCopies).toEqual([])
  })

  it("retains only the newest twenty DEVD protection snapshots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-data-"))
    cleanupPaths.push(root)
    const service = new DevdDataService(root)
    const archive = await service.exportArchive()
    const inspection = await service.inspectArchive(archive)
    let revision = 0

    for (let index = 0; index < 21; index += 1) {
      const result = await service.importArchive({
        archive,
        archiveHash: inspection.archiveHash,
        mode: "replace",
        expectedRevision: revision,
      })
      revision = result.revision
    }

    expect((await readdir(path.join(root, "backups", "protection"))).length).toBe(20)
  })

  it("rejects an incomplete archive before creating a transaction", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-data-"))
    cleanupPaths.push(root)
    const service = new DevdDataService(root)
    const archive = await service.exportArchive()
    const malformed = structuredClone(archive) as Record<string, any>
    delete malformed.runtime.settings

    await expect(service.inspectArchive(malformed)).rejects.toThrow()
    await expect(readdir(path.join(root, ".transactions"))).rejects.toMatchObject({
      code: "ENOENT",
    })
  })

  it("rejects archive working copies and versions with invalid canvas records", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-data-"))
    cleanupPaths.push(root)
    const service = new DevdDataService(root)

    const invalidWorkingCopyArchive = await service.exportArchive()
    invalidWorkingCopyArchive.runtime.workingCopies.push({
      sourceKey: "invalid:mock",
      source: { kind: "invalid", presetId: "mock" },
      draft: {},
      updatedAt: "2026-07-01T00:00:00.000Z",
    } as any)
    await expect(service.inspectArchive(invalidWorkingCopyArchive)).rejects.toThrow()

    const invalidVersionArchive = await service.exportArchive()
    invalidVersionArchive.runtime.templates.push({
      id: "invalid-version-template",
      name: "Invalid version template",
      description: "",
      width: 40,
      height: 20,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      archivedAt: null,
      currentVersionId: "invalid-version",
      fieldOrder: [],
    })
    invalidVersionArchive.runtime.versions.push({
      id: "invalid-version",
      templateId: "invalid-version-template",
      version: 1,
      kind: "saved",
      createdAt: "2026-07-01T00:00:00.000Z",
      label: "Invalid mock version",
      document: {},
    } as any)
    await expect(service.inspectArchive(invalidVersionArchive)).rejects.toThrow()

    const invalidElementArchive = await service.exportArchive()
    invalidElementArchive.runtime.templates.push({
      id: "invalid-element-template",
      name: "Invalid element template",
      description: "",
      width: 40,
      height: 20,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      archivedAt: null,
      currentVersionId: "invalid-element-version",
      fieldOrder: [],
    })
    invalidElementArchive.runtime.versions.push({
      id: "invalid-element-version",
      templateId: "invalid-element-template",
      version: 1,
      kind: "saved",
      createdAt: "2026-07-01T00:00:00.000Z",
      label: "Invalid mock element",
      document: { ...mockDocument("Invalid mock element"), elements: [{}] },
    } as any)
    await expect(service.inspectArchive(invalidElementArchive)).rejects.toThrow()
  })

  it("rejects duplicate records inside an imported archive", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-data-"))
    cleanupPaths.push(root)
    const service = new DevdDataService(root)
    const archive = await service.exportArchive()
    const timestamp = "2026-07-01T00:00:00.000Z"
    const template = {
      id: "duplicate-template",
      name: "Duplicate template",
      description: "",
      width: 40,
      height: 20,
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
      currentVersionId: "duplicate-version",
      fieldOrder: [],
    }
    archive.runtime.templates.push(template, { ...template })
    await expect(service.inspectArchive(archive)).rejects.toThrow("duplicate template")

    const materialArchive = await service.exportArchive()
    const material = {
      id: "duplicate-material-a",
      fullName: "Duplicate material",
      description: "",
      matrixCode: "DUPLICATE-MATRIX",
      packagingRemark: "",
      currentQuantity: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
      labelBindings: [],
    }
    materialArchive.inventory.materials.push(material, {
      ...material,
      id: "duplicate-material-b",
    })
    await expect(service.inspectArchive(materialArchive)).rejects.toThrow("duplicate material name")
  })

  it("rejects archives with orphaned cross-record references", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-data-"))
    cleanupPaths.push(root)
    const service = new DevdDataService(root)
    const archive = await service.exportArchive()
    archive.inventory.adjustments.push({
      id: "orphan-adjustment",
      materialId: "missing-material",
      kind: "in",
      quantityDelta: 3,
      targetQuantity: null,
      quantityAfter: 3,
      note: "mock orphan",
      actor: "mock",
      createdAt: "2026-07-01T00:00:00.000Z",
    })

    await expect(service.inspectArchive(archive)).rejects.toThrow("unknown material")

    const templateArchive = await service.exportArchive()
    templateArchive.runtime.templates.push({
      id: "orphan-template",
      name: "Orphan template",
      description: "",
      width: 40,
      height: 20,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      archivedAt: null,
      currentVersionId: "missing-version",
      fieldOrder: [],
    })
    await expect(service.inspectArchive(templateArchive)).rejects.toThrow("unknown current version")
  })

  it("recovers a prepared transaction through the shared data service", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-data-"))
    cleanupPaths.push(root)
    await mkdir(path.join(root, ".tuckmark", "transactions"), { recursive: true })
    await writeFile(
      path.join(root, ".tuckmark", "transactions", "recover.json"),
      JSON.stringify({
        schema: "tuckmark.devd-data-transaction.v1",
        revision: 1,
        writes: [
          {
            relativePath: "inventory/materials/recovered-material.json",
            value: {
              id: "recovered-material",
              fullName: "Recovered mock material",
              description: "",
              packagingRemark: "",
              currentQuantity: 1,
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z",
              labelBindings: [],
            },
          },
        ],
        deletes: [],
        event: { revision: 1, domains: ["inventory"], reason: "recovered-mock" },
      })
    )
    const service = new DevdDataService(root)

    expect((await service.readMaterials()).data.map((material) => material.id)).toContain(
      "recovered-material"
    )
    expect((await service.status()).revision).toBe(1)
  })
})
