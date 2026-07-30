import type { AppLaunchSplashStep } from "./app-launch-splash.js"

export type StartupTaskId =
  | "bootstrap-loaded"
  | "current-route-chunk-ready"
  | "current-route-data-ready"
  | "offline-readiness"

export type StartupTaskState = "pending" | "active" | "complete"

export type OfflineReadinessStatus = "unsupported" | "idle" | "pending" | "complete" | "error"

export type WorkbenchHydrationState = {
  shellReady: boolean
  currentRouteReady: boolean
  deferredHydrationPending: boolean
  offlineReadinessPending: boolean
  offlineReadinessStatus: OfflineReadinessStatus
}

const STARTUP_TASK_LABELS: Record<StartupTaskId, string> = {
  "bootstrap-loaded": "启动运行时引导",
  "current-route-chunk-ready": "装载当前页面模块",
  "current-route-data-ready": "准备当前页面状态",
  "offline-readiness": "验证离线版本完整性",
}

function resolveOfflineReadinessTaskState(status: OfflineReadinessStatus): StartupTaskState {
  if (status === "complete" || status === "unsupported") {
    return "complete"
  }
  if (status === "pending") {
    return "active"
  }
  return "pending"
}

export function buildStartupTaskSteps(args: {
  currentRouteChunkReady: boolean
  currentRouteDataReady: boolean
  offlineReadinessStatus: OfflineReadinessStatus
}): readonly AppLaunchSplashStep[] {
  const bootstrapLoaded = true
  return [
    {
      id: "bootstrap-loaded",
      label: STARTUP_TASK_LABELS["bootstrap-loaded"],
      state: bootstrapLoaded ? "complete" : "pending",
    },
    {
      id: "current-route-chunk-ready",
      label: STARTUP_TASK_LABELS["current-route-chunk-ready"],
      state: args.currentRouteChunkReady ? "complete" : "active",
    },
    {
      id: "current-route-data-ready",
      label: STARTUP_TASK_LABELS["current-route-data-ready"],
      state: args.currentRouteDataReady
        ? "complete"
        : args.currentRouteChunkReady
          ? "active"
          : "pending",
    },
    {
      id: "offline-readiness",
      label: STARTUP_TASK_LABELS["offline-readiness"],
      state: resolveOfflineReadinessTaskState(args.offlineReadinessStatus),
    },
  ] satisfies readonly AppLaunchSplashStep[]
}

export function buildStartupSplashState(args: {
  currentRouteChunkReady: boolean
  currentRouteDataReady: boolean
  offlineReadinessStatus: OfflineReadinessStatus
  deferredHydrationPending: boolean
}) {
  const steps = buildStartupTaskSteps(args)
  const completedStepCount = steps.filter((step) => step.state === "complete").length
  const progressPercent = Math.round((completedStepCount / steps.length) * 100)

  if (!args.currentRouteChunkReady) {
    return {
      detailText: "正在启动运行环境并装载当前页面。",
      progressPercent,
      statusText: "正在准备工作台",
      steps,
    }
  }

  if (!args.currentRouteDataReady) {
    return {
      detailText: "当前页面就绪后会立即进入，其他资产会在后台静默补齐。",
      progressPercent,
      statusText: "正在准备工作台",
      steps,
    }
  }

  if (args.offlineReadinessStatus === "pending") {
    return {
      detailText: "工作台已可用，正在后台确认离线版本完整性。",
      progressPercent,
      statusText: "正在进入工作台",
      steps,
    }
  }

  if (args.deferredHydrationPending) {
    return {
      detailText: "工作台已可用，离线版本会在后台准备。",
      progressPercent,
      statusText: "正在进入工作台",
      steps,
    }
  }

  return {
    detailText: "工作台已完成首屏准备。",
    progressPercent: 100,
    statusText: "工作台已就绪",
    steps,
  }
}
