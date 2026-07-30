import { restoreSpaRedirectLocation } from "./spa-fallback.js"
import { preloadWorkbenchRoute } from "./workbench-route-registry.js"

declare global {
  interface Window {
    __tuckmarkLaunchShell?: {
      setPhase: (
        phaseId: "bootstrap-loaded" | "current-route-chunk-ready" | "current-route-data-ready"
      ) => void
      markMounted: () => void
      fail: () => void
    }
  }
}

const rootElement = document.getElementById("root")
if (rootElement) {
  void (async () => {
    restoreSpaRedirectLocation()
    window.__tuckmarkLaunchShell?.setPhase("current-route-chunk-ready")
    const [runtimeModule, currentRouteChunkReady] = await Promise.all([
      import("./app-runtime.js"),
      preloadWorkbenchRoute(window.location.pathname).catch(() => false),
    ])
    if (currentRouteChunkReady) {
      window.__tuckmarkLaunchShell?.setPhase("current-route-data-ready")
    }
    runtimeModule.mountApp(
      rootElement,
      {
        bootstrapState: {
          currentRouteChunkReady,
        },
      },
      true
    )
    window.__tuckmarkLaunchShell?.markMounted()
  })().catch(() => {
    window.__tuckmarkLaunchShell?.fail()
  })
}
