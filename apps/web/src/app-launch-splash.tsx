export type AppLaunchSplashProps = {
  detailText?: string;
  progressPercent?: number;
  statusText?: string;
  steps?: readonly AppLaunchSplashStep[];
  theme?: "auto" | "dark" | "light";
};

export type AppLaunchSplashStepState = "pending" | "active" | "complete";

export type AppLaunchSplashStep = {
  id?: string;
  label: string;
  state: AppLaunchSplashStepState;
};

const DEFAULT_STEPS = [
  {
    id: "bootstrap-loaded",
    label: "启动运行时引导",
    state: "complete",
  },
  {
    id: "current-route-chunk-ready",
    label: "装载当前页面模块",
    state: "active",
  },
  {
    id: "current-route-data-ready",
    label: "准备当前页面状态",
    state: "pending",
  },
  {
    id: "offline-warmup",
    label: "补齐离线资源缓存",
    state: "pending",
  },
] satisfies readonly AppLaunchSplashStep[];

function describeStepState(state: AppLaunchSplashStepState) {
  switch (state) {
    case "complete":
      return "已完成";
    case "active":
      return "处理中";
    case "pending":
    default:
      return "待处理";
  }
}

export function AppLaunchSplash({
  detailText = "正在预载当前页面模块，准备进入工作台。",
  progressPercent = 25,
  statusText = "正在装载当前页面模块",
  steps = DEFAULT_STEPS,
  theme = "auto",
}: AppLaunchSplashProps) {
  const rootClassName = [
    "tm-launch-root",
    "tm-launch-root--loading",
    theme === "dark" ? "tm-launch-root--dark" : "",
    theme === "light" ? "tm-launch-root--light" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const safeProgress = Math.max(0, Math.min(100, Math.round(progressPercent)));
  const completedSteps = steps.filter((step) => step.state === "complete").length;

  return (
    <div
      className={rootClassName}
      data-launch-screen="booting"
      role="status"
      aria-live="polite"
      aria-label={`Tuckmark ${statusText}`}
    >
      <div className="tm-launch-stage">
        <div
          className="tm-launch-ambient tm-launch-ambient--left"
          aria-hidden="true"
        />
        <div
          className="tm-launch-ambient tm-launch-ambient--right"
          aria-hidden="true"
        />
        <div className="tm-launch-wave" aria-hidden="true" />
        <div className="tm-launch-grid" aria-hidden="true" />
        <div
          className="tm-launch-register tm-launch-register--top-left"
          aria-hidden="true"
        />
        <div
          className="tm-launch-register tm-launch-register--top-right"
          aria-hidden="true"
        />
        <div
          className="tm-launch-register tm-launch-register--bottom-right"
          aria-hidden="true"
        />

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
                className="tm-launch-progress-rail"
                role="progressbar"
                aria-label={`${statusText} 进度`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={safeProgress}
                aria-valuetext={`${completedSteps} / ${steps.length} 启动阶段已完成`}
              >
                <div
                  className="tm-launch-progress-fill"
                  style={{ width: `${safeProgress}%` }}
                />
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

            <div className="tm-launch-checklist">
              {steps.map((step) => (
                <div
                  key={step.id ?? step.label}
                  className={`tm-launch-checklist-item tm-launch-checklist-item--${step.state}`}
                >
                  <span
                    className={`tm-launch-checklist-dot tm-launch-checklist-dot--${step.state}`}
                  />
                  <span className="tm-launch-checklist-text">{step.label}</span>
                  <span
                    className={`tm-launch-checklist-state tm-launch-checklist-state--${step.state}`}
                  >
                    {describeStepState(step.state)}
                  </span>
                </div>
              ))}
            </div>

            <div className="tm-launch-ticket">
              <div className="tm-launch-ticket-grid" />
              <div className="tm-launch-ticket-code" />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
