import { expect, test } from "@playwright/test"

test("pages demo and mock shell share the same formal app surface", async ({ page }) => {
  await page.goto("/tuckmark/?demo=true")
  await expect(page.getByRole("heading", { name: "单标签打印主链路" })).toBeVisible()
  await expect(page.getByText("Pages demo", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Server Contract", { exact: true })).toBeVisible()
  await expect(page.getByText("mocked / available", { exact: true }).first()).toBeVisible()

  await page.goto("/tuckmark/?demo=false")
  await expect(page.getByRole("heading", { name: "单标签打印主链路" })).toBeVisible()
  await expect(page.getByText("Mock shell", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Mock API layer over the formal app surface")).toBeVisible()
})
