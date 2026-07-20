import { useNavigate, useRouterState } from "@tanstack/react-router"
import React from "react"

type WorkbenchNavigateOptions = {
  replace?: boolean
}

export function useWorkbenchNavigate() {
  const navigate = useNavigate()

  return React.useCallback(
    async (to: string, options?: WorkbenchNavigateOptions) => {
      await navigate({
        href: to,
        replace: options?.replace,
      })
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
