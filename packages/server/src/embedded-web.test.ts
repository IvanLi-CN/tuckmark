import { describe, expect, it } from "vitest"

import {
  EMBEDDED_WEB_CONTROL_PATHS,
  serveEmbeddedWebAsset,
  serveEmbeddedWebIndex,
} from "./embedded-web.js"

describe("embedded Web assets", () => {
  it("keeps PWA control paths distinct from SPA fallback paths", () => {
    expect(EMBEDDED_WEB_CONTROL_PATHS).toEqual(
      new Set(["/sw.js", "/manifest.webmanifest", "/version.json"])
    )
  })

  it("serves an embedded static asset and rejects traversal paths", async () => {
    const sent: Buffer[] = []
    const types: string[] = []
    const response = {
      type: (value: string) => {
        types.push(value)
      },
      send: (value: Buffer) => {
        sent.push(value)
      },
    }
    const assets = new Map<string, Blob>([["/sw.js", new Blob(["self.skipWaiting()"])]])

    await expect(serveEmbeddedWebAsset("/sw.js", response, assets)).resolves.toBe(true)
    await expect(serveEmbeddedWebAsset("/%2e%2e/private", response, assets)).resolves.toBe(false)

    expect(types).toEqual([".js"])
    expect(sent[0]?.toString("utf8")).toBe("self.skipWaiting()")
  })

  it("serves the SPA fallback as HTML", async () => {
    const sent: Buffer[] = []
    const types: string[] = []
    const response = {
      type: (value: string) => {
        types.push(value)
      },
      send: (value: Buffer) => {
        sent.push(value)
      },
    }
    const assets = new Map<string, Blob>([["/index.html", new Blob(["<main>Tuckmark</main>"])]])

    await expect(serveEmbeddedWebIndex(response, assets)).resolves.toBe(true)

    expect(types).toEqual(["html"])
    expect(sent[0]?.toString("utf8")).toBe("<main>Tuckmark</main>")
  })
})
