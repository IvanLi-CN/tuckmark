export type AppLaunchSplashProps = {
  detailText?: string
  progressPercent?: number
  progressMode?: "determinate" | "indeterminate"
  statusText?: string
  theme?: "auto" | "dark" | "light"
}

export type AppLaunchSplashStepState = "pending" | "active" | "complete"

export type AppLaunchSplashStep = {
  id?: string
  label: string
  state: AppLaunchSplashStepState
}

export function AppLaunchSplash({
  detailText = "当前页面就绪后会立即进入，其他资产会在后台静默补齐。",
  progressMode = "indeterminate",
  progressPercent,
  statusText = "正在准备工作台",
  theme = "auto",
}: AppLaunchSplashProps) {
  const rootClassName = [
    "tm-launch-root",
    "tm-launch-root--loading",
    theme === "dark" ? "tm-launch-root--dark" : "",
    theme === "light" ? "tm-launch-root--light" : "",
  ]
    .filter(Boolean)
    .join(" ")
  const hasDeterminateProgress =
    progressMode === "determinate" && typeof progressPercent === "number"
  const safeProgress =
    hasDeterminateProgress && typeof progressPercent === "number"
      ? Math.max(0, Math.min(100, Math.round(progressPercent)))
      : null

  return (
    <div
      className={rootClassName}
      data-launch-screen="booting"
      role="status"
      aria-live="polite"
      aria-label={`Tuckmark ${statusText}`}
    >
      <div className="tm-launch-stage">
        <div className="tm-launch-ambient tm-launch-ambient--left" aria-hidden="true" />
        <div className="tm-launch-ambient tm-launch-ambient--right" aria-hidden="true" />
        <div className="tm-launch-wave" aria-hidden="true" />
        <div className="tm-launch-grid" aria-hidden="true" />
        <div className="tm-launch-register tm-launch-register--top-left" aria-hidden="true" />
        <div className="tm-launch-register tm-launch-register--top-right" aria-hidden="true" />
        <div className="tm-launch-register tm-launch-register--bottom-right" aria-hidden="true" />

        <div className="tm-launch-layout">
          <section className="tm-launch-copy-panel">
            <div className="tm-launch-brand">
              <div className="tm-launch-mark" aria-hidden="true">
                <span>T</span>
              </div>
              <div className="tm-launch-copy">
                <p className="tm-launch-kicker">Tuckmark</p>
                <h1 className="tm-launch-title">Label Workbench</h1>
              </div>
            </div>

            <div className="tm-launch-message-stack">
              <div className="tm-launch-text-block">
                <p className="tm-launch-status">{statusText}</p>
                <p className="tm-launch-detail">{detailText}</p>
              </div>

              <div className="tm-launch-progress-block">
                <div className="tm-launch-progress-dots">
                  <span />
                  <span />
                  <span />
                </div>
                <div
                  className={[
                    "tm-launch-progress-rail",
                    !hasDeterminateProgress ? "tm-launch-progress-rail--indeterminate" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  role="progressbar"
                  aria-label={`${statusText} 进度`}
                  aria-valuemin={hasDeterminateProgress ? 0 : undefined}
                  aria-valuemax={hasDeterminateProgress ? 100 : undefined}
                  aria-valuenow={safeProgress ?? undefined}
                  aria-valuetext={statusText}
                >
                  <div
                    className={[
                      "tm-launch-progress-fill",
                      !hasDeterminateProgress ? "tm-launch-progress-fill--indeterminate" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={safeProgress !== null ? { width: `${safeProgress}%` } : undefined}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="tm-launch-art-panel" aria-hidden="true">
            <div className="tm-launch-sheet">
              <div className="tm-launch-sheet-header">
                <div className="tm-launch-sheet-chip">
                  <strong>A6</strong>
                  <span>105 × 148 mm</span>
                </div>
                <div className="tm-launch-sheet-meta" />
              </div>
              <div className="tm-launch-sheet-body">
                <div className="tm-launch-sheet-label tm-launch-sheet-label--hero" />
                <div className="tm-launch-sheet-label" />
                <div className="tm-launch-sheet-label" />
                <div className="tm-launch-sheet-label" />
              </div>
              <div className="tm-launch-sheet-barcode" />
            </div>

            <div className="tm-launch-ticket">
              <div className="tm-launch-ticket-grid" />
              <div className="tm-launch-ticket-code" />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
