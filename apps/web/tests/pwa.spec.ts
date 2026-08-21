import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLAYWRIGHT_BUILD_METADATA = {
  appVersion: "",
  buildRef: "e499426",
} as const
const APP_RUNTIME_CHUNK_GLOB = "**/assets/app-runtime-*.js"
const TEMPLATES_ROUTE_CHUNK_GLOB = "**/assets/workbench-templates-route-*.js"
const TEMPLATES_ROUTE_CHUNK_NAME = "workbench-templates-route"
const CANVAS_ROUTE_CHUNK_NAME = "workbench-canvas-route"
const SYSTEM_ROUTE_CHUNK_NAME = "workbench-system-route"

test("browser-static build registers a service worker and works offline after first load", async ({
  context,
  page,
}) => {
  let delayedRuntimeChunk = false
  await page.route("**/assets/*.js", async (route) => {
    if (!delayedRuntimeChunk) {
      delayedRuntimeChunk = true
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    await route.continue()
  })

  await page.goto("/", { waitUntil: "commit" })
  await expect(page.locator('[data-launch-screen="booting"]')).toBeVisible()
  await expect(page.getByRole("heading", { name: "打印工作台" })).toBeVisible()

  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.ready
          return Boolean(registration.active)
        }),
      {
        timeout: 15_000,
      }
    )
    .toBe(true)

  await expect
    .poll(async () => page.locator(".tm-shell").getAttribute("data-offline-readiness-status"), {
      timeout: 15_000,
    })
    .toBe("complete")

  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const cacheNames = await caches.keys()
          const appCaches = cacheNames.filter((name) => name.startsWith("tuckmark-app-"))
          const readinessMarkers = await Promise.all(
            appCaches.map(async (name) => {
              const cache = await caches.open(name)
              return cache.match("./__tuckmark-cache-ready__")
            })
          )
          return readinessMarkers.some(Boolean)
        }),
      { timeout: 15_000 }
    )
    .toBe(true)

  await context.setOffline(true)
  for (const route of ["/", "/templates", "/canvas", "/system"]) {
    await page.goto(route)
    await expect(page.getByText("Tuckmark").first()).toBeVisible({
      timeout: 5000,
    })
    await expect(page.getByRole("link", { name: "主页" })).toBeVisible({
      timeout: 5000,
    })
  }
  await context.setOffline(false)
})

test("browser-static build does not prompt for an update when version metadata matches", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "打印工作台" })).toBeVisible()

  await page.waitForTimeout(1000)
  await expect(page.getByLabel("Tuckmark Web update status")).toHaveCount(0)
})

test("browser-static switches to deferred routes without reopening a loading screen", async ({
  page,
}) => {
  let templateChunkRequests = 0

  await page.route(TEMPLATES_ROUTE_CHUNK_GLOB, async (route) => {
    templateChunkRequests += 1
    await new Promise((resolve) => setTimeout(resolve, 250))
    await route.continue()
  })

  await page.goto("/")
  await expect(page.getByRole("heading", { name: "打印工作台" })).toBeVisible()

  await page.waitForTimeout(350)
  const requestCountBeforeClick = templateChunkRequests

  await page.getByRole("link", { name: "模板" }).click()
  await expect(page.locator(".tm-startup-overlay")).toHaveCount(0)
  await expect(page.locator(".tm-route-loading")).toHaveCount(0)
  await expect(page.getByText("模板列表")).toBeVisible()
  expect(templateChunkRequests).toBeLessThanOrEqual(requestCountBeforeClick + 1)
})

test("browser-static keeps the current page visible while the target route chunk is still loading", async ({
  page,
}) => {
  let releaseTemplateChunk: (() => void) | null = null
  const templateChunkGate = new Promise<void>((resolve) => {
    releaseTemplateChunk = resolve
  })

  await page.route(TEMPLATES_ROUTE_CHUNK_GLOB, async (route) => {
    await templateChunkGate
    await route.continue()
  })

  await page.goto("/")
  await expect(page.getByRole("heading", { name: "打印工作台" })).toBeVisible()

  const immediateNavigationState = await page.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>('a[href="/templates"]')
    if (!link) {
      return null
    }
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    return {
      pathname: window.location.pathname,
      routeLoadingCount: document.querySelectorAll(".tm-route-loading").length,
      visibleText: document.body.textContent ?? "",
    }
  })

  expect(immediateNavigationState).not.toBeNull()
  expect(immediateNavigationState?.pathname).toBe("/templates")
  expect(immediateNavigationState?.routeLoadingCount).toBe(0)
  expect(immediateNavigationState?.visibleText).toContain("打印工作台")

  releaseTemplateChunk?.()
  await expect(page.getByText("模板列表")).toBeVisible()
})

test("browser-static build ships complete PWA assets without remote font dependency", async () => {
  const distRoot = path.resolve(__dirname, "../dist")
  const indexHtml = await fs.readFile(path.join(distRoot, "index.html"), "utf8")
  const assetFiles = await fs.readdir(path.join(distRoot, "assets"))
  const versionMetadata = JSON.parse(
    await fs.readFile(path.join(distRoot, "version.json"), "utf8")
  ) as {
    appVersion: string
    buildRef: string
  }
  const manifest = JSON.parse(
    await fs.readFile(path.join(distRoot, "manifest.webmanifest"), "utf8")
  ) as {
    start_url: string
    scope: string
    icons: Array<{ src: string; purpose?: string }>
  }
  const serviceWorker = await fs.readFile(path.join(distRoot, "sw.js"), "utf8")

  expect(indexHtml).toContain('rel="manifest"')
  expect(indexHtml).toContain('data-tuckmark-pwa="true"')
  expect(indexHtml).toContain('data-launch-screen="booting"')
  expect(indexHtml).toContain("data-launch-recovery-actions")
  expect(indexHtml).toContain("const SLOW_START_NOTICE_MS = 10_000")
  expect(indexHtml).toContain("const BOOT_TIMEOUT_MS = 60_000")
  expect(indexHtml).toContain("data-launch-update-restart")
  expect(indexHtml).toContain("showSlowStart")
  expect(indexHtml).toContain("restartWithLatestVersion")
  expect(indexHtml).toContain('return "工作台启动\\n时间较长"')
  expect(indexHtml).not.toContain("clearAppCaches")
  expect(indexHtml).not.toContain("unregisterTuckmarkWorkers")
  expect(indexHtml).toContain("markMounted")
  expect(indexHtml).toContain("fail")
  expect(indexHtml).toContain("Tuckmark 正在准备工作台")
  expect(indexHtml).toContain("当前页面就绪后会立即进入，离线版本会在后台准备。")
  expect(indexHtml).not.toContain("进入后继续补齐")
  expect(indexHtml).not.toContain("完整资产会在后台静默完成。")
  expect(indexHtml).not.toContain("启动运行时引导")
  expect(indexHtml).not.toContain("装载当前页面模块")
  expect(indexHtml).not.toContain("准备当前页面状态")
  expect(indexHtml).not.toContain("补齐离线资源缓存")
  expect(indexHtml).toContain("@media (prefers-color-scheme: dark)")
  expect(indexHtml).toContain("--tm-launch-background: #14110f;")
  expect(indexHtml).not.toContain("fonts.googleapis.com")
  expect(indexHtml).not.toContain("fonts.gstatic.com")
  expect(assetFiles.some((file) => file.includes(TEMPLATES_ROUTE_CHUNK_NAME))).toBe(true)
  expect(assetFiles.some((file) => file.includes(CANVAS_ROUTE_CHUNK_NAME))).toBe(true)
  expect(assetFiles.some((file) => file.includes(SYSTEM_ROUTE_CHUNK_NAME))).toBe(true)
  expect(assetFiles.some((file) => file.includes("feature-runtime") && file.endsWith(".css"))).toBe(
    true
  )
  expect(versionMetadata).toEqual(PLAYWRIGHT_BUILD_METADATA)
  expect(manifest.start_url).toBe("./")
  expect(manifest.scope).toBe("./")
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ src: "./pwa/tuckmark-icon-192.png", purpose: "any" }),
      expect.objectContaining({ src: "./pwa/tuckmark-icon-512.png", purpose: "any" }),
      expect.objectContaining({ src: "./pwa/tuckmark-icon-maskable-192.png", purpose: "maskable" }),
      expect.objectContaining({ src: "./pwa/tuckmark-icon-maskable-512.png", purpose: "maskable" }),
    ])
  )
  await Promise.all(
    [
      "favicon.ico",
      "tuckmark-apple-touch-icon-120.png",
      "tuckmark-apple-touch-icon-152.png",
      "tuckmark-apple-touch-icon-167.png",
      "tuckmark-apple-touch-icon-180.png",
      "tuckmark-favicon-16.png",
      "tuckmark-favicon-32.png",
      "tuckmark-favicon-48.png",
      "tuckmark-favicon.svg",
      "tuckmark-icon-192.png",
      "tuckmark-icon-512.png",
      "tuckmark-icon-maskable-192.png",
      "tuckmark-icon-maskable-512.png",
    ].map((fileName) => fs.access(path.join(distRoot, "pwa", fileName)))
  )
  expect(serviceWorker).toContain('"./index.html"')
  expect(serviceWorker).toContain('"./404.html"')
  expect(serviceWorker).toContain('"./pwa/tuckmark-icon-192.png"')
  expect(serviceWorker).toContain('"./pwa/tuckmark-icon-512.png"')
  expect(serviceWorker).toContain('const CACHE_READY_MARKER = "./__tuckmark-cache-ready__"')
  expect(serviceWorker).toContain("cacheCompleteApp")
  expect(serviceWorker).toContain("cache.addAll(PRECACHE_ASSETS.map((asset) => asset.url))")
  expect(serviceWorker).toContain("cache.match(CACHE_READY_MARKER)")
  expect(serviceWorker).not.toContain("WARM_ASSETS")
  expect(serviceWorker).not.toContain("INSTALL_TIERS")
  expect(serviceWorker).toContain('"./pwa/tuckmark-icon-maskable-192.png"')
  expect(serviceWorker).toContain('"./pwa/tuckmark-icon-maskable-512.png"')
  expect(serviceWorker).toContain('"./pwa/tuckmark-apple-touch-icon-180.png"')
  expect(serviceWorker).toContain('"./pwa/tuckmark-apple-touch-icon-120.png"')
  expect(serviceWorker).toContain('"./pwa/tuckmark-apple-touch-icon-152.png"')
  expect(serviceWorker).toContain('"./pwa/tuckmark-apple-touch-icon-167.png"')
  expect(serviceWorker).toContain("SKIP_WAITING")
  expect(serviceWorker).toContain('const VERSION_METADATA_URL = "./version.json"')
  expect(serviceWorker).toContain(
    "const versionMetadataPath = new URL(VERSION_METADATA_URL, self.location.href).pathname"
  )
  expect(serviceWorker).toContain('requestUrl.pathname.startsWith("/api/")')
  expect(serviceWorker).toContain('requestUrl.pathname === "/health"')
  expect(serviceWorker).toContain('request.headers.get("accept")?.includes("text/event-stream")')
  expect(serviceWorker).not.toContain('"url": "./version.json"')
})

test.describe("browser-static launch recovery", () => {
  test.use({ serviceWorkers: "block" })

  test("shows a slow-start update hint at ten seconds before the one-minute terminal state", async ({
    page,
  }) => {
    let runtimeRequests = 0

    await page.addInitScript(() => {
      const originalSetTimeout = window.setTimeout.bind(window)
      window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        if (timeout === 10_000) {
          return originalSetTimeout(handler, 100, ...args)
        }
        if (timeout === 60_000) {
          return originalSetTimeout(handler, 1_000, ...args)
        }
        return originalSetTimeout(handler, timeout, ...args)
      }) as typeof window.setTimeout
    })
    await page.route(APP_RUNTIME_CHUNK_GLOB, async (route) => {
      runtimeRequests += 1
      await route.fulfill({
        contentType: "text/javascript",
        body: "await new Promise(() => {})",
      })
    })

    await page.goto("/", { waitUntil: "commit" })

    await expect(page.getByRole("status", { name: "Tuckmark 工作台启动时间较长" })).toBeVisible()
    await expect(page.getByRole("button", { name: "检查更新并重启" })).toBeVisible()
    await expect(page.getByRole("alert", { name: "Tuckmark 无法启动工作台" })).toBeVisible({
      timeout: 5_000,
    })
    await expect(page.getByRole("button", { name: "重新加载" })).toBeVisible()
    await expect(page.getByRole("button", { name: "检查更新并重启" })).toBeVisible()
    expect(runtimeRequests).toBe(1)
  })

  test("does not reload or clear complete caches when the one-minute terminal state is shown", async ({
    page,
  }) => {
    let runtimeRequests = 0

    await page.addInitScript(async () => {
      const originalSetTimeout = window.setTimeout.bind(window)
      window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        if (timeout === 10_000 || timeout === 60_000) {
          return originalSetTimeout(handler, 50, ...args)
        }
        return originalSetTimeout(handler, timeout, ...args)
      }) as typeof window.setTimeout
      if (window.sessionStorage.getItem("tuckmark.pwa-recovery-ready-cache-seeded") === "true") {
        return
      }
      window.sessionStorage.setItem("tuckmark.pwa-recovery-ready-cache-seeded", "true")
      const completeCache = await caches.open("tuckmark-app-last-known-good")
      await completeCache.put(
        "./__tuckmark-cache-ready__",
        new Response(JSON.stringify({ version: "last-known-good" }))
      )
    })
    await page.route(APP_RUNTIME_CHUNK_GLOB, async (route) => {
      runtimeRequests += 1
      await route.fulfill({
        contentType: "text/javascript",
        body: "await new Promise(() => {})",
      })
    })

    await page.goto("/", { waitUntil: "commit" })

    await expect(page.getByRole("alert", { name: "Tuckmark 无法启动工作台" })).toBeVisible({
      timeout: 5_000,
    })
    expect(runtimeRequests).toBeLessThanOrEqual(1)

    const completeCacheReady = await page.evaluate(async () => {
      const cache = await caches.open("tuckmark-app-last-known-good")
      return Boolean(await cache.match("./__tuckmark-cache-ready__"))
    })
    expect(completeCacheReady).toBe(true)
  })

  test("activates a waiting worker only after the user requests an updated restart", async ({
    page,
  }) => {
    let runtimeRequests = 0

    await page.addInitScript(() => {
      const originalSetTimeout = window.setTimeout.bind(window)
      window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        if (timeout === 10_000 || timeout === 60_000) {
          return originalSetTimeout(handler, 50, ...args)
        }
        return originalSetTimeout(handler, timeout, ...args)
      }) as typeof window.setTimeout
      const controllerChangeListeners: Array<() => void> = []
      const waitingWorker = {
        postMessage: () => {
          window.sessionStorage.setItem("tuckmark.pwa-waiting-worker-activated", "true")
          for (const listener of controllerChangeListeners) {
            listener()
          }
        },
      }
      const registration = {
        waiting: waitingWorker,
        update: async () => undefined,
        unregister: async () => true,
      }
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: {
          addEventListener: (type: string, listener: () => void) => {
            if (type === "controllerchange") {
              controllerChangeListeners.push(listener)
            }
          },
          getRegistrations: async () => [registration],
          register: async () => registration,
        },
      })
    })
    await page.route(APP_RUNTIME_CHUNK_GLOB, async (route) => {
      runtimeRequests += 1
      await route.fulfill({
        contentType: "text/javascript",
        body: "await new Promise(() => {})",
      })
    })

    await page.goto("/", { waitUntil: "commit" })

    await expect(page.getByRole("alert", { name: "Tuckmark 无法启动工作台" })).toBeVisible({
      timeout: 5_000,
    })
    await expect.poll(() => runtimeRequests, { timeout: 5_000 }).toBe(1)
    await expect
      .poll(() =>
        page.evaluate(() => window.sessionStorage.getItem("tuckmark.pwa-waiting-worker-activated"))
      )
      .toBeNull()

    await page.getByRole("button", { name: "使用最新版本重启" }).click()
    await expect
      .poll(() =>
        page.evaluate(() => window.sessionStorage.getItem("tuckmark.pwa-waiting-worker-activated"))
      )
      .toBe("true")
  })
})
