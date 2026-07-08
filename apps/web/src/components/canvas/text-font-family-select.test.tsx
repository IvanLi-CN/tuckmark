// @vitest-environment jsdom

import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { TextFontFamily } from "../../../../../packages/core/src/web.js"
import {
  clearTextFontUsageState,
  loadTextFontUsageState,
  persistTextFontUsageState,
} from "../../lib/text-font-usage.js"
import { TextFontFamilySelect } from "./text-font-family-select.js"

let mountedRoot: ReturnType<typeof ReactDOM.createRoot> | null = null

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function installMemoryStorage() {
  const store = new Map<string, string>()
  const memoryStorage: Storage = {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key) {
      return store.get(key) ?? null
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key) {
      store.delete(key)
    },
    setItem(key, value) {
      store.set(key, value)
    },
  }

  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage,
    configurable: true,
    writable: true,
  })
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      value: memoryStorage,
      configurable: true,
      writable: true,
    })
  }
}

async function flush(times = 2): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

async function renderSelect(value: TextFontFamily = "noto-sans-sc", onValueChange = vi.fn()) {
  HTMLElement.prototype.hasPointerCapture ??= () => false
  HTMLElement.prototype.setPointerCapture ??= () => undefined
  HTMLElement.prototype.releasePointerCapture ??= () => undefined
  HTMLElement.prototype.scrollIntoView ??= () => undefined
  document.body.innerHTML = '<div id="root"></div>'
  const rootElement = document.getElementById("root")
  if (!rootElement) {
    throw new Error("Missing root element")
  }
  await act(async () => {
    mountedRoot = ReactDOM.createRoot(rootElement)
    mountedRoot.render(
      <div>
        <label htmlFor="font-family">字体</label>
        <TextFontFamilySelect id="font-family" value={value} onValueChange={onValueChange} />
      </div>
    )
    await flush()
  })
  return onValueChange
}

function trigger(): HTMLButtonElement {
  const element = document.querySelector('[role="combobox"]')
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error("Missing select trigger")
  }
  return element
}

async function openSelect() {
  const element = trigger()
  await act(async () => {
    element.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        ctrlKey: false,
      })
    )
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await flush()
  })
}

beforeEach(() => {
  installMemoryStorage()
  clearTextFontUsageState()
})

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

describe("TextFontFamilySelect", () => {
  it("renders common fonts first and keeps the full named-font list", async () => {
    persistTextFontUsageState({
      fonts: {
        ...loadTextFontUsageState().fonts,
        "ibm-plex-mono": {
          id: "ibm-plex-mono",
          lastUsedAt: "2026-07-08T05:00:00.000Z",
          totalUsedMs: 900,
        },
        "noto-sans-sc": {
          id: "noto-sans-sc",
          lastUsedAt: "2026-07-08T04:00:00.000Z",
          totalUsedMs: 8_000,
        },
        "space-grotesk": {
          id: "space-grotesk",
          lastUsedAt: "2026-07-08T03:00:00.000Z",
          totalUsedMs: 7_000,
        },
        "source-serif-4": {
          id: "source-serif-4",
          lastUsedAt: "2026-07-08T02:00:00.000Z",
          totalUsedMs: 6_000,
        },
        arial: {
          id: "arial",
          lastUsedAt: "2026-07-08T01:00:00.000Z",
          totalUsedMs: 5_000,
        },
      },
    })

    await renderSelect()
    await openSelect()

    expect(document.body.textContent).toContain("常用字体")
    const optionLabels = Array.from(document.querySelectorAll('[role="option"]')).map((element) =>
      element.textContent?.trim()
    )
    expect(optionLabels.slice(0, 5)).toEqual([
      "IBM Plex Mono",
      "Noto Sans SC",
      "Space Grotesk",
      "Source Serif 4",
      "Arial",
    ])
    expect(optionLabels.length).toBeGreaterThan(20)
  })

  it("reports the selected font family", async () => {
    const onValueChange = await renderSelect()
    await openSelect()
    const option = Array.from(document.querySelectorAll('[role="option"]')).find(
      (element) => element.textContent?.trim() === "IBM Plex Mono"
    )
    if (!(option instanceof HTMLElement)) {
      throw new Error("Missing font option")
    }

    await act(async () => {
      option.click()
      await flush()
    })

    expect(onValueChange).toHaveBeenCalledWith("ibm-plex-mono")
  })

  it("shows a named font when a legacy alias is selected", async () => {
    await renderSelect("system-sans")
    expect(trigger().textContent?.trim()).toContain("Arial")
    expect(trigger().getAttribute("style")).toContain("Arial")
  })

  it("shows tooltip metadata for a hovered font option", async () => {
    await renderSelect()
    await openSelect()

    const option = Array.from(document.querySelectorAll('[role="option"]')).find(
      (element) => element.textContent?.trim() === "IBM Plex Mono"
    )
    if (!(option instanceof HTMLElement)) {
      throw new Error("Missing font option")
    }

    await act(async () => {
      option.focus()
      option.dispatchEvent(new FocusEvent("focus", { bubbles: true }))
      option.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
      await flush()
    })

    expect(option.getAttribute("data-font-label")).toBe("IBM Plex Mono")
    expect(option.getAttribute("data-font-attributes")).toContain("等宽")
  })
})
