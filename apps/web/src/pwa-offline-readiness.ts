import React from "react"

import type { AppContext } from "./types.js"

export type PwaOfflineReadinessStatus = "unsupported" | "idle" | "pending" | "complete" | "error"

async function waitForCompleteOfflineVersion(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    throw new Error("service worker unsupported")
  }

  const registration = await navigator.serviceWorker.ready
  if (!registration.active) {
    throw new Error("no active service worker available for offline readiness")
  }
}

export function usePwaOfflineReadiness(
  context: AppContext,
  enabled: boolean
): PwaOfflineReadinessStatus {
  const [status, setStatus] = React.useState<PwaOfflineReadinessStatus>(() =>
    import.meta.env.PROD && context.surface === "browser-static" && context.mode === "runtime"
      ? "idle"
      : "unsupported"
  )

  React.useEffect(() => {
    if (
      !enabled ||
      !import.meta.env.PROD ||
      context.surface !== "browser-static" ||
      context.mode !== "runtime"
    ) {
      setStatus(
        import.meta.env.PROD && context.surface === "browser-static" && context.mode === "runtime"
          ? "idle"
          : "unsupported"
      )
      return
    }

    let cancelled = false
    setStatus("pending")
    void waitForCompleteOfflineVersion()
      .then(() => {
        if (!cancelled) {
          setStatus("complete")
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error")
        }
      })

    return () => {
      cancelled = true
    }
  }, [context.mode, context.surface, enabled])

  return status
}
