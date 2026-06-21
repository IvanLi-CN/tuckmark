// @vitest-environment jsdom

import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ApiClient } from "./api-client.js"
import { App } from "./app.js"
import {
  buildSafeTextBrowserSvgForTest,
  readBrowserArtifact,
  resetBrowserArtifactStoreForTest,
  writeBrowserArtifactForTest,
} from "./browser-runtime.js"
import { fallbackTemplates } from "./demo-data.js"
import type { AppContext, PreviewArtifact } from "./types.js"

const browserPrinterMocks = vi.hoisted(() => ({
  connectBrowserPrinter: vi.fn(),
  getSelectedBrowserPrinter: vi.fn(),
  isBrowserPrintSupported: vi.fn(),
  printPreviewArtifact: vi.fn(),
  restoreBrowserPrinter: vi.fn(),
}))

const browserPayloadMocks = vi.hoisted(() => ({
  materializeBrowserArtifactData: vi.fn(),
  encodeBrowserPngBytes: vi.fn(),
}))

vi.mock("./browser-printer.js", () => browserPrinterMocks)
vi.mock("./browser-print-payload.js", () => browserPayloadMocks)

const fetchMock = vi.fn<typeof fetch>()
const originalFetch = globalThis.fetch
const originalIndexedDb = globalThis.indexedDB
let mountedRoot: ReturnType<typeof ReactDOM.createRoot> | null = null

function createFakeIndexedDb(): IDBFactory {
  const databases = new Map<string, Map<string, Map<string, unknown>>>()

  function createRequest<T>(): IDBRequest<T> {
    return {
      error: null,
      onerror: null,
      onsuccess: null,
      readyState: "pending",
      result: undefined as T,
      source: null,
      transaction: null,
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return true
      },
    } as unknown as IDBRequest<T>
  }

  return {
    cmp() {
      return 0
    },
    databases: async () => [],
    deleteDatabase(name: string) {
      databases.delete(name)
      const request = createRequest<undefined>() as unknown as {
        readyState: IDBRequestReadyState
        onsuccess: IDBRequest<undefined>["onsuccess"]
      }
      queueMicrotask(() => {
        request.readyState = "done"
        request.onsuccess?.call(request as unknown as IDBRequest<undefined>, new Event("success"))
      })
      return request as unknown as IDBOpenDBRequest
    },
    open(name: string) {
      const request = createRequest<IDBDatabase>() as unknown as IDBOpenDBRequest & {
        readyState: IDBRequestReadyState
        result: IDBDatabase
      }
      queueMicrotask(() => {
        const existing = databases.get(name)
        const stores = existing ?? new Map<string, Map<string, unknown>>()
        const database = {
          close() {},
          createObjectStore(storeName: string) {
            if (!stores.has(storeName)) {
              stores.set(storeName, new Map())
            }
            return {} as IDBObjectStore
          },
          deleteObjectStore() {},
          transaction(storeName: string) {
            if (!stores.has(storeName)) {
              stores.set(storeName, new Map())
            }
            const store = stores.get(storeName) as Map<string, unknown>
            const transaction = {
              error: null,
              onabort: null,
              oncomplete: null,
              onerror: null,
              abort() {},
              commit() {},
              db: database,
              durability: "default",
              mode: "readwrite",
              objectStoreNames: {} as DOMStringList,
              objectStore() {
                return {
                  get(key: string) {
                    const getRequest = createRequest<unknown>() as unknown as {
                      readyState: IDBRequestReadyState
                      result: unknown
                      onsuccess: IDBRequest<unknown>["onsuccess"]
                    }
                    queueMicrotask(() => {
                      getRequest.readyState = "done"
                      getRequest.result = store.get(key)
                      getRequest.onsuccess?.call(
                        getRequest as unknown as IDBRequest<unknown>,
                        new Event("success")
                      )
                    })
                    return getRequest
                  },
                  put(value: { artifact: { id: string } }) {
                    const putRequest = createRequest<string>() as unknown as {
                      readyState: IDBRequestReadyState
                      result: string
                      onsuccess: IDBRequest<string>["onsuccess"]
                    }
                    queueMicrotask(() => {
                      store.set(value.artifact.id, structuredClone(value))
                      putRequest.readyState = "done"
                      putRequest.result = value.artifact.id
                      putRequest.onsuccess?.call(
                        putRequest as unknown as IDBRequest<string>,
                        new Event("success")
                      )
                      transaction.oncomplete?.(new Event("complete") as Event)
                    })
                    return putRequest
                  },
                } as IDBObjectStore
              },
              addEventListener() {},
              removeEventListener() {},
              dispatchEvent() {
                return true
              },
            } as unknown as IDBTransaction
            return transaction
          },
          onabort: null,
          onclose: null,
          onerror: null,
          onversionchange: null,
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() {
            return true
          },
          name,
          objectStoreNames: {} as DOMStringList,
          version: 1,
        } as unknown as IDBDatabase

        request.result = database
        if (!existing) {
          databases.set(name, stores)
          request.onupgradeneeded?.(new Event("upgradeneeded") as IDBVersionChangeEvent)
        }
        request.readyState = "done"
        request.onsuccess?.(new Event("success") as Event)
      })
      return request
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true
    },
  } as unknown as IDBFactory
}

const serverRuntimeContext: AppContext = {
  apiBasePath: "/api",
  basePath: "",
  surface: "server-http",
  mode: "runtime",
  capabilities: {
    browserDirectPrintPath: "available",
    serviceApiPrintPath: "available",
  },
}

const browserRuntimeContext: AppContext = {
  apiBasePath: "",
  basePath: "",
  surface: "browser-static",
  mode: "runtime",
  capabilities: {
    browserDirectPrintPath: "available",
    serviceApiPrintPath: "disabled",
  },
}

const demoContext: AppContext = {
  apiBasePath: "",
  basePath: "",
  surface: "browser-static",
  mode: "demo",
  capabilities: {
    browserDirectPrintPath: "mocked",
    serviceApiPrintPath: "mocked",
  },
}

function makeArtifact(artifactId: string, templateId = "shipping-compact"): PreviewArtifact {
  return {
    id: artifactId,
    name: templateId === "safe-text-label" ? "Safe Text Label" : "Shipping Label",
    templateId,
    createdAt: "2026-06-20T00:00:00.000Z",
    width: 384,
    height: 120,
    renderOptions: {
      printWidthDots: 384,
      previewScale: 4,
      paperType: templateId === "safe-text-label" ? "continuous" : "gap",
      threshold: 150,
      xOffsetDots: 0,
    },
  }
}

function makeBrowserMaterialization(kind: "template" | "safe-text" = "template") {
  const artifact = makeArtifact(
    kind === "template" ? "artifact-browser-1" : "artifact-browser-safe-1",
    kind === "template" ? "shipping-compact" : "safe-text-label"
  )
  return {
    artifact,
    data: {
      preview: {
        kind: "data-url" as const,
        dataUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
      },
      packets: {
        artifactId: artifact.id,
        packetsJsonPath: "browser://packets",
        packets: ["AA=="],
        packetCount: 1,
        totalBytes: 1,
      },
    },
    source:
      kind === "template"
        ? {
            kind: "template" as const,
            templateId: "shipping-compact",
            input: {
              recipient: "Koha Cat",
              address: "Moon Street 42\nShanghai",
              orderId: "TM-001",
              note: "fragile",
            },
            renderOptions: {
              printWidthDots: 384,
              previewScale: 4,
              paperType: "gap" as const,
              threshold: 150,
              xOffsetDots: 0,
            },
          }
        : {
            kind: "safe-text" as const,
            text: "Tuckmark\nPrint OK",
            title: "Safe Text Label",
            renderOptions: {
              printWidthDots: 384,
              previewScale: 4,
              paperType: "continuous" as const,
              threshold: 150,
              xOffsetDots: 0,
            },
          },
  }
}

async function flush(times = 3): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
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

async function renderApp(context: AppContext, client?: ApiClient): Promise<void> {
  document.body.innerHTML = '<div id="root"></div>'
  const rootElement = document.getElementById("root")
  if (!rootElement) {
    throw new Error("Missing root element")
  }

  await act(async () => {
    mountedRoot = ReactDOM.createRoot(rootElement)
    mountedRoot.render(<App context={context} client={client} />)
    await flush()
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  globalThis.fetch = fetchMock
  globalThis.indexedDB = createFakeIndexedDb()
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
    artifactId: "artifact-browser-1",
    printer: {
      deviceId: "browser-printer-1",
      name: "Browser P2",
    },
    statusCode: 0,
    printable: 0,
    message: "浏览器蓝牙打印已提交。",
    packetCount: 1,
    totalBytes: 1,
  })
  browserPrinterMocks.restoreBrowserPrinter.mockReset()
  browserPrinterMocks.restoreBrowserPrinter.mockResolvedValue(null)
  browserPayloadMocks.materializeBrowserArtifactData.mockReset()
  browserPayloadMocks.materializeBrowserArtifactData.mockImplementation(async (source) =>
    makeBrowserMaterialization(source.kind)
  )
  resetBrowserArtifactStoreForTest()
  globalThis.indexedDB?.deleteDatabase("tuckmark-browser-runtime")
})

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => {
      mountedRoot?.unmount()
      await flush(1)
    })
  }
  mountedRoot = null
  globalThis.fetch = originalFetch
  globalThis.indexedDB = originalIndexedDb
  resetBrowserArtifactStoreForTest()
  document.body.innerHTML = ""
})

describe("web app", () => {
  it("escapes browser-runtime safe text once when building preview SVG", () => {
    const svg = buildSafeTextBrowserSvgForTest("A & B < C", {
      printWidthDots: 384,
      paperType: "continuous",
      threshold: 150,
      xOffsetDots: 0,
    })

    expect(svg).toContain("A &amp; B &lt; C")
    expect(svg).not.toContain("&amp;amp;")
    expect(svg).not.toContain("&amp;lt;")
  })

  it("persists browser artifacts across store reinitialization when IndexedDB is available", async () => {
    const entry = {
      artifact: makeArtifact("artifact-persist-1"),
      data: {
        preview: {
          kind: "data-url" as const,
          dataUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
        },
        packets: {
          artifactId: "artifact-persist-1",
          packetsJsonPath: "browser://packets",
          packets: ["AA=="],
          packetCount: 1,
          totalBytes: 1,
        },
      },
    }

    await writeBrowserArtifactForTest(entry)
    resetBrowserArtifactStoreForTest()

    await expect(readBrowserArtifact("artifact-persist-1")).resolves.toEqual(entry)
  })

  it("renders server-http runtime and submits current preview through /api", async () => {
    browserPrinterMocks.getSelectedBrowserPrinter.mockReturnValue(null)

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ templates: fallbackTemplates })))
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
      .mockResolvedValueOnce(new Response(JSON.stringify({ artifact: makeArtifact("artifact-1") })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            artifactId: "artifact-1",
            packetsJsonPath: "/tmp/artifact-1.packets.json",
            packets: ["AA=="],
            packetCount: 1,
            totalBytes: 1,
          })
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "completed" })))

    await renderApp(serverRuntimeContext)

    expect(document.body.textContent).toContain("Server HTTP")
    expect(document.body.textContent).toContain("Runtime mode")

    await act(async () => {
      clickByText("生成预览").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    await act(async () => {
      clickByText("打印当前预览").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/preview/template")).toBe(true)
    expect(
      fetchMock.mock.calls.some((call) => call[0] === "/api/artifacts/artifact-1/packets")
    ).toBe(true)
    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/print/artifact")).toBe(true)
    expect(browserPrinterMocks.printPreviewArtifact).not.toHaveBeenCalled()
    const previewImage = document.querySelector(
      "img[alt='preview artifact']"
    ) as HTMLImageElement | null
    expect(previewImage?.getAttribute("src")).toBe("/api/artifacts/artifact-1/png")
  })

  it("restores the previously granted browser printer after a page reload", async () => {
    browserPrinterMocks.getSelectedBrowserPrinter.mockReturnValue(null)
    browserPrinterMocks.restoreBrowserPrinter.mockResolvedValue({
      deviceId: "browser-printer-1",
      name: "Browser P2",
    })

    await renderApp(browserRuntimeContext)
    await flush()

    expect(browserPrinterMocks.restoreBrowserPrinter).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain("重新连接浏览器直连打印机")
    expect(document.body.textContent).toContain("已连接")
    expect(document.body.textContent).toContain("Browser P2")
  })

  it("clears an auto-selected service-api printer after browser-direct connect and prints through BLE", async () => {
    browserPrinterMocks.getSelectedBrowserPrinter.mockReturnValue(null)

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ templates: fallbackTemplates })))
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

    await renderApp(serverRuntimeContext)

    await act(async () => {
      clickByText("连接浏览器直连打印机").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    expect(document.body.textContent).toContain("重新连接浏览器直连打印机")
    expect(document.body.textContent).toContain("已连接")
    expect(document.body.textContent).toContain("Browser P2")

    await act(async () => {
      clickByText("生成预览").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    await act(async () => {
      clickByText("打印当前预览").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    expect(browserPrinterMocks.connectBrowserPrinter).toHaveBeenCalledOnce()
    expect(browserPrinterMocks.printPreviewArtifact).toHaveBeenCalledOnce()
    expect(browserPayloadMocks.materializeBrowserArtifactData).toHaveBeenCalled()
    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/preview/template")).toBe(false)
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/artifacts/"))).toBe(
      false
    )
    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/print/artifact")).toBe(false)
  })

  it("rebinds server printing by printer name after a stale printer id fails", async () => {
    browserPrinterMocks.getSelectedBrowserPrinter.mockReturnValue(null)

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ templates: fallbackTemplates })))
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
        new Response(JSON.stringify({ artifact: makeArtifact("artifact-stale-1") }))
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            artifactId: "artifact-stale-1",
            packetsJsonPath: "/tmp/artifact-stale-1.packets.json",
            packets: ["AA=="],
            packetCount: 1,
            totalBytes: 1,
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error:
              "Printer is no longer available: printer-1 (Mock P2). Refresh printers and retry.",
          }),
          { status: 409 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ templates: fallbackTemplates })))
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
        new Response(JSON.stringify({ id: "job-rebound-1", status: "completed" }))
      )

    await renderApp(serverRuntimeContext)

    await act(async () => {
      clickByText("生成预览").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    await act(async () => {
      clickByText("打印当前预览").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(5)
    })

    const printArtifactCalls = fetchMock.mock.calls.filter(
      (call) => call[0] === "/api/print/artifact"
    )
    expect(printArtifactCalls).toHaveLength(2)
    expect(JSON.parse(String(printArtifactCalls[0]?.[1]?.body))).toMatchObject({
      printerId: "printer-1",
      printerName: "Mock P2",
      artifactId: "artifact-stale-1",
    })
    expect(JSON.parse(String(printArtifactCalls[1]?.[1]?.body))).toMatchObject({
      printerId: "printer-2",
      printerName: "Mock P2",
      artifactId: "artifact-stale-1",
    })
    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/printers")).toBe(true)
    expect(document.body.textContent).toContain("打印任务 job-rebound-1 状态 completed。")
  })

  it("uses browser-static runtime labels and routes print through browser packets seam", async () => {
    browserPrinterMocks.getSelectedBrowserPrinter.mockReturnValue(null)

    await renderApp(browserRuntimeContext)

    expect(document.body.textContent).toContain("Browser static")
    expect(document.body.textContent).not.toContain("Service API 打印机")

    await act(async () => {
      clickByText("生成预览").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    await act(async () => {
      clickByText("连接浏览器直连打印机").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    expect(clickByText("打印当前预览").disabled).toBe(false)

    await act(async () => {
      clickByText("打印当前预览").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    expect(browserPrinterMocks.connectBrowserPrinter).toHaveBeenCalledOnce()
    expect(browserPrinterMocks.printPreviewArtifact).toHaveBeenCalledOnce()
    expect(browserPayloadMocks.materializeBrowserArtifactData).toHaveBeenCalled()
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
        return { artifact: makeArtifact("artifact-demo-1") }
      },
      async previewSafeText() {
        return { artifact: makeArtifact("artifact-demo-safe-1", "safe-text-label") }
      },
      async printArtifact() {
        return {
          id: "demo-job-1",
          status: "completed",
        }
      },
      async printTemplate() {
        return {
          preview: { artifact: makeArtifact("artifact-demo-1") },
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
          preview: { artifact: makeArtifact("artifact-demo-safe-1", "safe-text-label") },
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
            dataUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
          },
          packets: {
            artifactId: artifact.id,
            packetsJsonPath: "browser://packets",
            packets: ["AA=="],
            packetCount: 1,
            totalBytes: 1,
          },
        }
      },
    }

    await renderApp(demoContext, demoClient)

    expect(document.body.textContent).toContain("Demo mode")
    expect(document.body.textContent).toContain("成功仿真")

    await act(async () => {
      clickByText("生成预览").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    await act(async () => {
      clickByText("打印当前预览").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    expect(browserPrinterMocks.restoreBrowserPrinter).not.toHaveBeenCalled()
    expect(browserPrinterMocks.connectBrowserPrinter).not.toHaveBeenCalled()
    expect(browserPrinterMocks.printPreviewArtifact).not.toHaveBeenCalled()
  })
})
