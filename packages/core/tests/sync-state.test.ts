import { describe, expect, it } from "vitest"

import {
  type CanvasDraftRecord,
  createCanvasDraftRecord,
  createDeletedCanvasDraftRecord,
  createRecentPrintRecord,
  createTemplateUsageRecord,
  emptySyncState,
  mergeSyncRecord,
  mergeSyncState,
} from "../src/sync-state.ts"

describe("sync-state merge semantics", () => {
  it("does not treat same canvas content with different savedAt as a conflict", () => {
    const draft = {
      version: 1 as const,
      id: "draft-1",
      presetId: "shipping-wide",
      name: "Shipping Wide",
      width: 384,
      height: 224,
      elements: [],
      editor: {
        gridEnabled: true,
        snapEnabled: true,
      },
    }

    const left = createCanvasDraftRecord(
      {
        presetId: draft.presetId,
        draft,
        savedAt: "2026-06-28T10:00:00.000Z",
      },
      undefined
    )
    const right = createCanvasDraftRecord(
      {
        presetId: draft.presetId,
        draft,
        savedAt: "2026-06-28T10:05:00.000Z",
      },
      {
        ...left,
        vectorClock: { browser: 0, service: 1 },
      }
    )

    const merged = mergeSyncRecord(left, right)
    expect(merged.hash).toBe(left.hash)
    expect(merged.conflicts).toHaveLength(0)
  })

  it("keeps conflicting canvas branches as explicit conflict payloads", () => {
    const base = createCanvasDraftRecord({
      presetId: "shipping-wide",
      draft: {
        version: 1,
        id: "draft-1",
        presetId: "shipping-wide",
        name: "A",
        width: 384,
        height: 224,
        elements: [],
        editor: {
          gridEnabled: true,
          snapEnabled: true,
        },
      },
      savedAt: "2026-06-28T10:00:00.000Z",
    })
    const local = createCanvasDraftRecord(
      {
        presetId: "shipping-wide",
        draft: {
          ...base.payload.draft,
          name: "Local",
        },
        savedAt: "2026-06-28T10:02:00.000Z",
      },
      {
        ...base,
        vectorClock: { browser: 1, service: 0 },
      }
    )
    const remote = createCanvasDraftRecord(
      {
        presetId: "shipping-wide",
        draft: {
          ...base.payload.draft,
          name: "Remote",
        },
        savedAt: "2026-06-28T10:03:00.000Z",
      },
      {
        ...base,
        vectorClock: { browser: 0, service: 1 },
      }
    )

    const merged = mergeSyncRecord(local, remote)
    expect(merged.conflicts).toHaveLength(1)
    expect(merged.conflicts[0]?.branches).toHaveLength(2)
    expect(
      merged.conflicts[0]?.branches.map(
        (branch) => (branch.payload as { draft: { name: string } }).draft.name
      )
    ).toEqual(expect.arrayContaining(["Local", "Remote"]))
  })

  it("preserves deleted canvas draft tombstones across merge", () => {
    const live = createCanvasDraftRecord({
      presetId: "ops-tag",
      draft: {
        version: 1,
        id: "draft-2",
        presetId: "ops-tag",
        name: "Ops Tag",
        width: 384,
        height: 160,
        elements: [],
        editor: {
          gridEnabled: true,
          snapEnabled: true,
        },
      },
      savedAt: "2026-06-28T10:00:00.000Z",
    })
    const tombstone = createDeletedCanvasDraftRecord(
      "ops-tag",
      {
        ...live,
        vectorClock: { browser: 1, service: 0 },
      },
      "2026-06-28T10:05:00.000Z"
    )

    const merged = mergeSyncState(
      {
        ...emptySyncState(),
        updatedAt: tombstone.updatedAt,
        canvasDraftRecords: [tombstone],
      },
      {
        ...emptySyncState(),
        updatedAt: live.updatedAt,
        canvasDraftRecords: [live],
      }
    )

    expect(merged.canvasDraftRecords[0]?.deleted).toBe(true)
  })

  it("merges recent records into the combined state surface", () => {
    const template = createTemplateUsageRecord({
      id: "shipping-compact",
      name: "Shipping Label",
      description: "Recent template",
      usedAt: "2026-06-28T10:00:00.000Z",
    })
    const print = createRecentPrintRecord({
      id: "template:shipping-compact",
      title: "shipping-compact",
      kind: "template",
      printerName: "Mock P2",
      printedAt: "2026-06-28T10:01:00.000Z",
    })

    const merged = mergeSyncState(
      {
        ...emptySyncState(),
        updatedAt: template.updatedAt,
        templateUsageRecords: [template],
      },
      {
        ...emptySyncState(),
        updatedAt: print.updatedAt,
        recentPrintRecords: [print],
      }
    )

    expect(merged.templateUsageRecords).toHaveLength(1)
    expect(merged.recentPrintRecords).toHaveLength(1)
  })

  it("keeps recent print merges idempotent once both sides already agree", () => {
    const local = createRecentPrintRecord({
      id: "template:shipping-compact",
      title: "shipping-compact",
      kind: "template",
      printerName: "Browser P2",
      printedAt: "2026-06-28T10:00:00.000Z",
    })
    const remote = {
      ...local,
      version: local.version + 2,
      vectorClock: { browser: 1, service: 3 },
    }

    const merged = mergeSyncRecord(local, remote)
    expect(merged.version).toBe(remote.version)
    expect(merged.vectorClock).toEqual(remote.vectorClock)
    expect(merged.hash).toBe(remote.hash)
  })

  it("converges concurrent draft branches after one side adopts the merged winner", () => {
    const base = createCanvasDraftRecord({
      presetId: "shipping-wide",
      draft: {
        version: 1,
        id: "draft-1",
        presetId: "shipping-wide",
        name: "Base",
        width: 384,
        height: 224,
        elements: [],
        editor: {
          gridEnabled: true,
          snapEnabled: true,
        },
      },
      savedAt: "2026-06-28T10:00:00.000Z",
    })
    const browserBranch = createCanvasDraftRecord(
      {
        presetId: "shipping-wide",
        draft: {
          ...base.payload.draft,
          name: "Browser edit",
        },
        savedAt: "2026-06-28T10:02:00.000Z",
      },
      {
        version: base.version,
        vectorClock: { browser: 1, service: 0 },
        conflicts: base.conflicts,
      }
    )
    const serviceBranch = createCanvasDraftRecord(
      {
        presetId: "shipping-wide",
        draft: {
          ...base.payload.draft,
          name: "Service edit",
        },
        savedAt: "2026-06-28T10:03:00.000Z",
      },
      {
        version: base.version,
        vectorClock: { browser: 0, service: 1 },
        conflicts: base.conflicts,
      }
    )

    const firstMerge = mergeSyncRecord(browserBranch, serviceBranch) as CanvasDraftRecord
    expect(firstMerge.conflicts).toHaveLength(1)

    const adoptedByBrowser = createCanvasDraftRecord(
      {
        presetId: "shipping-wide",
        draft: firstMerge.payload.draft,
        savedAt: "2026-06-28T10:04:00.000Z",
      },
      {
        version: firstMerge.version,
        vectorClock: firstMerge.vectorClock,
        conflicts: firstMerge.conflicts,
      }
    )

    const converged = mergeSyncRecord(adoptedByBrowser, firstMerge)
    expect(converged.hash).toBe(adoptedByBrowser.hash)
    expect(converged.conflicts).toHaveLength(1)
    expect(converged.version).toBe(adoptedByBrowser.version)
    expect(converged.vectorClock).toEqual(adoptedByBrowser.vectorClock)
  })
})
