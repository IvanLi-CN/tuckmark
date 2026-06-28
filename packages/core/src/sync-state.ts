import { z } from "zod"

const vectorClockSchema = z.object({
  browser: z.number().int().nonnegative().default(0),
  service: z.number().int().nonnegative().default(0),
})

const syncConflictBranchSchema = z.object({
  branchId: z.string(),
  hash: z.string(),
  updatedAt: z.string(),
  payload: z.unknown(),
  deleted: z.boolean().default(false),
})

const syncConflictSchema = z.object({
  recordId: z.string(),
  field: z.string(),
  localHash: z.string(),
  remoteHash: z.string(),
  detectedAt: z.string(),
  branches: z.array(syncConflictBranchSchema).default([]),
})

const syncRecordBaseSchema = z.object({
  recordId: z.string(),
  version: z.number().int().positive(),
  vectorClock: vectorClockSchema,
  updatedAt: z.string(),
  hash: z.string(),
  deleted: z.boolean().optional(),
  conflicts: z.array(syncConflictSchema).default([]),
})

const templateUsagePayloadSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  usedAt: z.string(),
})

const recentPrintPayloadSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["template", "canvas", "safe_text"]),
  printedAt: z.string(),
  printerName: z.string(),
})

const canvasDraftPayloadSchema = z.object({
  presetId: z.string(),
  draft: z.unknown(),
  savedAt: z.string(),
})

export type SharedCanvasDraftDocument = {
  version: 1
  id: string
  presetId: string
  name: string
  width: number
  height: number
  elements: unknown[]
  editor: {
    gridEnabled: boolean
    snapEnabled: boolean
  }
}

export const templateUsageRecordSchema = syncRecordBaseSchema.extend({
  kind: z.literal("template_usage"),
  payload: templateUsagePayloadSchema,
})

export const recentPrintRecordSchema = syncRecordBaseSchema.extend({
  kind: z.literal("recent_print"),
  payload: recentPrintPayloadSchema,
})

export const canvasDraftRecordSchema = syncRecordBaseSchema.extend({
  kind: z.literal("canvas_draft"),
  payload: canvasDraftPayloadSchema,
})

export const syncRecordSchema = z.discriminatedUnion("kind", [
  templateUsageRecordSchema,
  recentPrintRecordSchema,
  canvasDraftRecordSchema,
])

export const syncStateSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string(),
  templateUsageRecords: z.array(templateUsageRecordSchema).default([]),
  recentPrintRecords: z.array(recentPrintRecordSchema).default([]),
  canvasDraftRecords: z.array(canvasDraftRecordSchema).default([]),
})

export type VectorClock = z.infer<typeof vectorClockSchema>
export type SyncConflictBranch = z.infer<typeof syncConflictBranchSchema>
export type SyncConflict = z.infer<typeof syncConflictSchema>
export type TemplateUsagePayload = z.infer<typeof templateUsagePayloadSchema>
export type RecentPrintPayload = z.infer<typeof recentPrintPayloadSchema>
export type CanvasDraftPayload = z.infer<typeof canvasDraftPayloadSchema> & {
  draft: SharedCanvasDraftDocument
}
export type TemplateUsageRecord = z.infer<typeof templateUsageRecordSchema>
export type RecentPrintRecord = z.infer<typeof recentPrintRecordSchema>
export type CanvasDraftRecord = z.infer<typeof canvasDraftRecordSchema> & {
  payload: CanvasDraftPayload
}
export type SyncRecord = TemplateUsageRecord | RecentPrintRecord | CanvasDraftRecord
export type SyncState = z.infer<typeof syncStateSchema> & {
  canvasDraftRecords: CanvasDraftRecord[]
}

export type ExistingRecordMetadata = {
  version: number
  vectorClock: VectorClock
  conflicts: SyncConflict[]
}

export type ExistingDeletedCanvasDraftMetadata = ExistingRecordMetadata & {
  payload?: {
    draft: SharedCanvasDraftDocument
  }
}

export function stableHash(value: unknown): string {
  const input = stableStringify(value)
  let first = 0x811c9dc5
  let second = 0x01000193

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index)
    first ^= code
    first = Math.imul(first, 0x01000193)
    second ^= code
    second = Math.imul(second, 0x27d4eb2d)
  }

  const left = (first >>> 0).toString(16).padStart(8, "0")
  const right = (second >>> 0).toString(16).padStart(8, "0")
  return `${left}${right}`
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right)
    )
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function emptySyncState(): SyncState {
  return {
    schemaVersion: 1,
    updatedAt: new Date(0).toISOString(),
    templateUsageRecords: [],
    recentPrintRecords: [],
    canvasDraftRecords: [],
  }
}

function parseDraftPayload(raw: z.infer<typeof canvasDraftPayloadSchema>): CanvasDraftPayload {
  return {
    ...raw,
    draft: raw.draft as SharedCanvasDraftDocument,
  }
}

function parseSyncConflictBranch(
  branch: z.infer<typeof syncConflictBranchSchema>
): SyncConflictBranch {
  return {
    ...branch,
    payload: branch.payload,
  }
}

function parseSyncConflict(conflict: z.infer<typeof syncConflictSchema>): SyncConflict {
  return {
    ...conflict,
    branches: conflict.branches.map((branch) => parseSyncConflictBranch(branch)),
  }
}

export function parseSyncRecord(record: z.infer<typeof syncRecordSchema>): SyncRecord {
  if (record.kind === "canvas_draft") {
    return {
      ...record,
      payload: parseDraftPayload(record.payload),
      conflicts: record.conflicts.map((conflict) => parseSyncConflict(conflict)),
    }
  }

  return {
    ...record,
    conflicts: record.conflicts.map((conflict) => parseSyncConflict(conflict)),
  }
}

export function parseSyncState(input: unknown): SyncState {
  const parsed = syncStateSchema.parse(input)
  return {
    ...parsed,
    templateUsageRecords: parsed.templateUsageRecords.map((record) =>
      parseSyncRecord(record)
    ) as TemplateUsageRecord[],
    recentPrintRecords: parsed.recentPrintRecords.map((record) =>
      parseSyncRecord(record)
    ) as RecentPrintRecord[],
    canvasDraftRecords: parsed.canvasDraftRecords.map((record) =>
      parseSyncRecord(record)
    ) as CanvasDraftRecord[],
  }
}

export function bumpVectorClock(vectorClock: VectorClock, origin: MergeOrigin): VectorClock {
  return {
    browser: vectorClock.browser + (origin === "browser" ? 1 : 0),
    service: vectorClock.service + (origin === "service" ? 1 : 0),
  }
}

type MergeOrigin = "browser" | "service"

function compareVectorClock(
  left: VectorClock,
  right: VectorClock
): "equal" | "left-newer" | "right-newer" | "concurrent" {
  const leftGte = left.browser >= right.browser && left.service >= right.service
  const rightGte = right.browser >= left.browser && right.service >= left.service

  if (left.browser === right.browser && left.service === right.service) {
    return "equal"
  }
  if (leftGte && (left.browser > right.browser || left.service > right.service)) {
    return "left-newer"
  }
  if (rightGte && (right.browser > left.browser || right.service > left.service)) {
    return "right-newer"
  }
  return "concurrent"
}

function compareIsoTime(left: string, right: string): number {
  return new Date(left).getTime() - new Date(right).getTime()
}

function newestUpdatedAt(left: string, right: string): string {
  return compareIsoTime(left, right) >= 0 ? left : right
}

function maxVectorClock(left: VectorClock, right: VectorClock): VectorClock {
  return {
    browser: Math.max(left.browser, right.browser),
    service: Math.max(left.service, right.service),
  }
}

function dedupeConflicts(conflicts: SyncConflict[], extra: SyncConflict[] = []): SyncConflict[] {
  const seen = new Set<string>()
  const ordered = [...conflicts, ...extra]
  return ordered.filter((item) => {
    const key = `${item.recordId}:${item.field}:${item.localHash}:${item.remoteHash}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function selectByUpdatedAt<T extends SyncRecord>(left: T, right: T): T {
  return compareIsoTime(left.updatedAt, right.updatedAt) >= 0 ? left : right
}

function recordPayloadHash(record: SyncRecord): string {
  if (record.kind === "canvas_draft") {
    return stableHash({
      presetId: record.payload.presetId,
      draft: record.payload.draft,
    })
  }
  return stableHash(record.payload)
}

function conflictBranchFromRecord(record: SyncRecord): SyncConflictBranch {
  return {
    branchId: `${record.recordId}:${record.hash}`,
    hash: record.hash,
    updatedAt: record.updatedAt,
    payload: record.payload,
    deleted: record.deleted ?? false,
  }
}

function withMergedMetadata<T extends SyncRecord>(
  base: T,
  other: T,
  conflicts: SyncConflict[] = [],
  options: {
    incrementVersion?: boolean
  } = {}
): T {
  return {
    ...base,
    version:
      options.incrementVersion === false
        ? Math.max(base.version, other.version)
        : Math.max(base.version, other.version) + 1,
    vectorClock: maxVectorClock(base.vectorClock, other.vectorClock),
    updatedAt: newestUpdatedAt(base.updatedAt, other.updatedAt),
    hash: recordPayloadHash(base),
    conflicts: dedupeConflicts(base.conflicts, [...other.conflicts, ...conflicts]),
  } as T
}

function mergeTemplateUsageRecord(
  local: TemplateUsageRecord,
  remote: TemplateUsageRecord
): TemplateUsageRecord {
  const vectorResult = compareVectorClock(local.vectorClock, remote.vectorClock)
  if (vectorResult === "left-newer") {
    return local
  }
  if (vectorResult === "right-newer") {
    return remote
  }
  if (local.hash === remote.hash) {
    const merged = selectByUpdatedAt(local, remote)
    return withMergedMetadata(merged, merged === local ? remote : local, [], {
      incrementVersion: false,
    })
  }

  const payload =
    compareIsoTime(local.payload.usedAt, remote.payload.usedAt) >= 0
      ? local.payload
      : remote.payload
  const merged = selectByUpdatedAt(local, remote)
  return withMergedMetadata(
    {
      ...merged,
      payload,
    },
    merged === local ? remote : local
  )
}

function mergeRecentPrintRecord(
  local: RecentPrintRecord,
  remote: RecentPrintRecord
): RecentPrintRecord {
  const vectorResult = compareVectorClock(local.vectorClock, remote.vectorClock)
  if (vectorResult === "left-newer") {
    return local
  }
  if (vectorResult === "right-newer") {
    return remote
  }
  if (local.hash === remote.hash) {
    const merged = selectByUpdatedAt(local, remote)
    return withMergedMetadata(merged, merged === local ? remote : local, [], {
      incrementVersion: false,
    })
  }

  const payload =
    compareIsoTime(local.payload.printedAt, remote.payload.printedAt) >= 0
      ? local.payload
      : remote.payload
  const merged = selectByUpdatedAt(local, remote)
  return withMergedMetadata(
    {
      ...merged,
      payload,
    },
    merged === local ? remote : local
  )
}

function mergeDeletedRecord<T extends SyncRecord>(local: T, remote: T): T {
  const vectorResult = compareVectorClock(local.vectorClock, remote.vectorClock)
  if (vectorResult === "left-newer") {
    return local
  }
  if (vectorResult === "right-newer") {
    return remote
  }

  const preferred = selectByUpdatedAt(local, remote)
  return withMergedMetadata(preferred, preferred === local ? remote : local, [], {
    incrementVersion: preferred.hash !== (preferred === local ? remote : local).hash,
  })
}

function mergeCanvasDraftRecord(
  local: CanvasDraftRecord,
  remote: CanvasDraftRecord
): CanvasDraftRecord {
  const vectorResult = compareVectorClock(local.vectorClock, remote.vectorClock)
  if (vectorResult === "left-newer") {
    return local
  }
  if (vectorResult === "right-newer") {
    return remote
  }

  if (local.deleted || remote.deleted) {
    return mergeDeletedRecord(local, remote)
  }

  if (local.hash === remote.hash) {
    const merged = selectByUpdatedAt(local, remote)
    return withMergedMetadata(merged, merged === local ? remote : local, [], {
      incrementVersion: false,
    })
  }

  const preferred =
    compareIsoTime(local.payload.savedAt, remote.payload.savedAt) >= 0 ? local : remote
  const other = preferred === local ? remote : local
  const conflict: SyncConflict = {
    recordId: preferred.recordId,
    field: "draft",
    localHash: local.hash,
    remoteHash: remote.hash,
    detectedAt: newestUpdatedAt(local.updatedAt, remote.updatedAt),
    branches: [conflictBranchFromRecord(local), conflictBranchFromRecord(remote)],
  }

  return withMergedMetadata(preferred, other, [conflict])
}

export function mergeSyncRecord(local: SyncRecord, remote: SyncRecord): SyncRecord {
  if (local.kind !== remote.kind || local.recordId !== remote.recordId) {
    throw new Error("Sync records must share recordId and kind before merge.")
  }

  if (local.deleted && !remote.deleted) {
    return compareVectorClock(local.vectorClock, remote.vectorClock) === "right-newer"
      ? remote
      : local
  }
  if (remote.deleted && !local.deleted) {
    return compareVectorClock(local.vectorClock, remote.vectorClock) === "left-newer"
      ? local
      : remote
  }

  switch (local.kind) {
    case "template_usage":
      return mergeTemplateUsageRecord(local, remote as TemplateUsageRecord)
    case "recent_print":
      return mergeRecentPrintRecord(local, remote as RecentPrintRecord)
    case "canvas_draft":
      return mergeCanvasDraftRecord(local, remote as CanvasDraftRecord)
  }
}

function mergeTemplateUsageRecords(
  local: TemplateUsageRecord[],
  remote: TemplateUsageRecord[]
): TemplateUsageRecord[] {
  const merged = new Map<string, TemplateUsageRecord>()
  for (const record of [...local, ...remote]) {
    const existing = merged.get(record.recordId)
    merged.set(
      record.recordId,
      existing ? (mergeSyncRecord(existing, record) as TemplateUsageRecord) : record
    )
  }
  return [...merged.values()].sort((left, right) => compareIsoTime(right.updatedAt, left.updatedAt))
}

function mergeRecentPrintRecords(
  local: RecentPrintRecord[],
  remote: RecentPrintRecord[]
): RecentPrintRecord[] {
  const merged = new Map<string, RecentPrintRecord>()
  for (const record of [...local, ...remote]) {
    const existing = merged.get(record.recordId)
    merged.set(
      record.recordId,
      existing ? (mergeSyncRecord(existing, record) as RecentPrintRecord) : record
    )
  }
  return [...merged.values()].sort((left, right) => compareIsoTime(right.updatedAt, left.updatedAt))
}

function mergeCanvasDraftRecords(
  local: CanvasDraftRecord[],
  remote: CanvasDraftRecord[]
): CanvasDraftRecord[] {
  const merged = new Map<string, CanvasDraftRecord>()
  for (const record of [...local, ...remote]) {
    const existing = merged.get(record.recordId)
    merged.set(
      record.recordId,
      existing ? (mergeSyncRecord(existing, record) as CanvasDraftRecord) : record
    )
  }
  return [...merged.values()].sort((left, right) => compareIsoTime(right.updatedAt, left.updatedAt))
}

export function mergeSyncState(local: SyncState, remote: SyncState): SyncState {
  const templateUsageRecords = mergeTemplateUsageRecords(
    local.templateUsageRecords,
    remote.templateUsageRecords
  )
  const recentPrintRecords = mergeRecentPrintRecords(
    local.recentPrintRecords,
    remote.recentPrintRecords
  )
  const canvasDraftRecords = mergeCanvasDraftRecords(
    local.canvasDraftRecords,
    remote.canvasDraftRecords
  )

  return {
    schemaVersion: 1,
    updatedAt: newestUpdatedAt(local.updatedAt, remote.updatedAt),
    templateUsageRecords,
    recentPrintRecords,
    canvasDraftRecords,
  }
}

export function createTemplateUsageRecord(
  payload: Omit<TemplateUsagePayload, "usedAt"> & { usedAt?: string },
  existing?: ExistingRecordMetadata
): TemplateUsageRecord {
  const nextPayload = {
    ...payload,
    usedAt: payload.usedAt ?? new Date().toISOString(),
  }
  const nextRecord: TemplateUsageRecord = {
    kind: "template_usage",
    recordId: `template:${payload.id}`,
    version: (existing?.version ?? 0) + 1,
    vectorClock: bumpVectorClock(existing?.vectorClock ?? { browser: 0, service: 0 }, "browser"),
    updatedAt: nextPayload.usedAt,
    hash: "",
    payload: nextPayload,
    deleted: false,
    conflicts: existing?.conflicts ?? [],
  }
  return {
    ...nextRecord,
    hash: recordPayloadHash(nextRecord),
  }
}

export function createRecentPrintRecord(
  payload: Omit<RecentPrintPayload, "printedAt"> & { printedAt?: string },
  existing?: ExistingRecordMetadata
): RecentPrintRecord {
  const nextPayload = {
    ...payload,
    printedAt: payload.printedAt ?? new Date().toISOString(),
  }
  const nextRecord: RecentPrintRecord = {
    kind: "recent_print",
    recordId: `print:${payload.id}`,
    version: (existing?.version ?? 0) + 1,
    vectorClock: bumpVectorClock(existing?.vectorClock ?? { browser: 0, service: 0 }, "browser"),
    updatedAt: nextPayload.printedAt,
    hash: "",
    payload: nextPayload,
    deleted: false,
    conflicts: existing?.conflicts ?? [],
  }
  return {
    ...nextRecord,
    hash: recordPayloadHash(nextRecord),
  }
}

export function createCanvasDraftRecord(
  payload: { presetId: string; draft: SharedCanvasDraftDocument; savedAt?: string },
  existing?: ExistingRecordMetadata
): CanvasDraftRecord {
  const nextPayload = {
    presetId: payload.presetId,
    draft: payload.draft,
    savedAt: payload.savedAt ?? new Date().toISOString(),
  }
  const nextRecord: CanvasDraftRecord = {
    kind: "canvas_draft",
    recordId: `draft:${payload.presetId}`,
    version: (existing?.version ?? 0) + 1,
    vectorClock: bumpVectorClock(existing?.vectorClock ?? { browser: 0, service: 0 }, "browser"),
    updatedAt: nextPayload.savedAt,
    hash: "",
    payload: nextPayload,
    deleted: false,
    conflicts: existing?.conflicts ?? [],
  }
  return {
    ...nextRecord,
    hash: recordPayloadHash(nextRecord),
  }
}

export function createDeletedCanvasDraftRecord(
  presetId: string,
  existing?: ExistingDeletedCanvasDraftMetadata,
  deletedAt = new Date().toISOString()
): CanvasDraftRecord {
  const draft =
    existing?.payload?.draft ??
    ({
      version: 1,
      id: `${presetId}-deleted`,
      presetId,
      name: presetId,
      width: 0,
      height: 0,
      elements: [],
      editor: {
        gridEnabled: true,
        snapEnabled: true,
      },
    } satisfies SharedCanvasDraftDocument)
  const nextRecord: CanvasDraftRecord = {
    kind: "canvas_draft",
    recordId: `draft:${presetId}`,
    version: (existing?.version ?? 0) + 1,
    vectorClock: bumpVectorClock(existing?.vectorClock ?? { browser: 0, service: 0 }, "browser"),
    updatedAt: deletedAt,
    hash: "",
    payload: {
      presetId,
      draft,
      savedAt: deletedAt,
    },
    deleted: true,
    conflicts: existing?.conflicts ?? [],
  }
  return {
    ...nextRecord,
    hash: recordPayloadHash(nextRecord),
  }
}
