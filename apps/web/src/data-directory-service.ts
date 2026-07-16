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
  RuntimeExportArchiveV1,
  RuntimeSnapshotSummary,
} from "./data-directory-types.js"
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
const MANIFEST_PATH = "manifest.json"
const MANUAL_BACKUPS_DIR = `${BACKUPS_DIR}/manual`
const PROTECTION_BACKUPS_DIR = `${BACKUPS_DIR}/protection`
const SETTINGS_DIR = "settings"
const TEMPLATES_DIR = "templates"
const ARCHIVE_SCHEMA = "tuckmark.runtime-export-archive.v1"
const MANIFEST_SCHEMA = "tuckmark.data-dir-manifest.v1"
const PROTECTION_BACKUP_LIMIT = 20
const STATUS_STORAGE_KEY = "tuckmark.data-directory-status.v1"

type PersistedStatus = {
  lastSyncAt: string | null
  lastError: string | null
}

export type DataArchiveInspection = {
  label: string
  snapshot: RuntimeStoreSnapshot
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

function toRuntimeSummary(snapshot: RuntimeStoreSnapshot): RuntimeSnapshotSummary {
  return {
    exportedAt: snapshot.exportedAt,
    snapshotUpdatedAt: snapshot.snapshotUpdatedAt,
    templates: snapshot.templates.length,
    versions: snapshot.versions.length,
    workingCopies: snapshot.workingCopies.length,
  }
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

function buildSnapshotTree(
  snapshot: RuntimeStoreSnapshot,
  source: "runtime-sync" | "backup-archive"
) {
  const normalized = normalizeSnapshot(snapshot)
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

  const manifest: DataDirectoryManifestV1 = {
    schema: MANIFEST_SCHEMA,
    generatedAt: new Date().toISOString(),
    snapshotUpdatedAt: normalized.snapshotUpdatedAt,
    source,
    files: {
      settings: APP_SETTINGS_PATH,
      templatesDir: TEMPLATES_DIR,
      draftsDir: DRAFTS_DIR,
      backupsDir: BACKUPS_DIR,
    },
    counts: {
      templates: normalized.templates.length,
      versions: normalized.versions.length,
      workingCopies: normalized.workingCopies.length,
    },
  }
  files.set(MANIFEST_PATH, JSON.stringify(manifest, null, 2))

  return { files, manifest, snapshot: normalized }
}

function parseManifest(raw: string): DataDirectoryManifestV1 {
  const parsed = JSON.parse(raw) as DataDirectoryManifestV1
  if (parsed.schema !== MANIFEST_SCHEMA) {
    throw new Error("目录 manifest 版本不受支持。")
  }
  return parsed
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

async function readTextFile(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile()
  return await file.text()
}

async function writeTextFile(
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

async function readFileIfPresent(
  handle: FileSystemDirectoryHandle,
  path: string
): Promise<string | null> {
  try {
    const fileHandle = await resolveFileHandle(handle, path)
    return await readTextFile(fileHandle)
  } catch {
    return null
  }
}

async function resolveDirectoryHandle(
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

async function resolveFileHandle(
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

async function removeEntryIfPresent(
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

async function clearManagedMirror(handle: FileSystemDirectoryHandle): Promise<void> {
  await removeEntryIfPresent(handle, SETTINGS_DIR, { recursive: true })
  await removeEntryIfPresent(handle, TEMPLATES_DIR, { recursive: true })
  await removeEntryIfPresent(handle, DRAFTS_DIR, { recursive: true })
  await removeEntryIfPresent(handle, MANIFEST_PATH)
}

async function collectDirectoryFiles(
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
      files.set(path, await readTextFile(entry))
      continue
    }
    if (!isDirectoryHandle(entry)) {
      continue
    }
    const nested = await collectDirectoryFiles(entry, path)
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
  const raw = await readFileIfPresent(handle, MANIFEST_PATH)
  if (!raw) {
    return null
  }
  return parseManifest(raw)
}

async function writeSnapshotToDirectory(
  handle: FileSystemDirectoryHandle,
  snapshot: RuntimeStoreSnapshot,
  source: "runtime-sync" | "backup-archive"
): Promise<DataDirectoryManifestV1> {
  const { files, manifest } = buildSnapshotTree(snapshot, source)
  await clearManagedMirror(handle)
  for (const [path, value] of files) {
    await writeTextFile(handle, path, value)
  }
  rememberSyncSuccess(manifest.generatedAt)
  return manifest
}

async function readSnapshotFromDirectory(
  handle: FileSystemDirectoryHandle
): Promise<RuntimeStoreSnapshot> {
  const files = new Map<string, string>()
  const manifestRaw = await readFileIfPresent(handle, MANIFEST_PATH)
  if (manifestRaw) {
    files.set(MANIFEST_PATH, manifestRaw)
  }
  const settingsRaw = await readFileIfPresent(handle, APP_SETTINGS_PATH)
  if (settingsRaw) {
    files.set(APP_SETTINGS_PATH, settingsRaw)
  }
  for (const root of [TEMPLATES_DIR, DRAFTS_DIR]) {
    try {
      const directory = await resolveDirectoryHandle(handle, root)
      const nested = await collectDirectoryFiles(directory, root)
      for (const [path, value] of nested) {
        files.set(path, value)
      }
    } catch {
      // Ignore absent managed subtrees.
    }
  }
  return parseSnapshotFromFiles(files)
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

function createArchiveBytes(snapshot: RuntimeStoreSnapshot): Uint8Array {
  const { files } = buildSnapshotTree(snapshot, "backup-archive")
  const zipEntries: Record<string, Uint8Array> = {}
  for (const [path, value] of files) {
    zipEntries[path] = strToU8(value)
  }
  zipEntries["archive.json"] = strToU8(
    JSON.stringify(
      {
        schema: ARCHIVE_SCHEMA,
        exportedAt: new Date().toISOString(),
      } satisfies Pick<RuntimeExportArchiveV1, "schema" | "exportedAt">,
      null,
      2
    )
  )
  return zipSync(zipEntries, { level: 6 })
}

async function readBackupEntryBytes(
  handle: FileSystemDirectoryHandle,
  entry: DataDirectoryBackupEntry
): Promise<Uint8Array> {
  const fileHandle = await resolveFileHandle(handle, entry.path)
  const file = await fileHandle.getFile()
  return new Uint8Array(await file.arrayBuffer())
}

function parseArchiveBytes(bytes: Uint8Array): RuntimeStoreSnapshot {
  const entries = unzipSync(bytes)
  const archiveMeta = entries["archive.json"]
  if (archiveMeta) {
    const parsed = JSON.parse(strFromU8(archiveMeta)) as Partial<RuntimeExportArchiveV1>
    if (parsed.schema !== ARCHIVE_SCHEMA) {
      throw new Error("ZIP 数据格式不受支持。")
    }
  }
  const files = new Map<string, string>()
  for (const [path, value] of Object.entries(entries)) {
    if (path === "archive.json") {
      continue
    }
    files.set(path, strFromU8(value))
  }
  return parseSnapshotFromFiles(files)
}

async function trimProtectionBackups(handle: FileSystemDirectoryHandle): Promise<void> {
  const backups = await listBackupEntries(handle)
  const protection = backups
    .filter((entry) => entry.kind === "protection")
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
  for (const stale of protection.slice(PROTECTION_BACKUP_LIMIT)) {
    try {
      const directory = await resolveDirectoryHandle(handle, PROTECTION_BACKUPS_DIR)
      await directory.removeEntry(stale.name)
    } catch {
      // Ignore best-effort retention cleanup failures.
    }
  }
}

async function createProtectionBackup(handle: FileSystemDirectoryHandle): Promise<void> {
  const snapshot = await exportRuntimeSnapshot()
  const bytes = createArchiveBytes(snapshot)
  await writeArchiveFile(handle, "protection", createArchiveName("protection"), bytes)
  await trimProtectionBackups(handle)
}

async function loadConfiguredHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (!supportsDirectoryHandles()) {
    return null
  }
  return await loadStoredDataDirectoryHandle()
}

export function supportsDataDirectoryFeatures(): boolean {
  return supportsDirectoryHandles()
}

export async function hasConfiguredDataDirectory(): Promise<boolean> {
  return (await loadConfiguredHandle()) !== null
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
  await saveDataDirectoryHandle(args.handle)

  if (args.mode === "overwrite-current") {
    const snapshot = await exportRuntimeSnapshot()
    await writeSnapshotToDirectory(args.handle, snapshot, "runtime-sync")
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

export async function requestConfiguredDirectoryPermission(requestIfNeeded = true): Promise<void> {
  const handle = await loadConfiguredHandle()
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
  const handle = await loadConfiguredHandle()
  if (!handle) {
    throw new Error("尚未配置数据目录。")
  }
  const permission = await ensureReadWritePermission(handle, args.requestIfNeeded ?? true)
  if (permission !== "granted") {
    throw new Error("需要先授予数据目录读写权限。")
  }
  await args.coordinator.runAsWriter(async () => {
    const snapshot = await exportRuntimeSnapshot()
    await writeSnapshotToDirectory(handle, snapshot, "runtime-sync")
  })
}

export async function createManualBackup(args: {
  coordinator: CrossTabCoordinator
}): Promise<DataDirectoryBackupEntry> {
  const handle = await loadConfiguredHandle()
  if (!handle) {
    throw new Error("尚未配置数据目录。")
  }
  const permission = await ensureReadWritePermission(handle, true)
  if (permission !== "granted") {
    throw new Error("需要先授予数据目录读写权限。")
  }
  return await args.coordinator.runAsWriter(async () => {
    const snapshot = await exportRuntimeSnapshot()
    const bytes = createArchiveBytes(snapshot)
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
      directory = await resolveDirectoryHandle(handle, `${BACKUPS_DIR}/${kind}`)
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
  const handle = await loadConfiguredHandle()
  if (!handle) {
    throw new Error("尚未配置数据目录。")
  }
  const permission = await ensureReadWritePermission(handle, true)
  if (permission !== "granted") {
    throw new Error("需要先授予数据目录读写权限。")
  }
  const bytes = await readBackupEntryBytes(handle, entry)
  const snapshot = parseArchiveBytes(bytes)
  return {
    label: entry.name,
    snapshot,
    summary: toRuntimeSummary(snapshot),
  }
}

export async function restoreConfiguredBackup(args: {
  coordinator: CrossTabCoordinator
  entry: DataDirectoryBackupEntry
  snapshot: RuntimeStoreSnapshot
}): Promise<void> {
  const handle = await loadConfiguredHandle()
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
    await writeSnapshotToDirectory(handle, args.snapshot, "runtime-sync")
  })
}

export async function inspectImportArchiveFile(file: File): Promise<DataArchiveInspection> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const snapshot = parseArchiveBytes(bytes)
  return {
    label: file.name,
    snapshot,
    summary: toRuntimeSummary(snapshot),
  }
}

export async function importRuntimeArchive(args: {
  coordinator: CrossTabCoordinator
  snapshot: RuntimeStoreSnapshot
}): Promise<void> {
  const handle = await loadConfiguredHandle()
  if (handle) {
    const permission = await ensureReadWritePermission(handle, true)
    if (permission !== "granted") {
      throw new Error("需要先授予数据目录读写权限。")
    }
    await args.coordinator.runAsWriter(async () => {
      await createProtectionBackup(handle)
      await replaceRuntimeSnapshot(args.snapshot)
      await writeSnapshotToDirectory(handle, args.snapshot, "runtime-sync")
    })
    return
  }

  await replaceRuntimeSnapshot(args.snapshot)
}

export async function exportRuntimeArchive(): Promise<{ fileName: string }> {
  const snapshot = await exportRuntimeSnapshot()
  const bytes = createArchiveBytes(snapshot)
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

  const handle = await loadConfiguredHandle()
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
