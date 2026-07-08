// @vitest-environment jsdom

import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { TextFontFamily } from "../../../../../packages/core/src/web.js"
import { TextFontFamilySelect } from "./text-font-family-select.js"

let mountedRoot: ReturnType<typeof ReactDOM.createRoot> | null = null

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function flush(times = 2): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

async function renderSelect(
  value: TextFontFamily = "noto-sans-sc",
  onValueChange = vi.fn()
) {
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
        <TextFontFamilySelect
          id="font-family"
          value={value}
          onValueChange={onValueChange}
        />
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
  it("renders grouped official and compatibility font sections", async () => {
    await renderSelect()
    await openSelect()

    expect(document.body.textContent).toContain("官方中文")
    expect(document.body.textContent).toContain("官方工业")
    expect(document.body.textContent).toContain("系统兼容")
    expect(document.body.textContent).toContain("IBM Plex Mono")
    expect(document.body.textContent).toContain("系统无衬线")
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
})
