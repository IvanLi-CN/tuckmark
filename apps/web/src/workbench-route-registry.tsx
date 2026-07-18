import React from "react"

const loadTemplatesRoute = () => import("./workbench-templates-route.js")
const loadCanvasRoute = () => import("./workbench-canvas-route.js")
const loadSystemRoute = () => import("./workbench-system-route.js")

export const LazyTemplatesRoute = React.lazy(loadTemplatesRoute)
export const LazyCanvasRoute = React.lazy(loadCanvasRoute)
export const LazySystemRoute = React.lazy(loadSystemRoute)

export function normalizeWorkbenchRoutePath(
  pathname: string
): "/" | "/templates" | "/canvas" | "/system" {
  const normalized = pathname.replace(/\/+$/, "") || "/"
  if (normalized.endsWith("/templates")) {
    return "/templates"
  }
  if (normalized.endsWith("/canvas")) {
    return "/canvas"
  }
  if (normalized.endsWith("/system")) {
    return "/system"
  }
  return "/"
}

export function preloadWorkbenchRoute(pathname: string): Promise<boolean> {
  const routePath = normalizeWorkbenchRoutePath(pathname)
  switch (routePath) {
    case "/templates":
      return loadTemplatesRoute().then(() => true)
    case "/canvas":
      return loadCanvasRoute().then(() => true)
    case "/system":
      return loadSystemRoute().then(() => true)
    case "/":
    default:
      return Promise.resolve(true)
  }
}
