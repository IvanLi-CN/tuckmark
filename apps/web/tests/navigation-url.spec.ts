import { expect, test } from "@playwright/test"

const TEMPLATES_ROUTE_CHUNK_GLOB = "**/assets/workbench-templates-route-*.js"

test("navigation updates the URL before the delayed route chunk reveals the new page", async ({
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

test("browser back after templates navigation restores the home page content", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "打印工作台" })).toBeVisible()

  await page.locator('a[href="/templates"]').click()
  await page.waitForURL("**/templates")
  await expect(page.getByText("模板列表")).toBeVisible()

  await page.goBack()
  await page.waitForURL("**/")
  await expect(page.getByRole("heading", { name: "打印工作台" })).toBeVisible()
  await expect(page.locator(".tm-nav-progress--active")).toHaveCount(0)
})
