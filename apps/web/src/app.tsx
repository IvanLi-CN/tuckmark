import type { ApiClient } from "./api-client.js"
import type { AppContext } from "./types.js"
import { WorkbenchApp } from "./workbench-app.js"

export type AppBootstrapState = {
  currentRouteChunkReady?: boolean
}

export type AppProps = {
  client?: ApiClient
  context?: AppContext
  bootstrapState?: AppBootstrapState
}

export function App(props: AppProps = {}) {
  return <WorkbenchApp {...props} startupShell="auto" />
}
