import {
  type InventoryDirectorySnapshot,
  inventoryAdjustmentSchema,
  inventoryAdjustmentTransactionSchema,
  inventoryDirectorySnapshotSchema,
  inventoryMaterialSchema,
  sortInventoryAdjustmentsNewestFirst,
  sortInventoryMaterialsByName,
} from "@tuckmark/inventory"
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"

import type { CrossTabCoordinator, CrossTabLeaseState } from "./cross-tab-coordinator.js"
import {
  clearStoredDataDirectoryHandle,
  loadStoredDataDirectoryHandle,
  saveDataDirectoryHandle,
  supportsDirectoryHandles,
} from "./data-directory-handle-store.js"
import type {
  DataDirectoryAttachmentInspection,
  DataDirectoryBackupEntry,
  DataDirectoryHealth,
  DataDirectoryManifestV1,
  DataDirectoryPermissionState,
  DataDirectoryStatus,
  RuntimeSnapshotSummary,
} from "./data-directory-types.js"
import { devdDataClient, isServerHttpDataSurface } from "./devd-data-client.js"
import {
  readBrowserLocalInventorySnapshot,
  writeBrowserLocalInventorySnapshot,
} from "./inventory-browser-storage.js"
import { normalizeRuntimeAppSettings } from "./runtime-app-settings.js"
import type { RuntimeStoreSnapshot } from "./runtime-store-contract.js"
import type {
  CanvasWorkingCopyIndexEntry,
  UserTemplateRecord,
  UserTemplateVersionSnapshot,
} from "./types.js"
import { exportRuntimeSnapshot, replaceRuntimeSnapshot } from "./user-template-store.js"

const APP_SETTINGS_PATH = "settings/app-settings.json"
const BACKUPS_DIR = "backups"
const DRAFTS_DIR = "drafts"
const INVENTORY_DIR = "inventory"
const MATERIALS_DIR = `${INVENTORY_DIR}/materials`
const ADJUSTMENTS_DIR = `${INVENTORY_DIR}/adjustments`
const TRANSACTIONS_DIR = `${INVENTORY_DIR}/transactions`
const MANIFEST_PATH = "manifest.json"
const MANUAL_BACKUPS_DIR = `${BACKUPS_DIR}/manual`
const PROTECTION_BACKUPS_DIR = `${BACKUPS_DIR}/protection`
const SETTINGS_DIR = "settings"
const TEMPLATES_DIR = "templates"
const ARCHIVE_SCHEMA = "tuckmark.runtime-export-archive.v1"
export const TUCKMARK_DATA_ARCHIVE_SCHEMA = "tuckmark.data-archive.v1"
const MANIFEST_SCHEMA = "tuckmark.data-dir-manifest.v1"
const PROTECTION_BACKUP_LIMIT = 20
const STATUS_STORAGE_KEY = "tuckmark.data-directory-status.v1"

type PersistedStatus = {
  lastSyncAt: string | null
  lastError: string | null
}

type ManagedDirectoryState = {
  snapshot: RuntimeStoreSnapshot
  inventorySnapshot: InventoryDirectorySnapshot
}

export type TuckmarkDataArchive = {
  schema: typeof TUCKMARK_DATA_ARCHIVE_SCHEMA
  exportedAt: string
  runtime: RuntimeStoreSnapshot
  inventory: InventoryDirectorySnapshot
}

export type DataArchiveInspection = {
  label: string
  snapshot: RuntimeStoreSnapshot
  inventorySnapshot: InventoryDirectorySnapshot
  summary: RuntimeSnapshotSummary
}

function getBackupDirectoryPath(kind: "manual" | "protection") {
  return kind === "manual" ? MANUAL_BACKUPS_DIR : PROTECTION_BACKUPS_DIR
}

function createEmptyStatus(): PersistedStatus {
  return {
    lastSyncAt: null,
    lastError: null,
  }
}

function readPersistedStatus(): PersistedStatus {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return createEmptyStatus()
  }
  try {
    const raw = window.localStorage.getItem(STATUS_STORAGE_KEY)
    if (!raw) {
      return createEmptyStatus()
    }
    const parsed = JSON.parse(raw) as Partial<PersistedStatus>
    return {
      lastSyncAt: typeof parsed.lastSyncAt === "string" ? parsed.lastSyncAt : null,
      lastError: typeof parsed.lastError === "string" ? parsed.lastError : null,
    }
  } catch {
    return createEmptyStatus()
  }
}

function writePersistedStatus(next: PersistedStatus): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return
  }
  window.localStorage.setItem(STATUS_STORAGE_KEY, JSON.stringify(next))
}

function rememberSyncSuccess(at: string): void {
  writePersistedStatus({
    lastSyncAt: at,
    lastError: null,
  })
}

function rememberSyncError(error: unknown): void {
  const previous = readPersistedStatus()
  writePersistedStatus({
    lastSyncAt: previous.lastSyncAt,
    lastError: error instanceof Error ? error.message : String(error),
  })
}

function createEmptyInventorySnapshot(): InventoryDirectorySnapshot {
  return {
    materials: [],
    adjustments: [],
  }
}

function normalizeInventorySnapshot(
  snapshot: InventoryDirectorySnapshot
): InventoryDirectorySnapshot {
  const normalized = inventoryDirectorySnapshotSchema.parse(snapshot)
  return {
    materials: [...normalized.materials].sort(sortInventoryMaterialsByName),
    adjustments: [...normalized.adjustments].sort(sortInventoryAdjustmentsNewestFirst),
  }
}

function toRuntimeSummary(
  snapshot: RuntimeStoreSnapshot,
  inventorySnapshot: InventoryDirectorySnapshot = createEmptyInventorySnapshot()
): RuntimeSnapshotSummary {
  const normalizedInventory = normalizeInventorySnapshot(inventorySnapshot)
  return {
    exportedAt: snapshot.exportedAt,
    snapshotUpdatedAt: snapshot.snapshotUpdatedAt,
    templates: snapshot.templates.length,
    versions: snapshot.versions.length,
    workingCopies: snapshot.workingCopies.length,
    materials: normalizedInventory.materials.length,
    adjustments: normalizedInventory.adjustments.length,
  }
}

function hasSnapshotData(summary: RuntimeSnapshotSummary): boolean {
  return summary.templates > 0 || summary.versions > 0 || summary.workingCopies > 0
}

function parseTimestamp(value: string | null): number | null {
  if (!value) {
    return null
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function compareSnapshotFreshness(left: string | null, right: string | null): number {
  const leftValue = parseTimestamp(left)
  const rightValue = parseTimestamp(right)
  if (leftValue === null && rightValue === null) {
    return 0
  }
  if (leftValue === null) {
    return -1
  }
  if (rightValue === null) {
    return 1
  }
  return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1
}

function manifestDominatesRuntime(
  manifest: DataDirectoryManifestV1,
  runtimeSummary: RuntimeSnapshotSummary
): boolean {
  const counts = manifest.counts
  const matchesOrExceeds =
    counts.templates >= runtimeSummary.templates &&
    counts.versions >= runtimeSummary.versions &&
    counts.workingCopies >= runtimeSummary.workingCopies
  if (!matchesOrExceeds) {
    return false
  }
  return (
    counts.templates > runtimeSummary.templates ||
    counts.versions > runtimeSummary.versions ||
    counts.workingCopies > runtimeSummary.workingCopies
  )
}

function shouldRestoreRuntimeFromDirectoryManifest(args: {
  manifest: DataDirectoryManifestV1
  runtimeSnapshot: RuntimeStoreSnapshot
  runtimeSummary: RuntimeSnapshotSummary
}): boolean {
  if (!hasSnapshotData(args.runtimeSummary)) {
    return args.manifest.counts.templates > 0 || args.manifest.counts.versions > 0
  }
  const freshness = compareSnapshotFreshness(
    args.manifest.snapshotUpdatedAt,
    args.runtimeSnapshot.snapshotUpdatedAt
  )
  if (freshness > 0) {
    return true
  }
  if (freshness < 0) {
    return false
  }
  return manifestDominatesRuntime(args.manifest, args.runtimeSummary)
}

function createArchiveName(prefix: string): string {
  const stamp = new Date().toISOString().replaceAll(":", "-")
  return `${prefix}-${stamp}.zip`
}

function isFileHandle(handle: FileSystemHandle): handle is FileSystemFileHandle {
  return handle.kind === "file"
}

function isDirectoryHandle(handle: FileSystemHandle): handle is FileSystemDirectoryHandle {
  return handle.kind === "directory"
}

function isNotFoundError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    (cause as { name?: unknown }).name === "NotFoundError"
  )
}

function toBinaryArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const normalized = new Uint8Array(bytes.byteLength)
  normalized.set(bytes)
  return normalized.buffer
}

function normalizeSnapshot(snapshot: RuntimeStoreSnapshot): RuntimeStoreSnapshot {
  return {
    ...snapshot,
    settings: normalizeRuntimeAppSettings(snapshot.settings),
    templates: [...snapshot.templates].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    ),
    versions: [...snapshot.versions].sort(
      (left, right) => right.createdAt.localeCompare(left.createdAt) || right.version - left.version
    ),
    workingCopies: [...snapshot.workingCopies].sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.sourceKey.localeCompare(right.sourceKey)
    ),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function createDataArchive(
  state: ManagedDirectoryState,
  exportedAt = new Date().toISOString()
): TuckmarkDataArchive {
  return {
    schema: TUCKMARK_DATA_ARCHIVE_SCHEMA,
    exportedAt,
    runtime: normalizeSnapshot(state.snapshot),
    inventory: normalizeInventorySnapshot(state.inventorySnapshot),
  }
}

function parseDataArchive(value: unknown): TuckmarkDataArchive {
  if (
    !isRecord(value) ||
    value.schema !== TUCKMARK_DATA_ARCHIVE_SCHEMA ||
    typeof value.exportedAt !== "string" ||
    !isRecord(value.runtime) ||
    !isRecord(value.inventory)
  ) {
    throw new Error("ZIP 数据格式不受支持。")
  }
  return createDataArchive(
    {
      snapshot: value.runtime as RuntimeStoreSnapshot,
      inventorySnapshot: value.inventory as InventoryDirectorySnapshot,
    },
    value.exportedAt
  )
}

function buildSnapshotTree(
  snapshot: RuntimeStoreSnapshot,
  inventorySnapshot: InventoryDirectorySnapshot,
  source: "runtime-sync" | "backup-archive"
) {
  const normalized = normalizeSnapshot(snapshot)
  const normalizedInventory = normalizeInventorySnapshot(inventorySnapshot)
  const files = new Map<string, string>()
  files.set(APP_SETTINGS_PATH, JSON.stringify(normalized.settings, null, 2))

  for (const template of normalized.templates) {
    files.set(`templates/${template.id}/template.json`, JSON.stringify(template, null, 2))
  }

  for (const version of normalized.versions) {
    files.set(
      `templates/${version.templateId}/versions/${version.id}.json`,
      JSON.stringify(version, null, 2)
    )
  }

  for (const workingCopy of normalized.workingCopies) {
    if (workingCopy.source.kind === "user-template" && workingCopy.templateId) {
      files.set(
        `templates/${workingCopy.templateId}/working-copy.json`,
        JSON.stringify(workingCopy, null, 2)
      )
      continue
    }
    if (workingCopy.source.kind === "scratch") {
      files.set(
        `drafts/scratch/${workingCopy.source.presetId}.json`,
        JSON.stringify(workingCopy, null, 2)
      )
      continue
    }
    if (workingCopy.source.kind === "preset-template") {
      files.set(
        `drafts/preset-template/${workingCopy.source.presetId}.json`,
        JSON.stringify(workingCopy, null, 2)
      )
    }
  }

  for (const material of normalizedInventory.materials) {
    files.set(`${MATERIALS_DIR}/${material.id}.json`, JSON.stringify(material, null, 2))
  }

  for (const adjustment of normalizedInventory.adjustments) {
    files.set(`${ADJUSTMENTS_DIR}/${adjustment.id}.json`, JSON.stringify(adjustment, null, 2))
  }

  const manifest: DataDirectoryManifestV1 = {
    schema: MANIFEST_SCHEMA,
    generatedAt: new Date().toISOString(),
    snapshotUpdatedAt: normalized.snapshotUpdatedAt,
    source,
    files: {
      settings: APP_SETTINGS_PATH,
      templatesDir: TEMPLATES_DIR,
      draftsDir: DRAFTS_DIR,
      inventoryDir: INVENTORY_DIR,
      backupsDir: BACKUPS_DIR,
    },
    counts: {
      templates: normalized.templates.length,
      versions: normalized.versions.length,
      workingCopies: normalized.workingCopies.length,
      materials: normalizedInventory.materials.length,
      adjustments: normalizedInventory.adjustments.length,
    },
  }
  files.set(MANIFEST_PATH, JSON.stringify(manifest, null, 2))

  return { files, manifest, snapshot: normalized, inventorySnapshot: normalizedInventory }
}

function parseManifest(raw: string): DataDirectoryManifestV1 {
  const parsed = JSON.parse(raw) as DataDirectoryManifestV1
  if (parsed.schema !== MANIFEST_SCHEMA) {
    throw new Error("目录 manifest 版本不受支持。")
  }
  return {
    ...parsed,
    files: {
      ...parsed.files,
      inventoryDir: parsed.files?.inventoryDir ?? INVENTORY_DIR,
    },
    counts: {
      ...parsed.counts,
      materials: parsed.counts?.materials ?? 0,
      adjustments: parsed.counts?.adjustments ?? 0,
    },
  }
}

function parseSnapshotFromFiles(files: Map<string, string>): RuntimeStoreSnapshot {
  const manifestRaw = files.get(MANIFEST_PATH)
  if (!manifestRaw) {
    throw new Error("目录中缺少 manifest.json。")
  }
  const manifest = parseManifest(manifestRaw)
  const settingsRaw = files.get(APP_SETTINGS_PATH)
  const templates: UserTemplateRecord[] = []
  const versions: UserTemplateVersionSnapshot[] = []
  const workingCopies: CanvasWorkingCopyIndexEntry[] = []

  for (const [path, raw] of files) {
    if (path === MANIFEST_PATH || path === APP_SETTINGS_PATH) {
      continue
    }
    const segments = path.split("/")
    if (segments[0] === "templates" && segments.length === 3 && segments[2] === "template.json") {
      templates.push(JSON.parse(raw))
      continue
    }
    if (
      segments[0] === "templates" &&
      segments.length === 4 &&
      segments[2] === "versions" &&
      segments[3].endsWith(".json")
    ) {
      versions.push(JSON.parse(raw))
      continue
    }
    if (
      segments[0] === "templates" &&
      segments.length === 3 &&
      segments[2] === "working-copy.json"
    ) {
      workingCopies.push(JSON.parse(raw))
      continue
    }
    if (
      segments[0] === "drafts" &&
      (segments[1] === "scratch" || segments[1] === "preset-template") &&
      segments.length === 3 &&
      segments[2].endsWith(".json")
    ) {
      workingCopies.push(JSON.parse(raw))
    }
  }

  return normalizeSnapshot({
    schema: "tuckmark.runtime-export.v1",
    exportedAt: manifest.generatedAt,
    snapshotUpdatedAt: manifest.snapshotUpdatedAt,
    settings: normalizeRuntimeAppSettings(settingsRaw ? JSON.parse(settingsRaw) : null),
    templates,
    versions,
    workingCopies,
  })
}

function parseInventorySnapshotFromFiles(files: Map<string, string>): InventoryDirectorySnapshot {
  const materials = []
  const adjustments = []

  for (const [path, raw] of files) {
    const segments = path.split("/")
    if (
      segments[0] === "inventory" &&
      segments[1] === "materials" &&
      segments.length === 3 &&
      segments[2].endsWith(".json")
    ) {
      materials.push(inventoryMaterialSchema.parse(JSON.parse(raw)))
      continue
    }
    if (
      segments[0] === "inventory" &&
      segments[1] === "adjustments" &&
      segments.length === 3 &&
      segments[2].endsWith(".json")
    ) {
      adjustments.push(inventoryAdjustmentSchema.parse(JSON.parse(raw)))
    }
  }

  return normalizeInventorySnapshot({ materials, adjustments })
}

function parseDirectoryStateFromFiles(files: Map<string, string>): ManagedDirectoryState {
  return {
    snapshot: parseSnapshotFromFiles(files),
    inventorySnapshot: parseInventorySnapshotFromFiles(files),
  }
}

function assertArchiveCompleteness(files: Map<string, string>, state: ManagedDirectoryState): void {
  const manifestRaw = files.get(MANIFEST_PATH)
  if (!manifestRaw || !files.has(APP_SETTINGS_PATH)) {
    throw new Error("ZIP 数据不完整。")
  }
  const counts = parseManifest(manifestRaw).counts
  const actual = toRuntimeSummary(state.snapshot, state.inventorySnapshot)
  if (
    counts.templates !== actual.templates ||
    counts.versions !== actual.versions ||
    counts.workingCopies !== actual.workingCopies ||
    counts.materials !== actual.materials ||
    counts.adjustments !== actual.adjustments
  ) {
    throw new Error("ZIP 数据清单与内容不一致。")
  }
}

export async function readTextFileFromDirectoryHandle(
  handle: FileSystemFileHandle
): Promise<string> {
  const file = await handle.getFile()
  return await file.text()
}

export async function writeTextFileToDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  path: string,
  value: string
): Promise<void> {
  const segments = path.split("/")
  const fileName = segments.pop()
  if (!fileName) {
    throw new Error(`无效的文件路径: ${path}`)
  }
  let directory = handle
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create: true })
  }
  const fileHandle = await directory.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(value)
  await writable.close()
}

export async function readFileFromDirectoryHandleIfPresent(
  handle: FileSystemDirectoryHandle,
  path: string
): Promise<string | null> {
  try {
    const fileHandle = await resolveFileHandleFromDirectoryHandle(handle, path)
    return await readTextFileFromDirectoryHandle(fileHandle)
  } catch (cause) {
    if (isNotFoundError(cause)) {
      return null
    }
    throw cause
  }
}

export async function resolveDirectoryHandleFromDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  path: string,
  create = false
): Promise<FileSystemDirectoryHandle> {
  let directory = handle
  for (const segment of path.split("/")) {
    if (!segment) {
      continue
    }
    directory = await directory.getDirectoryHandle(segment, create ? { create: true } : undefined)
  }
  return directory
}

export async function resolveFileHandleFromDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  path: string
): Promise<FileSystemFileHandle> {
  const segments = path.split("/")
  const fileName = segments.pop()
  if (!fileName) {
    throw new Error(`无效的文件路径: ${path}`)
  }
  let directory = handle
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment)
  }
  return await directory.getFileHandle(fileName)
}

export async function removeEntryIfPresentFromDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  name: string,
  options?: FileSystemRemoveOptions
): Promise<void> {
  try {
    await handle.removeEntry(name, options)
  } catch {
    // Ignore missing managed entries.
  }
}

async function clearManagedMirror(
  handle: FileSystemDirectoryHandle,
  inventoryMode: "replace" | "preserve"
): Promise<void> {
  await removeEntryIfPresentFromDirectoryHandle(handle, SETTINGS_DIR, { recursive: true })
  await removeEntryIfPresentFromDirectoryHandle(handle, TEMPLATES_DIR, { recursive: true })
  await removeEntryIfPresentFromDirectoryHandle(handle, DRAFTS_DIR, { recursive: true })
  if (inventoryMode === "replace") {
    await removeEntryIfPresentFromDirectoryHandle(handle, INVENTORY_DIR, { recursive: true })
  }
  await removeEntryIfPresentFromDirectoryHandle(handle, MANIFEST_PATH)
}

export async function collectDirectoryFilesFromDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  prefix = ""
): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  for await (const entry of handle.values()) {
    if (!prefix && entry.name === BACKUPS_DIR) {
      continue
    }
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (isFileHandle(entry)) {
      files.set(path, await readTextFileFromDirectoryHandle(entry))
      continue
    }
    if (!isDirectoryHandle(entry)) {
      continue
    }
    const nested = await collectDirectoryFilesFromDirectoryHandle(entry, path)
    for (const [nestedPath, value] of nested) {
      files.set(nestedPath, value)
    }
  }
  return files
}

async function ensureReadWritePermission(
  handle: FileSystemDirectoryHandle,
  requestIfNeeded: boolean
): Promise<DataDirectoryPermissionState> {
  const current = await handle.queryPermission({ mode: "readwrite" })
  if (current === "granted") {
    return "granted"
  }
  if (!requestIfNeeded) {
    return current
  }
  return await handle.requestPermission({ mode: "readwrite" })
}

async function listDirectoryEntries(
  handle: FileSystemDirectoryHandle
): Promise<FileSystemHandle[]> {
  const entries: FileSystemHandle[] = []
  for await (const entry of handle.values()) {
    entries.push(entry)
  }
  return entries
}

async function readManifestIfPresent(
  handle: FileSystemDirectoryHandle
): Promise<DataDirectoryManifestV1 | null> {
  const raw = await readFileFromDirectoryHandleIfPresent(handle, MANIFEST_PATH)
  if (!raw) {
    return null
  }
  return parseManifest(raw)
}

async function writeSnapshotToDirectory(
  handle: FileSystemDirectoryHandle,
  snapshot: RuntimeStoreSnapshot,
  inventorySnapshot: InventoryDirectorySnapshot,
  source: "runtime-sync" | "backup-archive",
  inventoryMode: "replace" | "preserve"
): Promise<DataDirectoryManifestV1> {
  const { files, manifest } = buildSnapshotTree(snapshot, inventorySnapshot, source)
  await clearManagedMirror(handle, inventoryMode)
  for (const [path, value] of files) {
    if (inventoryMode === "preserve" && path.startsWith(`${INVENTORY_DIR}/`)) {
      continue
    }
    await writeTextFileToDirectoryHandle(handle, path, value)
  }
  rememberSyncSuccess(manifest.generatedAt)
  return manifest
}

async function collectManagedDirectoryFiles(
  handle: FileSystemDirectoryHandle,
  roots: readonly string[]
): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  for (const root of roots) {
    try {
      const directory = await resolveDirectoryHandleFromDirectoryHandle(handle, root)
      const nested = await collectDirectoryFilesFromDirectoryHandle(directory, root)
      for (const [path, value] of nested) {
        files.set(path, value)
      }
    } catch (cause) {
      if (isNotFoundError(cause)) {
        continue
      }
      throw cause
    }
  }
  return files
}

async function recoverInventoryAdjustmentTransactionsFromDirectory(
  handle: FileSystemDirectoryHandle
): Promise<void> {
  const files = await collectManagedDirectoryFiles(handle, [TRANSACTIONS_DIR])
  const transactions = Array.from(files.values()).map((raw) =>
    inventoryAdjustmentTransactionSchema.parse(JSON.parse(raw))
  )
  if (transactions.length === 0) {
    return
  }
  const transactionsDirectory = await resolveDirectoryHandleFromDirectoryHandle(
    handle,
    TRANSACTIONS_DIR
  )
  for (const transaction of transactions) {
    await writeTextFileToDirectoryHandle(
      handle,
      `${MATERIALS_DIR}/${transaction.material.id}.json`,
      `${JSON.stringify(transaction.material, null, 2)}\n`
    )
    await writeTextFileToDirectoryHandle(
      handle,
      `${ADJUSTMENTS_DIR}/${transaction.adjustment.id}.json`,
      `${JSON.stringify(transaction.adjustment, null, 2)}\n`
    )
    try {
      await transactionsDirectory.removeEntry(`${transaction.adjustment.id}.json`)
    } catch (cause) {
      if (!isNotFoundError(cause)) {
        throw cause
      }
    }
  }
}

async function readInventorySnapshotFromDirectory(
  handle: FileSystemDirectoryHandle
): Promise<InventoryDirectorySnapshot> {
  await recoverInventoryAdjustmentTransactionsFromDirectory(handle)
  const files = await collectManagedDirectoryFiles(handle, [MATERIALS_DIR, ADJUSTMENTS_DIR])
  return parseInventorySnapshotFromFiles(files)
}

async function readDirectoryStateFromDirectory(
  handle: FileSystemDirectoryHandle
): Promise<ManagedDirectoryState> {
  await recoverInventoryAdjustmentTransactionsFromDirectory(handle)
  const files = new Map<string, string>()
  const manifestRaw = await readFileFromDirectoryHandleIfPresent(handle, MANIFEST_PATH)
  if (manifestRaw) {
    files.set(MANIFEST_PATH, manifestRaw)
  }
  const settingsRaw = await readFileFromDirectoryHandleIfPresent(handle, APP_SETTINGS_PATH)
  if (settingsRaw) {
    files.set(APP_SETTINGS_PATH, settingsRaw)
  }
  const managedFiles = await collectManagedDirectoryFiles(handle, [
    TEMPLATES_DIR,
    DRAFTS_DIR,
    MATERIALS_DIR,
    ADJUSTMENTS_DIR,
  ])
  for (const [path, value] of managedFiles) {
    files.set(path, value)
  }
  return parseDirectoryStateFromFiles(files)
}

async function readSnapshotFromDirectory(
  handle: FileSystemDirectoryHandle
): Promise<RuntimeStoreSnapshot> {
  return (await readDirectoryStateFromDirectory(handle)).snapshot
}

async function ensureBackupsDirectory(
  handle: FileSystemDirectoryHandle,
  kind: "manual" | "protection"
): Promise<FileSystemDirectoryHandle> {
  const backups = await handle.getDirectoryHandle(BACKUPS_DIR, { create: true })
  return await backups.getDirectoryHandle(kind, { create: true })
}

async function writeArchiveFile(
  handle: FileSystemDirectoryHandle,
  kind: "manual" | "protection",
  fileName: string,
  bytes: Uint8Array
): Promise<DataDirectoryBackupEntry> {
  const directory = await ensureBackupsDirectory(handle, kind)
  const fileHandle = await directory.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(toBinaryArrayBuffer(bytes))
  await writable.close()
  const file = await fileHandle.getFile()
  return {
    kind,
    name: file.name,
    path: `${getBackupDirectoryPath(kind)}/${file.name}`,
    modifiedAt: new Date(file.lastModified).toISOString(),
    size: file.size,
  }
}

export function createDataArchiveBytes(archive: TuckmarkDataArchive): Uint8Array {
  const { files } = buildSnapshotTree(archive.runtime, archive.inventory, "backup-archive")
  const entries: Record<string, Uint8Array> = {}
  for (const [path, value] of files) {
    entries[path] = strToU8(value)
  }
  entries["archive.json"] = strToU8(
    JSON.stringify(
      {
        schema: ARCHIVE_SCHEMA,
        exportedAt: archive.exportedAt,
      },
      null,
      2
    )
  )
  return zipSync(entries, { level: 6 })
}

function createArchiveBytes(state: ManagedDirectoryState): Uint8Array {
  return createDataArchiveBytes(createDataArchive(state))
}

async function readBackupEntryBytes(
  handle: FileSystemDirectoryHandle,
  entry: DataDirectoryBackupEntry
): Promise<Uint8Array> {
  const fileHandle = await resolveFileHandleFromDirectoryHandle(handle, entry.path)
  const file = await fileHandle.getFile()
  return new Uint8Array(await file.arrayBuffer())
}

function parseArchiveBytes(bytes: Uint8Array): TuckmarkDataArchive {
  const entries = unzipSync(bytes)
  const archiveMeta = entries["archive.json"]
  let exportedAt = new Date().toISOString()
  if (archiveMeta) {
    const parsed = JSON.parse(strFromU8(archiveMeta)) as unknown
    if (isRecord(parsed) && parsed.schema === TUCKMARK_DATA_ARCHIVE_SCHEMA) {
      return parseDataArchive(parsed)
    }
    if (!isRecord(parsed) || parsed.schema !== ARCHIVE_SCHEMA) {
      throw new Error("ZIP 数据格式不受支持。")
    }
    if (typeof parsed.exportedAt === "string") {
      exportedAt = parsed.exportedAt
    }
  }
  const files = new Map<string, string>()
  for (const [path, value] of Object.entries(entries)) {
    if (path === "archive.json") {
      continue
    }
    files.set(path, strFromU8(value))
  }
  const state = parseDirectoryStateFromFiles(files)
  assertArchiveCompleteness(files, state)
  return createDataArchive(state, exportedAt)
}

export async function readDataArchiveFile(file: File): Promise<TuckmarkDataArchive> {
  return parseArchiveBytes(new Uint8Array(await file.arrayBuffer()))
}

async function trimProtectionBackups(handle: FileSystemDirectoryHandle): Promise<void> {
  const backups = await listBackupEntries(handle)
  const protection = backups
    .filter((entry) => entry.kind === "protection")
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
  for (const stale of protection.slice(PROTECTION_BACKUP_LIMIT)) {
    try {
      const directory = await resolveDirectoryHandleFromDirectoryHandle(
        handle,
        PROTECTION_BACKUPS_DIR
      )
      await directory.removeEntry(stale.name)
    } catch {
      // Ignore best-effort retention cleanup failures.
    }
  }
}

async function createProtectionBackup(handle: FileSystemDirectoryHandle): Promise<void> {
  const snapshot = await exportRuntimeSnapshot()
  const inventorySnapshot = await readInventorySnapshotFromDirectory(handle)
  const bytes = createArchiveBytes({ snapshot, inventorySnapshot })
  await writeArchiveFile(handle, "protection", createArchiveName("protection"), bytes)
  await trimProtectionBackups(handle)
}

export async function loadConfiguredDataDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (!supportsDirectoryHandles()) {
    return null
  }
  return await loadStoredDataDirectoryHandle()
}

export async function readRuntimeSnapshotFromDirectoryHandle(
  handle: FileSystemDirectoryHandle
): Promise<RuntimeStoreSnapshot> {
  return await readSnapshotFromDirectory(handle)
}

export async function writeRuntimeSnapshotToDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  snapshot: RuntimeStoreSnapshot,
  source: "runtime-sync" | "backup-archive" = "runtime-sync"
): Promise<DataDirectoryManifestV1> {
  const inventorySnapshot = await readInventorySnapshotFromDirectory(handle)
  return await writeSnapshotToDirectory(handle, snapshot, inventorySnapshot, source, "preserve")
}

export function supportsDataDirectoryFeatures(): boolean {
  if (isServerHttpDataSurface()) {
    return false
  }
  return supportsDirectoryHandles()
}

export async function hasConfiguredDataDirectory(): Promise<boolean> {
  return (await loadConfiguredDataDirectoryHandle()) !== null
}

export async function inspectPickedDataDirectory(
  handle: FileSystemDirectoryHandle
): Promise<DataDirectoryAttachmentInspection> {
  const permission = await ensureReadWritePermission(handle, true)
  if (permission !== "granted") {
    throw new Error("未获得数据目录的读写权限。")
  }
  const manifest = await readManifestIfPresent(handle)
  if (manifest) {
    return {
      kind: "existing",
      handleName: handle.name,
      manifest,
    }
  }
  const entries = await listDirectoryEntries(handle)
  return {
    kind: "empty",
    handleName: handle.name,
    entryCount: entries.length,
  }
}

export async function pickDataDirectory(): Promise<{
  handle: FileSystemDirectoryHandle
  inspection: DataDirectoryAttachmentInspection
}> {
  if (typeof window === "undefined" || typeof window.showDirectoryPicker !== "function") {
    throw new Error("当前环境不支持目录选择。")
  }
  const handle = await window.showDirectoryPicker({
    id: "tuckmark-data-directory",
    mode: "readwrite",
  })
  const inspection = await inspectPickedDataDirectory(handle)
  return { handle, inspection }
}

export async function attachDataDirectory(args: {
  handle: FileSystemDirectoryHandle
  mode: "overwrite-current" | "import-existing"
}): Promise<"mirrored-runtime" | "replaced-runtime"> {
  const permission = await ensureReadWritePermission(args.handle, true)
  if (permission !== "granted") {
    throw new Error("未获得数据目录的读写权限。")
  }
  const previousHandle = await loadConfiguredDataDirectoryHandle()
  await saveDataDirectoryHandle(args.handle)

  if (args.mode === "overwrite-current") {
    const snapshot = await exportRuntimeSnapshot()
    const inventorySnapshot = previousHandle
      ? await readInventorySnapshotFromDirectory(previousHandle)
      : readBrowserLocalInventorySnapshot()
    await writeSnapshotToDirectory(
      args.handle,
      snapshot,
      inventorySnapshot,
      "runtime-sync",
      "replace"
    )
    return "mirrored-runtime"
  }

  const snapshot = await readSnapshotFromDirectory(args.handle)
  await replaceRuntimeSnapshot(snapshot)
  rememberSyncSuccess(new Date().toISOString())
  return "replaced-runtime"
}

export async function detachDataDirectory(): Promise<void> {
  await clearStoredDataDirectoryHandle()
}

export async function restoreRuntimeFromConfiguredDirectoryIfNeeded(): Promise<
  "restored" | "skipped"
> {
  if (isServerHttpDataSurface()) {
    return "skipped"
  }
  const handle = await loadConfiguredDataDirectoryHandle()
  if (!handle) {
    return "skipped"
  }
  const permission = await ensureReadWritePermission(handle, false)
  if (permission !== "granted") {
    return "skipped"
  }
  const manifest = await readManifestIfPresent(handle)
  if (!manifest) {
    return "skipped"
  }
  const runtimeSnapshot = await exportRuntimeSnapshot()
  const runtimeSummary = toRuntimeSummary(runtimeSnapshot)
  if (!shouldRestoreRuntimeFromDirectoryManifest({ manifest, runtimeSnapshot, runtimeSummary })) {
    return "skipped"
  }
  const directorySnapshot = await readSnapshotFromDirectory(handle)
  await replaceRuntimeSnapshot(directorySnapshot)
  return "restored"
}

export async function requestConfiguredDirectoryPermission(requestIfNeeded = true): Promise<void> {
  const handle = await loadConfiguredDataDirectoryHandle()
  if (!handle) {
    throw new Error("尚未配置数据目录。")
  }
  const permission = await ensureReadWritePermission(handle, requestIfNeeded)
  if (permission !== "granted") {
    throw new Error("未获得数据目录的读写权限。")
  }
}

export async function syncConfiguredDataDirectory(args: {
  coordinator: CrossTabCoordinator
  requestIfNeeded?: boolean
}): Promise<void> {
  const handle = await loadConfiguredDataDirectoryHandle()
  if (!handle) {
    throw new Error("尚未配置数据目录。")
  }
  const permission = await ensureReadWritePermission(handle, args.requestIfNeeded ?? true)
  if (permission !== "granted") {
    throw new Error("需要先授予数据目录读写权限。")
  }
  await args.coordinator.runAsWriter(async () => {
    const snapshot = await exportRuntimeSnapshot()
    const inventorySnapshot = await readInventorySnapshotFromDirectory(handle)
    await writeSnapshotToDirectory(handle, snapshot, inventorySnapshot, "runtime-sync", "preserve")
  })
}

export async function createManualBackup(args: {
  coordinator: CrossTabCoordinator
}): Promise<DataDirectoryBackupEntry> {
  const handle = await loadConfiguredDataDirectoryHandle()
  if (!handle) {
    throw new Error("尚未配置数据目录。")
  }
  const permission = await ensureReadWritePermission(handle, true)
  if (permission !== "granted") {
    throw new Error("需要先授予数据目录读写权限。")
  }
  return await args.coordinator.runAsWriter(async () => {
    const snapshot = await exportRuntimeSnapshot()
    const inventorySnapshot = await readInventorySnapshotFromDirectory(handle)
    const bytes = createArchiveBytes({ snapshot, inventorySnapshot })
    return await writeArchiveFile(handle, "manual", createArchiveName("backup"), bytes)
  })
}

export async function listBackupEntries(
  handle: FileSystemDirectoryHandle
): Promise<DataDirectoryBackupEntry[]> {
  const entries: DataDirectoryBackupEntry[] = []
  for (const kind of ["manual", "protection"] as const) {
    let directory: FileSystemDirectoryHandle
    try {
      directory = await resolveDirectoryHandleFromDirectoryHandle(handle, `${BACKUPS_DIR}/${kind}`)
    } catch {
      continue
    }
    for await (const entry of directory.values()) {
      if (!isFileHandle(entry) || !entry.name.endsWith(".zip")) {
        continue
      }
      const file = await entry.getFile()
      entries.push({
        kind,
        name: file.name,
        path: `${BACKUPS_DIR}/${kind}/${file.name}`,
        modifiedAt: new Date(file.lastModified).toISOString(),
        size: file.size,
      })
    }
  }
  return entries.sort(
    (left, right) =>
      right.modifiedAt.localeCompare(left.modifiedAt) || left.name.localeCompare(right.name)
  )
}

export async function inspectConfiguredBackup(
  entry: DataDirectoryBackupEntry
): Promise<DataArchiveInspection> {
  const handle = await loadConfiguredDataDirectoryHandle()
  if (!handle) {
    throw new Error("尚未配置数据目录。")
  }
  const permission = await ensureReadWritePermission(handle, true)
  if (permission !== "granted") {
    throw new Error("需要先授予数据目录读写权限。")
  }
  const bytes = await readBackupEntryBytes(handle, entry)
  const archive = parseArchiveBytes(bytes)
  return {
    label: entry.name,
    snapshot: archive.runtime,
    inventorySnapshot: archive.inventory,
    summary: toRuntimeSummary(archive.runtime, archive.inventory),
  }
}

export async function restoreConfiguredBackup(args: {
  coordinator: CrossTabCoordinator
  entry: DataDirectoryBackupEntry
  snapshot: RuntimeStoreSnapshot
  inventorySnapshot: InventoryDirectorySnapshot
}): Promise<void> {
  const handle = await loadConfiguredDataDirectoryHandle()
  if (!handle) {
    throw new Error("尚未配置数据目录。")
  }
  const permission = await ensureReadWritePermission(handle, true)
  if (permission !== "granted") {
    throw new Error("需要先授予数据目录读写权限。")
  }
  await args.coordinator.runAsWriter(async () => {
    await createProtectionBackup(handle)
    await replaceRuntimeSnapshot(args.snapshot)
    await writeSnapshotToDirectory(
      handle,
      args.snapshot,
      args.inventorySnapshot,
      "runtime-sync",
      "replace"
    )
  })
}

export async function inspectImportArchiveFile(file: File): Promise<DataArchiveInspection> {
  const archive = await readDataArchiveFile(file)
  return {
    label: file.name,
    snapshot: archive.runtime,
    inventorySnapshot: archive.inventory,
    summary: toRuntimeSummary(archive.runtime, archive.inventory),
  }
}

export async function importRuntimeArchive(args: {
  coordinator: CrossTabCoordinator
  snapshot: RuntimeStoreSnapshot
  inventorySnapshot: InventoryDirectorySnapshot
}): Promise<void> {
  const handle = await loadConfiguredDataDirectoryHandle()
  if (handle) {
    const permission = await ensureReadWritePermission(handle, true)
    if (permission !== "granted") {
      throw new Error("需要先授予数据目录读写权限。")
    }
    await args.coordinator.runAsWriter(async () => {
      await createProtectionBackup(handle)
      await replaceRuntimeSnapshot(args.snapshot)
      await writeSnapshotToDirectory(
        handle,
        args.snapshot,
        args.inventorySnapshot,
        "runtime-sync",
        "replace"
      )
    })
    return
  }

  await replaceRuntimeSnapshot(args.snapshot)
  writeBrowserLocalInventorySnapshot(args.inventorySnapshot)
}

export async function exportRuntimeArchive(): Promise<{ fileName: string }> {
  const snapshot = await exportRuntimeSnapshot()
  const handle = await loadConfiguredDataDirectoryHandle()
  const inventorySnapshot = handle
    ? await readInventorySnapshotFromDirectory(handle)
    : readBrowserLocalInventorySnapshot()
  const bytes = createArchiveBytes({ snapshot, inventorySnapshot })
  const fileName = createArchiveName("tuckmark-export")
  const blob = new Blob([toBinaryArrayBuffer(bytes)], { type: "application/zip" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
  return { fileName }
}

function resolveHealth(args: {
  supported: boolean
  configured: boolean
  permissionState: DataDirectoryPermissionState
  manifest: DataDirectoryManifestV1 | null
  lastError: string | null
}): DataDirectoryHealth {
  if (!args.supported) {
    return "unsupported"
  }
  if (!args.configured) {
    return "unconfigured"
  }
  if (args.permissionState !== "granted") {
    return "permission-required"
  }
  if (args.lastError || !args.manifest) {
    return "error"
  }
  return "healthy"
}

export async function getDataDirectoryStatus(
  leaseState?: CrossTabLeaseState
): Promise<DataDirectoryStatus> {
  if (isServerHttpDataSurface()) {
    const now = new Date().toISOString()
    let status: Awaited<ReturnType<typeof devdDataClient.status>>
    try {
      status = await devdDataClient.status()
    } catch (error) {
      return {
        owner: "devd",
        revision: undefined,
        connectionState: "reconnecting",
        supported: true,
        configured: false,
        directoryName: null,
        permissionState: "granted",
        health: "error",
        manifest: null,
        lastSyncAt: null,
        lastError: error instanceof Error ? error.message : String(error),
        backups: [],
        leaseRole: "unsupported",
        leaseExpiresAt: null,
        runtimeSummary: {
          exportedAt: now,
          snapshotUpdatedAt: null,
          templates: 0,
          versions: 0,
          workingCopies: 0,
          materials: 0,
          adjustments: 0,
        },
      }
    }
    return {
      owner: "devd",
      revision: status.revision,
      connectionState: "connected",
      supported: true,
      configured: status.configured,
      directoryName: status.directoryName,
      permissionState: "granted",
      health: status.health,
      manifest: {
        schema: "tuckmark.data-dir-manifest.v1",
        generatedAt: now,
        snapshotUpdatedAt: now,
        source: "runtime-sync",
        files: {
          settings: "settings/app-settings.json",
          templatesDir: "templates",
          draftsDir: "drafts",
          inventoryDir: "inventory",
          backupsDir: "backups",
        },
        counts: status.counts,
      },
      lastSyncAt: now,
      lastError: null,
      backups: [],
      leaseRole: "writer",
      leaseExpiresAt: null,
      runtimeSummary: {
        exportedAt: now,
        snapshotUpdatedAt: now,
        ...status.counts,
      },
    }
  }
  const runtimeSnapshot = await exportRuntimeSnapshot()
  const runtimeSummary = toRuntimeSummary(runtimeSnapshot)
  const supported = supportsDataDirectoryFeatures()
  const persistedStatus = readPersistedStatus()

  if (!supported) {
    return {
      supported: false,
      configured: false,
      directoryName: null,
      permissionState: "unsupported",
      health: "unsupported",
      manifest: null,
      lastSyncAt: persistedStatus.lastSyncAt,
      lastError: persistedStatus.lastError,
      backups: [],
      leaseRole: leaseState?.role ?? "unsupported",
      leaseExpiresAt: leaseState?.leaseExpiresAt ?? null,
      runtimeSummary,
    }
  }

  const handle = await loadConfiguredDataDirectoryHandle()
  if (!handle) {
    return {
      supported: true,
      configured: false,
      directoryName: null,
      permissionState: "unconfigured",
      health: "unconfigured",
      manifest: null,
      lastSyncAt: persistedStatus.lastSyncAt,
      lastError: persistedStatus.lastError,
      backups: [],
      leaseRole: leaseState?.role ?? "unsupported",
      leaseExpiresAt: leaseState?.leaseExpiresAt ?? null,
      runtimeSummary,
    }
  }

  let permissionState: DataDirectoryPermissionState = "prompt"
  let manifest: DataDirectoryManifestV1 | null = null
  let backups: DataDirectoryBackupEntry[] = []
  try {
    permissionState = await ensureReadWritePermission(handle, false)
    if (permissionState === "granted") {
      manifest = await readManifestIfPresent(handle)
      backups = await listBackupEntries(handle)
    }
  } catch (error) {
    permissionState = "prompt"
    rememberSyncError(error)
  }

  return {
    supported: true,
    configured: true,
    directoryName: handle.name,
    permissionState,
    health: resolveHealth({
      supported: true,
      configured: true,
      permissionState,
      manifest,
      lastError: readPersistedStatus().lastError,
    }),
    manifest,
    lastSyncAt: readPersistedStatus().lastSyncAt,
    lastError: readPersistedStatus().lastError,
    backups,
    leaseRole: leaseState?.role ?? "unsupported",
    leaseExpiresAt: leaseState?.leaseExpiresAt ?? null,
    runtimeSummary,
  }
}

export async function tryBackgroundMirrorSync(coordinator: CrossTabCoordinator): Promise<void> {
  if (isServerHttpDataSurface()) {
    return
  }
  if (!(await hasConfiguredDataDirectory())) {
    return
  }
  try {
    await syncConfiguredDataDirectory({
      coordinator,
      requestIfNeeded: false,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("需要先授予") || message.includes("尚未配置")) {
      return
    }
    rememberSyncError(error)
  }
}
