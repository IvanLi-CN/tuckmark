import { afterEach, describe, expect, it, vi } from "vitest"

import {
  DevdDataClient,
  DevdDataConflictError,
  devdDataClient,
  isServerHttpDataSurface,
} from "./devd-data-client.js"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

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

  it("does not regress the cached revision when an older concurrent read finishes last", async () => {
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
    await olderSnapshot
    await client.runtimeCommand("save-settings", { patch: {} })

    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toMatchObject({
      expectedRevision: 9,
    })
  })
})
