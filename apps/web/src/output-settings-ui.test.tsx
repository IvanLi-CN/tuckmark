// @vitest-environment jsdom

import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { OutputSettingsControls } from "./output-settings-ui.js"

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
    await flush(4)
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

describe("OutputSettingsControls", () => {
  it("shows zeroed device calibration and disables device-only controls when no device is selected", async () => {
    const onDeviceCalibrationChange = vi.fn()

    await renderNode(
      <OutputSettingsControls
        paperType="continuous"
        onPaperTypeChange={() => undefined}
        deviceCalibration={{
          xOffsetMm: 0,
          yOffsetMm: 0,
          printStrengthLevel: 0,
        }}
        onDeviceCalibrationChange={onDeviceCalibrationChange}
        printerIdentity={{
          printerModel: "generic",
          deviceDisplayName: "未选择输出设备",
          deviceKey: null,
          capabilityPrintWidthDots: 384,
        }}
        appliedModelPreset={{
          printerDpi: 203,
          printWidthDots: 384,
        }}
        recommendedModelPreset={{
          printerDpi: 203,
          printWidthDots: 384,
        }}
        onSaveModelPreset={() => undefined}
      />
    )

    expect(document.body.textContent).toContain("X 0.00 mm · Y 0.00 mm")

    const xInput = document.getElementById("print-offset-x") as HTMLInputElement | null
    const yInput = document.getElementById("print-offset-y") as HTMLInputElement | null
    expect(xInput?.disabled).toBe(true)
    expect(yInput?.disabled).toBe(true)

    const buttons = Array.from(document.querySelectorAll("button"))
    const strengthButton = buttons.find((button) => button.textContent?.trim() === "-2")
    expect(strengthButton?.hasAttribute("disabled")).toBe(true)
  })
})
