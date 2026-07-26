import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 1600, height: 1200 } })

test("inventory detail creates a material, binds a template, and renders a print preview", async ({
  page,
}) => {
  const suffix = Date.now().toString().slice(-6)
  const fullName = `E2E-TPS62933DRLR-${suffix}`
  const matrixCode = `E2E-MATRIX-${suffix}`

  await page.goto("/inventory?demo=true")
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible()
  await expect(page.getByText("物料列表", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "新建物料" }).click()
  await expect(page.getByText("库存详情")).toBeVisible()

  await page.getByLabel("完整型号").fill(fullName)
  await page.getByLabel("主名称").fill("TPS62933")
  await page.getByLabel("次名称").fill("DRLR")
  await page.getByLabel("封装").fill("SOT-583")
  await page.getByLabel("矩阵码").fill(matrixCode)
  await page.getByLabel("包装备注").fill("编带一盘 3000pcs")
  await page.getByLabel("简要描述").fill("同步降压 28V")

  await page.getByRole("button", { name: "创建物料" }).click()
  await expect(page.getByText(fullName)).toBeVisible()

  const bindingPanel = page
    .locator(".tm-panel")
    .filter({ has: page.getByRole("heading", { name: "标签模板关联" }) })
  const bindingComboboxes = bindingPanel.locator("button[role='combobox']")
  await expect(bindingComboboxes).toHaveCount(2)
  await bindingComboboxes.nth(1).scrollIntoViewIfNeeded()
  await bindingComboboxes.nth(1).click()
  await page.getByRole("option", { name: "Cable Tag" }).click()
  await page.getByRole("button", { name: "添加关联" }).click()
  await expect(bindingPanel.getByText("Cable Tag")).toBeVisible()

  const previewPanel = page
    .locator(".tm-panel")
    .filter({ has: page.getByRole("heading", { name: "打印预览" }) })
  await expect(previewPanel.getByText("先打印当前标签后查看预览。")).toBeVisible()

  const printPanel = page
    .locator(".tm-panel")
    .filter({ has: page.getByRole("heading", { name: "手动打印标签" }) })
  await printPanel.getByRole("button", { name: "打印当前标签" }).click()

  await expect(previewPanel.getByAltText("preview artifact")).toBeVisible()
  await expect(previewPanel.getByText("有效打印宽度")).toBeVisible()
  await expect(page.getByText("操作失败")).toHaveCount(0)
})
