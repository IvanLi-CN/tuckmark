import React from "react"
import { type NavigateOptions, useNavigate } from "react-router-dom"

import {
  preloadWorkbenchRoute,
  prepareWorkbenchRouteNavigation,
} from "./workbench-route-registry.js"

export function preloadWorkbenchNavigationIntent(pathname: string): void {
  void preloadWorkbenchRoute(pathname).catch(() => undefined)
}

export function useWorkbenchNavigate() {
  const navigate = useNavigate()

  return React.useCallback(
    async (to: string, options?: NavigateOptions) => {
      await prepareWorkbenchRouteNavigation(to).catch(() => undefined)
      React.startTransition(() => {
        navigate(to, options)
      })
    },
    [navigate]
  )
}
