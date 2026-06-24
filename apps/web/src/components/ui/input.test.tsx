// @vitest-environment jsdom

import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import { Input } from "./input.js"

let mountedRoot: ReturnType<typeof ReactDOM.createRoot> | null = null

async function flush(times = 2): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

async function renderNode(node: React.ReactNode) {
  document.body.innerHTML = '<div id="root"></div>'
  const rootElement = document.getElementById("root")
  if (!rootElement) {
    throw new Error("Missing root element")
  }

  await act(async () => {
    mountedRoot = ReactDOM.createRoot(rootElement)
    mountedRoot.render(node)
    await flush()
  })
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
})

describe("Input", () => {
  it("supports a compact input variant with visible but tight field chrome", async () => {
    await renderNode(
      <Input data-testid="input" density="compact" value="Moon Street 42 Shanghai" readOnly />
    )

    const input = document.querySelector("[data-testid='input']") as HTMLInputElement | null
    expect(input).not.toBeNull()
    expect(input?.className).toContain("h-7")
    expect(input?.className).toContain("rounded-sm")
    expect(input?.className).toContain("border")
    expect(input?.className).toContain("bg-background/95")
    expect(input?.className).toContain("shadow-none")
    expect(input?.className).toContain("px-2")
  })

  it("exposes all compact sizes through the public interface", async () => {
    await renderNode(
      <div>
        <Input data-testid="input-xs" density="compact" size="xs" value="TM-001" readOnly />
        <Input data-testid="input-sm" density="compact" size="sm" value="TM-001" readOnly />
        <Input data-testid="input-md" density="compact" size="md" value="TM-001" readOnly />
        <Input data-testid="input-lg" density="compact" size="lg" value="TM-001" readOnly />
      </div>
    )

    const inputXs = document.querySelector("[data-testid='input-xs']") as HTMLInputElement | null
    const inputSm = document.querySelector("[data-testid='input-sm']") as HTMLInputElement | null
    const inputMd = document.querySelector("[data-testid='input-md']") as HTMLInputElement | null
    const inputLg = document.querySelector("[data-testid='input-lg']") as HTMLInputElement | null

    expect(inputXs?.className).toContain("h-5")
    expect(inputSm?.className).toContain("h-6")
    expect(inputMd?.className).toContain("h-7")
    expect(inputLg?.className).toContain("h-8")
  })

  it("lets compact inputs opt into content-fit width bounds", async () => {
    await renderNode(
      <Input
        data-testid="input"
        density="compact"
        widthMode="content-fit"
        minWidthPx={96}
        maxWidthPx={224}
        value="TM-001"
        readOnly
      />
    )

    const input = document.querySelector("[data-testid='input']") as HTMLInputElement | null
    expect(input?.style.minWidth).toBe("96px")
    expect(input?.style.maxWidth).toBe("224px")
    expect(input?.style.width).toBeTruthy()
  })
})
