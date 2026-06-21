import { describe, expect, it } from "vitest"

import { resolveAppContext, resolveBasePath } from "./runtime.js"

describe("resolveBasePath", () => {
  it("prefers an explicit base path env", () => {
    expect(
      resolveBasePath({
        TUCKMARK_WEB_BASE_PATH: "/tuckmark/",
      })
    ).toBe("/tuckmark")
  })
})

describe("resolveAppContext", () => {
  it("uses seeded demo mode on github pages by default", () => {
    const context = resolveAppContext(
      { BASE_URL: "/tuckmark/" },
      {
        origin: "https://ivanli-cn.github.io",
        pathname: "/tuckmark/",
        search: "",
      }
    )

    expect(context.mode).toBe("demo-seeded")
    expect(context.apiBasePath).toBe("/tuckmark/mock-api")
    expect(context.capabilities.browserDirectPrintPath).toBe("available")
    expect(context.capabilities.serviceApiPrintPath).toBe("mocked")
  })

  it("lets demo=false switch pages into mock shell mode", () => {
    const context = resolveAppContext(
      { BASE_URL: "/tuckmark/" },
      {
        origin: "https://ivanli-cn.github.io",
        pathname: "/tuckmark/",
        search: "?demo=false",
      }
    )

    expect(context.mode).toBe("mock-shell")
  })

  it("uses runtime mode off pages by default", () => {
    const context = resolveAppContext(
      {},
      {
        origin: "http://127.0.0.1:5173",
        pathname: "/",
        search: "",
      }
    )

    expect(context.mode).toBe("runtime")
    expect(context.apiBasePath).toBe("/api")
    expect(context.capabilities.browserDirectPrintPath).toBe("available")
    expect(context.capabilities.serviceApiPrintPath).toBe("available")
  })

  it("lets the two print paths be gated independently", () => {
    const context = resolveAppContext(
      {
        TUCKMARK_ENABLE_BROWSER_DIRECT_PRINT: "0",
        TUCKMARK_ENABLE_SERVER_SIDE_PRINT: "1",
      },
      {
        origin: "http://127.0.0.1:5173",
        pathname: "/",
        search: "",
      }
    )

    expect(context.capabilities.browserDirectPrintPath).toBe("disabled")
    expect(context.capabilities.serviceApiPrintPath).toBe("available")
  })
})
