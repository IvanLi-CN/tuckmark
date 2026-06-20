import type { AppContext, AppMode } from "./types.js"

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") && value !== "/" ? value.slice(0, -1) : value
}

function parseDemoParam(search: string): AppMode | null {
  const params = new URLSearchParams(search)
  const value = params.get("demo")
  if (value === "true") {
    return "demo-seeded"
  }
  if (value === "false") {
    return "mock-shell"
  }
  return null
}

export function resolveBasePath(env: Record<string, string | undefined>): string {
  const explicit = env.TUCKMARK_WEB_BASE_PATH?.trim()
  if (explicit) {
    return trimTrailingSlash(explicit)
  }

  const base = env.BASE_URL?.trim()
  if (base) {
    return trimTrailingSlash(base)
  }

  return ""
}

export function resolveAppContext(
  env: Record<string, string | undefined>,
  locationLike:
    | {
        origin: string
        pathname: string
        search: string
      }
    | undefined = typeof window !== "undefined" ? window.location : undefined
): AppContext {
  const basePath = resolveBasePath(env)
  const isPagesHost = locationLike?.origin.includes("github.io") ?? false
  const demoOverride = parseDemoParam(locationLike?.search ?? "")

  let mode: AppMode
  if (demoOverride) {
    mode = demoOverride
  } else if (isPagesHost) {
    mode = "demo-seeded"
  } else {
    mode = "runtime"
  }

  const apiBasePath = mode === "runtime" ? "/api" : `${basePath}/mock-api`

  return {
    apiBasePath,
    basePath,
    isPages: isPagesHost,
    mode,
    capabilities: {
      browserPrint: "available",
      serverPrint: mode === "runtime" ? "available" : "mocked",
      packetsSource: mode === "runtime" ? "http" : "mock",
    },
  }
}
