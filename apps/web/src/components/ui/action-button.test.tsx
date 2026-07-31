// @vitest-environment jsdom

import { Copy } from "lucide-react"
import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ActionButton } from "./action-button.js"

let mountedRoot: ReturnType<typeof ReactDOM.createRoot> | null = null

async function flush(times = 4): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

function dispatchPointerLikeEvent(
  target: Element,
  type: string,
  init: Record<string, number | string | boolean>
): void {
  const event = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(event, key, { value, configurable: true })
  }
  target.dispatchEvent(event)
}

async function renderNode(node: React.ReactNode) {
  document.body.innerHTML = '<div id="root"></div>'
  const rootElement = document.getElementById("root")
  if (!rootElement) throw new Error("Missing root element")
  await act(async () => {
    mountedRoot = ReactDOM.createRoot(rootElement)
    mountedRoot.render(node)
    await flush()
  })
}

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  vi.useRealTimers()
  if (mountedRoot) {
    await act(async () => {
      mountedRoot?.unmount()
      await flush()
    })
  }
  mountedRoot = null
  document.body.innerHTML = ""
})

describe("ActionButton", () => {
  it("opens an icon-only tooltip after a 520 ms touch long press", async () => {
    vi.useFakeTimers()
    await renderNode(<ActionButton name="复制标签" icon={Copy} mode="icon" />)
    const button = document.querySelector("button[aria-label='复制标签']")
    if (!button) throw new Error("Missing icon-only action button")

    await act(async () => {
      dispatchPointerLikeEvent(button, "pointerdown", { pointerType: "touch" })
      await vi.advanceTimersByTimeAsync(520)
      await flush()
    })

    expect(document.querySelector("[role='tooltip']")?.textContent).toBe("复制标签")
  })
})
