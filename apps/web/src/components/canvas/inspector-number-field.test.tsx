// @vitest-environment jsdom

import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { InspectorNumberField } from "./inspector-number-field.js"

let mountedRoot: ReturnType<typeof ReactDOM.createRoot> | null = null

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function flush(times = 2): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

async function renderField(
  value = 21.234,
  onValueChange = vi.fn(),
  props: Partial<React.ComponentProps<typeof InspectorNumberField>> = {}
) {
  document.body.innerHTML = '<div id="root"></div>'
  const rootElement = document.getElementById("root")
  if (!rootElement) {
    throw new Error("Missing root element")
  }
  await act(async () => {
    mountedRoot = ReactDOM.createRoot(rootElement)
    mountedRoot.render(
      <InspectorNumberField
        id="size-width"
        label="宽"
        value={value}
        onValueChange={onValueChange}
        {...props}
      />
    )
    await flush()
  })
  return onValueChange
}

function input(): HTMLInputElement {
  const element = document.querySelector("input")
  if (!(element instanceof HTMLInputElement)) {
    throw new Error("Missing number input")
  }
  return element
}

function label(): HTMLLabelElement {
  const element = document.querySelector("label")
  if (!(element instanceof HTMLLabelElement)) {
    throw new Error("Missing number label")
  }
  element.setPointerCapture = vi.fn()
  element.releasePointerCapture = vi.fn()
  return element
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

describe("InspectorNumberField", () => {
  it("formats values with one decimal place and a 0.1 step", async () => {
    await renderField()

    expect(input().value).toBe("21.2")
    expect(input().step).toBe("0.1")
  })

  it("rounds typed values to one decimal place", async () => {
    const onValueChange = await renderField()
    const element = input()

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setter?.call(element, "7.76")
      element.dispatchEvent(new Event("input", { bubbles: true }))
      await flush()
    })

    expect(onValueChange).toHaveBeenCalledWith(7.8)
  })

  it("formats and rounds integer precision fields without decimals", async () => {
    const onValueChange = await renderField(12.6, vi.fn(), {
      id: "element-rotation",
      label: "旋转",
      precision: 0,
      step: 1,
    })
    const element = input()

    expect(element.value).toBe("13")
    expect(element.step).toBe("1")

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setter?.call(element, "7.6")
      element.dispatchEvent(new Event("input", { bubbles: true }))
      await flush()
    })

    expect(onValueChange).toHaveBeenCalledWith(8)
  })

  it("renders optional inline actions", async () => {
    await renderField(0, vi.fn(), {
      actions: <button type="button">+45</button>,
    })

    expect(document.querySelector(".tm-inspector-inline-actions")?.textContent).toBe("+45")
  })

  it("adjusts by 0.1 when dragging the label horizontally", async () => {
    const onValueChange = await renderField(7.5)
    const dragLabel = label()

    await act(async () => {
      dragLabel.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 100,
          pointerId: 1,
        })
      )
      dragLabel.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 116,
          pointerId: 1,
        })
      )
      dragLabel.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: 116,
          pointerId: 1,
        })
      )
      await flush()
    })

    expect(onValueChange).toHaveBeenCalledWith(7.7)
  })
})
