// @vitest-environment jsdom

import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import { ProductMark } from "./product-mark.js"

let mountedRoot: ReturnType<typeof ReactDOM.createRoot> | null = null

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function flush(times = 2): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

async function renderProductMark(compact = false) {
  document.body.innerHTML = '<div id="root"></div>'
  const rootElement = document.getElementById("root")
  if (!rootElement) {
    throw new Error("Missing root element")
  }

  await act(async () => {
    mountedRoot = ReactDOM.createRoot(rootElement)
    mountedRoot.render(<ProductMark compact={compact} />)
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

describe("ProductMark", () => {
  it("renders the approved full-logo asset rather than reconstructing its wordmark", async () => {
    await renderProductMark()

    const productMark = document.querySelector("[role='img'][aria-label='Tuckmark']")
    const lightLogo = document.querySelector(
      ".tm-product-mark__asset--light"
    ) as HTMLImageElement | null
    const darkLogo = document.querySelector(
      ".tm-product-mark__asset--dark"
    ) as HTMLImageElement | null

    expect(productMark).not.toBeNull()
    expect(lightLogo?.src).toContain("tuckmark-full-logo-light.svg")
    expect(darkLogo?.src).toContain("tuckmark-full-logo-dark.svg")
    expect(document.body.textContent).not.toContain("Label Workbench")
  })

  it("keeps the compact variant as the same complete logo", async () => {
    await renderProductMark(true)

    const logo = document.querySelector("[role='img'][aria-label='Tuckmark']")

    expect(logo?.className).toContain("tm-product-mark--compact")
  })
})
