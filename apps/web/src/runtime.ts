import {
  type DetongerWasmStatus,
  resolveConfiguredBrowserDirectPathState,
} from "./browser-direct-path.js"
import type { AppContext, AppSurface } from "./types.js"
import detongerWasmStatus from "./wasm/pkg/detonger_wasm_status.js"

declare const __TUCKMARK_WEB_SURFACE__: AppSurface

function resolveInjectedSurfaceFallback(): AppSurface {
  return typeof __TUCKMARK_WEB_SURFACE__ !== "undefined" ? __TUCKMARK_WEB_SURFACE__ : "server-http"
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") && value !== "/" ? value.slice(0, -1) : value
}

function normalizeBasePath(value: string): string {
  if (value === "./" || value === ".") {
    return ""
  }
  return trimTrailingSlash(value)
}

function parseDemoParam(search: string): AppContext["mode"] {
  const params = new URLSearchParams(search)
  return params.get("demo") === "true" ? "demo" : "runtime"
}

function envFlagEnabled(
  env: Record<string, string | undefined>,
  name: string,
  defaultValue: boolean
): boolean {
  const raw = env[name]?.trim()
  if (!raw) {
    return defaultValue
  }
  return raw !== "0" && raw.toLowerCase() !== "false"
}

export function resolveBasePath(env: Record<string, string | undefined>): string {
  const explicit = env.TUCKMARK_WEB_BASE_PATH?.trim()
  if (explicit) {
    return normalizeBasePath(explicit)
  }

  const base = env.BASE_URL?.trim()
  return base ? normalizeBasePath(base) : ""
}

export function resolveSurface(
  env: Record<string, string | undefined>,
  fallback: AppSurface = resolveInjectedSurfaceFallback()
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
    | undefined = typeof window !== "undefined" ? window.location : undefined,
  overrides?: {
    detongerWasmStatus?: DetongerWasmStatus
  }
): AppContext {
  const surface = resolveSurface(env)
  const mode = parseDemoParam(locationLike?.search ?? "")
  const basePath = resolveBasePath(env)
  const browserDirectEnabled = envFlagEnabled(env, "TUCKMARK_ENABLE_BROWSER_DIRECT_PRINT", true)
  const serviceApiEnabled = envFlagEnabled(env, "TUCKMARK_ENABLE_SERVER_SIDE_PRINT", false)
  const resolvedDetongerWasmStatus = overrides?.detongerWasmStatus ?? detongerWasmStatus

  return {
    apiBasePath: surface === "server-http" ? "/api" : "",
    basePath,
    mode,
    surface,
    capabilities: {
      browserDirectPrintPath: resolveConfiguredBrowserDirectPathState(
        mode,
        browserDirectEnabled,
        resolvedDetongerWasmStatus
      ),
      serviceApiPrintPath:
        mode === "demo"
          ? "mocked"
          : surface === "server-http"
            ? serviceApiEnabled
              ? "available"
              : "disabled"
            : "disabled",
    },
  }
}
