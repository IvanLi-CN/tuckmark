import React from "react"

import {
  createAgentImportDemoClient,
  createAgentImportDemoSession,
} from "./agent-import-demo-data.js"
import { AgentImportPage } from "./agent-import-page.js"
import type { ApiClient } from "./api-client.js"
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

export function App(props: AppProps = {}) {
  if (typeof window !== "undefined" && /^\/agent-import\/[^/]+/u.test(window.location.pathname)) {
    if (
      window.location.pathname === "/agent-import/demo" &&
      new URLSearchParams(window.location.search).get("ui_demo") === "1"
    ) {
      return (
        <AgentImportPage
          sessionId="demo-agent-import-session"
          initialSession={createAgentImportDemoSession()}
          client={createAgentImportDemoClient()}
          localTemplatesLoader={async () => []}
        />
      )
    }
    return <AgentImportPage />
  }
  return (
    <React.Suspense fallback={null}>
      <LazyWorkbenchApp {...props} startupShell="auto" />
    </React.Suspense>
  )
}
