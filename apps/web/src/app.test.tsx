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

import type { ApiClient } from "./api-client.js"
import { App } from "./app.js"
import { defaultRenderOptions, fallbackTemplates } from "./demo-data.js"
import type { AppContext } from "./types.js"

const fetchMock = vi.fn<typeof fetch>()

const serverRuntimeContext: AppContext = {
  apiBasePath: "/api",
  basePath: "",
  surface: "server-http",
  mode: "runtime",
  capabilities: {
    browserPrint: "available",
    serverPrint: "available",
    mockHardware: false,
  },
}

const browserRuntimeContext: AppContext = {
  apiBasePath: "",
  basePath: "",
  surface: "browser-static",
  mode: "runtime",
  capabilities: {
    browserPrint: "available",
    serverPrint: "disabled",
    mockHardware: false,
  },
}

const demoContext: AppContext = {
  apiBasePath: "",
  basePath: "",
  surface: "browser-static",
  mode: "demo",
  capabilities: {
    browserPrint: "disabled",
    serverPrint: "disabled",
    mockHardware: true,
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
  browserPrinterMocks.connectBrowserPrinter.mockResolvedValue({
    deviceId: "browser-printer-1",
    name: "Browser P2",
  })
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
    packetCount: 3,
    totalBytes: 128,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function requireRootElement(): HTMLElement {
  const rootElement = document.getElementById("root")
  if (!rootElement) {
    throw new Error("Missing root element")
  }
  return rootElement
}

function clickByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(text)
  ) as HTMLButtonElement | undefined
  if (!button) {
    throw new Error(`Missing button: ${text}`)
  }
  return button
}

describe("web app", () => {
  it("renders server-http runtime and submits current preview through /api", async () => {
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
            artifactId: "artifact-1",
            packets: ["AA=="],
            packetCount: 1,
            totalBytes: 1,
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
      root.render(<App context={serverRuntimeContext} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("Server HTTP")
    expect(document.body.textContent).toContain("Runtime mode")

    await act(async () => {
      clickByText("生成预览").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      clickByText("打印当前预览").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/preview/template")).toBe(true)
    expect(
      fetchMock.mock.calls.some((call) => call[0] === "/api/artifacts/artifact-1/packets")
    ).toBe(true)
    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/print/artifact")).toBe(true)
    const previewImage = document.querySelector(
      "img[alt='preview artifact']"
    ) as HTMLImageElement | null
    expect(previewImage?.getAttribute("src")).toBe("/api/artifacts/artifact-1/png")
  })

  it("uses browser-static runtime labels and routes print through browser packets seam", async () => {
    const browserClient: ApiClient = {
      async listTemplates() {
        return [
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
        ]
      },
      async listPrinters() {
        return []
      },
      async previewTemplate() {
        return {
          artifact: {
            id: "artifact-browser-1",
            name: "Shipping Label",
            templateId: "shipping-compact",
            createdAt: "2026-06-20T00:00:00.000Z",
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
        }
      },
      async previewSafeText() {
        throw new Error("not implemented")
      },
      async printArtifact() {
        return { id: "browser-print", status: "ready" }
      },
      async printTemplate() {
        throw new Error("not implemented")
      },
      async printSafeText() {
        throw new Error("not implemented")
      },
      async readArtifactData() {
        return {
          preview: {
            kind: "data-url" as const,
            dataUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
          },
          packets: {
            artifactId: "artifact-browser-1",
            packets: ["AA=="],
            packetCount: 1,
            totalBytes: 1,
          },
        }
      },
    }

    document.body.innerHTML = '<div id="root"></div>'
    await act(async () => {
      const root = ReactDOM.createRoot(requireRootElement())
      root.render(<App context={browserRuntimeContext} client={browserClient} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("Browser static")
    expect(document.body.textContent).not.toContain("后端探测打印机")

    await act(async () => {
      clickByText("生成预览").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      clickByText("连接当前浏览器打印机").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      clickByText("打印当前预览").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(browserPrinterMocks.connectBrowserPrinter).toHaveBeenCalledOnce()
    expect(browserPrinterMocks.printPreviewArtifact).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("keeps demo mode on the formal app surface while disabling hardware calls", async () => {
    const demoClient: ApiClient = {
      async listTemplates() {
        return fallbackTemplates
      },
      async listPrinters() {
        return []
      },
      async previewTemplate() {
        return {
          artifact: {
            id: "artifact-demo-1",
            name: "Shipping Label",
            templateId: "shipping-compact",
            createdAt: "2026-06-20T00:00:00.000Z",
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
        }
      },
      async previewSafeText() {
        return {
          artifact: {
            id: "artifact-demo-safe-1",
            name: "Safe Text Label",
            templateId: "safe-text-label",
            createdAt: "2026-06-20T00:00:00.000Z",
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
        }
      },
      async printArtifact() {
        return {
          id: "demo-job-1",
          status: "completed",
        }
      },
      async printTemplate() {
        return {
          preview: await this.previewTemplate({
            templateId: "shipping-compact",
            input: {},
            renderOptions: defaultRenderOptions,
          }),
          job: {
            id: "demo-template-1",
            status: "completed",
            artifactId: "artifact-demo-1",
            printerId: "demo-printer",
          },
        }
      },
      async printSafeText() {
        return {
          preview: await this.previewSafeText({
            text: "safe",
            title: "Safe Text Label",
            renderOptions: defaultRenderOptions,
          }),
          job: {
            id: "demo-safe-1",
            status: "completed",
            artifactId: "artifact-demo-safe-1",
            printerId: "demo-printer",
          },
        }
      },
      async readArtifactData(artifact) {
        return {
          preview: {
            kind: "data-url",
            dataUrl:
              artifact.id === "artifact-demo-safe-1"
                ? "data:image/gif;base64,R0lGODlhAQABAAAAACw="
                : "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
          },
          packets: {
            artifactId: artifact.id,
            packets: ["AA=="],
            packetCount: 1,
            totalBytes: 1,
          },
        }
      },
    }

    document.body.innerHTML = '<div id="root"></div>'
    await act(async () => {
      const root = ReactDOM.createRoot(requireRootElement())
      root.render(<App context={demoContext} client={demoClient} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("Demo mode")
    expect(document.body.textContent).toContain("成功仿真")

    await act(async () => {
      clickByText("生成预览").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      clickByText("打印当前预览").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(browserPrinterMocks.connectBrowserPrinter).not.toHaveBeenCalled()
    expect(browserPrinterMocks.printPreviewArtifact).not.toHaveBeenCalled()
  })
})
