import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { Page } from "@playwright/test"

import {
  createRecentPrintRecord,
  createTemplateUsageRecord,
  emptySyncState,
  type SharedCanvasDraftDocument,
  type SyncState,
} from "../../../packages/core/src/web.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "../../..")
const syncRoot = path.join(repoRoot, "work", "playwright-sync")
const syncStatePath = path.join(syncRoot, ".tuckmark", "sync-state.json")

export async function writeServerSyncState(state: SyncState): Promise<void> {
  await fs.mkdir(path.dirname(syncStatePath), { recursive: true })
  await fs.writeFile(syncStatePath, JSON.stringify(state, null, 2), "utf8")
}

export async function readServerSyncState(): Promise<SyncState> {
  const raw = await fs.readFile(syncStatePath, "utf8")
  return JSON.parse(raw) as SyncState
}

export async function clearServerSyncState(): Promise<void> {
  await writeServerSyncState(emptySyncState())
}

export function createServerRecentActivityState(): SyncState {
  const template = createTemplateUsageRecord({
    id: "shipping-compact",
    name: "Shipping Label",
    description: "Synced template",
    usedAt: "2026-06-28T10:00:00.000Z",
  })
  const print = createRecentPrintRecord({
    id: "template:shipping-compact",
    title: "shipping-compact",
    kind: "template",
    printerName: "Server P2",
    printedAt: "2026-06-28T10:05:00.000Z",
  })
  return {
    ...emptySyncState(),
    updatedAt: print.updatedAt,
    templateUsageRecords: [template],
    recentPrintRecords: [print],
  }
}

export function createDraftDocument(
  overrides: Partial<SharedCanvasDraftDocument> = {}
): SharedCanvasDraftDocument {
  return {
    version: 1,
    id: overrides.id ?? "shipping-wide",
    presetId: overrides.presetId ?? "shipping-wide",
    name: overrides.name ?? "Shipping Wide",
    width: overrides.width ?? 384,
    height: overrides.height ?? 224,
    elements: overrides.elements ?? [],
    editor: overrides.editor ?? {
      gridEnabled: true,
      snapEnabled: true,
    },
  }
}

export async function seedBrowserLocalState(
  page: Page,
  state: {
    syncState?: SyncState
    recentActivity?: unknown
    draftByPreset?: Record<string, SharedCanvasDraftDocument>
  }
): Promise<void> {
  await page.addInitScript((payload) => {
    if (payload.syncState) {
      window.localStorage.setItem("tuckmark.sync-state.v1", JSON.stringify(payload.syncState))
    }
    if (payload.recentActivity) {
      window.localStorage.setItem(
        "tuckmark.recent-activity.v1",
        JSON.stringify(payload.recentActivity)
      )
    }
    for (const [presetId, draft] of Object.entries(payload.draftByPreset ?? {})) {
      window.localStorage.setItem(`tuckmark:canvas-draft:v1:${presetId}`, JSON.stringify(draft))
    }
  }, state)
}

export async function readBrowserStorage(page: Page, key: string): Promise<string | null> {
  return page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key)
}
