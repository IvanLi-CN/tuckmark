import { describe, expect, it } from "vitest"

import {
  isDeferredWorkbenchRouteModuleReady,
  normalizeWorkbenchRoutePath,
  preloadWorkbenchRoute,
} from "./workbench-route-registry.js"

describe("normalizeWorkbenchRoutePath", () => {
  it("keeps formal route matches when query and hash are present", () => {
    expect(normalizeWorkbenchRoutePath("/canvas?source=user-template&templateId=demo")).toBe(
      "/canvas"
    )
    expect(normalizeWorkbenchRoutePath("/templates#recent")).toBe("/templates")
    expect(normalizeWorkbenchRoutePath("/system/?panel=data#sync")).toBe("/system")
  })
})

describe("preloadWorkbenchRoute", () => {
  it("makes a deferred route module synchronously available after preload completes", async () => {
    expect(isDeferredWorkbenchRouteModuleReady("/templates")).toBe(false)

    await preloadWorkbenchRoute("/templates")

    expect(isDeferredWorkbenchRouteModuleReady("/templates")).toBe(true)
  })
})
