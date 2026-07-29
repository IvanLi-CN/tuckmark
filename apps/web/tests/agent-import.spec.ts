import { expect, test } from "@playwright/test"

test.describe("agent-assisted inventory intake", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto("/agent-import/demo?ui_demo=1")
  })

  test("separates new and restock items while keeping attention non-blocking", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "新增物品" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "增加库存" })).toBeVisible()
    await expect(page.getByRole("table", { name: "新增物品" })).toBeVisible()
    await expect(page.getByRole("table", { name: "增加库存" })).toBeVisible()
    await expect(
      page.getByRole("table", { name: "新增物品" }).getByRole("columnheader", { name: "数据手册" })
    ).toBeVisible()
    await expect(
      page.getByRole("table", { name: "增加库存" }).getByRole("columnheader", { name: "目标物料" })
    ).toBeVisible()
    await expect(page.getByText("型号后缀来自商品标题，建议在导入前核对封装。")).toBeVisible()
    await expect(page.getByText("未提供数据手册")).toBeVisible()
    await expect(
      page.getByText("补库存沿用目标物料的资料与标签绑定；可调整入库数量、来源备注和是否导入。")
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "确认导入选中项" })).toBeEnabled()
  })

  test("freezes only template input while the Agent fulfills the new contract", async ({
    page,
  }) => {
    await page.getByRole("combobox", { name: "标签模板" }).selectOption("system:shipping-compact")

    await expect(page.getByText("等待 Agent 根据字段合同补全")).toBeVisible()
    await expect(page.getByRole("button", { name: "确认导入选中项" })).toBeDisabled()
    await expect(page.getByLabel("目标物料 ID")).toBeDisabled()
  })

  test("preserves current edits before requesting a replacement template contract", async ({
    page,
  }) => {
    await page.getByLabel("描述").first().fill("Mock draft edited before template replacement")
    await page.getByRole("combobox", { name: "标签模板" }).selectOption("system:shipping-compact")

    await expect(page.getByText("等待 Agent 根据字段合同补全")).toBeVisible()
    await expect(page.getByLabel("描述").first()).toHaveValue(
      "Mock draft edited before template replacement"
    )
  })

  test("persists the current edits before completing the import", async ({ page }) => {
    await page.getByLabel("入库数量").first().fill("121")
    await page.getByRole("button", { name: "确认导入选中项" }).click()

    await expect(page.getByText("已写入库存目录")).toBeVisible()
    await expect(page.getByLabel("入库数量").first()).toHaveValue("121")
    await expect(page.getByRole("button", { name: "已完成导入" })).toBeDisabled()
  })
})
