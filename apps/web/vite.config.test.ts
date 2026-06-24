import { describe, expect, it } from "vitest"

import { resolveApiOrigin, resolvePublicBase } from "./vite.config.js"

describe("resolveApiOrigin", () => {
  it("prefers explicit api origin", () => {
    expect(
      resolveApiOrigin({
        TUCKMARK_API_ORIGIN: "http://127.0.0.1:5171",
        TUCKMARK_SERVER_PORT: "5210",
      })
    ).toBe("http://127.0.0.1:5171")
  })

  it("falls back to the configured server port", () => {
    expect(
      resolveApiOrigin({
        TUCKMARK_SERVER_PORT: "5171",
      })
    ).toBe("http://127.0.0.1:5171")
  })

  it("uses the default server port when nothing is configured", () => {
    expect(resolveApiOrigin({})).toBe("http://127.0.0.1:5210")
  })
})

describe("resolvePublicBase", () => {
  it("keeps the dev server on an absolute root base even for browser-static surface", () => {
    expect(resolvePublicBase({ TUCKMARK_WEB_SURFACE: "browser-static" }, "serve")).toBe("/")
  })

  it("uses a relative base only for browser-static builds", () => {
    expect(resolvePublicBase({ TUCKMARK_WEB_SURFACE: "browser-static" }, "build")).toBe("./")
  })

  it("keeps server-http builds on the root base", () => {
    expect(resolvePublicBase({ TUCKMARK_WEB_SURFACE: "server-http" }, "build")).toBe("/")
  })
})
