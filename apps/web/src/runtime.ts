import type { AppContext, AppMode, AppSurface } from "./types.js"

declare const __TUCKMARK_WEB_SURFACE__: AppSurface

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") && value !== "/" ? value.slice(0, -1) : value
}

function parseDemoParam(search: string): AppMode {
  const params = new URLSearchParams(search)
  return params.get("demo") === "true" ? "demo" : "runtime"
}

export function resolveBasePath(env: Record<string, string | undefined>): string {
  const explicit = env.TUCKMARK_WEB_BASE_PATH?.trim()
  return explicit ? trimTrailingSlash(explicit) : ""
}

export function resolveSurface(
  env: Record<string, string | undefined>,
  fallback: AppSurface = __TUCKMARK_WEB_SURFACE__
): AppSurface {
  const explicit = env.TUCKMARK_WEB_SURFACE?.trim()
  if (explicit === "browser-static" || explicit === "server-http") {
    return explicit
  }
  return fallback
}

export function resolveAppContext(
  env: Record<string, string | undefined>,
  locationLike:
    | {
        search: string
      }
    | undefined = typeof window !== "undefined" ? window.location : undefined
): AppContext {
  const surface = resolveSurface(env)
  const mode = parseDemoParam(locationLike?.search ?? "")
  const basePath = resolveBasePath(env)

  return {
    apiBasePath: surface === "server-http" ? "/api" : "",
    basePath,
    mode,
    surface,
    capabilities: {
      browserPrint: mode === "demo" ? "disabled" : "available",
      serverPrint: surface === "server-http" && mode === "runtime" ? "available" : "disabled",
      mockHardware: mode === "demo",
    },
  }
}
