import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  applyInventoryAdjustment,
  ensureInventoryMaterialActive,
  ensureInventoryMaterialDeletionAllowed,
  type InventoryAdjustment,
  type InventoryAdjustmentInput,
  type InventoryMaterial,
  inventoryAdjustmentInputSchema,
  inventoryAdjustmentSchema,
  inventoryMaterialSchema,
  inventoryTemplateBindingSchema,
  materialMatchesQuery,
  sortInventoryAdjustmentsNewestFirst,
  sortInventoryMaterialsByName,
} from "@tuckmark/inventory"
import { z } from "zod"

const STATE_SCHEMA = "tuckmark.devd-data-state.v1"
const TRANSACTION_SCHEMA = "tuckmark.devd-data-transaction.v1"
const MANIFEST_SCHEMA = "tuckmark.data-dir-manifest.v1"
const OWNER_SCHEMA = "tuckmark.devd-owner.v1"
const LIVE_LOCK_SCHEMA = "tuckmark.devd-live-lock.v1"
const LIVE_LOCK_RECOVERY_SUFFIX = ".recovery"
const MAX_SAVED_TEMPLATE_VERSIONS = 20
const MAX_AUTOSAVED_TEMPLATE_VERSIONS = 10
const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000
const MAX_PROTECTION_SNAPSHOTS = 20
const claimedDataDirectories = new Map<string, { lockPath: string; token: string }>()
let liveLockExitHandlerRegistered = false
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
  recommendedUse?: string
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
    | "update-template-package"
    | "restore-template-version"
    | "update-template-metadata"
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

const recommendedUseSchema = z.string().trim()

const templateRecordSchema = z
  .object({
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
    recommendedUse: recommendedUseSchema.optional(),
  })
  .strict()

const dataIdentifierSchema = z.string().trim().min(1)
const canvasDraftSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scratch"), presetId: dataIdentifierSchema }),
  z.object({ kind: z.literal("preset-template"), presetId: dataIdentifierSchema }),
  z.object({ kind: z.literal("user-template"), templateId: dataIdentifierSchema }),
])
const finiteNumberSchema = z.number().finite()
const canvasDraftElementBaseShape = {
  id: dataIdentifierSchema,
  meta: z.object({ name: z.string(), visible: z.boolean(), locked: z.boolean() }),
  binding: z
    .object({
      fieldKey: z.string(),
      kind: z.enum(["text", "barcode", "qr", "datamatrix"]),
    })
    .optional(),
}
const canvasDraftElementSchema = z
  .discriminatedUnion("kind", [
    z.object({
      ...canvasDraftElementBaseShape,
      kind: z.literal("text"),
      x: finiteNumberSchema,
      y: finiteNumberSchema,
      width: finiteNumberSchema,
      height: finiteNumberSchema,
      fontSize: finiteNumberSchema,
      fontFamily: z.string().min(1),
      lineHeight: finiteNumberSchema,
      fontWeight: z.enum(["normal", "bold"]),
      align: z.string(),
      justifyAlign: z.string().optional(),
      verticalAlign: z.string(),
      stretchXGrow: z.boolean().optional(),
      stretchXShrink: z.boolean().optional(),
      stretchYGrow: z.boolean().optional(),
      stretchYShrink: z.boolean().optional(),
      stretchX: z.boolean().optional(),
      stretchY: z.boolean().optional(),
      autoWrap: z.boolean(),
      adaptiveFontSize: z.boolean().optional(),
      verticalText: z.boolean(),
      value: z.string(),
      maxLines: finiteNumberSchema.optional(),
      rotation: finiteNumberSchema.optional(),
    }),
    z.object({
      ...canvasDraftElementBaseShape,
      kind: z.literal("rect"),
      x: finiteNumberSchema,
      y: finiteNumberSchema,
      width: finiteNumberSchema,
      height: finiteNumberSchema,
      strokeWidth: finiteNumberSchema,
      fill: z.string(),
      stroke: z.string(),
      radius: finiteNumberSchema,
      rotation: finiteNumberSchema.optional(),
    }),
    z.object({
      ...canvasDraftElementBaseShape,
      kind: z.literal("circle"),
      x: finiteNumberSchema,
      y: finiteNumberSchema,
      size: finiteNumberSchema,
      strokeWidth: finiteNumberSchema,
      fill: z.string(),
      stroke: z.string(),
    }),
    z.object({
      ...canvasDraftElementBaseShape,
      kind: z.literal("triangle"),
      x: finiteNumberSchema,
      y: finiteNumberSchema,
      width: finiteNumberSchema,
      height: finiteNumberSchema,
      strokeWidth: finiteNumberSchema,
      fill: z.string(),
      stroke: z.string(),
      rotation: finiteNumberSchema.optional(),
    }),
    z.object({
      ...canvasDraftElementBaseShape,
      kind: z.literal("line"),
      x: finiteNumberSchema,
      y: finiteNumberSchema,
      x2: finiteNumberSchema,
      y2: finiteNumberSchema,
      strokeWidth: finiteNumberSchema,
      stroke: z.string(),
    }),
    z.object({
      ...canvasDraftElementBaseShape,
      kind: z.literal("barcode"),
      x: finiteNumberSchema,
      y: finiteNumberSchema,
      width: finiteNumberSchema,
      height: finiteNumberSchema,
      value: z.string(),
      format: z.literal("CODE128"),
      showValue: z.boolean(),
      rotation: finiteNumberSchema.optional(),
    }),
    z.object({
      ...canvasDraftElementBaseShape,
      kind: z.literal("qr"),
      x: finiteNumberSchema,
      y: finiteNumberSchema,
      size: finiteNumberSchema,
      value: z.string(),
      errorCorrectionLevel: z.enum(["L", "M", "Q", "H"]),
      rotation: finiteNumberSchema.optional(),
    }),
    z.object({
      ...canvasDraftElementBaseShape,
      kind: z.literal("datamatrix"),
      x: finiteNumberSchema,
      y: finiteNumberSchema,
      size: finiteNumberSchema,
      value: z.string(),
      rotation: finiteNumberSchema.optional(),
    }),
  ])
  .superRefine((element, context) => {
    if (element.kind !== "text") return
    const hasLegacyStretchFlags = element.stretchX !== undefined && element.stretchY !== undefined
    const hasAxisFitFlags =
      element.stretchXGrow !== undefined &&
      element.stretchXShrink !== undefined &&
      element.stretchYGrow !== undefined &&
      element.stretchYShrink !== undefined
    if (!hasLegacyStretchFlags && !hasAxisFitFlags) {
      context.addIssue({
        code: "custom",
        message: "Canvas text elements require stretch flags.",
      })
    }
  })
const canvasDraftDocumentSchema = z
  .object({
    version: z.literal(1),
    unit: z.literal("mm").optional(),
    id: dataIdentifierSchema,
    presetId: dataIdentifierSchema,
    name: dataIdentifierSchema,
    source: canvasDraftSourceSchema,
    templateId: dataIdentifierSchema.optional(),
    baseVersionId: dataIdentifierSchema.optional(),
    lastSavedAt: z.string().min(1).optional(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    renderOptions: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(z.string().min(1)).default([]),
    recommendedUse: recommendedUseSchema.optional(),
    fields: z.array(
      z.object({ key: dataIdentifierSchema, label: dataIdentifierSchema }).passthrough()
    ),
    elements: z.array(canvasDraftElementSchema),
    editor: z.object({
      gridEnabled: z.boolean(),
      gridSize: z.preprocess(
        (value) => (value === 1 || value === 2 || value === 5 ? value : 1),
        z.union([z.literal(1), z.literal(2), z.literal(5)])
      ),
      snapEnabled: z.boolean(),
      snapStep: z.preprocess(
        (value) => (value === 0.25 || value === 0.5 || value === 1 ? value : 1),
        z.union([z.literal(0.25), z.literal(0.5), z.literal(1)])
      ),
    }),
  })
  .strict()

const versionRecordSchema = z.object({
  id: z.string().min(1),
  templateId: z.string().min(1),
  version: z.number().int().positive(),
  kind: z.enum(["saved", "autosave"]),
  createdAt: z.string().min(1),
  label: z.string(),
  sourceVersionId: z.string().optional(),
  document: canvasDraftDocumentSchema,
})

const workingCopyRecordSchema = z.object({
  sourceKey: z.string().min(1),
  source: canvasDraftSourceSchema,
  templateId: z.string().optional(),
  draft: canvasDraftDocumentSchema,
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

const workingCopyArgsSchema = z.object({
  templateId: dataIdentifierSchema.optional(),
  source: canvasDraftSourceSchema,
  document: canvasDraftDocumentSchema,
  sourceVersionId: dataIdentifierSchema.optional(),
})
const materialReferenceArgsSchema = z
  .object({ id: dataIdentifierSchema.optional(), materialId: dataIdentifierSchema.optional() })
  .refine((value) => Boolean(value.id || value.materialId), {
    message: "A material identifier is required.",
  })
const runtimeMutationArgsSchemas = {
  "save-template": z.object({
    templateId: dataIdentifierSchema.optional(),
    createOnly: z.boolean().optional(),
    name: dataIdentifierSchema,
    description: z.string().optional(),
    sourceVersionId: dataIdentifierSchema.optional(),
    document: canvasDraftDocumentSchema,
  }),
  "update-template-package": z.object({
    templateId: dataIdentifierSchema,
    name: dataIdentifierSchema,
    description: z.string().optional(),
    baselineVersionId: dataIdentifierSchema,
    baselineWorkingCopyUpdatedAt: z.string().min(1).nullable(),
    document: canvasDraftDocumentSchema,
  }),
  "restore-template-version": z.object({
    templateId: dataIdentifierSchema,
    versionId: dataIdentifierSchema,
    baselineVersionId: dataIdentifierSchema,
    baselineWorkingCopyUpdatedAt: z.string().min(1).nullable(),
  }),
  "update-template-metadata": z.object({
    templateId: dataIdentifierSchema,
    patch: z
      .object({
        name: dataIdentifierSchema.optional(),
        description: z.string().trim().optional(),
        recommendedUse: z.string().trim().optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, "Template metadata patch is empty."),
  }),
  "rename-template": z.object({ templateId: dataIdentifierSchema, name: dataIdentifierSchema }),
  "archive-template": z.object({ templateId: dataIdentifierSchema }),
  "restore-template": z.object({ templateId: dataIdentifierSchema }),
  "purge-template": z.object({ templateId: dataIdentifierSchema }),
  "save-autosave": workingCopyArgsSchema,
  "replace-working-copy": workingCopyArgsSchema,
  "clear-working-copy": z.object({ source: canvasDraftSourceSchema }),
  "clear-template-autosaves": z.object({ templateId: dataIdentifierSchema }),
  "save-settings": z.object({ patch: z.record(z.string(), z.unknown()) }),
  "replace-snapshot": z.object({
    snapshot: z.object({
      schema: z.literal("tuckmark.runtime-export.v1"),
      exportedAt: z.string().min(1),
      snapshotUpdatedAt: z.string().nullable(),
      settings: z.record(z.string(), z.unknown()),
      templates: z.array(templateRecordSchema),
      versions: z.array(versionRecordSchema),
      workingCopies: z.array(workingCopyRecordSchema),
    }),
  }),
} satisfies Record<RuntimeMutation["command"], z.ZodType>
const inventoryMutationArgsSchemas = {
  "save-material": z.object({
    id: dataIdentifierSchema.optional(),
    fullName: dataIdentifierSchema,
    baseName: z.string().optional(),
    variantName: z.string().optional(),
    packageName: z.string().optional(),
    description: z.string().optional(),
    deviceDetails: z.string().optional(),
    matrixCode: z.string().optional(),
    packagingRemark: z.string().optional(),
    labelBindings: z.array(inventoryTemplateBindingSchema).optional(),
  }),
  "archive-material": materialReferenceArgsSchema,
  "restore-material": materialReferenceArgsSchema,
  "delete-material": materialReferenceArgsSchema,
  "apply-adjustment": z.object({
    materialId: dataIdentifierSchema,
    input: inventoryAdjustmentInputSchema,
  }),
} satisfies Record<InventoryMutation["command"], z.ZodType>

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

type DevdLiveLock = {
  schema: typeof LIVE_LOCK_SCHEMA
  pid: number
  token: string
  claimedAt: string
  processStartIdentity?: string
}

function isLiveLock(value: unknown): value is DevdLiveLock {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<DevdLiveLock>
  return (
    candidate.schema === LIVE_LOCK_SCHEMA &&
    typeof candidate.pid === "number" &&
    Number.isSafeInteger(candidate.pid) &&
    candidate.pid > 0 &&
    typeof candidate.token === "string" &&
    candidate.token.length > 0 &&
    typeof candidate.claimedAt === "string" &&
    candidate.claimedAt.length > 0 &&
    (candidate.processStartIdentity === undefined ||
      (typeof candidate.processStartIdentity === "string" &&
        candidate.processStartIdentity.length > 0))
  )
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

function readProcessStartIdentity(pid: number): string | null {
  try {
    const startedAt = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    return startedAt || null
  } catch {
    return null
  }
}

function processOwnsLiveLock(lock: DevdLiveLock): boolean {
  if (!processIsAlive(lock.pid)) return false
  if (!lock.processStartIdentity) return true
  const currentStartIdentity = readProcessStartIdentity(lock.pid)
  return currentStartIdentity === null || currentStartIdentity === lock.processStartIdentity
}

function createLiveLock(): DevdLiveLock {
  const processStartIdentity = readProcessStartIdentity(process.pid)
  return {
    schema: LIVE_LOCK_SCHEMA,
    pid: process.pid,
    token: randomUUID(),
    claimedAt: new Date().toISOString(),
    ...(processStartIdentity ? { processStartIdentity } : {}),
  }
}

function releaseLiveLock(resolvedDataDir: string, lockPath: string, token: string): void {
  claimedDataDirectories.delete(resolvedDataDir)
  try {
    const current = JSON.parse(readFileSync(lockPath, "utf8")) as unknown
    if (isLiveLock(current) && current.token === token) {
      unlinkSync(lockPath)
    }
  } catch {
    // A stopped process must not remove a newer owner's lock.
  }
}

function registerLiveLockExitHandler(): void {
  if (liveLockExitHandlerRegistered) return
  liveLockExitHandlerRegistered = true
  process.once("exit", () => {
    for (const [resolvedDataDir, claim] of claimedDataDirectories) {
      releaseLiveLock(resolvedDataDir, claim.lockPath, claim.token)
    }
  })
}

function releaseRecoveryLock(recoveryPath: string, token: string): void {
  try {
    const current = JSON.parse(readFileSync(recoveryPath, "utf8")) as unknown
    if (isLiveLock(current) && current.token === token) {
      unlinkSync(recoveryPath)
    }
  } catch {
    // Recovery guard ownership changed or was already released.
  }
}

function sameLiveLock(left: DevdLiveLock, right: DevdLiveLock): boolean {
  return (
    left.token === right.token &&
    left.pid === right.pid &&
    left.claimedAt === right.claimedAt &&
    left.processStartIdentity === right.processStartIdentity
  )
}

function recoveryLockIsOwned(recoveryPath: string, expected: DevdLiveLock): boolean {
  try {
    const current = JSON.parse(readFileSync(recoveryPath, "utf8")) as unknown
    return isLiveLock(current) && sameLiveLock(current, expected)
  } catch {
    return false
  }
}

function reclaimStaleRecoveryLock(recoveryPath: string): boolean {
  let expected: DevdLiveLock
  try {
    const current = JSON.parse(readFileSync(recoveryPath, "utf8")) as unknown
    if (!isLiveLock(current)) {
      throw new DevdDataUnavailableError("The DEVD stale-lock recovery guard is invalid.")
    }
    expected = current
  } catch (error) {
    if (error instanceof DevdDataUnavailableError) throw error
    if (isMissing(error)) return false
    throw new DevdDataUnavailableError("The DEVD stale-lock recovery guard is unreadable.")
  }
  if (processOwnsLiveLock(expected)) return false

  const retiredPath = `${recoveryPath}.stale-${randomUUID()}`
  try {
    renameSync(recoveryPath, retiredPath)
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }

  try {
    const retired = JSON.parse(readFileSync(retiredPath, "utf8")) as unknown
    if (!isLiveLock(retired) || !sameLiveLock(retired, expected)) {
      try {
        writeFileSync(recoveryPath, `${JSON.stringify(retired)}\n`, {
          encoding: "utf8",
          flag: "wx",
        })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      }
      return false
    }
    if (processOwnsLiveLock(retired)) return false
    return true
  } finally {
    try {
      unlinkSync(retiredPath)
    } catch {
      // The contender that owns this retirement path has already removed it.
    }
  }
}

function retireStaleLiveLock(lockPath: string, expected: DevdLiveLock): boolean {
  const recoveryPath = `${lockPath}${LIVE_LOCK_RECOVERY_SUFFIX}`
  const recovery = createLiveLock()
  try {
    writeFileSync(recoveryPath, `${JSON.stringify(recovery)}\n`, { encoding: "utf8", flag: "wx" })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false
    throw error
  }

  const retiredPath = `${lockPath}.stale-${randomUUID()}`
  try {
    let current: unknown
    try {
      current = JSON.parse(readFileSync(lockPath, "utf8")) as unknown
    } catch (error) {
      if (isMissing(error)) return true
      throw new DevdDataUnavailableError("The DEVD live-owner lock is unreadable.")
    }
    if (!isLiveLock(current) || !sameLiveLock(current, expected)) {
      return false
    }
    if (processOwnsLiveLock(current)) return false
    if (!recoveryLockIsOwned(recoveryPath, recovery)) return false

    // A recovery guard serializes the check-and-rename sequence. Claimants that
    // observe it leave the live lock untouched, so a replacement can never be retired.
    renameSync(lockPath, retiredPath)
    unlinkSync(retiredPath)
    return true
  } finally {
    releaseRecoveryLock(recoveryPath, recovery.token)
  }
}

function claimDataDirectory(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true })
  const resolvedDataDir = realpathSync(dataDir)
  if (claimedDataDirectories.has(resolvedDataDir)) {
    throw new DevdDataUnavailableError("This DEVD data directory already has a live owner.")
  }

  const controlDirectory = path.join(resolvedDataDir, ".tuckmark")
  const ownerPath = path.join(controlDirectory, "devd-owner.json")
  try {
    mkdirSync(controlDirectory, { recursive: true })
    writeFileSync(
      ownerPath,
      `${JSON.stringify({ schema: OWNER_SCHEMA, claimedAt: new Date().toISOString() })}\n`,
      { encoding: "utf8", flag: "wx" }
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  }

  const lockPath = path.join(controlDirectory, "devd-live.lock")
  const lock = createLiveLock()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const recoveryPath = `${lockPath}${LIVE_LOCK_RECOVERY_SUFFIX}`
    if (existsSync(recoveryPath)) {
      if (!reclaimStaleRecoveryLock(recoveryPath)) {
        throw new DevdDataUnavailableError("DEVD stale-lock recovery is already in progress.")
      }
      continue
    }
    try {
      writeFileSync(lockPath, `${JSON.stringify(lock)}\n`, { encoding: "utf8", flag: "wx" })
      claimedDataDirectories.set(resolvedDataDir, { lockPath, token: lock.token })
      registerLiveLockExitHandler()
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }

    let existing: unknown
    try {
      existing = JSON.parse(readFileSync(lockPath, "utf8")) as unknown
    } catch {
      throw new DevdDataUnavailableError("The DEVD live-owner lock is unreadable.")
    }
    if (!isLiveLock(existing)) {
      throw new DevdDataUnavailableError("The DEVD live-owner lock is invalid.")
    }
    if (processOwnsLiveLock(existing)) {
      throw new DevdDataUnavailableError("This DEVD data directory already has a live owner.")
    }
    retireStaleLiveLock(lockPath, existing)
  }
  throw new DevdDataUnavailableError("Unable to acquire the DEVD data-directory live-owner lock.")
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
    claimDataDirectory(dataDir)
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
      const template = await readJsonIfPresent<unknown>(path.join(root, "template.json"))
      if (!template) continue
      templates.push(templateRecordSchema.parse(template))
      for (const versionPath of await listJsonFiles(path.join(root, "versions"))) {
        versions.push(versionRecordSchema.parse(JSON.parse(await readFile(versionPath, "utf8"))))
      }
      const workingCopy = await readJsonIfPresent<unknown>(path.join(root, "working-copy.json"))
      if (workingCopy) workingCopies.push(workingCopyRecordSchema.parse(workingCopy))
    }
    for (const kind of ["scratch", "preset-template"] as const) {
      for (const filePath of await listJsonFiles(path.join(this.dataDir, "drafts", kind))) {
        workingCopies.push(
          workingCopyRecordSchema.parse(JSON.parse(await readFile(filePath, "utf8")))
        )
      }
    }
    const legacyScratch = await readJsonIfPresent<unknown>(
      path.join(this.dataDir, "drafts", "scratch.json")
    )
    if (legacyScratch) workingCopies.push(workingCopyRecordSchema.parse(legacyScratch))
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

  async readInventoryPrintSnapshot(): Promise<{
    revision: number
    data: {
      materials: InventoryMaterial[]
      runtime: Awaited<ReturnType<DevdDataService["runtimeSnapshot"]>>
    }
  }> {
    return await this.serialize(async () => {
      await this.recoverTransactions()
      const revision = await this.readRevision()
      return {
        revision,
        data: {
          materials: await this.listMaterials("", true, false),
          runtime: await this.runtimeSnapshot(false),
        },
      }
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
    const args = runtimeMutationArgsSchemas[input.command].parse(input.args)
    return await this.serialize(async () => {
      await this.recoverTransactions()
      await this.assertRevision(input.expectedRevision)
      const snapshot = await this.runtimeSnapshot(false)
      const materials = await this.listMaterials("", true, false)
      const result = this.applyRuntimeCommand(snapshot, materials, input.command, args)
      const { writes, deletes } =
        input.command === "replace-snapshot"
          ? {
              writes: this.snapshotWrites(result.snapshot),
              deletes: await this.snapshotDeletes(result.snapshot),
            }
          : this.runtimeDelta(snapshot, result.snapshot)
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
    const args = inventoryMutationArgsSchemas[input.command].parse(input.args)
    return await this.serialize(async () => {
      await this.recoverTransactions()
      await this.assertRevision(input.expectedRevision)
      const materials = await this.listMaterials("", true, false)
      const adjustments = await this.listAdjustments(undefined, false)
      const result = this.applyInventoryCommand(materials, adjustments, input.command, args)
      const { writes, deletes } = this.inventoryDelta(
        materials,
        adjustments,
        result.materials,
        result.adjustments
      )
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
      const runtimeChanges =
        input.mode === "replace"
          ? {
              writes: this.snapshotWrites(runtime),
              deletes: await this.snapshotDeletes(runtime),
            }
          : this.runtimeDelta(currentRuntime, runtime)
      const inventoryChanges =
        input.mode === "replace"
          ? {
              writes: this.inventoryWrites(materials, adjustments),
              deletes: await this.inventoryDeletes(materials, adjustments),
            }
          : this.inventoryDelta(currentMaterials, currentAdjustments, materials, adjustments)
      const writes = [
        ...runtimeChanges.writes,
        ...inventoryChanges.writes,
        {
          relativePath: `backups/protection/${Date.now()}-${randomUUID()}.json`,
          value: protection,
        },
      ]
      const deletes = [
        ...runtimeChanges.deletes,
        ...inventoryChanges.deletes,
        ...(await this.protectionSnapshotDeletes()),
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

  private applyRuntimeCommand(
    snapshot: any,
    materials: InventoryMaterial[],
    command: RuntimeMutation["command"],
    args: any
  ) {
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

    if (
      command === "save-template" ||
      command === "update-template-package" ||
      command === "restore-template-version"
    ) {
      const templateId = args.templateId ?? `user-template-${randomUUID()}`
      const existing = findTemplate(templateId)
      if (command === "save-template" && args.createOnly && existing) {
        throw new Error("Template already exists. Use template import --update.")
      }
      if (command !== "save-template") {
        if (!existing) throw new DevdDataNotFoundError("Template was not found.")
        const working = workingCopies.find((item) => item.sourceKey === `user:${templateId}`)
        if (
          existing.currentVersionId !== args.baselineVersionId ||
          (working?.updatedAt ?? null) !== args.baselineWorkingCopyUpdatedAt
        ) {
          throw new Error("Template changed after export. Export it again and merge the changes.")
        }
      }
      const restoredVersion =
        command === "restore-template-version"
          ? versions.find((item) => item.id === args.versionId && item.templateId === templateId)
          : undefined
      if (command === "restore-template-version" && !restoredVersion) {
        throw new DevdDataNotFoundError("Template version was not found.")
      }
      const restoreSource =
        command === "restore-template-version" && restoredVersion && existing
          ? { version: restoredVersion, template: existing }
          : undefined
      const sourceDocument = restoreSource ? clone(restoreSource.version.document) : args.document
      const sourceName = restoreSource ? restoreSource.template.name : args.name
      const sourceDescription = restoreSource
        ? restoreSource.template.description
        : args.description
      const nextVersion =
        Math.max(0, ...versions.filter((v) => v.templateId === templateId).map((v) => v.version)) +
        1
      const versionId = `user-template-version-${randomUUID()}`
      const document = {
        ...clone(sourceDocument),
        templateId,
        source: { kind: "user-template", templateId },
        baseVersionId: undefined,
        lastSavedAt: now,
        name: sourceName,
      }
      const version: VersionRecord = {
        id: versionId,
        templateId,
        version: nextVersion,
        kind: "saved",
        createdAt: now,
        label: `已保存版本 ${nextVersion}`,
        sourceVersionId: restoreSource ? restoreSource.version.id : args.sourceVersionId,
        document,
      }
      versions.push(version)
      if (command !== "restore-template-version") {
        for (let index = versions.length - 1; index >= 0; index -= 1) {
          const entry = versions[index]
          if (entry?.templateId === templateId && entry?.kind === "autosave")
            versions.splice(index, 1)
        }
      }
      if (command !== "restore-template-version") {
        this.pruneTemplateVersions(versions, templateId, "saved", MAX_SAVED_TEMPLATE_VERSIONS)
      }
      const hasRecommendedUse = Object.hasOwn(document, "recommendedUse")
      const recommendedUse = hasRecommendedUse
        ? document.recommendedUse?.trim() || undefined
        : existing?.recommendedUse
      const template: TemplateRecord = {
        id: templateId,
        name: sourceName,
        description: sourceDescription ?? existing?.description ?? "",
        width: document.width,
        height: document.height,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        archivedAt: existing?.archivedAt ?? null,
        currentVersionId: versionId,
        fieldOrder: (document.fields ?? []).map((field: any) => field.key),
        ...(recommendedUse ? { recommendedUse } : {}),
      }
      if (existing) {
        if (hasRecommendedUse && !recommendedUse) {
          delete existing.recommendedUse
        }
        Object.assign(existing, template)
      } else {
        templates.push(template)
      }
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
    } else if (command === "update-template-metadata") {
      const template = findTemplate(args.templateId)
      if (!template) throw new DevdDataNotFoundError("Template was not found.")
      const patch = args.patch as {
        name?: string
        description?: string
        recommendedUse?: string
      }
      if (patch.name !== undefined) {
        template.name = String(patch.name).trim()
      }
      if (patch.description !== undefined) {
        template.description = patch.description
      }
      const working = workingCopies.find((item) => item.sourceKey === `user:${template.id}`)
      if (patch.recommendedUse !== undefined) {
        const recommendedUse = patch.recommendedUse.trim()
        if (recommendedUse) template.recommendedUse = recommendedUse
        else delete template.recommendedUse
        if (working) {
          if (recommendedUse) working.draft.recommendedUse = recommendedUse
          else delete working.draft.recommendedUse
        }
      }
      if (patch.name !== undefined && working) working.draft.name = template.name
      if (patch.description !== undefined && working)
        working.draft.description = template.description
      template.updatedAt = now
      if (working) working.updatedAt = now
      data = summary(template)
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
      const material = materials.find((item) =>
        item.labelBindings.some(
          (binding) =>
            binding.templateSource === "user-template" && binding.templateId === args.templateId
        )
      )
      if (material) {
        throw new Error(
          `Template is still referenced by the inventory material ${material.fullName}.`
        )
      }
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
        if (!last || Date.parse(now) - Date.parse(last.createdAt) >= AUTOSAVE_INTERVAL_MS) {
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
          this.pruneTemplateVersions(
            versions,
            args.templateId,
            "autosave",
            MAX_AUTOSAVED_TEMPLATE_VERSIONS
          )
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
        ...existing,
        id: args.id ?? `inventory-material-${randomUUID()}`,
        fullName: String(args.fullName).trim(),
        baseName: args.baseName?.trim() || undefined,
        variantName: args.variantName?.trim() || undefined,
        packageName: args.packageName?.trim() || undefined,
        description: args.description?.trim() ?? "",
        deviceDetails: args.deviceDetails?.trim() ?? existing?.deviceDetails ?? "",
        matrixCode: args.matrixCode?.trim() || undefined,
        packagingRemark: args.packagingRemark?.trim() ?? "",
        currentQuantity: existing?.currentQuantity ?? 0,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        archivedAt: existing?.archivedAt ?? null,
        labelBindings: args.labelBindings ?? existing?.labelBindings ?? [],
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

    const templates = new Map(
      (archive.runtime.templates as TemplateRecord[]).map((template) => [template.id, template])
    )
    const versions = new Map(
      (archive.runtime.versions as VersionRecord[]).map((version) => [version.id, version])
    )
    for (const version of archive.runtime.versions as VersionRecord[]) {
      if (!templates.has(version.templateId)) {
        throw new Error(
          `Archive version ${version.id} references unknown template ${version.templateId}.`
        )
      }
    }
    for (const template of templates.values()) {
      const version = versions.get(template.currentVersionId)
      if (!version || version.templateId !== template.id) {
        throw new Error(
          `Archive template ${template.id} references unknown current version ${template.currentVersionId}.`
        )
      }
    }
    for (const workingCopy of archive.runtime.workingCopies as WorkingCopyRecord[]) {
      if (workingCopy.templateId && !templates.has(workingCopy.templateId)) {
        throw new Error(
          `Archive working copy ${workingCopy.sourceKey} references unknown template ${workingCopy.templateId}.`
        )
      }
      if (
        workingCopy.source.kind === "user-template" &&
        (!workingCopy.templateId ||
          workingCopy.source.templateId !== workingCopy.templateId ||
          !templates.has(workingCopy.source.templateId))
      ) {
        throw new Error(
          `Archive working copy ${workingCopy.sourceKey} has an invalid template source.`
        )
      }
    }
    const materialIds = new Set(archive.inventory.materials.map((material) => material.id))
    for (const adjustment of archive.inventory.adjustments) {
      if (!materialIds.has(adjustment.materialId)) {
        throw new Error(
          `Archive adjustment ${adjustment.id} references unknown material ${adjustment.materialId}.`
        )
      }
    }
    for (const material of archive.inventory.materials) {
      for (const binding of material.labelBindings) {
        if (binding.templateSource === "user-template" && !templates.has(binding.templateId)) {
          throw new Error(
            `Archive material ${material.id} references unknown user template ${binding.templateId}.`
          )
        }
      }
    }
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
      const relativePath =
        working.source.kind === "user-template"
          ? `templates/${safeSegment(working.source.templateId)}/working-copy.json`
          : `drafts/${working.source.kind}/${safeSegment(working.source.presetId)}.json`
      writes.push({ relativePath, value: working })
    }
    return writes
  }

  private runtimeDelta(previous: any, next: any): { writes: JsonWrite[]; deletes: string[] } {
    return this.writeDelta(this.snapshotWrites(previous), this.snapshotWrites(next))
  }

  private pruneTemplateVersions(
    versions: VersionRecord[],
    templateId: string,
    kind: VersionRecord["kind"],
    limit: number
  ): void {
    const retained = new Set(
      versions
        .filter((version) => version.templateId === templateId && version.kind === kind)
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) || right.version - left.version
        )
        .slice(0, limit)
        .map((version) => version.id)
    )
    for (let index = versions.length - 1; index >= 0; index -= 1) {
      const version = versions[index]
      if (
        version?.templateId === templateId &&
        version.kind === kind &&
        !retained.has(version.id)
      ) {
        versions.splice(index, 1)
      }
    }
  }

  private async protectionSnapshotDeletes(): Promise<string[]> {
    const root = path.join(this.dataDir, "backups", "protection")
    const snapshots = await Promise.all(
      (await listJsonFiles(root)).map(async (filePath) => ({
        filePath,
        mtimeMs: (await stat(filePath)).mtimeMs,
      }))
    )
    return snapshots
      .sort(
        (left, right) =>
          right.mtimeMs - left.mtimeMs ||
          path.basename(right.filePath).localeCompare(path.basename(left.filePath))
      )
      .slice(MAX_PROTECTION_SNAPSHOTS - 1)
      .map((snapshot) => `backups/protection/${path.basename(snapshot.filePath)}`)
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
    for (const kind of ["scratch", "preset-template"] as const) {
      for (const filePath of await listJsonFiles(path.join(this.dataDir, "drafts", kind))) {
        existing.push(`drafts/${kind}/${path.basename(filePath)}`)
      }
    }
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

  private inventoryDelta(
    previousMaterials: InventoryMaterial[],
    previousAdjustments: InventoryAdjustment[],
    nextMaterials: InventoryMaterial[],
    nextAdjustments: InventoryAdjustment[]
  ): { writes: JsonWrite[]; deletes: string[] } {
    return this.writeDelta(
      this.inventoryWrites(previousMaterials, previousAdjustments),
      this.inventoryWrites(nextMaterials, nextAdjustments)
    )
  }

  private writeDelta(
    previous: JsonWrite[],
    next: JsonWrite[]
  ): { writes: JsonWrite[]; deletes: string[] } {
    const currentByPath = new Map(previous.map((item) => [item.relativePath, item.value]))
    const nextByPath = new Map(next.map((item) => [item.relativePath, item.value]))
    const writes = [...nextByPath]
      .filter(
        ([relativePath, value]) =>
          JSON.stringify(currentByPath.get(relativePath)) !== JSON.stringify(value)
      )
      .map(([relativePath, value]) => ({ relativePath, value }))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    const deletes = [...currentByPath.keys()]
      .filter((relativePath) => !nextByPath.has(relativePath))
      .sort()
    return { writes, deletes }
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
