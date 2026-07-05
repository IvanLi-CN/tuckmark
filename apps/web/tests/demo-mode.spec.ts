import { expect, test } from "@playwright/test"

test("browser-static root path defaults to runtime and supports explicit demo mode", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "打印工作台" })).toBeVisible()
  await expect(page.getByText("Browser static", { exact: false }).first()).toBeVisible()
  await expect(page.getByText("Runtime mode", { exact: false }).first()).toBeVisible()
  await expect(page.getByRole("link", { name: "GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/IvanLi-CN/tuckmark"
  )
  await expect(page.getByText("v0.1.0")).toBeVisible()
  await expect(page.getByRole("link", { name: "© 2026 Ivan Li" })).toHaveAttribute(
    "href",
    "https://ivanli.cc/"
  )
  await expect(page.getByText("Releases")).toHaveCount(0)
  await expect(page.getByRole("link", { name: "模板" })).toBeVisible()
  await expect(page.getByRole("button", { name: /选择设备|Studio P2|Browser P2/ })).toBeVisible()

  await page.getByRole("link", { name: "模板" }).click()
  await expect(page.getByText("模板列表")).toBeVisible()
  await expect(page.getByRole("button", { name: "生成预览" })).toBeVisible()

  await page.goto("/?demo=true")
  await expect(page.getByRole("heading", { name: "打印工作台" })).toBeVisible()
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible()

  await page.getByRole("button", { name: /选择设备|Studio P2|Browser P2/ }).click()
  await expect(page.getByText("设备与打印路径")).toBeVisible()
  await expect(page.getByText("Service API", { exact: false }).first()).toBeVisible()
})
