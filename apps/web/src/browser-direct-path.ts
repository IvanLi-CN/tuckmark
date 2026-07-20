import type { AppMode, PrintPathState } from "./types.js"

export type DetongerWasmStatus = {
  available: boolean
  reason: string | null
}

const FALLBACK_UNAVAILABLE_MESSAGE =
  "浏览器直连打印依赖 detonger-wasm 当前不可用。恢复依赖后重新启动 dev/build。"

export function resolveConfiguredBrowserDirectPathState(
  mode: AppMode,
  browserDirectEnabled: boolean,
  detongerWasmStatus: DetongerWasmStatus
): PrintPathState {
  if (mode === "demo") {
    return "mocked"
  }
  if (!browserDirectEnabled) {
    return "disabled"
  }
  return detongerWasmStatus.available ? "available" : "unavailable"
}

export function resolveEffectiveBrowserDirectPathState(
  state: PrintPathState,
  mode: AppMode,
  browserPrintSupported: boolean
): PrintPathState {
  if (mode === "demo") {
    return "mocked"
  }
  if (state !== "available") {
    return state
  }
  return browserPrintSupported ? "available" : "unsupported"
}

export function getDetongerWasmUnavailableMessage(reason?: string | null): string {
  const normalized = reason?.trim()
  return normalized && normalized.length > 0 ? normalized : FALLBACK_UNAVAILABLE_MESSAGE
}

export function getBrowserDirectPathStateMessage(
  state: PrintPathState,
  unavailableReason?: string | null
): string {
  switch (state) {
    case "disabled":
      return "浏览器直连打印链路已被产品开关关闭。"
    case "mocked":
      return "Demo mode 不触发真实硬件连接。"
    case "unsupported":
      return "当前浏览器不支持 Web Bluetooth，无法使用浏览器直连打印。"
    case "unavailable":
      return getDetongerWasmUnavailableMessage(unavailableReason)
    case "available":
      return "浏览器直连打印链路可用。"
  }
}

export function getPrintPathStateTone(state: PrintPathState): "ok" | "warn" | "muted" {
  switch (state) {
    case "available":
      return "ok"
    case "mocked":
    case "unsupported":
    case "unavailable":
      return "warn"
    case "disabled":
      return "muted"
  }
}

export function formatPrintPathStateLabel(state: PrintPathState, locale: "en" | "zh"): string {
  if (locale === "zh") {
    switch (state) {
      case "available":
        return "已启用"
      case "disabled":
        return "已关闭"
      case "mocked":
        return "演示模拟"
      case "unsupported":
        return "浏览器不支持"
      case "unavailable":
        return "依赖未就绪"
    }
  }

  return state
}
