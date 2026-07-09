// @vitest-environment jsdom

import { AlertCircle } from "lucide-react"
import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import { Alert, AlertDescription, AlertTitle } from "./alert.js"

let mountedRoot: ReturnType<typeof ReactDOM.createRoot> | null = null

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function flush(times = 2): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

async function renderNode(node: React.ReactNode) {
  document.body.innerHTML = '<div id="root"></div>'
  const rootElement = document.getElementById("root")
  if (!rootElement) {
    throw new Error("Missing root element")
  }

  await act(async () => {
    mountedRoot = ReactDOM.createRoot(rootElement)
    mountedRoot.render(node)
    await flush()
  })
}

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => {
      mountedRoot?.unmount()
      await flush()
    })
  }
  mountedRoot = null
  document.body.innerHTML = ""
})

describe("Alert", () => {
  it("keeps title and description in the content column beside the icon", async () => {
    await renderNode(
      <Alert data-testid="alert" variant="destructive">
        <AlertCircle data-testid="alert-icon" className="size-4" />
        <AlertTitle data-testid="alert-title">数据矩阵码内容为空</AlertTitle>
        <AlertDescription data-testid="alert-description">
          请输入要编码的文本后再继续。
        </AlertDescription>
      </Alert>
    )

    const alert = document.querySelector("[data-testid='alert']")
    const title = document.querySelector("[data-testid='alert-title']")
    const description = document.querySelector("[data-testid='alert-description']")

    expect(alert?.className).toContain("grid-cols-[0_minmax(0,1fr)]")
    expect(alert?.className).toContain("has-[>svg]:grid-cols-[auto_minmax(0,1fr)]")
    expect(alert?.className).toContain("[&>svg]:row-span-2")
    expect(title?.className).toContain("col-start-2")
    expect(description?.className).toContain("col-start-2")
    expect(description?.className).toContain("min-w-0")
  })
})
