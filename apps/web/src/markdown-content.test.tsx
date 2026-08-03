// @vitest-environment jsdom

import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import { MarkdownContent } from "./markdown-content.js"

let mountedRoot: ReturnType<typeof ReactDOM.createRoot> | null = null

async function renderNode(node: React.ReactNode) {
  document.body.innerHTML = '<div id="root"></div>'
  const rootElement = document.getElementById("root")
  if (!rootElement) {
    throw new Error("Missing root element")
  }
  await act(async () => {
    mountedRoot = ReactDOM.createRoot(rootElement)
    mountedRoot.render(node)
  })
}

afterEach(async () => {
  await act(async () => {
    mountedRoot?.unmount()
  })
  mountedRoot = null
  document.body.innerHTML = ""
})

describe("MarkdownContent", () => {
  it("renders Markdown without accepting raw HTML", async () => {
    await renderNode(
      <MarkdownContent
        value={
          "## 电气特性\n\n- 输入范围：4.5V 至 28V\n- [制造商页面](https://manufacturer.example/device)\n\n<script>unsafe()</script>"
        }
      />
    )

    expect(document.querySelector("h2")?.textContent).toBe("电气特性")
    expect(document.querySelectorAll("li")).toHaveLength(2)
    const link = document.querySelector("a")
    expect(link?.getAttribute("href")).toBe("https://manufacturer.example/device")
    expect(link?.getAttribute("target")).toBe("_blank")
    expect(document.querySelector("script")).toBeNull()
    expect(document.body.textContent).not.toContain("unsafe()")
  })

  it("shows the empty state for legacy records without a detail string", async () => {
    await renderNode(<MarkdownContent value={undefined} />)

    expect(document.body.textContent).toContain("未填写设备详细信息。")
  })
})
