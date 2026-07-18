import React from "react"

type DeferredWorkbenchRouteModule = {
  default: React.ComponentType<any>
}

export const DEFERRED_WORKBENCH_ROUTE_PATHS = ["/templates", "/canvas", "/system"] as const
type DeferredWorkbenchRoutePath = (typeof DEFERRED_WORKBENCH_ROUTE_PATHS)[number]

type DeferredWorkbenchRouteStore<TModule extends DeferredWorkbenchRouteModule> = {
  listeners: Set<() => void>
  loader: () => Promise<TModule>
  module: TModule | null
  promise: Promise<TModule> | null
}

type TemplatesRouteModule = typeof import("./workbench-templates-route.js")
type CanvasRouteModule = typeof import("./workbench-canvas-route.js")
type SystemRouteModule = typeof import("./workbench-system-route.js")

function createDeferredWorkbenchRouteStore<TModule extends DeferredWorkbenchRouteModule>(
  loader: () => Promise<TModule>
): DeferredWorkbenchRouteStore<TModule> {
  return {
    listeners: new Set(),
    loader,
    module: null,
    promise: null,
  }
}

const templatesRouteStore = createDeferredWorkbenchRouteStore<TemplatesRouteModule>(
  () => import("./workbench-templates-route.js")
)
const canvasRouteStore = createDeferredWorkbenchRouteStore<CanvasRouteModule>(
  () => import("./workbench-canvas-route.js")
)
const systemRouteStore = createDeferredWorkbenchRouteStore<SystemRouteModule>(
  () => import("./workbench-system-route.js")
)

function notifyDeferredWorkbenchRouteStore(
  store: DeferredWorkbenchRouteStore<DeferredWorkbenchRouteModule>
): void {
  for (const listener of store.listeners) {
    listener()
  }
}

function loadDeferredWorkbenchRouteStore<TModule extends DeferredWorkbenchRouteModule>(
  store: DeferredWorkbenchRouteStore<TModule>
): Promise<TModule> {
  if (store.module) {
    return Promise.resolve(store.module)
  }
  if (store.promise) {
    return store.promise
  }

  const routePromise = store.loader().then((routeModule) => {
    store.module = routeModule
    notifyDeferredWorkbenchRouteStore(store)
    return routeModule
  })

  store.promise = routePromise.finally(() => {
    if (store.promise === routePromise) {
      store.promise = null
    }
  })

  return routePromise
}

function resolveDeferredWorkbenchRouteStore(
  pathname: DeferredWorkbenchRoutePath
): DeferredWorkbenchRouteStore<DeferredWorkbenchRouteModule> {
  switch (pathname) {
    case "/templates":
      return templatesRouteStore
    case "/canvas":
      return canvasRouteStore
    case "/system":
      return systemRouteStore
  }
}

function getDeferredWorkbenchRouteModule(
  pathname: DeferredWorkbenchRoutePath
): DeferredWorkbenchRouteModule | null {
  return resolveDeferredWorkbenchRouteStore(pathname).module
}

export function normalizeWorkbenchRoutePath(
  pathname: string
): "/" | "/templates" | "/canvas" | "/system" {
  const pathnameOnly = pathname.split(/[?#]/u)[0] ?? pathname
  const normalized = pathnameOnly.replace(/\/+$/, "") || "/"
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

export function useDeferredWorkbenchRouteModule(
  pathname: DeferredWorkbenchRoutePath
): DeferredWorkbenchRouteModule | null {
  const routeStore = resolveDeferredWorkbenchRouteStore(pathname)
  return React.useSyncExternalStore(
    (listener) => {
      routeStore.listeners.add(listener)
      return () => {
        routeStore.listeners.delete(listener)
      }
    },
    () => getDeferredWorkbenchRouteModule(pathname),
    () => getDeferredWorkbenchRouteModule(pathname)
  )
}

export function isDeferredWorkbenchRouteModuleReady(pathname: string): boolean {
  const routePath = normalizeWorkbenchRoutePath(pathname)
  if (routePath === "/") {
    return true
  }
  return getDeferredWorkbenchRouteModule(routePath) !== null
}

export function preloadWorkbenchRoute(pathname: string): Promise<boolean> {
  const routePath = normalizeWorkbenchRoutePath(pathname)
  switch (routePath) {
    case "/templates":
      return loadDeferredWorkbenchRouteStore(templatesRouteStore).then(() => true)
    case "/canvas":
      return loadDeferredWorkbenchRouteStore(canvasRouteStore).then(() => true)
    case "/system":
      return loadDeferredWorkbenchRouteStore(systemRouteStore).then(() => true)
    default:
      return Promise.resolve(true)
  }
}

export async function prepareWorkbenchRouteNavigation(pathname: string): Promise<void> {
  const routePath = normalizeWorkbenchRoutePath(pathname)
  switch (routePath) {
    case "/templates":
      await loadDeferredWorkbenchRouteStore(templatesRouteStore)
      return
    case "/canvas": {
      const routeModule = await loadDeferredWorkbenchRouteStore(canvasRouteStore)
      await routeModule.preloadCanvasRouteNavigation?.(pathname)
      return
    }
    case "/system":
      await loadDeferredWorkbenchRouteStore(systemRouteStore)
      return
    default:
      return
  }
}

export function preloadDeferredWorkbenchRoutes(): Promise<void> {
  return Promise.all(
    DEFERRED_WORKBENCH_ROUTE_PATHS.map((routePath) => preloadWorkbenchRoute(routePath))
  ).then(() => undefined)
}
