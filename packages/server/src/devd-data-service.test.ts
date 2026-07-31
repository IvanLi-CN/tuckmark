import { mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { DevdDataConflictError, DevdDataService } from "./devd-data-service.js"

const cleanupPaths: string[] = []

afterEach(async () => {
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
    await service.mutateRuntime({
      command: "replace-snapshot",
      expectedRevision: 0,
      args: { snapshot: archive.runtime },
    })
    const inspection = await service.inspectArchive(archive)
    expect(inspection.conflicts).toContain("template:same-template")
    await expect(
      service.importArchive({
        archive,
        archiveHash: inspection.archiveHash,
        mode: "merge",
        expectedRevision: 1,
      })
    ).rejects.toThrow("Archive merge conflicts")

    const replaced = await service.importArchive({
      archive,
      archiveHash: inspection.archiveHash,
      mode: "replace",
      expectedRevision: 1,
    })
    expect(replaced.revision).toBe(2)
    expect((await readdir(path.join(root, "backups", "protection"))).length).toBe(1)
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
})
