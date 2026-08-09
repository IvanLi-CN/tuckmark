import { type APIRequestContext, expect, type Page, test } from "@playwright/test"

type DevdStatus = { revision: number }
type RevisionResponse = { revision: number }
type RevisionEvent = { revision: number; domains: string[]; reason: string }
type BrowserSseState = {
  source: EventSource
  event: Promise<RevisionEvent>
}

const SSE_STATE_KEY = "__tuckmarkContractSse"

test.describe.configure({ mode: "serial" })

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

async function openDataRevisionStream(page: Page): Promise<void> {
  await page.evaluate(
    (stateKey) =>
      new Promise<void>((resolve, reject) => {
        const source = new EventSource("/api/data/events")
        const target = window as typeof window & Record<string, BrowserSseState | undefined>
        const openTimeout = window.setTimeout(() => {
          source.close()
          reject(new Error("Timed out waiting for DEVD SSE connection."))
        }, 10_000)
        const event = new Promise<RevisionEvent>((resolveEvent, rejectEvent) => {
          const eventTimeout = window.setTimeout(() => {
            source.close()
            rejectEvent(new Error("Timed out waiting for DEVD revision event."))
          }, 20_000)
          source.addEventListener("data-revision", (raw) => {
            window.clearTimeout(eventTimeout)
            try {
              resolveEvent(JSON.parse((raw as MessageEvent<string>).data) as RevisionEvent)
            } catch (error) {
              rejectEvent(error)
            }
          })
          source.addEventListener("error", () => {
            if (source.readyState === EventSource.CLOSED) {
              window.clearTimeout(eventTimeout)
              rejectEvent(new Error("DEVD SSE connection closed before a revision event."))
            }
          })
        })
        target[stateKey] = { source, event }
        source.addEventListener("open", () => {
          window.clearTimeout(openTimeout)
          resolve()
        })
      }),
    SSE_STATE_KEY
  )
}

async function readDataRevisionEvent(page: Page): Promise<RevisionEvent> {
  return await page.evaluate(async (stateKey) => {
    const target = window as typeof window & Record<string, BrowserSseState | undefined>
    const state = target[stateKey]
    if (!state) throw new Error("DEVD SSE stream was not initialized.")
    try {
      return await state.event
    } finally {
      state.source.close()
      delete target[stateKey]
    }
  }, SSE_STATE_KEY)
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

test("server-http preserves the DEVD revision conflict payload", async ({ request }) => {
  const expectedRevision = await currentRevision(request)
  const first = await request.post("/api/data/runtime/save-settings", {
    data: {
      expectedRevision,
      args: { patch: { threshold: 144 } },
    },
  })
  expect(first.ok()).toBe(true)
  const firstBody = (await first.json()) as RevisionResponse

  const stale = await request.post("/api/data/runtime/save-settings", {
    data: {
      expectedRevision,
      args: { patch: { threshold: 145 } },
    },
  })
  expect(stale.status()).toBe(409)
  await expect(stale.json()).resolves.toEqual({
    status: "error",
    code: "revision_conflict",
    expectedRevision,
    actualRevision: firstBody.revision,
    error: `Expected revision ${expectedRevision} but current revision is ${firstBody.revision}.`,
  })
})

test("server-http browser receives native DEVD SSE revision events", async ({ page, request }) => {
  await page.goto("/system")
  await expect(page.getByRole("heading", { name: "DEVD 数据存储" })).toBeVisible()
  await openDataRevisionStream(page)

  const expectedRevision = await currentRevision(request)
  const response = await request.post("/api/data/runtime/save-settings", {
    data: {
      expectedRevision,
      args: { patch: { threshold: 146 } },
    },
  })
  expect(response.ok()).toBe(true)
  const responseBody = (await response.json()) as RevisionResponse

  const event = await readDataRevisionEvent(page)
  expect(event.revision).toBe(responseBody.revision)
  expect(event.domains).toContain("settings")
  expect(event.reason).toBe("save-settings")
})
