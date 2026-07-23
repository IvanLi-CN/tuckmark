import { AlertCircle, Home, RefreshCcw, RotateCcw } from "lucide-react"
import React from "react"

import { Button } from "./components/ui/button.js"

type WorkbenchRouteErrorDescriptor = {
  description: string
  suggestions: string[]
  title: string
}

export type WorkbenchRouteErrorPanelProps = {
  onGoHome?: () => void
  error: unknown
  onReload?: () => void
  onRetry?: () => void
  pathLabel?: string
}

const CHUNK_LOAD_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
]

function getWorkbenchRouteErrorMessage(error: unknown): string | null {
  if (typeof error === "string") {
    const message = error.trim()
    return message.length > 0 ? message : null
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const message = error.message.trim()
    return message.length > 0 ? message : null
  }

  return null
}

function isWorkbenchChunkLoadError(message: string | null): boolean {
  return Boolean(
    message &&
      CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => {
        pattern.lastIndex = 0
        return pattern.test(message)
      })
  )
}

export function describeWorkbenchRouteError(error: unknown): WorkbenchRouteErrorDescriptor {
  const message = getWorkbenchRouteErrorMessage(error)

  if (isWorkbenchChunkLoadError(message)) {
    return {
      title: "页面暂时没有加载出来",
      description: "这个页面内容没有完整加载。你可以先重试当前页面；如果还没有恢复，再刷新应用。",
      suggestions: [
        "先重试当前页面，通常可以立即恢复。",
        "如果问题还在，刷新应用后再进入这个页面。",
        "若仍未恢复，可以先返回主页，再重新打开当前页面。",
      ],
    }
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      title: "页面切换被中断了",
      description: "这次页面切换没有完整走完。你可以重新打开当前页面，或先回到主页再继续。",
      suggestions: [
        "先重试当前页面。",
        "如果页面仍然停在异常状态，可以返回主页后重新进入。",
        "连续失败时，再刷新整个应用。",
      ],
    }
  }

  return {
    title: "页面暂时打不开",
    description: "工作台暂时没能打开这个页面。你可以先重试当前页面；如果问题持续，再刷新应用。",
    suggestions: [
      "先重试当前页面。",
      "如果问题持续，刷新应用后再试一次。",
      "若仍未恢复，可以先返回主页，再重新进入该页面。",
    ],
  }
}

export function WorkbenchRouteErrorPanel({
  error,
  onGoHome,
  onReload,
  onRetry,
  pathLabel,
}: WorkbenchRouteErrorPanelProps) {
  const descriptor = React.useMemo(() => describeWorkbenchRouteError(error), [error])

  return (
    <section
      className="tm-route-error"
      role="alert"
      aria-live="assertive"
      aria-label="页面加载失败"
    >
      <div className="tm-route-error__hero">
        <div className="tm-route-error__icon" aria-hidden="true">
          <AlertCircle className="size-5" />
        </div>
        <div className="tm-route-error__copy">
          <p className="tm-route-error__eyebrow">导航已中断</p>
          <h2 className="tm-route-error__title">{descriptor.title}</h2>
          <p className="tm-route-error__body">{descriptor.description}</p>
        </div>
      </div>

      {pathLabel ? (
        <div className="tm-route-error__meta">
          <span className="tm-route-error__pill">
            <span className="tm-route-error__pill-label">当前页面</span>
            <code>{pathLabel}</code>
          </span>
        </div>
      ) : null}

      <div className="tm-route-error__guidance">
        <p className="tm-route-error__guidance-title">你可以尝试</p>
        <ul className="tm-route-error__guidance-list">
          {descriptor.suggestions.map((suggestion) => (
            <li key={suggestion}>{suggestion}</li>
          ))}
        </ul>
      </div>

      {onRetry || onGoHome || onReload ? (
        <div className="tm-route-error__actions">
          {onRetry ? (
            <Button type="button" onClick={onRetry}>
              <RefreshCcw className="size-4" />
              重试当前页面
            </Button>
          ) : null}
          {onGoHome ? (
            <Button type="button" variant="secondary" onClick={onGoHome}>
              <Home className="size-4" />
              返回主页
            </Button>
          ) : null}
          {onReload ? (
            <Button type="button" variant="outline" onClick={onReload}>
              <RotateCcw className="size-4" />
              刷新应用
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
