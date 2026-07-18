import React from "react"

import type { AppContext } from "./types.js"

export type PwaAssetTier = "shell" | "route" | "feature"
export type PwaAssetWarmupStatus = "unsupported" | "idle" | "pending" | "complete" | "error"

type WarmAssetsResponse = {
  ok: boolean
  error?: string
}

async function requestServiceWorkerWarmup(tiers: readonly PwaAssetTier[]): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    throw new Error("service worker unsupported")
  }

  const registration = await navigator.serviceWorker.ready
  const targetWorker =
    registration.active ?? registration.waiting ?? registration.installing ?? null
  if (!targetWorker) {
    throw new Error("no active service worker available for warmup")
  }

  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel()
    const timeoutId = window.setTimeout(() => {
      reject(new Error("service worker warmup timed out"))
    }, 15_000)

    channel.port1.onmessage = (event: MessageEvent<WarmAssetsResponse>) => {
      window.clearTimeout(timeoutId)
      if (event.data?.ok) {
        resolve()
        return
      }
      reject(new Error(event.data?.error ?? "service worker warmup failed"))
    }

    targetWorker.postMessage(
      {
        type: "WARM_ASSETS",
        tiers,
      },
      [channel.port2]
    )
  })
}

export function usePwaAssetWarmup(context: AppContext, enabled: boolean): PwaAssetWarmupStatus {
  const [status, setStatus] = React.useState<PwaAssetWarmupStatus>(() =>
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
    void requestServiceWorkerWarmup(["feature"])
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
