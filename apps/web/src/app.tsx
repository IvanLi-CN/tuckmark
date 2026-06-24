import type { ApiClient } from "./api-client.js"
import type { AppContext } from "./types.js"
import { WorkbenchApp } from "./workbench-app.js"

export type AppProps = {
  client?: ApiClient
  context?: AppContext
}

export function App(props: AppProps = {}) {
  return <WorkbenchApp {...props} />
}
