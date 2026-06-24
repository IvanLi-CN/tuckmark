import React from "react"
import ReactDOM from "react-dom/client"

import { App } from "./app.js"
import { restoreSpaRedirectLocation } from "./spa-fallback.js"
import "./styles.css"

export function mountApp(element: HTMLElement, useStrictMode = true) {
  const root = ReactDOM.createRoot(element)
  root.render(
    useStrictMode ? (
      <React.StrictMode>
        <App />
      </React.StrictMode>
    ) : (
      <App />
    )
  )
  return root
}

const rootElement = document.getElementById("root")
if (rootElement) {
  restoreSpaRedirectLocation()
  mountApp(rootElement, true)
}
