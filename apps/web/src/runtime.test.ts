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
  const availableWasm = { available: true, reason: null }

  it("defaults to runtime mode with browser-static surface when no demo param is present", () => {
    const context = resolveAppContext(
      { TUCKMARK_WEB_SURFACE: "browser-static" },
      {
        search: "",
      },
      { detongerWasmStatus: availableWasm }
    )

    expect(context.mode).toBe("runtime")
    expect(context.surface).toBe("browser-static")
    expect(context.apiBasePath).toBe("")
    expect(context.capabilities.browserDirectPrintPath).toBe("available")
    expect(context.capabilities.serviceApiPrintPath).toBe("disabled")
  })

  it("lets demo=true switch static runtime into demo mode", () => {
    const context = resolveAppContext(
      { TUCKMARK_WEB_SURFACE: "browser-static" },
      {
        search: "?demo=true",
      },
      { detongerWasmStatus: availableWasm }
    )

    expect(context.mode).toBe("demo")
    expect(context.capabilities.browserDirectPrintPath).toBe("mocked")
    expect(context.capabilities.serviceApiPrintPath).toBe("mocked")
  })

  it("keeps service-api disabled by default on server-http until explicitly enabled", () => {
    const context = resolveAppContext(
      { TUCKMARK_WEB_SURFACE: "server-http" },
      {
        search: "",
      },
      { detongerWasmStatus: availableWasm }
    )

    expect(context.mode).toBe("runtime")
    expect(context.surface).toBe("server-http")
    expect(context.apiBasePath).toBe("/api")
    expect(context.capabilities.browserDirectPrintPath).toBe("available")
    expect(context.capabilities.serviceApiPrintPath).toBe("disabled")
  })

  it("uses server-http service-api path when explicitly enabled", () => {
    const context = resolveAppContext(
      {
        TUCKMARK_WEB_SURFACE: "server-http",
        TUCKMARK_ENABLE_SERVER_SIDE_PRINT: "1",
      },
      {
        search: "",
      },
      { detongerWasmStatus: availableWasm }
    )

    expect(context.mode).toBe("runtime")
    expect(context.surface).toBe("server-http")
    expect(context.apiBasePath).toBe("/api")
    expect(context.capabilities.browserDirectPrintPath).toBe("available")
    expect(context.capabilities.serviceApiPrintPath).toBe("available")
  })

  it("lets the two print paths be gated independently", () => {
    const context = resolveAppContext(
      {
        TUCKMARK_ENABLE_BROWSER_DIRECT_PRINT: "0",
        TUCKMARK_ENABLE_SERVER_SIDE_PRINT: "1",
        TUCKMARK_WEB_SURFACE: "server-http",
      },
      {
        search: "",
      },
      { detongerWasmStatus: availableWasm }
    )

    expect(context.capabilities.browserDirectPrintPath).toBe("disabled")
    expect(context.capabilities.serviceApiPrintPath).toBe("available")
  })

  it("keeps service-api disabled on browser-static even when the env flag is on", () => {
    const context = resolveAppContext(
      {
        TUCKMARK_ENABLE_SERVER_SIDE_PRINT: "1",
        TUCKMARK_WEB_SURFACE: "browser-static",
      },
      {
        search: "",
      },
      { detongerWasmStatus: availableWasm }
    )

    expect(context.capabilities.browserDirectPrintPath).toBe("available")
    expect(context.capabilities.serviceApiPrintPath).toBe("disabled")
  })

  it("marks browser direct unavailable when startup downgraded detonger-wasm", () => {
    const context = resolveAppContext(
      { TUCKMARK_WEB_SURFACE: "browser-static" },
      {
        search: "",
      },
      {
        detongerWasmStatus: {
          available: false,
          reason: "missing detonger submodule",
        },
      }
    )

    expect(context.capabilities.browserDirectPrintPath).toBe("unavailable")
    expect(context.capabilities.serviceApiPrintPath).toBe("disabled")
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
