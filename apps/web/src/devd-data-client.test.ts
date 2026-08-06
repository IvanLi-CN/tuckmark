import { afterEach, describe, expect, it, vi } from "vitest"

import {
  DevdDataClient,
  DevdDataConflictError,
  devdDataClient,
  isServerHttpDataSurface,
} from "./devd-data-client.js"
import { createDefaultRuntimeAppSettings } from "./runtime-app-settings.js"
import type {
  RuntimeStoreAppSettings,
  RuntimeStoreSaveWorkingCopyArgs,
} from "./runtime-store-contract.js"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function runtimeSnapshot(settings: RuntimeStoreAppSettings, revision = 0) {
  return new Response(
    JSON.stringify({
      revision,
      data: {
        schema: "tuckmark.runtime-export.v1",
        exportedAt: "2026-07-01T00:00:00.000Z",
        snapshotUpdatedAt: settings.updatedAt,
        settings,
        templates: [],
        versions: [],
        workingCopies: [],
      },
    }),
    { headers: { "content-type": "application/json" } }
  )
}

function status(revision: number) {
  return new Response(
    JSON.stringify({
      configured: true,
      health: "healthy",
      directoryName: "mock-devd",
      revision,
      counts: { templates: 0, versions: 0, workingCopies: 0, materials: 0, adjustments: 0 },
    }),
    { headers: { "content-type": "application/json" } }
  )
}

describe("DevdDataClient", () => {
  it("detects the server-http data surface", () => {
    vi.stubEnv("TUCKMARK_WEB_SURFACE", "server-http")
    expect(isServerHttpDataSurface()).toBe(true)
  })

  it("keeps the authoritative revision after a conflict", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ revision: 3, data: { schema: "tuckmark.runtime-export.v1" } }),
          {
            headers: { "content-type": "application/json" },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: "revision_conflict", actualRevision: 8, error: "stale" }),
          { status: 409, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ revision: 9, data: null }), {
          headers: { "content-type": "application/json" },
        })
      )
    vi.stubGlobal("fetch", fetchMock)

    await devdDataClient.snapshot()
    devdDataClient.invalidate(8)
    await expect(
      devdDataClient.runtimeCommand("save-settings", { patch: {} })
    ).rejects.toBeInstanceOf(DevdDataConflictError)
    await devdDataClient.runtimeCommand("save-settings", { patch: {} })

    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toMatchObject({
      expectedRevision: 3,
    })
    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toMatchObject({
      expectedRevision: 8,
    })
  })

  it("rejects an older concurrent snapshot instead of pairing it with a newer revision", async () => {
    let resolveSnapshot: ((response: Response) => void) | undefined
    const snapshotResponse = new Promise<Response>((resolve) => {
      resolveSnapshot = resolve
    })
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => snapshotResponse)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            configured: true,
            health: "healthy",
            directoryName: "mock-devd",
            revision: 9,
            counts: { templates: 0, versions: 0, workingCopies: 0, materials: 0, adjustments: 0 },
          }),
          { headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ revision: 10, data: null }), {
          headers: { "content-type": "application/json" },
        })
      )
    vi.stubGlobal("fetch", fetchMock)
    const client = new DevdDataClient()

    const olderSnapshot = client.snapshot()
    await client.status()
    resolveSnapshot?.(
      new Response(
        JSON.stringify({ revision: 3, data: { schema: "tuckmark.runtime-export.v1" } }),
        { headers: { "content-type": "application/json" } }
      )
    )
    await expect(olderSnapshot).rejects.toBeInstanceOf(DevdDataConflictError)
    await client.runtimeCommand("save-settings", { patch: {} })

    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toMatchObject({
      expectedRevision: 9,
    })
  })

  it("shares one in-flight snapshot across concurrent read consumers", async () => {
    let resolveSnapshot: ((response: Response) => void) | undefined
    const snapshotResponse = new Promise<Response>((resolve) => {
      resolveSnapshot = resolve
    })
    const fetchMock = vi.fn().mockImplementation(() => snapshotResponse)
    vi.stubGlobal("fetch", fetchMock)
    const client = new DevdDataClient()

    const reads = [client.snapshot(), client.snapshot(), client.snapshot()]
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    resolveSnapshot?.(runtimeSnapshot(createDefaultRuntimeAppSettings(), 7))

    const snapshots = await Promise.all(reads)
    expect(snapshots).toHaveLength(3)
    expect(snapshots.every((snapshot) => snapshot.settings?.version === 2)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("joins a fresh snapshot when SSE supersedes an older in-flight response", async () => {
    let resolveStaleSnapshot: ((response: Response) => void) | undefined
    let resolveFreshSnapshot: ((response: Response) => void) | undefined
    const staleSnapshotResponse = new Promise<Response>((resolve) => {
      resolveStaleSnapshot = resolve
    })
    const freshSnapshotResponse = new Promise<Response>((resolve) => {
      resolveFreshSnapshot = resolve
    })
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => staleSnapshotResponse)
      .mockImplementationOnce(() => freshSnapshotResponse)
    vi.stubGlobal("fetch", fetchMock)
    const client = new DevdDataClient()

    const staleRead = client.snapshot()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    client.invalidate(8)
    const freshRead = client.snapshot()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    resolveFreshSnapshot?.(runtimeSnapshot(createDefaultRuntimeAppSettings(), 8))
    await expect(freshRead).resolves.toMatchObject({ settings: { version: 2 } })
    resolveStaleSnapshot?.(runtimeSnapshot(createDefaultRuntimeAppSettings(), 3))
    await expect(staleRead).resolves.toMatchObject({ settings: { version: 2 } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("accepts an in-flight snapshot at the invalidating SSE revision", async () => {
    let resolveSnapshot: ((response: Response) => void) | undefined
    const snapshotResponse = new Promise<Response>((resolve) => {
      resolveSnapshot = resolve
    })
    const fetchMock = vi.fn().mockImplementation(() => snapshotResponse)
    vi.stubGlobal("fetch", fetchMock)
    const client = new DevdDataClient()

    const read = client.snapshot()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    client.invalidate(8)
    resolveSnapshot?.(runtimeSnapshot(createDefaultRuntimeAppSettings(), 8))

    await expect(read).resolves.toMatchObject({ settings: { version: 2 } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("does not send a settings patch derived from a stale concurrent snapshot", async () => {
    let resolveSnapshot: ((response: Response) => void) | undefined
    const snapshotResponse = new Promise<Response>((resolve) => {
      resolveSnapshot = resolve
    })
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => snapshotResponse)
      .mockResolvedValueOnce(status(9))
    vi.stubGlobal("fetch", fetchMock)
    const client = new DevdDataClient()

    const update = client.updateSettings((current) => ({
      printerDeviceCalibrations: {
        ...current.printerDeviceCalibrations,
        alpha: { xOffsetMm: 1, yOffsetMm: 0, printStrengthLevel: 1 },
      },
    }))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await client.status()
    resolveSnapshot?.(runtimeSnapshot(createDefaultRuntimeAppSettings(), 3))

    await expect(update).rejects.toBeInstanceOf(DevdDataConflictError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("serializes overlapping mutations with the latest completed revision", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            configured: true,
            health: "healthy",
            directoryName: "mock-devd",
            revision: 0,
            counts: { templates: 0, versions: 0, workingCopies: 0, materials: 0, adjustments: 0 },
          }),
          { headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ revision: 1, data: null }), {
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ revision: 2, data: null }), {
          headers: { "content-type": "application/json" },
        })
      )
    vi.stubGlobal("fetch", fetchMock)
    const client = new DevdDataClient()

    await Promise.all([
      client.runtimeCommand("save-settings", { patch: { threshold: 140 } }),
      client.inventoryCommand("save-material", { material: { id: "mock-material" } }),
    ])

    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toMatchObject({
      expectedRevision: 0,
    })
    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toMatchObject({
      expectedRevision: 1,
    })
  })

  it("coalesces a burst of autosaves to the latest draft per source", async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(status(0))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ revision: 1, data: { sourceKey: "scratch:custom" } }), {
          headers: { "content-type": "application/json" },
        })
      )
    vi.stubGlobal("fetch", fetchMock)
    const client = new DevdDataClient()
    const autosave = (name: string) =>
      ({
        source: { kind: "scratch", presetId: "custom" },
        document: { name },
      }) as RuntimeStoreSaveWorkingCopyArgs

    const saves = [
      client.saveAutosave(autosave("first")),
      client.saveAutosave(autosave("second")),
      client.saveAutosave(autosave("latest")),
    ]
    await vi.advanceTimersByTimeAsync(150)
    await Promise.all(saves)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toMatchObject({
      args: { document: { name: "latest" } },
    })
  })

  it("retries a pending autosave after a revision conflict without losing its waiters", async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(status(0))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: "revision_conflict", actualRevision: 1, error: "stale" }),
          { status: 409, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ revision: 2, data: { sourceKey: "scratch:custom" } }), {
          headers: { "content-type": "application/json" },
        })
      )
    vi.stubGlobal("fetch", fetchMock)
    const client = new DevdDataClient()
    const save = client.saveAutosave({
      source: { kind: "scratch", presetId: "custom" },
      document: { name: "pending draft" },
    } as RuntimeStoreSaveWorkingCopyArgs)

    await vi.advanceTimersByTimeAsync(150)
    await vi.advanceTimersByTimeAsync(150)
    await expect(save).resolves.toEqual({ sourceKey: "scratch:custom" })

    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toMatchObject({
      expectedRevision: 0,
    })
    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toMatchObject({
      expectedRevision: 1,
      args: { document: { name: "pending draft" } },
    })
  })

  it("serializes functional settings updates through a fresh queued read", async () => {
    const initial = createDefaultRuntimeAppSettings()
    const first: RuntimeStoreAppSettings = {
      ...initial,
      printerDeviceCalibrations: {
        alpha: { xOffsetMm: 1, yOffsetMm: 0, printStrengthLevel: 1 },
      },
    }
    const second: RuntimeStoreAppSettings = {
      ...first,
      printerDeviceCalibrations: {
        ...first.printerDeviceCalibrations,
        beta: { xOffsetMm: 2, yOffsetMm: 0, printStrengthLevel: 2 },
      },
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(runtimeSnapshot(initial, 0))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ revision: 1, data: first }), {
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(runtimeSnapshot(first, 1))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ revision: 2, data: second }), {
          headers: { "content-type": "application/json" },
        })
      )
    vi.stubGlobal("fetch", fetchMock)
    const client = new DevdDataClient()

    await Promise.all([
      client.updateSettings((current) => ({
        printerDeviceCalibrations: {
          ...current.printerDeviceCalibrations,
          alpha: { xOffsetMm: 1, yOffsetMm: 0, printStrengthLevel: 1 },
        },
      })),
      client.updateSettings((current) => ({
        printerDeviceCalibrations: {
          ...current.printerDeviceCalibrations,
          beta: { xOffsetMm: 2, yOffsetMm: 0, printStrengthLevel: 2 },
        },
      })),
    ])

    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toMatchObject({
      expectedRevision: 0,
      args: { patch: { printerDeviceCalibrations: { alpha: expect.any(Object) } } },
    })
    expect(JSON.parse(fetchMock.mock.calls[3]?.[1]?.body as string)).toMatchObject({
      expectedRevision: 1,
      args: {
        patch: {
          printerDeviceCalibrations: { alpha: expect.any(Object), beta: expect.any(Object) },
        },
      },
    })
  })
})
