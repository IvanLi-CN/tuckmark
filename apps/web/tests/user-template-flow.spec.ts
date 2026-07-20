import { expect, test } from "@playwright/test"

test("preset templates can be saved into browser-local user templates and reused from templates workspace", async ({
  page,
}) => {
  await page.goto("/canvas?source=preset-template&templateId=cable-tag")

  await expect(page.getByText("系统模板：Cable Tag")).toBeVisible()
  await page.getByRole("button", { name: "保存" }).click()
  await expect(page.getByRole("dialog", { name: "保存为用户模板" })).toBeVisible()
  await page.getByLabel("模板名称").fill("E2E Cable Tag")
  await page
    .getByRole("dialog", { name: "保存为用户模板" })
    .getByRole("button", { name: "保存" })
    .click()

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
  await expect(firstRow.getByRole("button", { name: "LAN-01" })).toBeVisible()

  await expect(page.getByRole("button", { name: "生成预览" })).toBeEnabled()

  await userCard.getByRole("button", { name: "E2E Cable Tag 更多操作" }).click()
  await page.getByRole("menuitem", { name: "编辑" }).click()
  await expect(page).toHaveURL(/\/canvas\?source=user-template&templateId=/)
  await expect(page.getByText("用户模板：E2E Cable Tag")).toBeVisible()
})

test("preset-template working copies survive reload before first save", async ({ page }) => {
  await page.goto("/canvas?source=preset-template&templateId=cable-tag")

  await expect(page.getByText("系统模板：Cable Tag")).toBeVisible()
  const layerItems = page.locator(".tm-layer-list--inspector .tm-choice--layer")
  await expect(layerItems).toHaveCount(5)
  await page.locator(".tm-quick-tools").getByRole("button", { name: "文本", exact: true }).click()
  await expect(layerItems).toHaveCount(6)

  await page.reload()

  await expect(page.getByText("系统模板：Cable Tag")).toBeVisible()
  await expect(layerItems).toHaveCount(6)
})

test("first successful user-template save surfaces the data-directory setup nudge", async ({
  page,
}) => {
  await page.goto("/canvas?source=preset-template&templateId=cable-tag")

  await expect(page.getByText("系统模板：Cable Tag")).toBeVisible()
  await page.getByRole("button", { name: "保存" }).click()
  await expect(page.getByRole("dialog", { name: "保存为用户模板" })).toBeVisible()
  await page.getByLabel("模板名称").fill("Nudge Ready Template")
  await page
    .getByRole("dialog", { name: "保存为用户模板" })
    .getByRole("button", { name: "保存" })
    .click()

  await expect(page.getByText("建议授权数据目录")).toBeVisible()
  await page.goto("/system")

  await expect(page).toHaveURL(/\/system$/)
  await expect(page.getByRole("heading", { name: "本地数据目录与备份" })).toBeVisible()
  await expect(page.getByText("未配置").first()).toBeVisible()
})
