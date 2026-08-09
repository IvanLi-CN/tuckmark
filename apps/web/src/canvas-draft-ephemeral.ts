import { assertCanvasDraftGeneration } from "./canvas-draft-generation.js"
import { isDemoRuntimeMode } from "./runtime-data-mode.js"
import type { CanvasDraftDocument, CanvasDraftSource } from "./types.js"

const STORAGE_KEY = "tuckmark.canvas-ephemeral-drafts.v1"
const DEMO_STORAGE_KEY = "tuckmark.demo.canvas-ephemeral-drafts.v1"

export type EphemeralCanvasDraft = {
  source: CanvasDraftSource
  document: CanvasDraftDocument
  updatedAt: string
}

let demoFallbackDrafts = new Map<string, EphemeralCanvasDraft>()
let runtimeFallbackDrafts = new Map<string, EphemeralCanvasDraft>()

function sourceKey(source: CanvasDraftSource): string {
  return source.kind === "user-template"
    ? `user:${source.templateId}`
    : `${source.kind}:${source.presetId}`
}

function readStoredDrafts(
  storageKey: string,
  fallbackDrafts: Map<string, EphemeralCanvasDraft>
): Map<string, EphemeralCanvasDraft> {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return new Map(fallbackDrafts)
  }
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) {
      return new Map(fallbackDrafts)
    }
    const parsed = JSON.parse(raw) as Record<string, EphemeralCanvasDraft>
    return new Map(
      Object.entries(parsed).filter(([, entry]) => Boolean(entry?.source && entry.document))
    )
  } catch {
    return new Map(fallbackDrafts)
  }
}

function writeStoredDrafts(
  storageKey: string,
  drafts: Map<string, EphemeralCanvasDraft>,
  setFallbackDrafts: (next: Map<string, EphemeralCanvasDraft>) => void
): void {
  setFallbackDrafts(new Map(drafts))
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(drafts)))
  } catch {
    // The in-memory fallback remains authoritative until storage is available again.
  }
}

export function recordEphemeralCanvasDraft(
  draft: EphemeralCanvasDraft,
  options?: { expectedGeneration?: number }
): void {
  assertCanvasDraftGeneration(draft.source, options?.expectedGeneration)
  const key = sourceKey(draft.source)
  if (isDemoRuntimeMode()) {
    const drafts = readStoredDrafts(DEMO_STORAGE_KEY, demoFallbackDrafts)
    drafts.set(key, draft)
    writeStoredDrafts(DEMO_STORAGE_KEY, drafts, (next) => {
      demoFallbackDrafts = next
    })
    return
  }
  const drafts = readStoredDrafts(STORAGE_KEY, runtimeFallbackDrafts)
  drafts.set(key, draft)
  writeStoredDrafts(STORAGE_KEY, drafts, (next) => {
    runtimeFallbackDrafts = next
  })
}

export function listEphemeralCanvasDrafts(): EphemeralCanvasDraft[] {
  return Array.from(
    (isDemoRuntimeMode()
      ? readStoredDrafts(DEMO_STORAGE_KEY, demoFallbackDrafts)
      : readStoredDrafts(STORAGE_KEY, runtimeFallbackDrafts)
    ).values()
  )
}

export function clearEphemeralCanvasDraft(source: CanvasDraftSource): void {
  const storageKey = isDemoRuntimeMode() ? DEMO_STORAGE_KEY : STORAGE_KEY
  const drafts = isDemoRuntimeMode()
    ? readStoredDrafts(DEMO_STORAGE_KEY, demoFallbackDrafts)
    : readStoredDrafts(STORAGE_KEY, runtimeFallbackDrafts)
  drafts.delete(sourceKey(source))
  writeStoredDrafts(storageKey, drafts, (next) => {
    if (isDemoRuntimeMode()) {
      demoFallbackDrafts = next
      return
    }
    runtimeFallbackDrafts = next
  })
}

export function clearEphemeralCanvasDrafts(): void {
  if (isDemoRuntimeMode()) {
    demoFallbackDrafts = new Map()
    if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
      try {
        window.localStorage.removeItem(DEMO_STORAGE_KEY)
      } catch {
        // The demo fallback was cleared above.
      }
    }
    return
  }
  if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // The fallback was cleared above.
    }
  }
  runtimeFallbackDrafts = new Map()
}
