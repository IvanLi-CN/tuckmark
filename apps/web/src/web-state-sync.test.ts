// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createCanvasDraftRecord,
  createDeletedCanvasDraftRecord,
  createRecentPrintRecord,
  createTemplateUsageRecord,
  emptySyncState,
  type SyncState,
} from "../../../packages/core/src/web.js"
import { createDraftFromPreset, getDraftStorageKey, getPresetById } from "./canvas-editor-model.js"
import {
  applySyncStateToBrowser,
  loadLocalSyncState,
  recordCanvasDraftLocally,
  recordRecentPrintLocally,
  syncWebState,
} from "./web-state-sync.js"

function installMemoryStorage(): Storage {
  const store = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key) {
      return store.get(key) ?? null
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key) {
      store.delete(key)
    },
    setItem(key, value) {
      store.set(key, value)
    },
  }

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
  return storage
}

function readJson<T>(key: string): T | null {
  const raw = window.localStorage.getItem(key)
  return raw ? (JSON.parse(raw) as T) : null
}

describe("web-state-sync", () => {
  const storage = installMemoryStorage()

  beforeEach(() => {
    storage.clear()
    vi.useRealTimers()
  })

  it("migrates legacy recent activity and draft storage into sync state", () => {
    const preset = getPresetById("shipping-wide")
    const draft = createDraftFromPreset(preset)

    window.localStorage.setItem(
      "tuckmark.recent-activity.v1",
      JSON.stringify({
        templates: [
          {
            id: "shipping-compact",
            name: "Shipping Label",
            description: "Legacy template",
            usedAt: "2026-06-28T10:00:00.000Z",
          },
        ],
        prints: [
          {
            id: "template:shipping-compact",
            title: "shipping-compact",
            kind: "template",
            printedAt: "2026-06-28T10:01:00.000Z",
            printerName: "Legacy Printer",
          },
        ],
      })
    )
    window.localStorage.setItem(getDraftStorageKey(preset.id), JSON.stringify(draft))

    const state = loadLocalSyncState()

    expect(state.templateUsageRecords).toHaveLength(1)
    expect(state.recentPrintRecords).toHaveLength(1)
    expect(state.canvasDraftRecords).toHaveLength(1)
    expect(state.canvasDraftRecords[0]?.payload.presetId).toBe(preset.id)
  })

  it("replays browser-local edits after a sync failure and converges once the service recovers", async () => {
    const local = recordRecentPrintLocally({
      id: "template:shipping-compact",
      title: "shipping-compact",
      kind: "template",
      printerName: "Browser P2",
    })
    const offlineClient = {
      getSyncState: vi.fn<() => Promise<SyncState>>().mockRejectedValue(new Error("offline")),
      mergeSyncState: vi.fn<(_: SyncState) => Promise<SyncState>>(),
    }

    await expect(syncWebState(offlineClient, ["shipping-wide"])).rejects.toThrow("offline")
    expect(loadLocalSyncState().recentPrintRecords).toHaveLength(1)

    let remoteState = emptySyncState()
    const recoveredClient = {
      getSyncState: vi.fn(async () => remoteState),
      mergeSyncState: vi.fn(async (next: SyncState) => {
        remoteState = next
        return remoteState
      }),
    }

    const synced = await syncWebState(recoveredClient, ["shipping-wide"])

    expect(recoveredClient.getSyncState).toHaveBeenCalledOnce()
    expect(recoveredClient.mergeSyncState).toHaveBeenCalledOnce()
    expect(synced.state.recentPrintRecords).toHaveLength(1)
    expect(remoteState.recentPrintRecords[0]?.payload.printerName).toBe("Browser P2")
    expect(loadLocalSyncState().recentPrintRecords[0]?.payload.printerName).toBe("Browser P2")
    expect(local.recentPrintRecords[0]?.payload.id).toBe("template:shipping-compact")
  })

  it("keeps only the latest six recent print entries after browser writeback", () => {
    let state = emptySyncState()
    for (let index = 0; index < 7; index += 1) {
      const record = createRecentPrintRecord({
        id: `template:label-${index}`,
        title: `label-${index}`,
        kind: "template",
        printerName: "Mock P2",
        printedAt: `2026-06-28T10:0${index}:00.000Z`,
      })
      state = {
        ...state,
        updatedAt: record.updatedAt,
        recentPrintRecords: [...state.recentPrintRecords, record],
      }
    }

    const recent = applySyncStateToBrowser(state, ["shipping-wide"])

    expect(recent.prints).toHaveLength(6)
    expect(recent.prints[0]?.id).toBe("template:label-6")
    expect(recent.prints[5]?.id).toBe("template:label-1")
  })

  it("clears browser draft storage when the merged sync state only contains a tombstone", () => {
    const preset = getPresetById("ops-tag")
    const draft = createDraftFromPreset(preset)
    window.localStorage.setItem(getDraftStorageKey(preset.id), JSON.stringify(draft))

    const live = createCanvasDraftRecord({
      presetId: preset.id,
      draft,
      savedAt: "2026-06-28T10:00:00.000Z",
    })
    const tombstone = createDeletedCanvasDraftRecord(
      preset.id,
      {
        version: live.version,
        vectorClock: live.vectorClock,
        conflicts: live.conflicts,
        payload: {
          draft,
        },
      },
      "2026-06-28T10:05:00.000Z"
    )

    applySyncStateToBrowser(
      {
        ...emptySyncState(),
        updatedAt: tombstone.updatedAt,
        canvasDraftRecords: [tombstone],
      },
      [preset.id]
    )

    expect(window.localStorage.getItem(getDraftStorageKey(preset.id))).toBeNull()
  })

  it("persists the merged sync snapshot back into local storage after convergence", async () => {
    const localRecord = createTemplateUsageRecord({
      id: "shipping-compact",
      name: "Shipping Label",
      description: "Local",
      usedAt: "2026-06-28T10:00:00.000Z",
    })
    const remoteRecord = createTemplateUsageRecord({
      id: "ops-tag",
      name: "Ops Tag",
      description: "Remote",
      usedAt: "2026-06-28T10:01:00.000Z",
    })

    window.localStorage.setItem(
      "tuckmark.sync-state.v1",
      JSON.stringify({
        ...emptySyncState(),
        updatedAt: localRecord.updatedAt,
        templateUsageRecords: [localRecord],
      })
    )

    const client = {
      getSyncState: vi.fn(async () => ({
        ...emptySyncState(),
        updatedAt: remoteRecord.updatedAt,
        templateUsageRecords: [remoteRecord],
      })),
      mergeSyncState: vi.fn(async (next: SyncState) => next),
    }

    await syncWebState(client, ["shipping-wide"])

    const stored = readJson<SyncState>("tuckmark.sync-state.v1")
    expect(stored?.templateUsageRecords).toHaveLength(2)
    expect(stored?.templateUsageRecords.map((record) => record.payload.id)).toEqual(
      expect.arrayContaining(["shipping-compact", "ops-tag"])
    )
  })

  it("does not rewrite an unchanged local draft into a newer sync record during reload", () => {
    const preset = getPresetById("shipping-wide")
    const draft = createDraftFromPreset(preset)
    const existing = createCanvasDraftRecord({
      presetId: preset.id,
      draft,
      savedAt: "2026-06-28T10:00:00.000Z",
    })

    window.localStorage.setItem(
      "tuckmark.sync-state.v1",
      JSON.stringify({
        ...emptySyncState(),
        updatedAt: existing.updatedAt,
        canvasDraftRecords: [existing],
      })
    )
    window.localStorage.setItem(getDraftStorageKey(preset.id), JSON.stringify(draft))

    const loaded = loadLocalSyncState()

    expect(loaded.canvasDraftRecords[0]?.updatedAt).toBe(existing.updatedAt)
    expect(loaded.canvasDraftRecords[0]?.version).toBe(existing.version)
    expect(loaded.canvasDraftRecords[0]?.vectorClock).toEqual(existing.vectorClock)
  })

  it("does not bump version when persisting an unchanged draft over synced state", () => {
    const preset = getPresetById("shipping-wide")
    const draft = createDraftFromPreset(preset)
    const existing = {
      ...createCanvasDraftRecord({
        presetId: preset.id,
        draft,
        savedAt: "2026-06-28T10:15:00.000Z",
      }),
      version: 3,
      vectorClock: { browser: 0, service: 1 },
    }

    window.localStorage.setItem(
      "tuckmark.sync-state.v1",
      JSON.stringify({
        ...emptySyncState(),
        updatedAt: existing.updatedAt,
        canvasDraftRecords: [existing],
      })
    )

    const recorded = recordCanvasDraftLocally(preset.id, draft)

    expect(recorded.canvasDraftRecords[0]?.updatedAt).toBe(existing.updatedAt)
    expect(recorded.canvasDraftRecords[0]?.version).toBe(existing.version)
    expect(recorded.canvasDraftRecords[0]?.vectorClock).toEqual(existing.vectorClock)
  })

  it("ignores non-syncable preset ids when recording browser draft state", () => {
    const draft = createDraftFromPreset(getPresetById("cable-tag"))

    const recorded = recordCanvasDraftLocally("cable-tag", draft)

    expect(recorded.canvasDraftRecords).toHaveLength(0)
  })

  it("keeps browser-local writes that land while sync is awaiting the service merge", async () => {
    recordRecentPrintLocally({
      id: "template:shipping-compact",
      title: "shipping-compact",
      kind: "template",
      printerName: "Browser P2",
    })

    let releaseMerge: (() => void) | undefined
    const client = {
      getSyncState: vi.fn(async () => emptySyncState()),
      mergeSyncState: vi.fn(
        async (next: SyncState) =>
          await new Promise<SyncState>((resolve) => {
            releaseMerge = () => resolve(next)
          })
      ),
    }

    const pendingSync = syncWebState(client, ["shipping-wide"])
    await Promise.resolve()

    recordRecentPrintLocally({
      id: "template:cable-tag",
      title: "cable-tag",
      kind: "template",
      printerName: "Late Browser P2",
    })

    releaseMerge?.()
    const synced = await pendingSync

    expect(synced.requiresResync).toBe(true)
    expect(synced.state.recentPrintRecords.map((record) => record.payload.id)).toEqual(
      expect.arrayContaining(["template:shipping-compact", "template:cable-tag"])
    )
    expect(loadLocalSyncState().recentPrintRecords.map((record) => record.payload.id)).toEqual(
      expect.arrayContaining(["template:shipping-compact", "template:cable-tag"])
    )
  })
})
