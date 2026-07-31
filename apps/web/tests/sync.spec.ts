import { type APIRequestContext, expect, test } from "@playwright/test"

type DevdStatus = { revision: number }

async function currentRevision(request: APIRequestContext): Promise<number> {
  const response = await request.get("/api/data/status")
  expect(response.ok()).toBe(true)
  return ((await response.json()) as DevdStatus).revision
}

async function writeRuntimeWorkingCopy(request: APIRequestContext, name: string): Promise<void> {
  const response = await request.post("/api/data/runtime/replace-working-copy", {
    data: {
      expectedRevision: await currentRevision(request),
      args: {
        source: { kind: "scratch", presetId: "shipping-wide" },
        document: {
          version: 1,
          unit: "mm",
          id: "shipping-wide",
          presetId: "shipping-wide",
          name,
          source: { kind: "scratch", presetId: "shipping-wide" },
          width: 100,
          height: 60,
          fields: [],
          elements: [],
          editor: { gridEnabled: true, snapEnabled: true },
        },
      },
    },
  })
  expect(response.ok()).toBe(true)
}

test("server-http system status reads DEVD data instead of browser-local state", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tuckmark.sync-state.v1", '{"browserOnly":true}')
  })
  const response = await request.post("/api/data/inventory/save-material", {
    data: {
      expectedRevision: await currentRevision(request),
      args: {
        id: "sync-mock-material",
        fullName: "DEVD Sync Mock Material",
        description: "Temporary CI fixture.",
        matrixCode: "SYNC-MOCK-01",
      },
    },
  })
  expect(response.ok()).toBe(true)

  await page.goto("/system")

  await expect(page.getByRole("heading", { name: "DEVD 数据存储" })).toBeVisible()
  await expect(page.getByText("当前页面不会请求浏览器目录权限。")).toBeVisible()
  await expect(page.getByText("1 物料", { exact: false })).toBeVisible()
  await expect(
    page.evaluate(() => window.localStorage.getItem("tuckmark.sync-state.v1"))
  ).resolves.toContain("browserOnly")
})

test("server-http canvas restores the DEVD working copy and ignores browser drafts", async ({
  page,
  request,
}) => {
  await writeRuntimeWorkingCopy(request, "DEVD Shipping Draft")
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "tuckmark:canvas-draft:v1:shipping-wide",
      JSON.stringify({ name: "Browser Fallback Draft" })
    )
  })

  await page.goto("/canvas")

  await expect(page.getByText("标签编辑台")).toBeVisible()
  await expect(page.getByText("当前草稿：DEVD Shipping Draft")).toBeVisible()
  await expect(
    page.evaluate(() => window.localStorage.getItem("tuckmark:canvas-draft:v1:shipping-wide"))
  ).resolves.toContain("Browser Fallback Draft")

  await page.reload()

  await expect(page.getByText("当前草稿：DEVD Shipping Draft")).toBeVisible()
})
