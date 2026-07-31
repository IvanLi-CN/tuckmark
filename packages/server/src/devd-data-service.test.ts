import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
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
