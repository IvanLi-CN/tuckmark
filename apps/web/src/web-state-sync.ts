import {
  createCanvasDraftRecord,
  createRecentPrintRecord,
  createTemplateUsageRecord,
  type ExistingRecordMetadata,
  emptySyncState,
  mergeSyncState,
  parseSyncState,
  type SharedCanvasDraftDocument,
  type SyncState,
  stableHash,
  stableStringify,
} from "../../../packages/core/src/web.js"

import {
  CANVAS_PRESETS,
  clearStoredDraftDocument,
  loadStoredDraftDocument,
  persistDraftDocumentToStorage,
} from "./canvas-editor-model.js"
import {
  emptyRecentActivityState,
  loadRecentActivity,
  persistRecentActivity,
  type RecentActivityState,
  type RecentPrintEntry,
  type RecentTemplateEntry,
} from "./lib/recent-activity.js"
import type { CanvasDraftDocument } from "./types.js"

const SYNC_STORAGE_KEY = "tuckmark.sync-state.v1"
const MAX_ITEMS = 6

export type SyncApiClient = {
  getSyncState(): Promise<SyncState>
  mergeSyncState(state: SyncState): Promise<SyncState>
}

function recordSeed(
  record:
    | {
        version: number
        vectorClock: SyncState["canvasDraftRecords"][number]["vectorClock"]
        conflicts: SyncState["canvasDraftRecords"][number]["conflicts"]
      }
    | undefined
): ExistingRecordMetadata | undefined {
  if (!record) {
    return undefined
  }
  return {
    version: record.version,
    vectorClock: record.vectorClock,
    conflicts: record.conflicts,
  }
}

function recentRecordSeed<
  T extends {
    version: number
    vectorClock: SyncState["templateUsageRecords"][number]["vectorClock"]
    conflicts: SyncState["templateUsageRecords"][number]["conflicts"]
  },
>(record: T | undefined) {
  if (!record) {
    return undefined
  }
  return {
    version: record.version,
    vectorClock: record.vectorClock,
    conflicts: record.conflicts,
  }
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function persistMergedState(current: SyncState, delta: SyncState): SyncState {
  return persistLocalSyncState(mergeSyncState(current, delta))
}

function sameSyncState(left: SyncState, right: SyncState): boolean {
  return stableStringify(left) === stableStringify(right)
}

function dedupeLatest<T extends { recordId: string; updatedAt: string }>(records: T[]): T[] {
  const seen = new Set<string>()
  return [...records]
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .filter((record) => {
      if (seen.has(record.recordId)) {
        return false
      }
      seen.add(record.recordId)
      return true
    })
}

function buildLegacySyncSnapshot(): SyncState {
  const recentActivity = canUseStorage() ? loadRecentActivity() : emptyRecentActivityState()

  let state = emptySyncState()
  for (const entry of recentActivity.templates) {
    const existing = state.templateUsageRecords.find((record) => record.payload.id === entry.id)
    const record = createTemplateUsageRecord(entry, recentRecordSeed(existing))
    state = mergeSyncState(state, {
      ...emptySyncState(),
      updatedAt: record.updatedAt,
      templateUsageRecords: [record],
    })
  }

  for (const entry of recentActivity.prints) {
    const existing = state.recentPrintRecords.find((record) => record.payload.id === entry.id)
    const record = createRecentPrintRecord(entry, recentRecordSeed(existing))
    state = mergeSyncState(state, {
      ...emptySyncState(),
      updatedAt: record.updatedAt,
      recentPrintRecords: [record],
    })
  }

  for (const preset of CANVAS_PRESETS) {
    const draft = loadStoredDraftDocument(preset.id)
    if (!draft) {
      continue
    }
    const existing = state.canvasDraftRecords.find(
      (record) => record.payload.presetId === preset.id
    )
    const record = createCanvasDraftRecord(
      {
        presetId: preset.id,
        draft,
      },
      recordSeed(existing)
    )
    state = mergeSyncState(state, {
      ...emptySyncState(),
      updatedAt: record.updatedAt,
      canvasDraftRecords: [record],
    })
  }

  return state
}

export function loadLocalSyncState(): SyncState {
  if (!canUseStorage()) {
    return emptySyncState()
  }

  let stored = emptySyncState()
  try {
    const raw = window.localStorage.getItem(SYNC_STORAGE_KEY)
    stored = raw ? parseSyncState(JSON.parse(raw)) : emptySyncState()
  } catch {
    stored = emptySyncState()
  }

  const migrated = mergeSyncState(buildLegacySyncSnapshot(), stored)
  if (JSON.stringify(migrated) !== JSON.stringify(stored)) {
    persistLocalSyncState(migrated)
  }
  return migrated
}

export function persistLocalSyncState(state: SyncState): SyncState {
  if (!canUseStorage()) {
    return state
  }
  window.localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(state))
  return state
}

export function recordTemplateUsageLocally(entry: Omit<RecentTemplateEntry, "usedAt">): SyncState {
  const current = loadLocalSyncState()
  const existing = current.templateUsageRecords.find((record) => record.payload.id === entry.id)
  const record = createTemplateUsageRecord(entry, recentRecordSeed(existing))
  return persistMergedState(current, {
    ...emptySyncState(),
    updatedAt: record.updatedAt,
    templateUsageRecords: [record],
  })
}

export function recordRecentPrintLocally(entry: Omit<RecentPrintEntry, "printedAt">): SyncState {
  const current = loadLocalSyncState()
  const existing = current.recentPrintRecords.find((record) => record.payload.id === entry.id)
  const record = createRecentPrintRecord(entry, recentRecordSeed(existing))
  return persistMergedState(current, {
    ...emptySyncState(),
    updatedAt: record.updatedAt,
    recentPrintRecords: [record],
  })
}

export function recordCanvasDraftLocally(
  presetId: string,
  draft: SharedCanvasDraftDocument
): SyncState {
  const current = loadLocalSyncState()
  const existing = current.canvasDraftRecords.find((record) => record.payload.presetId === presetId)
  const record = createCanvasDraftRecord(
    {
      presetId,
      draft,
    },
    recordSeed(existing)
  )
  return persistMergedState(current, {
    ...emptySyncState(),
    updatedAt: record.updatedAt,
    canvasDraftRecords: [record],
  })
}

export function deleteCanvasDraftLocally(presetId: string): SyncState {
  const current = loadLocalSyncState()
  const existing = current.canvasDraftRecords.find((record) => record.payload.presetId === presetId)
  const deletedAt = new Date().toISOString()
  const preservedDraft =
    (existing?.payload.draft as SharedCanvasDraftDocument | undefined) ??
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
  const seed = recordSeed(existing)
  const record = {
    kind: "canvas_draft" as const,
    recordId: `draft:${presetId}`,
    version: (seed?.version ?? 0) + 1,
    vectorClock: {
      browser: (seed?.vectorClock.browser ?? 0) + 1,
      service: seed?.vectorClock.service ?? 0,
    },
    updatedAt: deletedAt,
    payload: {
      presetId,
      draft: preservedDraft,
      savedAt: deletedAt,
    },
    deleted: true,
    conflicts: seed?.conflicts ?? [],
    hash: stableHash({
      presetId,
      draft: preservedDraft,
    }),
  }
  return persistMergedState(current, {
    ...emptySyncState(),
    updatedAt: record.updatedAt,
    canvasDraftRecords: [record],
  })
}

export function applySyncStateToBrowser(
  state: SyncState,
  presetIds: string[]
): RecentActivityState {
  persistLocalSyncState(state)

  const recentActivity = persistRecentActivity({
    templates: dedupeLatest(state.templateUsageRecords)
      .filter((record) => !record.deleted)
      .map((record) => record.payload)
      .slice(0, MAX_ITEMS),
    prints: dedupeLatest(state.recentPrintRecords)
      .filter((record) => !record.deleted)
      .map((record) => record.payload)
      .slice(0, MAX_ITEMS),
  })

  const draftsByPreset = new Map(
    dedupeLatest(state.canvasDraftRecords)
      .filter((record) => !record.deleted)
      .map((record) => [record.payload.presetId, record.payload.draft] as const)
  )
  for (const presetId of presetIds) {
    const draft = draftsByPreset.get(presetId)
    if (draft) {
      persistDraftDocumentToStorage(presetId, draft as CanvasDraftDocument)
      continue
    }
    clearStoredDraftDocument(presetId)
  }

  return recentActivity
}

export async function syncWebState(
  client: SyncApiClient,
  presetIds: string[]
): Promise<{
  state: SyncState
  recentActivity: RecentActivityState
  requiresResync: boolean
}> {
  const local = loadLocalSyncState()
  const remote = await client.getSyncState()
  const merged = mergeSyncState(local, remote)
  const persisted = await client.mergeSyncState(merged)
  const latestLocal = loadLocalSyncState()
  const reconciled = mergeSyncState(persisted, latestLocal)
  const requiresResync = !sameSyncState(reconciled, persisted)
  const nextState = requiresResync ? reconciled : persisted
  return {
    state: nextState,
    recentActivity: applySyncStateToBrowser(nextState, presetIds),
    requiresResync,
  }
}
