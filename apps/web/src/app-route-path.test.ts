// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentImportPage } from "./agent-import-page.js"
import { App, resolveAppRoutePathname } from "./app.js"

describe("resolveAppRoutePathname", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    window.history.replaceState({}, "", "/")
  })

  it("strips the configured web base path before matching an Agent Import route", () => {
    expect(resolveAppRoutePathname("/tuckmark/agent-import/mock-session", "/tuckmark")).toBe(
      "/agent-import/mock-session"
    )
  })

  it("leaves a root-mounted route unchanged", () => {
    expect(resolveAppRoutePathname("/agent-import/mock-session", "")).toBe(
      "/agent-import/mock-session"
    )
  })

  it("uses the configured base path when App mounts without an explicit context", () => {
    vi.stubEnv("TUCKMARK_WEB_BASE_PATH", "/tuckmark")
    window.history.replaceState({}, "", "/tuckmark/agent-import/mock-session")

    const app = App()

    expect(app.type).toBe(AgentImportPage)
  })
})
