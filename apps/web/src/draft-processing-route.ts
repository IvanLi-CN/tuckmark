import type { CanvasDraftSource } from "./types.js"

export const DRAFT_PROCESSING_ROUTE_PATH = "/canvas/draft-processing"
const SPA_REDIRECT_PARAM = "__tuckmark_redirect__"

type DraftProcessingPathOptions = {
  demo?: boolean
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
  if (options.demo) {
    searchParams.set("demo", "true")
  }

  return `${DRAFT_PROCESSING_ROUTE_PATH}?${searchParams.toString()}`
}

export function openDraftProcessingWindow(source: CanvasDraftSource): void {
  if (typeof window === "undefined") {
    return
  }
  const isDemo = new URLSearchParams(window.location.search).get("demo") === "true"
  const processingPath = getDraftProcessingPath(source, { demo: isDemo })
  const applicationRoot = window.location.pathname.replace(/\/system\/?$/u, "/")
  const launchPath = new URL(applicationRoot, window.location.origin)
  launchPath.searchParams.set(SPA_REDIRECT_PARAM, encodeURIComponent(processingPath))
  const processingWindow = window.open(`${launchPath.pathname}${launchPath.search}`, "_blank")
  processingWindow?.focus()
}
