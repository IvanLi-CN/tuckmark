import { expect, test } from "@playwright/test"

test("preset templates can be saved into browser-local user templates and reused from templates workspace", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.prompt = () => "E2E Cable Tag"
  })

  await page.goto("/canvas?source=preset-template&templateId=cable-tag")

  await expect(page.getByText("系统模板：Cable Tag")).toBeVisible()
  await page.getByRole("button", { name: "保存" }).click()

  await expect(page.getByText("已保存为用户模板。")).toBeVisible()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.getByRole("heading", { name: "版本历史" })).toBeVisible()
  await expect(page.locator(".tm-version-list__item").first()).toBeVisible()

  await page.goto("/templates")

  await expect(page.getByText("系统模板")).toBeVisible()
  await expect(page.getByText("我的模板")).toBeVisible()

  const userCard = page.locator(".tm-template-card").filter({ hasText: "E2E Cable Tag" })
  await expect(userCard).toBeVisible()

  await userCard.getByRole("button").first().click()
  await expect(page.getByRole("table")).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "Name" })).toBeVisible()

  const firstRow = page.getByRole("table").locator("tbody tr").first()
  await firstRow.getByRole("button", { name: "—" }).first().click()
  const activeInput = firstRow.locator("input").first()
  await expect(activeInput).toBeVisible()
  await activeInput.fill("LAN-01")
  await activeInput.press("Enter")

  await page.getByRole("button", { name: "生成预览" }).click()
  await expect(page.locator("img[alt='preview artifact']")).toBeVisible()

  await userCard.getByRole("button", { name: "编辑模板" }).click()
  await expect(page).toHaveURL(/\/canvas\?source=user-template&templateId=/)
  await expect(page.getByText("用户模板：E2E Cable Tag")).toBeVisible()
})
