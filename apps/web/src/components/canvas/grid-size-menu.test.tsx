// @vitest-environment jsdom

import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GridSizeMenu } from "./grid-size-menu.js"

let mountedRoot: ReturnType<typeof ReactDOM.createRoot> | null = null

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function flush(times = 2): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

function dispatchPointerEvent(
  target: Element,
  type: string,
  init: Record<string, number | string>
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(event, key, { configurable: true, value })
  }
  target.dispatchEvent(event)
}

async function renderMenu(onToggle = vi.fn(), onChange = vi.fn()) {
  document.body.innerHTML = '<div id="root"></div>'
  const rootElement = document.getElementById("root")
  if (!rootElement) {
    throw new Error("Missing root element")
  }
  await act(async () => {
    mountedRoot = ReactDOM.createRoot(rootElement)
    mountedRoot.render(
      <GridSizeMenu gridEnabled value={2.5} onToggle={onToggle} onChange={onChange} />
    )
    await flush()
  })
  return {
    button: document.querySelector('button[aria-label="网格"]') ?? document.querySelector("button"),
    onChange,
    onToggle,
  }
}

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

describe("GridSizeMenu", () => {
  it("opens a five-option custom menu on right click without toggling the grid", async () => {
    const { button, onToggle } = await renderMenu()
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Missing grid button")
    }

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
    button.dispatchEvent(event)
    await act(async () => flush())

    expect(event.defaultPrevented).toBe(true)
    expect(onToggle).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("网格尺寸")
    expect(document.body.textContent).toContain("1mm")
    expect(document.body.textContent).toContain("2mm")
    expect(document.body.textContent).toContain("2.5mm")
    expect(document.body.textContent).toContain("5mm")
    expect(document.body.textContent).toContain("10mm")
  })

  it("opens on a 500ms touch long press and suppresses its click", async () => {
    vi.useFakeTimers()
    const { button, onToggle } = await renderMenu()
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Missing grid button")
    }

    await act(async () => {
      dispatchPointerEvent(button, "pointerdown", {
        pointerId: 1,
        pointerType: "touch",
        button: 0,
        clientX: 100,
        clientY: 100,
      })
      await vi.advanceTimersByTimeAsync(499)
    })
    expect(document.body.textContent).not.toContain("网格尺寸")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
      await flush()
    })
    expect(document.body.textContent).toContain("网格尺寸")

    await act(async () => {
      dispatchPointerEvent(button, "pointerup", {
        pointerId: 1,
        pointerType: "touch",
        button: 0,
        clientX: 100,
        clientY: 100,
      })
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await flush()
    })
    expect(onToggle).not.toHaveBeenCalled()
  })

  it("cancels a long press after moving more than 8px", async () => {
    vi.useFakeTimers()
    const { button } = await renderMenu()
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Missing grid button")
    }

    await act(async () => {
      dispatchPointerEvent(button, "pointerdown", {
        pointerId: 2,
        pointerType: "pen",
        button: 0,
        clientX: 100,
        clientY: 100,
      })
      dispatchPointerEvent(button, "pointermove", {
        pointerId: 2,
        pointerType: "pen",
        button: 0,
        clientX: 109,
        clientY: 100,
      })
      await vi.advanceTimersByTimeAsync(500)
      await flush()
    })

    expect(document.body.textContent).not.toContain("网格尺寸")
  })
})
