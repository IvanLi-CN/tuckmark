import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test("browser-static build registers a service worker and works offline after first load", async ({
  context,
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "打印工作台" })).toBeVisible()

  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready
        return Boolean(registration.active)
      })
    )
    .toBe(true)

  await context.setOffline(true)
  for (const route of ["/", "/templates", "/canvas", "/system"]) {
    await page.goto(route)
    await expect(page.getByText("Tuckmark").first()).toBeVisible({ timeout: 1000 })
    await expect(page.getByRole("link", { name: "主页" })).toBeVisible({ timeout: 1000 })
  }
  await context.setOffline(false)
})

test("browser-static build ships complete PWA assets without remote font dependency", async () => {
  const distRoot = path.resolve(__dirname, "../dist")
  const indexHtml = await fs.readFile(path.join(distRoot, "index.html"), "utf8")
  const manifest = JSON.parse(
    await fs.readFile(path.join(distRoot, "manifest.webmanifest"), "utf8")
  ) as {
    start_url: string
    scope: string
    icons: Array<{ src: string; purpose?: string }>
  }
  const serviceWorker = await fs.readFile(path.join(distRoot, "sw.js"), "utf8")

  expect(indexHtml).toContain('rel="manifest"')
  expect(indexHtml).not.toContain("fonts.googleapis.com")
  expect(indexHtml).not.toContain("fonts.gstatic.com")
  expect(manifest.start_url).toBe("./")
  expect(manifest.scope).toBe("./")
  expect(manifest.icons.some((icon) => icon.src === "./pwa/tuckmark-icon-192.png")).toBe(true)
  expect(manifest.icons.every((icon) => icon.purpose?.includes("maskable"))).toBe(true)
  expect(serviceWorker).toContain('"./index.html"')
  expect(serviceWorker).toContain('"./404.html"')
  expect(serviceWorker).toContain('"./pwa/tuckmark-icon-192.png"')
  expect(serviceWorker).toContain('"./pwa/tuckmark-icon-512.png"')
  expect(serviceWorker).toContain("SKIP_WAITING")
})
