import { QueryClient, queryOptions } from "@tanstack/react-query"

import {
  type LoadedCanvasRouteData,
  loadCanvasRouteData,
  resolveCanvasSource,
} from "./canvas-route-data.js"
import { isDraftProcessingPath } from "./draft-processing-route.js"
import type { AppContext, CanvasDraftSource, UserTemplateSummary } from "./types.js"
import { listArchivedUserTemplates, listUserTemplates } from "./user-template-store.js"

const WORKBENCH_QUERY_GC_TIME_MS = 30 * 60 * 1000
const WORKBENCH_QUERY_STALE_TIME_MS = 15 * 1000

type WorkbenchCacheScope = Pick<AppContext, "mode" | "surface">

export function createWorkbenchQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: WORKBENCH_QUERY_GC_TIME_MS,
        staleTime: WORKBENCH_QUERY_STALE_TIME_MS,
        retry: 0,
        refetchOnWindowFocus: false,
      },
    },
  })
}

function getWorkbenchScopeKey(context: WorkbenchCacheScope, runtimeDataGeneration = 0) {
  return ["workbench", context.surface, context.mode, runtimeDataGeneration] as const
}

export function getUserTemplatesQueryKey(context: WorkbenchCacheScope, runtimeDataGeneration = 0) {
  return [...getWorkbenchScopeKey(context, runtimeDataGeneration), "user-templates"] as const
}

export function getArchivedUserTemplatesQueryKey(
  context: WorkbenchCacheScope,
  runtimeDataGeneration = 0
) {
  return [
    ...getWorkbenchScopeKey(context, runtimeDataGeneration),
    "archived-user-templates",
  ] as const
}

function getCanvasRouteSourceKey(source: CanvasDraftSource) {
  switch (source.kind) {
    case "user-template":
      return ["user-template", source.templateId] as const
    case "preset-template":
      return ["preset-template", source.presetId] as const
    default:
      return ["scratch", source.presetId] as const
  }
}

export function getCanvasRouteDataQueryKey(
  context: WorkbenchCacheScope,
  source: CanvasDraftSource,
  runtimeDataGeneration = 0
) {
  return [
    ...getWorkbenchScopeKey(context, runtimeDataGeneration),
    "canvas-route",
    ...getCanvasRouteSourceKey(source),
  ] as const
}

export function userTemplatesQueryOptions(context: WorkbenchCacheScope, runtimeDataGeneration = 0) {
  return queryOptions({
    queryKey: getUserTemplatesQueryKey(context, runtimeDataGeneration),
    queryFn: async (): Promise<UserTemplateSummary[]> => listUserTemplates(),
    placeholderData: (previous) => previous,
  })
}

export function archivedUserTemplatesQueryOptions(
  context: WorkbenchCacheScope,
  runtimeDataGeneration = 0
) {
  return queryOptions({
    queryKey: getArchivedUserTemplatesQueryKey(context, runtimeDataGeneration),
    queryFn: async (): Promise<UserTemplateSummary[]> => listArchivedUserTemplates(),
    placeholderData: (previous) => previous,
  })
}

export function canvasRouteDataQueryOptions(
  context: WorkbenchCacheScope,
  source: CanvasDraftSource,
  runtimeDataGeneration = 0
) {
  return queryOptions({
    queryKey: getCanvasRouteDataQueryKey(context, source, runtimeDataGeneration),
    queryFn: async (): Promise<LoadedCanvasRouteData> => loadCanvasRouteData(source),
  })
}

export async function preloadWorkbenchRouteData(args: {
  context: WorkbenchCacheScope
  pathname: string
  queryClient: QueryClient
}): Promise<void> {
  const pathnameWithSearch = args.pathname
  const targetUrl = new URL(pathnameWithSearch, "https://tuckmark.local")
  const normalizedPath = targetUrl.pathname.replace(/\/+$/, "") || "/"

  if (normalizedPath.endsWith("/templates")) {
    await args.queryClient.ensureQueryData(userTemplatesQueryOptions(args.context))
    return
  }

  if (normalizedPath.endsWith("/system")) {
    await args.queryClient.ensureQueryData(archivedUserTemplatesQueryOptions(args.context))
    return
  }

  if (normalizedPath.endsWith("/canvas") || isDraftProcessingPath(normalizedPath)) {
    const routeSource = resolveCanvasSource(targetUrl.searchParams)
    await args.queryClient.ensureQueryData(canvasRouteDataQueryOptions(args.context, routeSource))
  }
}
