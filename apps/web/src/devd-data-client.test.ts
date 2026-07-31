import { afterEach, describe, expect, it, vi } from "vitest"

import {
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
})
