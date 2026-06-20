import { expect, test } from "@playwright/test"

test("browser-static root path defaults to runtime and supports explicit demo mode", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "单标签打印主链路" })).toBeVisible()
  await expect(page.getByText("Browser static", { exact: false }).first()).toBeVisible()
  await expect(page.getByText("Runtime mode", { exact: false }).first()).toBeVisible()
  await expect(page.getByRole("button", { name: "连接当前浏览器打印机" })).toBeVisible()

  await page.goto("/?demo=true")
  await expect(page.getByRole("heading", { name: "单标签打印主链路" })).toBeVisible()
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible()
  await expect(
    page.getByText("刷新、预览、打印都返回带合理耗时的成功仿真", { exact: false })
  ).toBeVisible()
})
