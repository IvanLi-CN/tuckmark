import { expect, test } from "@playwright/test"

test.describe("agent-assisted inventory intake", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(`/?__tuckmark_redirect__=${encodeURIComponent("/agent-import/demo?ui_demo=1")}`)
    await expect(page).toHaveURL(/\/agent-import\/demo\?ui_demo=1/u)
  })

  test("separates new and restock items while keeping attention non-blocking", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "新增物品" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "增加库存" })).toBeVisible()
    await expect(page.getByRole("table", { name: "新增物品" })).toBeVisible()
    await expect(page.getByRole("table", { name: "增加库存" })).toBeVisible()
    await expect(page.getByRole("table", { name: "新增物品" }).locator("tbody > tr")).toHaveCount(1)
    await expect(page.getByRole("table", { name: "增加库存" }).locator("tbody > tr")).toHaveCount(1)
    await expect(page.getByLabel("导入此物料").first()).toBeChecked()
    await expect(page.getByRole("button", { name: "保存当前编辑" })).toHaveCount(2)
    await expect(page.getByRole("button", { name: "编辑物料全名" })).toBeVisible()
    await expect(page.getByLabel("物料全名", { exact: true })).toHaveCount(0)
    await expect(
      page.getByRole("table", { name: "新增物品" }).getByRole("columnheader", { name: "数据手册" })
    ).toBeVisible()
    await expect(
      page
        .getByRole("table", { name: "增加库存" })
        .getByRole("columnheader", { name: "物料", exact: true })
    ).toBeVisible()
    await expect(page.getByText("型号后缀来自商品标题，建议在导入前核对封装。")).toBeVisible()
    await expect(page.getByText("未提供数据手册")).toBeVisible()
    await expect(
      page.getByText("仅向 Agent 指定的已有物料写入入库流水，保留原有标签绑定。")
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "确认导入选中项" })).toBeEnabled()
  })

  test("freezes only template input while the Agent fulfills the new contract", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "编辑标签模板" }).click()
    await page.getByRole("combobox", { name: "标签模板" }).selectOption("system:shipping-compact")

    await expect(page.getByText("等待 Agent 补全", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "确认导入选中项" })).toBeDisabled()
    await expect(page.getByLabel("目标物料 ID", { exact: true })).toHaveCount(0)
  })

  test("preserves current edits before requesting a replacement template contract", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "预览标签" }).click()
    await page.getByLabel("描述").first().fill("Mock draft edited before template replacement")
    await page.getByRole("button", { name: "编辑标签模板" }).click()
    await page.getByRole("combobox", { name: "标签模板" }).selectOption("system:shipping-compact")

    await expect(page.getByText("等待 Agent 补全", { exact: true })).toBeVisible()
    await expect(page.getByLabel("描述").first()).toHaveValue(
      "Mock draft edited before template replacement"
    )
  })

  test("persists the current edits before completing the import", async ({ page }) => {
    await page.getByRole("button", { name: "编辑入库数量" }).first().click()
    await page.getByLabel("入库数量", { exact: true }).first().fill("121")
    await page.getByLabel("入库数量", { exact: true }).first().press("Enter")
    await page.getByRole("button", { name: "确认导入选中项" }).click()

    await expect(page.getByText("已写入库存目录")).toBeVisible()
    await expect(page.getByRole("button", { name: "编辑入库数量" }).first()).toHaveText("121")
    await expect(page.getByRole("button", { name: "已完成导入" })).toBeDisabled()
  })

  test("edits only the clicked intake cell", async ({ page }) => {
    const materialName = page.getByRole("button", { name: "编辑物料全名" })

    await materialName.click()
    await expect(page.getByLabel("物料全名", { exact: true })).toBeFocused()
    await page.getByLabel("物料全名", { exact: true }).fill("暂存物料名")
    await page.getByLabel("物料全名", { exact: true }).press("Escape")
    await expect(materialName).toHaveText("TPS62933DRLR")

    await materialName.click()
    await page.getByLabel("物料全名", { exact: true }).fill("已编辑物料名")
    await page.getByLabel("物料全名", { exact: true }).press("Enter")
    await expect(materialName).toHaveText("已编辑物料名")
    await expect(page.getByLabel("物料全名", { exact: true })).toHaveCount(0)
  })
})
