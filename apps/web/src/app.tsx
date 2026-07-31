import React from "react"

import {
  createAgentImportDemoClient,
  createAgentImportDemoSession,
} from "./agent-import-demo-data.js"
import { AgentImportPage } from "./agent-import-page.js"
import type { ApiClient } from "./api-client.js"
import { AppLaunchSplash } from "./app-launch-splash.js"
import type { AppContext } from "./types.js"

const LazyWorkbenchApp = React.lazy(async () => {
  const module = await import("./workbench-app.js")
  return { default: module.WorkbenchApp }
})

export type AppBootstrapState = {
  currentRouteChunkReady?: boolean
}

export type AppProps = {
  client?: ApiClient
  context?: AppContext
  bootstrapState?: AppBootstrapState
}

export function resolveAppRoutePathname(pathname: string, basePath = ""): string {
  const normalizedBasePath = basePath.replace(/\/+$/u, "")
  if (
    normalizedBasePath &&
    (pathname === normalizedBasePath || pathname.startsWith(`${normalizedBasePath}/`))
  ) {
    return pathname.slice(normalizedBasePath.length) || "/"
  }
  return pathname
}

export function App(props: AppProps = {}) {
  const pathname =
    typeof window === "undefined"
      ? ""
      : resolveAppRoutePathname(window.location.pathname, props.context?.basePath)
  if (/^\/agent-import\/[^/]+/u.test(pathname)) {
    if (
      pathname === "/agent-import/demo" &&
      new URLSearchParams(window.location.search).get("ui_demo") === "1"
    ) {
      return (
        <AgentImportPage
          sessionId="demo-agent-import-session"
          initialSession={createAgentImportDemoSession()}
          client={createAgentImportDemoClient()}
        />
      )
    }
    return <AgentImportPage />
  }
  return (
    <React.Suspense fallback={<AppLaunchSplash />}>
      <LazyWorkbenchApp {...props} startupShell="auto" />
    </React.Suspense>
  )
}
