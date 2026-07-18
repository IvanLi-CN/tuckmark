import type { AppLaunchSplashStep } from "./app-launch-splash.js"

export type StartupTaskId =
  | "bootstrap-loaded"
  | "current-route-chunk-ready"
  | "current-route-data-ready"
  | "offline-warmup"

export type StartupTaskState = "pending" | "active" | "complete"

export type OfflineWarmupStatus = "unsupported" | "idle" | "pending" | "complete" | "error"

export type WorkbenchHydrationState = {
  shellReady: boolean
  currentRouteReady: boolean
  deferredHydrationPending: boolean
  offlineWarmupPending: boolean
  offlineWarmupStatus: OfflineWarmupStatus
}

const STARTUP_TASK_LABELS: Record<StartupTaskId, string> = {
  "bootstrap-loaded": "启动运行时引导",
  "current-route-chunk-ready": "装载当前页面模块",
  "current-route-data-ready": "准备当前页面状态",
  "offline-warmup": "补齐离线资源缓存",
}

function resolveWarmupTaskState(status: OfflineWarmupStatus): StartupTaskState {
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
  offlineWarmupStatus: OfflineWarmupStatus
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
      id: "offline-warmup",
      label: STARTUP_TASK_LABELS["offline-warmup"],
      state: resolveWarmupTaskState(args.offlineWarmupStatus),
    },
  ] satisfies readonly AppLaunchSplashStep[]
}

export function buildStartupSplashState(args: {
  currentRouteChunkReady: boolean
  currentRouteDataReady: boolean
  offlineWarmupStatus: OfflineWarmupStatus
  deferredHydrationPending: boolean
}) {
  const steps = buildStartupTaskSteps(args)
  const completedStepCount = steps.filter((step) => step.state === "complete").length
  const progressPercent = Math.round((completedStepCount / steps.length) * 100)

  if (!args.currentRouteChunkReady) {
    return {
      detailText: "正在预载当前页面模块，准备进入工作台。",
      progressPercent,
      statusText: "正在装载当前页面模块",
      steps,
    }
  }

  if (!args.currentRouteDataReady) {
    return {
      detailText: "正在准备当前页面所需的最小运行时状态。",
      progressPercent,
      statusText: "正在准备当前页面状态",
      steps,
    }
  }

  if (args.offlineWarmupStatus === "pending") {
    return {
      detailText: "已进入工作台，正在后台补齐离线资源缓存。",
      progressPercent,
      statusText: "正在补齐离线资源缓存",
      steps,
    }
  }

  if (args.deferredHydrationPending) {
    return {
      detailText: "已进入工作台，正在后台补齐模板、设置与最近状态。",
      progressPercent,
      statusText: "正在后台补齐完整资产",
      steps,
    }
  }

  return {
    detailText: "正在进入打印工作台。",
    progressPercent: 100,
    statusText: "启动完成",
    steps,
  }
}
