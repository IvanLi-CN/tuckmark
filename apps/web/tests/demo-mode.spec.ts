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
  await expect(page.getByText("build e499426")).toBeVisible()
  await expect(page.getByText("v0.1.0")).toHaveCount(0)
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

test("demo mode exposes draft processing through its formal restricted route", async ({ page }) => {
  const processingPath =
    "/canvas/draft-processing?source=preset-template&templateId=cable-tag&demo=true"
  await page.goto(`/?__tuckmark_redirect__=${encodeURIComponent(processingPath)}`)

  await expect(page).toHaveURL(processingPath)
  await expect(page.getByRole("heading", { name: "草稿处理" })).toBeVisible()
  await expect(page.getByText("系统模板：Cable Tag")).toBeVisible()
  await expect(page.getByRole("button", { name: "返回草稿处理弹窗" })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "GitHub" })).toHaveCount(0)
})

test("demo mode uses a virtual data directory instead of the native picker", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: () => {
        throw new Error("Demo mode must not open the native directory picker.")
      },
    })
  })

  await page.goto("/system?demo=true")
  await page.getByRole("button", { name: "接入演示目录" }).click()

  await expect(page.getByRole("heading", { name: "发现演示数据目录" })).toBeVisible()
  await expect(page.getByText("不会读取或写入本机目录", { exact: false })).toBeVisible()
  await expect(page.getByRole("button", { name: "导入演示数据" })).toBeVisible()
})

test("system tab processes another tab's pending draft without returning to the canvas tab", async ({
  page: canvasPage,
  context,
}) => {
  await canvasPage.goto("/canvas?source=preset-template&templateId=cable-tag&demo=true")
  await expect(canvasPage.getByText("系统模板：Cable Tag")).toBeVisible()
  const canvasLayers = canvasPage.locator(".tm-layer-list--inspector .tm-choice--layer")
  await expect(canvasLayers).toHaveCount(5)

  const systemPage = await context.newPage()
  await systemPage.goto("/templates?demo=true")
  await expect(systemPage.getByRole("heading", { name: "模板列表" })).toBeVisible()
  await systemPage.goto("/system?demo=true")
  await expect(systemPage.getByRole("button", { name: "接入演示目录" })).toBeVisible()
  const workingCopyPersisted = systemPage.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const channel = new BroadcastChannel("tuckmark.runtime-store-events.v1")
        channel.addEventListener("message", (event) => {
          if (event.data?.reason !== "working-copy-replaced") {
            return
          }
          channel.close()
          resolve()
        })
      })
  )

  await canvasPage.locator(".tm-quick-tools").getByRole("button", { name: "文本" }).click()
  await expect(canvasLayers).toHaveCount(6)
  await workingCopyPersisted

  await systemPage.getByRole("button", { name: "接管写入" }).click()
  await systemPage.getByRole("button", { name: "接入演示目录" }).click()
  await systemPage.getByRole("button", { name: "导入演示数据" }).click()

  await expect(systemPage.getByRole("heading", { name: "请先处理未保存草稿" })).toBeVisible()
  await expect(systemPage.getByText("Cable Tag")).toBeVisible()

  const processingPagePromise = systemPage.waitForEvent("popup")
  await systemPage.getByRole("button", { name: "去处理" }).click()
  const processingPage = await processingPagePromise
  await expect(processingPage).toHaveURL(
    /\/canvas\/draft-processing\?source=preset-template&templateId=cable-tag&demo=true/
  )
  await expect(processingPage.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0)

  await processingPage.getByRole("button", { name: "重置草稿" }).click()
  await expect(processingPage.getByText("已重置为系统模板初始内容。")).toBeVisible()
  const processingClosed = processingPage.waitForEvent("close")
  await processingPage.getByRole("button", { name: "返回草稿处理弹窗" }).click()
  await processingClosed

  await systemPage.getByRole("button", { name: "重新检查并继续" }).click()
  await expect(systemPage.getByText("Demo data directory", { exact: true })).toBeVisible()
  await expect(systemPage.getByRole("heading", { name: "请先处理未保存草稿" })).toHaveCount(0)
  await expect(canvasPage).toHaveURL(
    /\/canvas\?source=preset-template&templateId=cable-tag&demo=true/
  )
})

test("draft processing demo remains restricted on a compact viewport", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 })
  const processingPath =
    "/canvas/draft-processing?source=preset-template&templateId=cable-tag&demo=true"
  await page.goto(`/?__tuckmark_redirect__=${encodeURIComponent(processingPath)}`)

  await expect(page.getByRole("heading", { name: "草稿处理" })).toBeVisible()
  await expect(page.getByRole("button", { name: "返回草稿处理弹窗" })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0)
  expect(
    await page
      .locator("html")
      .evaluate((documentElement) => documentElement.scrollWidth <= documentElement.clientWidth)
  ).toBe(true)
})
