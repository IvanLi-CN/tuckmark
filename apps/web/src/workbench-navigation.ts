import { useNavigate, useRouterState } from "@tanstack/react-router"
import React from "react"

import { preloadWorkbenchRoute } from "./workbench-route-registry.js"

type WorkbenchNavigateOptions = {
  replace?: boolean
}

type PrimedWorkbenchLocation = {
  previousHref: string
  previousState: unknown
  targetHref: string
}

function createPrimedHistoryKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function createPrimedWorkbenchHistoryState(previousState: unknown, replace?: boolean) {
  const baseState =
    previousState && typeof previousState === "object"
      ? { ...(previousState as Record<string, unknown>) }
      : {}
  const previousIndex =
    typeof baseState.__TSR_index === "number" && Number.isFinite(baseState.__TSR_index)
      ? baseState.__TSR_index
      : 0
  const key = createPrimedHistoryKey()

  return {
    ...baseState,
    key,
    __TSR_key: key,
    __TSR_index: replace ? previousIndex : previousIndex + 1,
  }
}

function primeWorkbenchBrowserLocation(
  to: string,
  options?: WorkbenchNavigateOptions
): PrimedWorkbenchLocation | null {
  if (typeof window === "undefined") {
    return null
  }

  const targetUrl = new URL(to, window.location.origin)
  const targetHref = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`
  const previousHref = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (targetHref === previousHref) {
    return null
  }

  const previousState = window.history.state
  const mutateHistory = options?.replace ? window.history.replaceState : window.history.pushState
  mutateHistory.call(
    window.history,
    createPrimedWorkbenchHistoryState(previousState, options?.replace),
    "",
    targetHref
  )

  return {
    previousHref,
    previousState,
    targetHref,
  }
}

export function useWorkbenchNavigate() {
  const navigate = useNavigate()

  return React.useCallback(
    async (to: string, options?: WorkbenchNavigateOptions) => {
      void preloadWorkbenchRoute(to).catch(() => undefined)
      const primedLocation = primeWorkbenchBrowserLocation(to, options)
      try {
        await navigate({
          href: to,
          replace: primedLocation ? true : options?.replace,
        })
      } catch (error) {
        if (
          primedLocation &&
          typeof window !== "undefined" &&
          `${window.location.pathname}${window.location.search}${window.location.hash}` ===
            primedLocation.targetHref
        ) {
          window.history.replaceState(primedLocation.previousState, "", primedLocation.previousHref)
        }
        throw error
      }
    },
    [navigate]
  )
}

export function useWorkbenchPathname() {
  return useRouterState({
    select: (state) => state.location.pathname,
  })
}

export function useWorkbenchHref() {
  return useRouterState({
    select: (state) => state.location.href,
  })
}

export function useWorkbenchSearchParams() {
  const href = useWorkbenchHref()
  return React.useMemo(() => new URL(href, "https://tuckmark.local").searchParams, [href])
}
