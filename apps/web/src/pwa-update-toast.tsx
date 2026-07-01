import { Loader2, RefreshCcw } from "lucide-react"
import React from "react"

import { Button } from "./components/ui/button.js"
import { cn } from "./lib/utils.js"
import type { PwaUpdateSnapshot } from "./pwa-lifecycle.js"
import { pwaUpdateController } from "./pwa-lifecycle.js"
import type { AppContext } from "./types.js"

export type PwaUpdateToastProps = {
  snapshot: PwaUpdateSnapshot
  onUpdate: () => void
  placement?: "fixed" | "inline"
}

function shouldShowToast(status: PwaUpdateSnapshot["status"]): boolean {
  return status === "ready" || status === "activating"
}

export function PwaUpdateToast({ snapshot, onUpdate, placement = "fixed" }: PwaUpdateToastProps) {
  if (!shouldShowToast(snapshot.status)) {
    return null
  }

  const isReady = snapshot.status === "ready"
  const title = isReady ? "新版本可用" : "正在更新 Tuckmark Web"
  const description = isReady
    ? "可以立即切换到新的 Tuckmark Web。当前页面会在确认后刷新。"
    : "页面即将刷新。"

  return (
    <aside
      className={cn("tm-pwa-toast", placement === "inline" && "tm-pwa-toast--inline")}
      aria-live="polite"
      aria-label="Tuckmark Web update status"
    >
      <div className="tm-pwa-toast__icon">
        {isReady ? <RefreshCcw className="size-4" /> : <Loader2 className="size-4 animate-spin" />}
      </div>
      <div className="tm-pwa-toast__body">
        <div className="tm-pwa-toast__title">{title}</div>
        <div className="tm-pwa-toast__description">{description}</div>
      </div>
      <Button
        type="button"
        size="sm"
        disabled={!isReady}
        onClick={onUpdate}
        className="tm-pwa-toast__button"
      >
        {isReady ? (
          <RefreshCcw className="size-3.5" />
        ) : (
          <Loader2 className="size-3.5 animate-spin" />
        )}
        <span>{isReady ? "更新" : "更新中"}</span>
      </Button>
    </aside>
  )
}

export function usePwaUpdate(context: AppContext): PwaUpdateSnapshot {
  const [snapshot, setSnapshot] = React.useState<PwaUpdateSnapshot>({
    status: "idle",
    registration: null,
    waitingWorker: null,
    error: null,
  })

  React.useEffect(() => {
    if (
      !import.meta.env.PROD ||
      context.surface !== "browser-static" ||
      context.mode !== "runtime"
    ) {
      return
    }
    const unsubscribe = pwaUpdateController.subscribe(setSnapshot)
    void pwaUpdateController.register()
    return unsubscribe
  }, [context.mode, context.surface])

  return snapshot
}

export function confirmAndApplyPwaUpdate(snapshot: PwaUpdateSnapshot): void {
  if (snapshot.status !== "ready") {
    return
  }
  const shouldUpdate = window.confirm(
    "检测到新版本。现在更新会刷新当前页面，请确认当前编辑内容已经保存。"
  )
  if (!shouldUpdate) {
    return
  }
  pwaUpdateController.applyUpdate()
}
