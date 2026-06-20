// @vitest-environment jsdom

import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const browserPrinterMocks = vi.hoisted(() => ({
  connectBrowserPrinter: vi.fn(),
  getSelectedBrowserPrinter: vi.fn(),
  isBrowserPrintSupported: vi.fn(),
  printPreviewArtifact: vi.fn(),
}))

vi.mock("./browser-printer.js", () => browserPrinterMocks)

import { App } from "./app.js"
import type { AppContext } from "./types.js"

const fetchMock = vi.fn<typeof fetch>()
const runtimeContext: AppContext = {
  apiBasePath: "/api",
  basePath: "",
  isPages: false,
  mode: "runtime",
  capabilities: {
    browserPrint: "available",
    serverPrint: "available",
    packetsSource: "http",
  },
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  browserPrinterMocks.isBrowserPrintSupported.mockReturnValue(true)
  browserPrinterMocks.getSelectedBrowserPrinter.mockReturnValue({
    deviceId: "browser-printer-1",
    name: "Browser P2",
  })
  browserPrinterMocks.connectBrowserPrinter.mockReset()
  browserPrinterMocks.printPreviewArtifact.mockReset()
  browserPrinterMocks.printPreviewArtifact.mockResolvedValue({
    artifactId: "artifact-1",
    printer: {
      deviceId: "browser-printer-1",
      name: "Browser P2",
    },
    statusCode: 0,
    printable: 0,
    message: "浏览器蓝牙打印已提交。",
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function findFetchCall(url: string): [string, RequestInit | undefined] | undefined {
  return fetchMock.mock.calls.find((call) => call[0] === url) as
    | [string, RequestInit | undefined]
    | undefined
}

function requireRootElement(): HTMLElement {
  const rootElement = document.getElementById("root")
  if (!rootElement) {
    throw new Error("Missing root element")
  }
  return rootElement
}

describe("web app", () => {
  it("renders template workflow and prints current preview through server print when a backend printer is selected", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            templates: [
              {
                id: "shipping-compact",
                name: "Compact Shipping Label",
                description: "Preset shipping label",
                fields: [
                  { key: "recipient", label: "Recipient", required: true },
                  { key: "address", label: "Address", required: true, multiline: true },
                  { key: "orderId", label: "Order ID", required: true },
                  { key: "note", label: "Note", required: false, multiline: true },
                ],
              },
            ],
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            printers: [
              {
                id: "printer-1",
                name: "Mock P2",
                capabilities: {
                  printWidthDots: 384,
                  supportedPaperTypes: ["continuous", "gap"],
                },
              },
            ],
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            artifact: {
              id: "artifact-1",
              name: "Shipping Label",
              templateId: "shipping-compact",
              createdAt: "2026-06-18T00:00:00.000Z",
              width: 384,
              height: 120,
              renderOptions: {
                printWidthDots: 384,
                previewScale: 4,
                paperType: "continuous",
                threshold: 150,
                xOffsetDots: 0,
              },
            },
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "job-1",
            status: "completed",
          })
        )
      )

    document.body.innerHTML = '<div id="root"></div>'
    await act(async () => {
      const root = ReactDOM.createRoot(requireRootElement())
      root.render(<App context={runtimeContext} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("单标签打印主链路")
    expect(document.body.textContent).toContain("模板标签")
    expect(document.body.textContent).toContain("打印当前预览")
    expect(document.body.textContent).toContain("连接浏览器打印机")

    const previewButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("生成预览")
    )
    if (!previewButton) {
      throw new Error("Missing template preview button")
    }
    await act(async () => {
      previewButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    const printCurrentPreviewButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("打印当前预览")
    )
    if (!printCurrentPreviewButton) {
      throw new Error("Missing print current preview button")
    }
    expect(printCurrentPreviewButton.hasAttribute("disabled")).toBe(false)
    await act(async () => {
      printCurrentPreviewButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(findFetchCall("/api/preview/template")).toEqual([
      "/api/preview/template",
      expect.objectContaining({ method: "POST" }),
    ])
    expect(findFetchCall("/api/print/artifact")).toEqual([
      "/api/print/artifact",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          printerId: "printer-1",
          printerName: "Mock P2",
          artifactId: "artifact-1",
        }),
      }),
    ])
    expect(browserPrinterMocks.printPreviewArtifact).not.toHaveBeenCalled()
    const previewImage = document.querySelector(
      "img[alt='preview artifact']"
    ) as HTMLImageElement | null
    expect(previewImage?.getAttribute("src")).toBe("/api/artifacts/artifact-1/png")
    expect(document.body.textContent).toContain("打印任务 job-1 状态 completed")
  })

  it("does not use a stale backend printer selection after refresh returns no printers", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            templates: [
              {
                id: "shipping-compact",
                name: "Compact Shipping Label",
                description: "Preset shipping label",
                fields: [
                  { key: "recipient", label: "Recipient", required: true },
                  { key: "address", label: "Address", required: true, multiline: true },
                  { key: "orderId", label: "Order ID", required: true },
                  { key: "note", label: "Note", required: false, multiline: true },
                ],
              },
            ],
          })
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ printers: [] })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            artifact: {
              id: "artifact-2",
              name: "Shipping Label",
              templateId: "shipping-compact",
              createdAt: "2026-06-18T00:00:00.000Z",
              width: 384,
              height: 120,
              renderOptions: {
                printWidthDots: 384,
                previewScale: 4,
                paperType: "continuous",
                threshold: 150,
                xOffsetDots: 0,
              },
            },
          })
        )
      )

    document.body.innerHTML = '<div id="root"></div>'
    await act(async () => {
      const root = ReactDOM.createRoot(requireRootElement())
      root.render(<App context={runtimeContext} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    const previewButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("生成预览")
    )
    if (!previewButton) {
      throw new Error("Missing template preview button")
    }
    await act(async () => {
      previewButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    const printCurrentPreviewButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("打印当前预览")
    )
    if (!printCurrentPreviewButton) {
      throw new Error("Missing print current preview button")
    }

    expect(printCurrentPreviewButton.hasAttribute("disabled")).toBe(false)
    await act(async () => {
      printCurrentPreviewButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/print/artifact",
      expect.objectContaining({ method: "POST" })
    )
    expect(browserPrinterMocks.printPreviewArtifact).toHaveBeenCalledOnce()
  })

  it("refreshes backend printers and retries when the selected server printer instance has gone stale", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            templates: [
              {
                id: "shipping-compact",
                name: "Compact Shipping Label",
                description: "Preset shipping label",
                fields: [
                  { key: "recipient", label: "Recipient", required: true },
                  { key: "address", label: "Address", required: true, multiline: true },
                  { key: "orderId", label: "Order ID", required: true },
                  { key: "note", label: "Note", required: false, multiline: true },
                ],
              },
            ],
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            printers: [
              {
                id: "printer-1",
                name: "Mock P2",
                capabilities: {
                  printWidthDots: 384,
                  supportedPaperTypes: ["continuous", "gap"],
                },
              },
            ],
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            artifact: {
              id: "artifact-3",
              name: "Shipping Label",
              templateId: "shipping-compact",
              createdAt: "2026-06-18T00:00:00.000Z",
              width: 384,
              height: 120,
              renderOptions: {
                printWidthDots: 384,
                previewScale: 4,
                paperType: "continuous",
                threshold: 150,
                xOffsetDots: 0,
              },
            },
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "error",
            error:
              "Printer is no longer available: printer-1 (Mock P2). Refresh printers and retry.",
          }),
          { status: 400 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            templates: [
              {
                id: "shipping-compact",
                name: "Compact Shipping Label",
                description: "Preset shipping label",
                fields: [
                  { key: "recipient", label: "Recipient", required: true },
                  { key: "address", label: "Address", required: true, multiline: true },
                  { key: "orderId", label: "Order ID", required: true },
                  { key: "note", label: "Note", required: false, multiline: true },
                ],
              },
            ],
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            printers: [
              {
                id: "printer-2",
                name: "Mock P2",
                capabilities: {
                  printWidthDots: 384,
                  supportedPaperTypes: ["continuous", "gap"],
                },
              },
            ],
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "job-2",
            status: "completed",
          })
        )
      )

    document.body.innerHTML = '<div id="root"></div>'
    await act(async () => {
      const root = ReactDOM.createRoot(requireRootElement())
      root.render(<App context={runtimeContext} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    const previewButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("生成预览")
    )
    if (!previewButton) {
      throw new Error("Missing template preview button")
    }
    await act(async () => {
      previewButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    const printCurrentPreviewButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("打印当前预览")
    )
    if (!printCurrentPreviewButton) {
      throw new Error("Missing print current preview button")
    }
    await act(async () => {
      printCurrentPreviewButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    const printArtifactCalls = fetchMock.mock.calls.filter(
      (call) => call[0] === "/api/print/artifact"
    )
    expect(printArtifactCalls).toHaveLength(2)
    expect(printArtifactCalls[0]).toEqual([
      "/api/print/artifact",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          printerId: "printer-1",
          printerName: "Mock P2",
          artifactId: "artifact-3",
        }),
      }),
    ])
    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/templates")).toBe(true)
    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/printers")).toBe(true)
    expect(printArtifactCalls[1]).toEqual([
      "/api/print/artifact",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          printerId: "printer-2",
          printerName: "Mock P2",
          artifactId: "artifact-3",
        }),
      }),
    ])
    expect(document.body.textContent).toContain("打印任务 job-2 状态 completed")
  })
})
