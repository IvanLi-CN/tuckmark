import { restoreSpaRedirectLocation } from "./spa-fallback.js"
import { preloadWorkbenchRoute } from "./workbench-route-registry.js"

declare global {
  interface Window {
    __tuckmarkLaunchShell?: {
      setPhase: (
        phaseId: "bootstrap-loaded" | "current-route-chunk-ready" | "current-route-data-ready"
      ) => void
    }
  }
}

const rootElement = document.getElementById("root")
if (rootElement) {
  restoreSpaRedirectLocation()
  window.__tuckmarkLaunchShell?.setPhase("current-route-chunk-ready")
  void Promise.all([
    import("./app-runtime.js"),
    preloadWorkbenchRoute(window.location.pathname).catch(() => false),
  ]).then(([runtimeModule, currentRouteChunkReady]) => {
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
  })
}
