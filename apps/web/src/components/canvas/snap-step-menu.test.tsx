// @vitest-environment jsdom
import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SnapStepMenu } from "./snap-step-menu.js"

let mountedRoot: ReturnType<typeof ReactDOM.createRoot> | null = null

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
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
  vi.restoreAllMocks()
})

describe("SnapStepMenu", () => {
  it("shows the three snap step options and applies a selection", async () => {
    const onChange = vi.fn()
    const rootElement = document.createElement("div")
    document.body.append(rootElement)

    await act(async () => {
      mountedRoot = ReactDOM.createRoot(rootElement)
      mountedRoot.render(
        <SnapStepMenu snapEnabled value={1} onToggle={() => undefined} onChange={onChange} />
      )
      await flush()
    })

    const button = document.querySelector('button[aria-label="吸附"]')
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Missing snap button")
    }
    button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
    await act(async () => flush())

    expect(document.body.textContent).toContain("吸附步长")
    expect(document.body.textContent).toContain("1/4 格")
    expect(document.body.textContent).toContain("1/2 格")
    expect(document.body.textContent).toContain("1 格")

    const quarterButton = Array.from(document.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("1/4 格")
    )
    if (!(quarterButton instanceof HTMLButtonElement)) {
      throw new Error("Missing quarter snap option")
    }
    await act(async () => {
      quarterButton.click()
      await flush()
    })

    expect(onChange).toHaveBeenCalledWith(0.25)
  })
})
