import React from "react"
import ReactDOM from "react-dom/client"

import { App, type AppProps } from "./app.js"
import "./runtime-core-fonts.css"
import "./styles.css"

export function mountApp(element: HTMLElement, props: AppProps = {}, useStrictMode = true) {
  const root = ReactDOM.createRoot(element)
  root.render(
    useStrictMode ? (
      <React.StrictMode>
        <App {...props} />
      </React.StrictMode>
    ) : (
      <App {...props} />
    )
  )
  return root
}
