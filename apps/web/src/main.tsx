import { restoreSpaRedirectLocation } from "./spa-fallback.js"
import { preloadWorkbenchRoute } from "./workbench-route-registry.js"

const rootElement = document.getElementById("root")
if (rootElement) {
  restoreSpaRedirectLocation()
  void Promise.all([
    import("./app-runtime.js"),
    preloadWorkbenchRoute(window.location.pathname).catch(() => false),
  ]).then(([runtimeModule, currentRouteChunkReady]) => {
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
