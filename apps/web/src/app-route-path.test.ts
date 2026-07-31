import { describe, expect, it } from "vitest"

import { resolveAppRoutePathname } from "./app.js"

describe("resolveAppRoutePathname", () => {
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
})
