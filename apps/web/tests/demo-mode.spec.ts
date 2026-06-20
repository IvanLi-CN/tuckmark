import { expect, test } from "@playwright/test"

test("pages demo and mock shell share the same formal app surface", async ({ page }) => {
  await page.goto("/tuckmark/?demo=true")
  await expect(page.getByRole("heading", { name: "单标签打印主链路" })).toBeVisible()
  await expect(page.locator(".hero-card strong")).toHaveText("Pages demo")

  await page.goto("/tuckmark/?demo=false")
  await expect(page.getByRole("heading", { name: "单标签打印主链路" })).toBeVisible()
  await expect(page.locator(".hero-card strong")).toHaveText("Mock shell")
  await expect(page.getByText("Mock API layer over the formal app surface")).toBeVisible()
})
