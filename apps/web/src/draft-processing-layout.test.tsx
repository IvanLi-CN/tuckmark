// @vitest-environment jsdom

import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DraftProcessingLayout } from "./draft-processing-layout.js"

let mountedRoot: ReturnType<typeof ReactDOM.createRoot> | null = null
const originalOpenerDescriptor = Object.getOwnPropertyDescriptor(window, "opener")

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => {
      mountedRoot?.unmount()
      await flush()
    })
  }
  mountedRoot = null
  document.body.innerHTML = ""
  if (originalOpenerDescriptor) {
    Object.defineProperty(window, "opener", originalOpenerDescriptor)
  } else {
    delete (window as Window & { opener?: Window | null }).opener
  }
  vi.restoreAllMocks()
})

describe("DraftProcessingLayout", () => {
  it("has one application exit that closes the processing tab", async () => {
    const closeWindow = vi.spyOn(window, "close").mockImplementation(() => undefined)
    const focusOpener = vi.fn()
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: { closed: false, focus: focusOpener },
    })
    document.body.innerHTML = '<div id="root"></div>'
    const rootElement = document.getElementById("root")
    if (!rootElement) {
      throw new Error("Missing root element")
    }

    await act(async () => {
      mountedRoot = ReactDOM.createRoot(rootElement)
      mountedRoot.render(
        <DraftProcessingLayout>
          <section>画布处理内容</section>
        </DraftProcessingLayout>
      )
      await flush()
    })

    expect(document.querySelector('[aria-label="Main navigation"]')).toBeNull()
    expect(document.querySelectorAll("a")).toHaveLength(0)
    const returnButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="返回草稿处理弹窗"]'
    )
    expect(returnButton?.textContent).toContain("返回")

    await act(async () => {
      returnButton?.click()
      await flush()
    })
    expect(focusOpener).toHaveBeenCalledTimes(1)
    expect(closeWindow).toHaveBeenCalledTimes(1)
  })
})
