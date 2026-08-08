import type { CanvasDraftSource } from "./types.js"

export const DRAFT_PROCESSING_ROUTE_PATH = "/canvas/draft-processing"

type DraftProcessingPathOptions = {
  panel?: "versions"
  status?: "saved" | "created"
}

export function isDraftProcessingPath(pathname: string): boolean {
  const pathnameOnly = pathname.split(/[?#]/u)[0] ?? pathname
  const normalized = pathnameOnly.replace(/\/+$/u, "") || "/"
  return normalized.endsWith(DRAFT_PROCESSING_ROUTE_PATH)
}

export function getDraftProcessingPath(
  source: CanvasDraftSource,
  options: DraftProcessingPathOptions = {}
): string {
  const searchParams = new URLSearchParams()

  if (source.kind === "user-template") {
    searchParams.set("source", "user-template")
    searchParams.set("templateId", source.templateId)
  } else if (source.kind === "preset-template") {
    searchParams.set("source", "preset-template")
    searchParams.set("templateId", source.presetId)
  } else {
    searchParams.set("presetId", source.presetId)
  }

  if (options.panel) {
    searchParams.set("panel", options.panel)
  }
  if (options.status) {
    searchParams.set("status", options.status)
  }

  return `${DRAFT_PROCESSING_ROUTE_PATH}?${searchParams.toString()}`
}

export function openDraftProcessingWindow(source: CanvasDraftSource): void {
  if (typeof window === "undefined") {
    return
  }
  const processingWindow = window.open(getDraftProcessingPath(source), "_blank")
  processingWindow?.focus()
}
