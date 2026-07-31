import { createHash, randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  applyInventoryAdjustment,
  ensureInventoryMaterialActive,
  ensureInventoryMaterialDeletionAllowed,
  type InventoryAdjustment,
  type InventoryAdjustmentInput,
  type InventoryMaterial,
  inventoryAdjustmentSchema,
  inventoryMaterialSchema,
  materialMatchesQuery,
  sortInventoryAdjustmentsNewestFirst,
  sortInventoryMaterialsByName,
} from "@tuckmark/inventory"
import { z } from "zod"

const STATE_SCHEMA = "tuckmark.devd-data-state.v1"
const TRANSACTION_SCHEMA = "tuckmark.devd-data-transaction.v1"
const MANIFEST_SCHEMA = "tuckmark.data-dir-manifest.v1"
const DEFAULT_SETTINGS = {
  version: 2,
  updatedAt: "1970-01-01T00:00:00.000Z",
  documentDefaults: {
    printerDpi: 203,
    printWidthDots: 384,
    paperType: "continuous",
    threshold: 150,
    xOffsetMm: 0,
    yOffsetMm: 0,
    printStrengthLevel: 0,
  },
  printerModelPresets: {},
  printerDeviceCalibrations: {},
  permissionNudgeSeen: false,
  showTextBoundingBoxes: false,
}

export type DevdDataDomain = "templates" | "inventory" | "settings" | "archive"

export type DevdDataRevisionEvent = {
  revision: number
  domains: DevdDataDomain[]
  reason: string
}

export class DevdDataConflictError extends Error {
  readonly code = "revision_conflict"

  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number
  ) {
    super(`Data revision changed from ${expectedRevision} to ${actualRevision}.`)
  }
}

export class DevdDataNotFoundError extends Error {
  readonly code = "not_found"
}

export class DevdDataUnavailableError extends Error {
  readonly code = "data_directory_unavailable"
}

type JsonWrite = { relativePath: string; value: unknown }

type PersistedTransaction = {
  schema: typeof TRANSACTION_SCHEMA
  revision: number
  writes: JsonWrite[]
  deletes: string[]
  event: DevdDataRevisionEvent
}

type TemplateRecord = {
  id: string
  name: string
  description: string
  width: number
  height: number
  createdAt: string
  updatedAt: string
  archivedAt?: string | null
  currentVersionId: string
  fieldOrder: string[]
  recommendedUses?: Array<{ scope: string; weight: number }>
}

type VersionRecord = {
  id: string
  templateId: string
  version: number
  kind: "saved" | "autosave"
  createdAt: string
  label: string
  sourceVersionId?: string
  document: Record<string, any>
}

type WorkingCopyRecord = {
  sourceKey: string
  source: Record<string, any>
  templateId?: string
  draft: Record<string, any>
  updatedAt: string
  baseVersionId?: string
}

export type RuntimeMutation = {
  command:
    | "save-template"
    | "rename-template"
    | "archive-template"
    | "restore-template"
    | "purge-template"
    | "save-autosave"
    | "replace-working-copy"
    | "clear-working-copy"
    | "clear-template-autosaves"
    | "save-settings"
    | "replace-snapshot"
  expectedRevision: number
  args: Record<string, any>
}

export type InventoryMutation = {
  command:
    | "save-material"
    | "archive-material"
    | "restore-material"
    | "delete-material"
    | "apply-adjustment"
  expectedRevision: number
  args: Record<string, any>
}

export type DevdDataArchive = {
  schema: "tuckmark.devd-data-archive.v1"
  exportedAt: string
  runtime: any
  inventory: {
    materials: InventoryMaterial[]
    adjustments: InventoryAdjustment[]
  }
}

const templateRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  archivedAt: z.string().nullable().optional(),
  currentVersionId: z.string().min(1),
  fieldOrder: z.array(z.string()),
  recommendedUses: z
    .array(z.object({ scope: z.string().min(1), weight: z.number().int().min(1).max(100) }))
    .optional(),
})

const versionRecordSchema = z.object({
  id: z.string().min(1),
  templateId: z.string().min(1),
  version: z.number().int().positive(),
  kind: z.enum(["saved", "autosave"]),
  createdAt: z.string().min(1),
  label: z.string(),
  sourceVersionId: z.string().optional(),
  document: z.record(z.string(), z.unknown()),
})

const workingCopyRecordSchema = z.object({
  sourceKey: z.string().min(1),
  source: z.record(z.string(), z.unknown()),
  templateId: z.string().optional(),
  draft: z.record(z.string(), z.unknown()),
  updatedAt: z.string().min(1),
  baseVersionId: z.string().optional(),
})

const devdDataArchiveSchema = z.object({
  schema: z.literal("tuckmark.devd-data-archive.v1"),
  exportedAt: z.string().min(1),
  runtime: z.object({
    schema: z.literal("tuckmark.runtime-export.v1"),
    exportedAt: z.string().min(1),
    snapshotUpdatedAt: z.string().nullable(),
    settings: z.record(z.string(), z.unknown()),
    templates: z.array(templateRecordSchema),
    versions: z.array(versionRecordSchema),
    workingCopies: z.array(workingCopyRecordSchema),
  }),
  inventory: z.object({
    materials: z.array(inventoryMaterialSchema),
    adjustments: z.array(inventoryAdjustmentSchema),
  }),
})

export type DevdArchiveInspection = {
  archiveHash: string
  summary: {
    templates: number
    versions: number
    workingCopies: number
    materials: number
    adjustments: number
  }
  conflicts: string[]
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function createSourceKey(source: Record<string, any>): string {
  if (source.kind === "user-template") return `user:${source.templateId}`
  if (source.kind === "preset-template") return `preset:${source.presetId}`
  return `scratch:${source.presetId}`
}

function safeSegment(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("Invalid data identifier.")
  return value
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT"
}

async function readJsonIfPresent<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

async function listJsonFiles(root: string): Promise<string[]> {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(root, entry.name))
      .sort()
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}

async function listDirectories(root: string): Promise<string[]> {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  await rename(temporaryPath, filePath)
}

export class DevdDataService {
  private mutationQueue: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<(event: DevdDataRevisionEvent) => void>()

  constructor(private readonly dataDir: string) {
    if (!dataDir.trim()) throw new DevdDataUnavailableError("Data directory is not configured.")
  }

  static fromEnvironment(): DevdDataService | null {
    const root = process.env.TUCKMARK_DATA_DIR?.trim()
    return root ? new DevdDataService(path.resolve(root)) : null
  }

  subscribe(listener: (event: DevdDataRevisionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async status() {
    await this.recoverTransactions()
    const revision = await this.readRevision()
    const snapshot = await this.runtimeSnapshot(false)
    const materials = await this.listMaterials("", true, false)
    const adjustments = await this.listAdjustments(undefined, false)
    return {
      configured: true,
      health: "healthy" as const,
      directoryName: path.basename(this.dataDir),
      revision,
      counts: {
        templates: snapshot.templates.length,
        versions: snapshot.versions.length,
        workingCopies: snapshot.workingCopies.length,
        materials: materials.length,
        adjustments: adjustments.length,
      },
    }
  }

  async runtimeSnapshot(recover = true) {
    if (recover) await this.recoverTransactions()
    const templateIds = await listDirectories(path.join(this.dataDir, "templates"))
    const templates: TemplateRecord[] = []
    const versions: VersionRecord[] = []
    const workingCopies: WorkingCopyRecord[] = []
    for (const templateId of templateIds) {
      const root = path.join(this.dataDir, "templates", safeSegment(templateId))
      const template = await readJsonIfPresent<TemplateRecord>(path.join(root, "template.json"))
      if (!template) continue
      templates.push(template)
      for (const versionPath of await listJsonFiles(path.join(root, "versions"))) {
        versions.push(JSON.parse(await readFile(versionPath, "utf8")) as VersionRecord)
      }
      const workingCopy = await readJsonIfPresent<WorkingCopyRecord>(
        path.join(root, "working-copy.json")
      )
      if (workingCopy) workingCopies.push(workingCopy)
    }
    const scratch = await readJsonIfPresent<WorkingCopyRecord>(
      path.join(this.dataDir, "drafts", "scratch.json")
    )
    if (scratch) workingCopies.push(scratch)
    const settings =
      (await readJsonIfPresent<Record<string, any>>(
        path.join(this.dataDir, "settings", "app-settings.json")
      )) ?? clone(DEFAULT_SETTINGS)
    const timestamps = [
      settings.updatedAt,
      ...templates.map((item) => item.updatedAt),
      ...versions.map((item) => item.createdAt),
      ...workingCopies.map((item) => item.updatedAt),
    ].filter(Boolean)
    return {
      schema: "tuckmark.runtime-export.v1" as const,
      exportedAt: new Date().toISOString(),
      snapshotUpdatedAt: timestamps.sort().at(-1) ?? null,
      settings,
      templates,
      versions,
      workingCopies,
    }
  }

  async readRuntimeSnapshot() {
    return await this.serialize(async () => {
      await this.recoverTransactions()
      const revision = await this.readRevision()
      return { revision, data: await this.runtimeSnapshot(false) }
    })
  }

  async readMaterials(query = "", includeArchived = false) {
    return await this.serialize(async () => {
      await this.recoverTransactions()
      const revision = await this.readRevision()
      return { revision, data: await this.listMaterials(query, includeArchived, false) }
    })
  }

  async readAdjustments(materialId?: string) {
    return await this.serialize(async () => {
      await this.recoverTransactions()
      const revision = await this.readRevision()
      return { revision, data: await this.listAdjustments(materialId, false) }
    })
  }

  async currentRevision(): Promise<number> {
    return await this.serialize(async () => {
      await this.recoverTransactions()
      return await this.readRevision()
    })
  }

  async listMaterials(
    query = "",
    includeArchived = false,
    recover = true
  ): Promise<InventoryMaterial[]> {
    if (recover) await this.recoverTransactions()
    const materials = await Promise.all(
      (await listJsonFiles(path.join(this.dataDir, "inventory", "materials"))).map(
        async (filePath) =>
          inventoryMaterialSchema.parse(JSON.parse(await readFile(filePath, "utf8")))
      )
    )
    return materials
      .filter((material) => includeArchived || !material.archivedAt)
      .filter((material) => materialMatchesQuery(material, query))
      .sort(sortInventoryMaterialsByName)
  }

  async listAdjustments(materialId?: string, recover = true): Promise<InventoryAdjustment[]> {
    if (recover) await this.recoverTransactions()
    const adjustments = await Promise.all(
      (await listJsonFiles(path.join(this.dataDir, "inventory", "adjustments"))).map(
        async (filePath) =>
          inventoryAdjustmentSchema.parse(JSON.parse(await readFile(filePath, "utf8")))
      )
    )
    return adjustments
      .filter((entry) => !materialId || entry.materialId === materialId)
      .sort(sortInventoryAdjustmentsNewestFirst)
  }

  async mutateRuntime(input: RuntimeMutation): Promise<{ revision: number; data: any }> {
    return await this.serialize(async () => {
      await this.recoverTransactions()
      await this.assertRevision(input.expectedRevision)
      const snapshot = await this.runtimeSnapshot(false)
      const result = this.applyRuntimeCommand(snapshot, input.command, input.args)
      const writes = this.snapshotWrites(result.snapshot)
      const deletes = await this.snapshotDeletes(result.snapshot)
      const revision = await this.commit({
        expectedRevision: input.expectedRevision,
        writes,
        deletes,
        domains: input.command === "save-settings" ? ["settings"] : ["templates"],
        reason: input.command,
      })
      return { revision, data: result.data }
    })
  }

  async mutateInventory(input: InventoryMutation): Promise<{ revision: number; data: any }> {
    return await this.serialize(async () => {
      await this.recoverTransactions()
      await this.assertRevision(input.expectedRevision)
      const materials = await this.listMaterials("", true, false)
      const adjustments = await this.listAdjustments(undefined, false)
      const result = this.applyInventoryCommand(materials, adjustments, input.command, input.args)
      const writes: JsonWrite[] = result.materials.map((material) => ({
        relativePath: `inventory/materials/${safeSegment(material.id)}.json`,
        value: material,
      }))
      writes.push(
        ...result.adjustments.map((adjustment) => ({
          relativePath: `inventory/adjustments/${safeSegment(adjustment.id)}.json`,
          value: adjustment,
        }))
      )
      const existingMaterialIds = new Set(materials.map((item) => item.id))
      const nextMaterialIds = new Set(result.materials.map((item) => item.id))
      const deletes = [...existingMaterialIds]
        .filter((id) => !nextMaterialIds.has(id))
        .map((id) => `inventory/materials/${safeSegment(id)}.json`)
      const revision = await this.commit({
        expectedRevision: input.expectedRevision,
        writes,
        deletes,
        domains: ["inventory"],
        reason: input.command,
      })
      return { revision, data: result.data }
    })
  }

  async exportArchive(): Promise<DevdDataArchive> {
    return (await this.readArchive()).data
  }

  async readArchive(): Promise<{ revision: number; data: DevdDataArchive }> {
    return await this.serialize(async () => {
      await this.recoverTransactions()
      const revision = await this.readRevision()
      return {
        revision,
        data: this.buildArchive(
          await this.runtimeSnapshot(false),
          await this.listMaterials("", true, false),
          await this.listAdjustments(undefined, false)
        ),
      }
    })
  }

  async inspectArchive(input: unknown): Promise<DevdArchiveInspection> {
    const archive = this.parseArchive(input)
    const [runtime, materials, adjustments] = await Promise.all([
      this.runtimeSnapshot(),
      this.listMaterials("", true),
      this.listAdjustments(),
    ])
    const conflicts = this.findArchiveConflicts(archive, runtime, materials, adjustments)
    return {
      archiveHash: this.hashArchive(archive),
      summary: {
        templates: archive.runtime.templates.length,
        versions: archive.runtime.versions.length,
        workingCopies: archive.runtime.workingCopies.length,
        materials: archive.inventory.materials.length,
        adjustments: archive.inventory.adjustments.length,
      },
      conflicts,
    }
  }

  async importArchive(input: {
    archive: unknown
    archiveHash: string
    mode: "merge" | "replace"
    expectedRevision: number
  }): Promise<{ revision: number; data: DevdArchiveInspection }> {
    return await this.serialize(async () => {
      await this.recoverTransactions()
      await this.assertRevision(input.expectedRevision)
      const archive = this.parseArchive(input.archive)
      if (this.hashArchive(archive) !== input.archiveHash)
        throw new Error("Archive content changed after inspection.")
      const currentRuntime = await this.runtimeSnapshot(false)
      const currentMaterials = await this.listMaterials("", true, false)
      const currentAdjustments = await this.listAdjustments(undefined, false)
      const inspection = await this.inspectArchive(archive)
      if (input.mode === "merge" && inspection.conflicts.length > 0) {
        throw new Error(`Archive merge conflicts: ${inspection.conflicts.join(", ")}`)
      }
      const runtime =
        input.mode === "replace"
          ? archive.runtime
          : {
              ...currentRuntime,
              templates: [...currentRuntime.templates, ...archive.runtime.templates],
              versions: [...currentRuntime.versions, ...archive.runtime.versions],
              workingCopies: [...currentRuntime.workingCopies, ...archive.runtime.workingCopies],
            }
      const materials =
        input.mode === "replace"
          ? archive.inventory.materials
          : [...currentMaterials, ...archive.inventory.materials]
      const adjustments =
        input.mode === "replace"
          ? archive.inventory.adjustments
          : [...currentAdjustments, ...archive.inventory.adjustments]
      const protection = this.buildArchive(currentRuntime, currentMaterials, currentAdjustments)
      const writes = [
        ...this.snapshotWrites(runtime),
        ...this.inventoryWrites(materials, adjustments),
        {
          relativePath: `backups/protection/${Date.now()}-${randomUUID()}.json`,
          value: protection,
        },
      ]
      const deletes = [
        ...(await this.snapshotDeletes(runtime)),
        ...(await this.inventoryDeletes(materials, adjustments)),
      ]
      const revision = await this.commit({
        expectedRevision: input.expectedRevision,
        writes,
        deletes,
        domains: ["templates", "inventory", "archive"],
        reason: `archive-${input.mode}`,
      })
      return { revision, data: inspection }
    })
  }

  async createBackup(
    expectedRevision: number
  ): Promise<{ revision: number; data: { name: string } }> {
    return await this.serialize(async () => {
      await this.recoverTransactions()
      await this.assertRevision(expectedRevision)
      const archive = this.buildArchive(
        await this.runtimeSnapshot(false),
        await this.listMaterials("", true, false),
        await this.listAdjustments(undefined, false)
      )
      const name = `${Date.now()}-${randomUUID()}.json`
      const revision = await this.commit({
        expectedRevision,
        writes: [{ relativePath: `backups/manual/${name}`, value: archive }],
        deletes: [],
        domains: ["archive"],
        reason: "backup-created",
      })
      return { revision, data: { name } }
    })
  }

  async commitJsonWrites(args: {
    writes: JsonWrite[]
    deletes?: string[]
    domains: DevdDataDomain[]
    reason: string
    expectedRevision: number
  }): Promise<number> {
    return await this.serialize(async () => {
      await this.recoverTransactions()
      return await this.commit({
        expectedRevision: args.expectedRevision,
        writes: args.writes,
        deletes: args.deletes ?? [],
        domains: args.domains,
        reason: args.reason,
      })
    })
  }

  private applyRuntimeCommand(snapshot: any, command: RuntimeMutation["command"], args: any) {
    const now = new Date().toISOString()
    const templates: TemplateRecord[] = clone(snapshot.templates)
    const versions: VersionRecord[] = clone(snapshot.versions)
    const workingCopies: WorkingCopyRecord[] = clone(snapshot.workingCopies)
    const findTemplate = (id: string) => templates.find((item) => item.id === id)
    const summary = (template: TemplateRecord) => {
      const working = workingCopies.find((item) => item.sourceKey === `user:${template.id}`)
      const version = versions.find((item) => item.id === template.currentVersionId)
      const document = working?.draft ?? version?.document ?? null
      return { ...template, fields: document?.fields ?? [], document }
    }
    let data: any = null

    if (command === "save-template") {
      const templateId = args.templateId ?? `user-template-${randomUUID()}`
      const existing = findTemplate(templateId)
      const nextVersion =
        Math.max(0, ...versions.filter((v) => v.templateId === templateId).map((v) => v.version)) +
        1
      const versionId = `user-template-version-${randomUUID()}`
      const document = {
        ...clone(args.document),
        templateId,
        source: { kind: "user-template", templateId },
        baseVersionId: undefined,
        lastSavedAt: now,
        name: args.name,
      }
      const version: VersionRecord = {
        id: versionId,
        templateId,
        version: nextVersion,
        kind: "saved",
        createdAt: now,
        label: `已保存版本 ${nextVersion}`,
        sourceVersionId: args.sourceVersionId,
        document,
      }
      versions.push(version)
      for (let index = versions.length - 1; index >= 0; index -= 1) {
        const entry = versions[index]
        if (entry?.templateId === templateId && entry?.kind === "autosave")
          versions.splice(index, 1)
      }
      const template: TemplateRecord = {
        id: templateId,
        name: args.name,
        description: args.description ?? existing?.description ?? "",
        width: document.width,
        height: document.height,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        archivedAt: existing?.archivedAt ?? null,
        currentVersionId: versionId,
        fieldOrder: (document.fields ?? []).map((field: any) => field.key),
        recommendedUses: existing?.recommendedUses ?? [],
      }
      if (existing) Object.assign(existing, template)
      else templates.push(template)
      const workingCopy: WorkingCopyRecord = {
        sourceKey: `user:${templateId}`,
        source: { kind: "user-template", templateId },
        templateId,
        draft: document,
        updatedAt: now,
        baseVersionId: versionId,
      }
      const existingWorking = workingCopies.findIndex(
        (item) => item.sourceKey === workingCopy.sourceKey
      )
      if (existingWorking >= 0) workingCopies[existingWorking] = workingCopy
      else workingCopies.push(workingCopy)
      data = { template: summary(template), version, workingCopy }
    } else if (command === "rename-template") {
      const template = findTemplate(args.templateId)
      if (!template) throw new DevdDataNotFoundError("Template was not found.")
      template.name = String(args.name).trim()
      template.updatedAt = now
      const working = workingCopies.find((item) => item.sourceKey === `user:${template.id}`)
      if (working) {
        working.updatedAt = now
        working.draft.name = template.name
      }
      data = summary(template)
    } else if (command === "archive-template" || command === "restore-template") {
      const template = findTemplate(args.templateId)
      if (!template) throw new DevdDataNotFoundError("Template was not found.")
      template.archivedAt = command === "archive-template" ? now : null
      template.updatedAt = now
      data = summary(template)
    } else if (command === "purge-template") {
      const index = templates.findIndex((item) => item.id === args.templateId)
      if (index < 0) throw new DevdDataNotFoundError("Template was not found.")
      templates.splice(index, 1)
      for (let i = versions.length - 1; i >= 0; i -= 1)
        if (versions[i]?.templateId === args.templateId) versions.splice(i, 1)
      for (let i = workingCopies.length - 1; i >= 0; i -= 1)
        if (workingCopies[i]?.templateId === args.templateId) workingCopies.splice(i, 1)
    } else if (command === "save-autosave" || command === "replace-working-copy") {
      const sourceKey = createSourceKey(args.source)
      const workingCopy: WorkingCopyRecord = {
        sourceKey,
        source: clone(args.source),
        templateId: args.templateId,
        draft: clone(args.document),
        updatedAt: now,
        baseVersionId: args.sourceVersionId,
      }
      const existing = workingCopies.findIndex((item) => item.sourceKey === sourceKey)
      if (existing >= 0) workingCopies[existing] = workingCopy
      else workingCopies.push(workingCopy)
      if (command === "save-autosave" && args.templateId) {
        const last = versions
          .filter((item) => item.templateId === args.templateId && item.kind === "autosave")
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .at(-1)
        if (!last || Date.parse(now) - Date.parse(last.createdAt) >= 30_000) {
          versions.push({
            id: `user-template-autosave-${randomUUID()}`,
            templateId: args.templateId,
            version:
              Math.max(
                0,
                ...versions.filter((v) => v.templateId === args.templateId).map((v) => v.version)
              ) + 1,
            kind: "autosave",
            createdAt: now,
            label: "未保存草稿",
            sourceVersionId: args.sourceVersionId,
            document: clone(args.document),
          })
        }
      }
      data = workingCopy
    } else if (command === "clear-working-copy") {
      const key = createSourceKey(args.source)
      const index = workingCopies.findIndex((item) => item.sourceKey === key)
      if (index >= 0) workingCopies.splice(index, 1)
    } else if (command === "clear-template-autosaves") {
      for (let i = versions.length - 1; i >= 0; i -= 1) {
        const entry = versions[i]
        if (entry?.templateId === args.templateId && entry?.kind === "autosave")
          versions.splice(i, 1)
      }
    } else if (command === "save-settings") {
      snapshot.settings = { ...snapshot.settings, ...clone(args.patch), version: 2, updatedAt: now }
      data = snapshot.settings
    } else if (command === "replace-snapshot") {
      return { snapshot: clone(args.snapshot), data: null }
    }

    return { snapshot: { ...snapshot, templates, versions, workingCopies }, data }
  }

  private applyInventoryCommand(
    currentMaterials: InventoryMaterial[],
    currentAdjustments: InventoryAdjustment[],
    command: InventoryMutation["command"],
    args: any
  ) {
    const materials = clone(currentMaterials)
    const adjustments = clone(currentAdjustments)
    const existing = args.materialId
      ? materials.find((item) => item.id === args.materialId)
      : args.id
        ? materials.find((item) => item.id === args.id)
        : undefined
    const now = new Date().toISOString()
    let data: any = null
    if (command === "save-material") {
      if (existing) ensureInventoryMaterialActive(existing, "编辑")
      const material = inventoryMaterialSchema.parse({
        id: args.id ?? `inventory-material-${randomUUID()}`,
        fullName: String(args.fullName).trim(),
        baseName: args.baseName?.trim() || undefined,
        variantName: args.variantName?.trim() || undefined,
        packageName: args.packageName?.trim() || undefined,
        description: args.description?.trim() ?? "",
        matrixCode: args.matrixCode?.trim() || undefined,
        packagingRemark: args.packagingRemark?.trim() ?? "",
        currentQuantity: existing?.currentQuantity ?? 0,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        archivedAt: existing?.archivedAt ?? null,
        labelBindings: args.labelBindings ?? existing?.labelBindings ?? [],
        datasheets: args.datasheets ?? existing?.datasheets ?? [],
      })
      this.ensureMaterialUnique(materials, material)
      const index = materials.findIndex((item) => item.id === material.id)
      if (index >= 0) materials[index] = material
      else materials.push(material)
      data = material
    } else if (command === "archive-material" || command === "restore-material") {
      if (!existing) throw new DevdDataNotFoundError("Material was not found.")
      const material = inventoryMaterialSchema.parse({
        ...existing,
        archivedAt: command === "archive-material" ? now : null,
        updatedAt: now,
      })
      if (command === "restore-material") this.ensureMaterialUnique(materials, material)
      materials[materials.indexOf(existing)] = material
      data = material
    } else if (command === "delete-material") {
      if (!existing) throw new DevdDataNotFoundError("Material was not found.")
      ensureInventoryMaterialDeletionAllowed({
        material: existing,
        adjustments: adjustments.filter((item) => item.materialId === existing.id),
      })
      materials.splice(materials.indexOf(existing), 1)
    } else if (command === "apply-adjustment") {
      if (!existing) throw new DevdDataNotFoundError("Material was not found.")
      ensureInventoryMaterialActive(existing, "调整库存")
      const result = applyInventoryAdjustment({
        material: existing,
        input: args.input as InventoryAdjustmentInput,
        adjustmentId: `inventory-adjustment-${randomUUID()}`,
      })
      materials[materials.indexOf(existing)] = result.material
      adjustments.push(result.adjustment)
      data = result
    }
    return { materials, adjustments, data }
  }

  private ensureMaterialUnique(materials: InventoryMaterial[], draft: InventoryMaterial) {
    if (materials.some((item) => item.id !== draft.id && item.fullName === draft.fullName)) {
      throw new Error(`物料型号 ${draft.fullName} 已存在。`)
    }
    if (
      draft.matrixCode &&
      materials.some((item) => item.id !== draft.id && item.matrixCode === draft.matrixCode)
    ) {
      throw new Error(`矩阵码 ${draft.matrixCode} 已被使用。`)
    }
  }

  private parseArchive(input: unknown): DevdDataArchive {
    const archive = devdDataArchiveSchema.parse(clone(input)) as DevdDataArchive
    this.ensureArchiveRecordsAreUnique(archive)
    return archive
  }

  private ensureArchiveRecordsAreUnique(archive: DevdDataArchive): void {
    const assertUnique = (description: string, values: Array<string | undefined>) => {
      const seen = new Set<string>()
      for (const value of values) {
        if (!value) continue
        if (seen.has(value)) {
          throw new Error(`Archive contains duplicate ${description}: ${value}.`)
        }
        seen.add(value)
      }
    }

    assertUnique(
      "template",
      (archive.runtime.templates as TemplateRecord[]).map((item) => item.id)
    )
    assertUnique(
      "version",
      (archive.runtime.versions as VersionRecord[]).map((item) => item.id)
    )
    assertUnique(
      "template version",
      (archive.runtime.versions as VersionRecord[]).map(
        (item) => `${item.templateId}:${item.version}`
      )
    )
    assertUnique(
      "working copy",
      (archive.runtime.workingCopies as WorkingCopyRecord[]).map((item) => item.sourceKey)
    )
    assertUnique(
      "material",
      archive.inventory.materials.map((item) => item.id)
    )
    assertUnique(
      "material name",
      archive.inventory.materials.map((item) => item.fullName)
    )
    assertUnique(
      "matrix code",
      archive.inventory.materials.map((item) => item.matrixCode)
    )
    assertUnique(
      "adjustment",
      archive.inventory.adjustments.map((item) => item.id)
    )
  }

  private hashArchive(archive: DevdDataArchive): string {
    return createHash("sha256").update(JSON.stringify(archive)).digest("hex")
  }

  private buildArchive(
    runtime: any,
    materials: InventoryMaterial[],
    adjustments: InventoryAdjustment[]
  ): DevdDataArchive {
    return {
      schema: "tuckmark.devd-data-archive.v1",
      exportedAt: new Date().toISOString(),
      runtime: clone(runtime),
      inventory: { materials: clone(materials), adjustments: clone(adjustments) },
    }
  }

  private findArchiveConflicts(
    archive: DevdDataArchive,
    runtime: any,
    materials: InventoryMaterial[],
    adjustments: InventoryAdjustment[]
  ): string[] {
    const conflicts = new Set<string>()
    const templateIds = new Set(runtime.templates.map((item: TemplateRecord) => item.id))
    const versionIds = new Set(runtime.versions.map((item: VersionRecord) => item.id))
    const workingKeys = new Set(
      runtime.workingCopies.map((item: WorkingCopyRecord) => item.sourceKey)
    )
    const materialIds = new Set(materials.map((item) => item.id))
    const materialNames = new Set(materials.map((item) => item.fullName))
    const matrixCodes = new Set(materials.map((item) => item.matrixCode).filter(Boolean))
    const adjustmentIds = new Set(adjustments.map((item) => item.id))
    for (const item of archive.runtime.templates as TemplateRecord[])
      if (templateIds.has(item.id)) conflicts.add(`template:${item.id}`)
    for (const item of archive.runtime.versions as VersionRecord[])
      if (versionIds.has(item.id)) conflicts.add(`version:${item.id}`)
    for (const item of archive.runtime.workingCopies as WorkingCopyRecord[])
      if (workingKeys.has(item.sourceKey)) conflicts.add(`working-copy:${item.sourceKey}`)
    for (const item of archive.inventory.materials) {
      if (materialIds.has(item.id)) conflicts.add(`material:${item.id}`)
      if (materialNames.has(item.fullName)) conflicts.add(`material-name:${item.fullName}`)
      if (item.matrixCode && matrixCodes.has(item.matrixCode))
        conflicts.add(`matrix-code:${item.matrixCode}`)
    }
    for (const item of archive.inventory.adjustments)
      if (adjustmentIds.has(item.id)) conflicts.add(`adjustment:${item.id}`)
    return [...conflicts].sort()
  }

  private snapshotWrites(snapshot: any): JsonWrite[] {
    const writes: JsonWrite[] = [
      { relativePath: "settings/app-settings.json", value: snapshot.settings },
    ]
    for (const template of snapshot.templates as TemplateRecord[]) {
      writes.push({
        relativePath: `templates/${safeSegment(template.id)}/template.json`,
        value: template,
      })
    }
    for (const version of snapshot.versions as VersionRecord[]) {
      writes.push({
        relativePath: `templates/${safeSegment(version.templateId)}/versions/${safeSegment(version.id)}.json`,
        value: version,
      })
    }
    for (const working of snapshot.workingCopies as WorkingCopyRecord[]) {
      const relativePath = working.templateId
        ? `templates/${safeSegment(working.templateId)}/working-copy.json`
        : "drafts/scratch.json"
      writes.push({ relativePath, value: working })
    }
    return writes
  }

  private async snapshotDeletes(snapshot: any): Promise<string[]> {
    const desired = new Set(this.snapshotWrites(snapshot).map((item) => item.relativePath))
    const existing: string[] = []
    for (const templateId of await listDirectories(path.join(this.dataDir, "templates"))) {
      const root = path.join(this.dataDir, "templates", safeSegment(templateId))
      existing.push(
        `templates/${templateId}/template.json`,
        `templates/${templateId}/working-copy.json`
      )
      for (const filePath of await listJsonFiles(path.join(root, "versions"))) {
        existing.push(`templates/${templateId}/versions/${path.basename(filePath)}`)
      }
    }
    existing.push("drafts/scratch.json")
    return existing.filter((relativePath) => !desired.has(relativePath))
  }

  private inventoryWrites(
    materials: InventoryMaterial[],
    adjustments: InventoryAdjustment[]
  ): JsonWrite[] {
    return [
      ...materials.map((item) => ({
        relativePath: `inventory/materials/${safeSegment(item.id)}.json`,
        value: item,
      })),
      ...adjustments.map((item) => ({
        relativePath: `inventory/adjustments/${safeSegment(item.id)}.json`,
        value: item,
      })),
    ]
  }

  private async inventoryDeletes(
    materials: InventoryMaterial[],
    adjustments: InventoryAdjustment[]
  ): Promise<string[]> {
    const desired = new Set(
      this.inventoryWrites(materials, adjustments).map((item) => item.relativePath)
    )
    const existing = [
      ...(await listJsonFiles(path.join(this.dataDir, "inventory", "materials"))).map(
        (file) => `inventory/materials/${path.basename(file)}`
      ),
      ...(await listJsonFiles(path.join(this.dataDir, "inventory", "adjustments"))).map(
        (file) => `inventory/adjustments/${path.basename(file)}`
      ),
    ]
    return existing.filter((relativePath) => !desired.has(relativePath))
  }

  private async serialize<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue
    let release!: () => void
    this.mutationQueue = new Promise<void>((resolve) => (release = resolve))
    await previous
    try {
      return await work()
    } finally {
      release()
    }
  }

  private async assertRevision(expected: number): Promise<void> {
    const actual = await this.readRevision()
    if (actual !== expected) throw new DevdDataConflictError(expected, actual)
  }

  private async readRevision(): Promise<number> {
    const state = await readJsonIfPresent<{ schema: string; revision: number }>(
      path.join(this.dataDir, ".tuckmark", "state.json")
    )
    return state?.schema === STATE_SCHEMA && Number.isInteger(state.revision) ? state.revision : 0
  }

  private resolveRelative(relativePath: string): string {
    const normalized = relativePath.replaceAll("\\", "/")
    if (normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      throw new Error("Invalid data path.")
    }
    const resolved = path.resolve(this.dataDir, normalized)
    if (!resolved.startsWith(`${path.resolve(this.dataDir)}${path.sep}`))
      throw new Error("Invalid data path.")
    return resolved
  }

  private async commit(args: {
    expectedRevision: number
    writes: JsonWrite[]
    deletes: string[]
    domains: DevdDataDomain[]
    reason: string
  }): Promise<number> {
    await this.assertRevision(args.expectedRevision)
    const revision = args.expectedRevision + 1
    const event = { revision, domains: args.domains, reason: args.reason }
    const transaction: PersistedTransaction = {
      schema: TRANSACTION_SCHEMA,
      revision,
      writes: args.writes,
      deletes: args.deletes,
      event,
    }
    const transactionPath = path.join(
      this.dataDir,
      ".tuckmark",
      "transactions",
      `${revision}-${randomUUID()}.json`
    )
    await writeJsonAtomic(transactionPath, transaction)
    await this.applyTransaction(transaction)
    await rm(transactionPath, { force: true })
    this.listeners.forEach((listener) => {
      listener(event)
    })
    return revision
  }

  private async recoverTransactions(): Promise<void> {
    for (const transactionPath of await listJsonFiles(
      path.join(this.dataDir, ".tuckmark", "transactions")
    )) {
      const transaction = JSON.parse(
        await readFile(transactionPath, "utf8")
      ) as PersistedTransaction
      if (transaction.schema !== TRANSACTION_SCHEMA)
        throw new Error("Invalid DEVD data transaction.")
      await this.applyTransaction(transaction)
      await rm(transactionPath, { force: true })
    }
  }

  private async applyTransaction(transaction: PersistedTransaction): Promise<void> {
    for (const write of transaction.writes)
      await writeJsonAtomic(this.resolveRelative(write.relativePath), write.value)
    for (const relativePath of transaction.deletes)
      await rm(this.resolveRelative(relativePath), { force: true })
    await writeJsonAtomic(path.join(this.dataDir, ".tuckmark", "state.json"), {
      schema: STATE_SCHEMA,
      revision: transaction.revision,
      updatedAt: new Date().toISOString(),
    })
    await this.refreshManifest()
  }

  private async refreshManifest(): Promise<void> {
    const snapshot = await this.runtimeSnapshot(false)
    const materials = await this.listMaterials("", true, false)
    const adjustments = await this.listAdjustments(undefined, false)
    const now = new Date().toISOString()
    const existing = await readJsonIfPresent<any>(path.join(this.dataDir, "manifest.json"))
    await writeJsonAtomic(path.join(this.dataDir, "manifest.json"), {
      schema: MANIFEST_SCHEMA,
      generatedAt: now,
      snapshotUpdatedAt: snapshot.snapshotUpdatedAt,
      source: existing?.source ?? "runtime-sync",
      files: existing?.files ?? {
        settings: "settings/app-settings.json",
        templatesDir: "templates",
        draftsDir: "drafts",
        inventoryDir: "inventory",
        backupsDir: "backups",
      },
      counts: {
        templates: snapshot.templates.length,
        versions: snapshot.versions.length,
        workingCopies: snapshot.workingCopies.length,
        materials: materials.length,
        adjustments: adjustments.length,
      },
    })
  }
}
