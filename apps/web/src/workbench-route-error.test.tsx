// @vitest-environment jsdom

import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { describeWorkbenchRouteError, WorkbenchRouteErrorPanel } from "./workbench-route-error.js"

let mountedRoot: ReturnType<typeof ReactDOM.createRoot> | null = null

afterEach(async () => {
  await act(async () => {
    mountedRoot?.unmount()
  })
  mountedRoot = null
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("workbench route error panel", () => {
  it("maps chunk load failures to customized owner-facing copy", () => {
    expect(
      describeWorkbenchRouteError(
        new Error(
          "Failed to fetch dynamically imported module: http://127.0.0.1:23620/src/workbench-templates-route.tsx"
        )
      )
    ).toMatchObject({
      title: "页面暂时没有加载出来",
    })
  })

  it("renders customized error UI without the default router copy", async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const rootElement = document.getElementById("root")
    if (!rootElement) {
      throw new Error("Missing root element")
    }

    await act(async () => {
      mountedRoot = ReactDOM.createRoot(rootElement)
      mountedRoot.render(
        <WorkbenchRouteErrorPanel
          error={
            new Error(
              "Failed to fetch dynamically imported module: http://127.0.0.1:23620/src/workbench-templates-route.tsx"
            )
          }
          onReload={() => undefined}
          onRetry={() => undefined}
          pathLabel="/templates"
        />
      )
    })

    expect(document.body.textContent).toContain("页面暂时没有加载出来")
    expect(document.body.textContent).toContain("你可以尝试")
    expect(document.body.textContent).toContain("重试当前页面")
    expect(document.body.textContent).toContain("返回主页")
    expect(document.body.textContent).toContain("刷新应用")
    expect(document.body.textContent).not.toContain("Something went wrong!")
    expect(document.body.textContent).not.toContain("开发服务重启")
    expect(document.body.textContent).not.toContain("切换分支")
    expect(document.body.textContent).not.toContain("热更新中断")
    expect(document.body.textContent).not.toContain("查看技术细节")
    expect(document.querySelector('[role="alert"]')?.getAttribute("aria-label")).toBe(
      "页面加载失败"
    )
  })
})
