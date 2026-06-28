import { expect, test } from "@playwright/test"

import {
  clearServerSyncState,
  createDraftDocument,
  createServerRecentActivityState,
  readBrowserStorage,
  readServerSyncState,
  seedBrowserLocalState,
  writeServerSyncState,
} from "./sync-helpers.js"

test.beforeEach(async () => {
  await clearServerSyncState()
})

test("server-http startup hydrates recent activity from persisted sync state", async ({ page }) => {
  await writeServerSyncState(createServerRecentActivityState())

  await page.goto("/")

  await expect(page.getByRole("heading", { name: "打印工作台" })).toBeVisible()
  await expect(page.getByText("Server HTTP", { exact: false }).first()).toBeVisible()
  await expect(page.getByText("Runtime mode", { exact: false }).first()).toBeVisible()
  await expect(page.getByText("Shipping Label")).toBeVisible()
  await expect(page.getByText("Server P2")).toBeVisible()
})

test("server-http canvas restores a locally persisted draft after reload", async ({ page }) => {
  const draft = createDraftDocument({
    name: "Recovered Shipping Draft",
  })
  await seedBrowserLocalState(page, {
    draftByPreset: {
      "shipping-wide": draft,
    },
  })

  await page.goto("/canvas")

  await expect(page.getByText("标签编辑台")).toBeVisible()
  await expect(page.getByText("当前预设：Recovered Shipping Draft")).toBeVisible()
  await expect(await readBrowserStorage(page, "tuckmark:canvas-draft:v1:shipping-wide")).toContain(
    "Recovered Shipping Draft"
  )

  await page.reload()

  await expect(page.getByText("标签编辑台")).toBeVisible()
  await expect(page.getByText("当前预设：Recovered Shipping Draft")).toBeVisible()
  await expect(await readBrowserStorage(page, "tuckmark:canvas-draft:v1:shipping-wide")).toContain(
    "Recovered Shipping Draft"
  )
})

test("server-http startup merges browser-local recent prints back into service state", async ({
  page,
}) => {
  const localOnlyState = {
    ...createServerRecentActivityState(),
    recentPrintRecords: [
      {
        kind: "recent_print" as const,
        recordId: "print:template:local-offline",
        version: 1,
        vectorClock: { browser: 1, service: 0 },
        updatedAt: "2026-06-28T10:10:00.000Z",
        hash: "local-offline-hash",
        deleted: false,
        conflicts: [],
        payload: {
          id: "template:local-offline",
          title: "local-offline",
          kind: "template" as const,
          printedAt: "2026-06-28T10:10:00.000Z",
          printerName: "Offline Browser P2",
        },
      },
    ],
  }

  await writeServerSyncState(createServerRecentActivityState())
  await seedBrowserLocalState(page, {
    syncState: localOnlyState,
  })

  await page.goto("/")

  await expect(page.getByRole("heading", { name: "打印工作台" })).toBeVisible()

  await expect
    .poll(async () => {
      const state = await readServerSyncState()
      return state.recentPrintRecords.some(
        (record) => record.payload.id === "template:local-offline"
      )
    })
    .toBe(true)
})
