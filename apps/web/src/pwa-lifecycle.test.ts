import { describe, expect, it } from "vitest"

describe("pwa-lifecycle", () => {
  it("resolves the service worker module without requiring browser globals", async () => {
    const module = await import("./pwa-lifecycle.js")
    expect(module.pwaUpdateController).toBeDefined()
  })

  it("resolves relative-base service worker URLs from the bundled module", async () => {
    const module = await import("./pwa-lifecycle.js")
    const moduleHref = "https://example.test/repo/assets/index.js"

    expect(
      module.resolveServiceWorkerUrl("./", "https://example.test/repo/templates", moduleHref).href
    ).toBe("https://example.test/repo/sw.js")
    expect(
      module.resolveServiceWorkerScope("./", "https://example.test/repo/templates", moduleHref)
    ).toBe("/repo/")

    expect(
      module.resolveServiceWorkerUrl("./", "https://example.test/repo/templates/", moduleHref).href
    ).toBe("https://example.test/repo/sw.js")
    expect(
      module.resolveServiceWorkerScope("./", "https://example.test/repo/templates/", moduleHref)
    ).toBe("/repo/")
  })
})
