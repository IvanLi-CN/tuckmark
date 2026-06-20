// @vitest-environment jsdom

import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildSafeTextBrowserSvgForTest,
  readBrowserArtifact,
  resetBrowserArtifactStoreForTest,
  writeBrowserArtifactForTest,
} from "./browser-runtime.js"

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
        error: DOMException | null
        onerror: IDBRequest<undefined>["onerror"]
        onsuccess: IDBRequest<undefined>["onsuccess"]
        result: undefined
        source: IDBRequest<undefined>["source"]
        transaction: IDBRequest<undefined>["transaction"]
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
                      error: DOMException | null
                      onerror: IDBRequest<unknown>["onerror"]
                      result: unknown
                      onsuccess: IDBRequest<unknown>["onsuccess"]
                      source: IDBRequest<unknown>["source"]
                      transaction: IDBRequest<unknown>["transaction"]
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
                      error: DOMException | null
                      onerror: IDBRequest<string>["onerror"]
                      result: string
                      onsuccess: IDBRequest<string>["onsuccess"]
                      source: IDBRequest<string>["source"]
                      transaction: IDBRequest<string>["transaction"]
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
  vi.stubGlobal("indexedDB", createFakeIndexedDb())
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
  resetBrowserArtifactStoreForTest()
  globalThis.indexedDB?.deleteDatabase("tuckmark-browser-runtime")
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetBrowserArtifactStoreForTest()
  globalThis.indexedDB?.deleteDatabase("tuckmark-browser-runtime")
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
      artifact: {
        id: "artifact-persist-1",
        name: "Persisted",
        createdAt: "2026-06-20T00:00:00.000Z",
        width: 384,
        height: 120,
        renderOptions: {
          printWidthDots: 384,
          previewScale: 4,
          paperType: "continuous" as const,
          threshold: 150,
          xOffsetDots: 0,
        },
      },
      data: {
        preview: {
          kind: "data-url" as const,
          dataUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
        },
        packets: {
          artifactId: "artifact-persist-1",
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
