import { describe, expect, it } from "vitest"

import { resolveAppContext, resolveBasePath, resolveSurface } from "./runtime.js"

describe("resolveBasePath", () => {
  it("prefers an explicit base path env", () => {
    expect(
      resolveBasePath({
        TUCKMARK_WEB_BASE_PATH: "/tuckmark/",
      })
    ).toBe("/tuckmark")
  })

  it("falls back to BASE_URL for non-root preview paths", () => {
    expect(
      resolveBasePath({
        BASE_URL: "/preview/",
      })
    ).toBe("/preview")
  })

  it("normalizes relative vite base to an empty app base path", () => {
    expect(
      resolveBasePath({
        BASE_URL: "./",
      })
    ).toBe("")
  })
})

describe("resolveAppContext", () => {
  it("defaults to runtime mode with browser-static surface when no demo param is present", () => {
    const context = resolveAppContext(
      { TUCKMARK_WEB_SURFACE: "browser-static" },
      {
        search: "",
      }
    )

    expect(context.mode).toBe("runtime")
    expect(context.surface).toBe("browser-static")
    expect(context.apiBasePath).toBe("")
  })

  it("lets demo=true switch static runtime into demo mode", () => {
    const context = resolveAppContext(
      { TUCKMARK_WEB_SURFACE: "browser-static" },
      {
        search: "?demo=true",
      }
    )

    expect(context.mode).toBe("demo")
    expect(context.capabilities.mockHardware).toBe(true)
    expect(context.capabilities.browserPrint).toBe("disabled")
  })

  it("uses server-http runtime when the injected surface targets /api", () => {
    const context = resolveAppContext(
      { TUCKMARK_WEB_SURFACE: "server-http" },
      {
        search: "",
      }
    )

    expect(context.mode).toBe("runtime")
    expect(context.surface).toBe("server-http")
    expect(context.apiBasePath).toBe("/api")
  })
})

describe("resolveSurface", () => {
  it("accepts explicit browser-static configuration", () => {
    expect(resolveSurface({ TUCKMARK_WEB_SURFACE: "browser-static" }, "server-http")).toBe(
      "browser-static"
    )
  })

  it("does not crash when the injected surface global is absent", () => {
    expect(resolveSurface({})).toBe("server-http")
  })

  it("falls back to the injected surface for invalid values", () => {
    expect(resolveSurface({ TUCKMARK_WEB_SURFACE: "invalid" }, "server-http")).toBe("server-http")
  })
})
