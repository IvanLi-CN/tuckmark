// @vitest-environment jsdom

import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DimensionPicker } from "./dimension-picker.js"

let mountedRoot: ReturnType<typeof ReactDOM.createRoot> | null = null

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function flush(times = 2): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

async function renderPicker(onCommit = vi.fn()) {
  document.body.innerHTML = '<div id="root"></div>'
  const rootElement = document.getElementById("root")
  if (!rootElement) {
    throw new Error("Missing root element")
  }
  await act(async () => {
    mountedRoot = ReactDOM.createRoot(rootElement)
    mountedRoot.render(
      <DimensionPicker
        value={{ width: 48, height: 28 }}
        options={[
          { width: 48, height: 28 },
          { width: 48, height: 20 },
          { width: 40, height: 16 },
        ]}
        onCommit={onCommit}
      />
    )
    await flush()
  })
  return onCommit
}

function input(label: string): HTMLInputElement {
  const element = document.querySelector(`input[aria-label="${label}"]`)
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Missing input: ${label}`)
  }
  return element
}

async function change(element: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
    await flush()
  })
}

async function openSuggestions(): Promise<void> {
  await act(async () => {
    input("标签宽度").focus()
    await flush(4)
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

describe("DimensionPicker", () => {
  it("shows canvas dimensions as millimeters", async () => {
    await renderPicker()

    expect(input("标签宽度").value).toBe("48")
    expect(input("标签高度").value).toBe("28")
    expect(document.body.textContent).toContain("48 × 28 mm")
  })

  it("filters suggestions by the entered width prefix", async () => {
    await renderPicker()

    const widthInput = input("标签宽度")
    await change(input("标签高度"), "")
    await act(async () => {
      widthInput.focus()
      await flush()
    })
    await change(widthInput, "40")
    await openSuggestions()

    const listbox = document.querySelector('[role="listbox"]')
    expect(listbox?.textContent).toContain("40 × 16 mm")
    expect(listbox?.textContent).not.toContain("48 × 28 mm")
  })

  it("selects a suggestion and commits width and height together", async () => {
    const onCommit = await renderPicker()

    await act(async () => {
      input("标签宽度").focus()
      await flush()
    })
    await change(input("标签高度"), "")
    await openSuggestions()
    const option = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("48 × 20 mm")
    )
    if (!(option instanceof HTMLButtonElement)) {
      throw new Error("Missing dimension option")
    }

    await act(async () => {
      option.click()
      await flush()
    })

    expect(onCommit).toHaveBeenCalledWith({ width: 48, height: 20 })
  })

  it("closes suggestions when clicking outside the picker", async () => {
    await renderPicker()

    await act(async () => {
      input("标签宽度").focus()
      await flush()
    })
    await change(input("标签高度"), "")
    await openSuggestions()
    expect(document.body.textContent).toContain("48 × 20 mm")

    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }))
      await flush(4)
    })

    expect(document.body.textContent).not.toContain("48 × 20 mm")
  })

  it("rejects invalid dimensions without committing", async () => {
    const onCommit = await renderPicker()

    await change(input("标签宽度"), "0")
    await act(async () => {
      input("标签宽度").dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
          cancelable: true,
        })
      )
      await flush()
    })

    expect(onCommit).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("宽高必须是正整数毫米")
  })
})
