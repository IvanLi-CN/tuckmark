import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLAYWRIGHT_BUILD_METADATA = {
  appVersion: "",
  buildRef: "e499426",
} as const

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
    .poll(async () => page.locator(".tm-shell").getAttribute("data-offline-warmup-status"), {
      timeout: 15_000,
    })
    .toBe("complete")

  await context.setOffline(true)
  for (const route of ["/", "/templates", "/canvas", "/system"]) {
    await page.goto(route)
    await expect(page.getByText("Tuckmark").first()).toBeVisible({
      timeout: 1000,
    })
    await expect(page.getByRole("link", { name: "主页" })).toBeVisible({
      timeout: 1000,
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

test("browser-static warms deferred route chunks so page switches do not reopen a loading screen", async ({
  page,
}) => {
  let templateChunkRequests = 0

  await page.route("**/assets/route-templates-*.js", async (route) => {
    templateChunkRequests += 1
    await new Promise((resolve) => setTimeout(resolve, 250))
    await route.continue()
  })

  await page.goto("/")
  await expect(page.getByRole("heading", { name: "打印工作台" })).toBeVisible()

  await expect
    .poll(() => templateChunkRequests, {
      timeout: 5_000,
    })
    .toBeGreaterThan(0)

  await page.waitForTimeout(350)
  const requestCountBeforeClick = templateChunkRequests

  await page.getByRole("link", { name: "模板" }).click()
  await expect(page.locator(".tm-startup-overlay")).toHaveCount(0)
  await expect(page.locator(".tm-route-loading")).toHaveCount(0)
  await expect(page.getByText("模板列表")).toBeVisible()
  expect(templateChunkRequests).toBe(requestCountBeforeClick)
})

test("browser-static keeps the current page visible while the target route chunk is still loading", async ({
  page,
}) => {
  let templateChunkRequests = 0
  let releaseTemplateChunk: (() => void) | null = null
  const templateChunkGate = new Promise<void>((resolve) => {
    releaseTemplateChunk = resolve
  })

  await page.route("**/assets/route-templates-*.js", async (route) => {
    templateChunkRequests += 1
    await templateChunkGate
    await route.continue()
  })

  await page.goto("/")
  await expect(page.getByRole("heading", { name: "打印工作台" })).toBeVisible()

  await expect
    .poll(() => templateChunkRequests, {
      timeout: 5_000,
    })
    .toBeGreaterThan(0)

  await page.getByRole("link", { name: "模板" }).click()
  await expect(page.getByRole("heading", { name: "打印工作台" })).toBeVisible()
  await expect(page.locator(".tm-startup-overlay")).toHaveCount(0)
  await expect(page.locator(".tm-route-loading")).toHaveCount(0)

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
  expect(indexHtml).toContain('data-launch-screen="booting"')
  expect(indexHtml).toContain("Tuckmark 正在准备工作台")
  expect(indexHtml).toContain("当前页面就绪后会立即进入，其他资产会在后台静默补齐。")
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
  expect(assetFiles.some((file) => file.includes("route-templates"))).toBe(true)
  expect(assetFiles.some((file) => file.includes("route-canvas"))).toBe(true)
  expect(assetFiles.some((file) => file.includes("route-system"))).toBe(true)
  expect(assetFiles.some((file) => file.includes("feature-runtime") && file.endsWith(".css"))).toBe(
    true
  )
  expect(versionMetadata).toEqual(PLAYWRIGHT_BUILD_METADATA)
  expect(manifest.start_url).toBe("./")
  expect(manifest.scope).toBe("./")
  expect(manifest.icons.some((icon) => icon.src === "./pwa/tuckmark-icon-192.png")).toBe(true)
  expect(manifest.icons.every((icon) => icon.purpose?.includes("maskable"))).toBe(true)
  expect(serviceWorker).toContain('"./index.html"')
  expect(serviceWorker).toContain('"./404.html"')
  expect(serviceWorker).toContain('"./pwa/tuckmark-icon-192.png"')
  expect(serviceWorker).toContain('"./pwa/tuckmark-icon-512.png"')
  expect(serviceWorker).toContain('const INSTALL_TIERS = ["shell", "route"]')
  expect(serviceWorker).toContain('event.data?.type === "WARM_ASSETS"')
  expect(serviceWorker).toContain('["feature"]')
  expect(serviceWorker).toContain("SKIP_WAITING")
  expect(serviceWorker).toContain('const VERSION_METADATA_URL = "./version.json"')
  expect(serviceWorker).toContain("requestUrl.pathname.endsWith(VERSION_METADATA_URL.slice(1))")
  expect(serviceWorker).not.toContain('"url": "./version.json"')
})
