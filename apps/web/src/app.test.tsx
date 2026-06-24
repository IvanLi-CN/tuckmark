// @vitest-environment jsdom

import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ApiClient } from "./api-client.js"
import { App } from "./app.js"
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

function makeArtifact(
  artifactId: string,
  templateId = "shipping-compact",
  source: PreviewArtifact["source"] = "template"
): PreviewArtifact {
  return {
    id: artifactId,
    name: templateId === "safe-text-label" ? "Safe Text Label" : "Shipping Label",
    templateId,
    source,
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
    input: {},
  }
}

function makeBrowserMaterialization(kind: "template" | "canvas" | "safe-text" = "template") {
  const artifact =
    kind === "canvas"
      ? makeArtifact("artifact-browser-canvas-1", "canvas-1", "canvas")
      : makeArtifact(
          kind === "template" ? "artifact-browser-1" : "artifact-browser-safe-1",
          kind === "template" ? "shipping-compact" : "safe-text-label",
          kind === "template" ? "template" : "safe_text"
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
  }
}

async function flush(times = 3): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

function queryButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(label)
  ) as HTMLButtonElement | undefined
  if (!button) {
    throw new Error(`Missing button: ${label}`)
  }
  return button
}

function _clickNav(label: string): Promise<void> {
  return act(async () => {
    queryButton(label).dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await flush()
  })
}

async function renderApp(context: AppContext, client?: ApiClient): Promise<void> {
  document.body.innerHTML = '<div id="root"></div>'
  const rootElement = document.getElementById("root")
  if (!rootElement) {
    throw new Error("Missing root element")
  }

  window.history.replaceState({}, "", "/")

  await act(async () => {
    mountedRoot = ReactDOM.createRoot(rootElement)
    mountedRoot.render(<App context={context} client={client} />)
    await flush()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  globalThis.fetch = fetchMock
  globalThis.indexedDB = createFakeIndexedDb()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  browserPrinterMocks.isBrowserPrintSupported.mockReturnValue(true)
  browserPrinterMocks.getSelectedBrowserPrinter.mockReturnValue(null)
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
  document.body.innerHTML = ""
  window.history.replaceState({}, "", "/")
  vi.useRealTimers()
})

describe("web workbench app", () => {
  it("renders the four-page shell on the homepage", async () => {
    await renderApp(browserRuntimeContext)

    expect(document.body.textContent).toContain("打印工作台")
    expect(document.body.textContent).toContain("主页")
    expect(document.body.textContent).toContain("模板")
    expect(document.body.textContent).toContain("画布")
    expect(document.body.textContent).toContain("系统")
    expect(document.body.textContent).toContain("Browser static")
    expect(document.body.textContent).toContain("Runtime mode")
  })

  it("renders template workspace and submits preview through /api on server-http runtime", async () => {
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

    await renderApp(serverRuntimeContext)

    await act(async () => {
      const nav = document.querySelector("a[href='/templates']") as HTMLAnchorElement | null
      nav?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    await act(async () => {
      queryButton("生成预览").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(4)
    })

    expect(document.body.textContent).toContain("模板列表")
    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/preview/template")).toBe(true)
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes("/api/artifacts/artifact-1/packets")
      )
    ).toBe(true)
    expect(document.querySelector("img[alt='preview artifact']")).not.toBeNull()
  })

  it("auto-generates template preview when a table row is selected on server-http runtime", async () => {
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
        new Response(JSON.stringify({ artifact: makeArtifact("artifact-auto-1") }))
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            artifactId: "artifact-auto-1",
            packetsJsonPath: "/tmp/artifact-auto-1.packets.json",
            packets: ["AA=="],
            packetCount: 1,
            totalBytes: 1,
          })
        )
      )

    await renderApp(serverRuntimeContext)

    await act(async () => {
      const nav = document.querySelector("a[href='/templates']") as HTMLAnchorElement | null
      nav?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    await act(async () => {
      const firstRow = document.querySelector(".tm-table tbody tr") as HTMLTableRowElement | null
      firstRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(4)
    })

    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/preview/template")).toBe(true)
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes("/api/artifacts/artifact-auto-1/packets")
      )
    ).toBe(true)
    expect(document.querySelector("img[alt='preview artifact']")).not.toBeNull()
  })

  it("debounces template preview refresh after editing the selected row", async () => {
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
        new Response(JSON.stringify({ artifact: makeArtifact("artifact-auto-1") }))
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            artifactId: "artifact-auto-1",
            packetsJsonPath: "/tmp/artifact-auto-1.packets.json",
            packets: ["AA=="],
            packetCount: 1,
            totalBytes: 1,
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ artifact: makeArtifact("artifact-auto-2") }))
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            artifactId: "artifact-auto-2",
            packetsJsonPath: "/tmp/artifact-auto-2.packets.json",
            packets: ["AA=="],
            packetCount: 1,
            totalBytes: 1,
          })
        )
      )

    await renderApp(serverRuntimeContext)

    await act(async () => {
      const nav = document.querySelector("a[href='/templates']") as HTMLAnchorElement | null
      nav?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    await act(async () => {
      const firstRow = document.querySelector(".tm-table tbody tr") as HTMLTableRowElement | null
      firstRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(4)
    })

    expect(fetchMock.mock.calls.filter((call) => call[0] === "/api/preview/template")).toHaveLength(
      1
    )

    await act(async () => {
      const firstCellButton = document.querySelector(
        ".tm-table tbody tr button.tm-table__cell"
      ) as HTMLButtonElement | null
      firstCellButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    const input = document.querySelector(".tm-table tbody tr input") as HTMLInputElement | null
    expect(input).not.toBeNull()

    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
      descriptor?.set?.call(input, "Koha Cat Updated")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
      await flush()
    })

    expect(fetchMock.mock.calls.filter((call) => call[0] === "/api/preview/template")).toHaveLength(
      1
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(319)
      await flush()
    })

    expect(fetchMock.mock.calls.filter((call) => call[0] === "/api/preview/template")).toHaveLength(
      1
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
      await flush(4)
    })

    expect(fetchMock.mock.calls.filter((call) => call[0] === "/api/preview/template")).toHaveLength(
      2
    )
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes("/api/artifacts/artifact-auto-2/packets")
      )
    ).toBe(true)
  })

  it("restores browser printer state into the device button label", async () => {
    browserPrinterMocks.restoreBrowserPrinter.mockResolvedValue({
      deviceId: "browser-printer-1",
      name: "Browser P2",
    })

    await renderApp(browserRuntimeContext)
    await flush()

    expect(browserPrinterMocks.restoreBrowserPrinter).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain("Browser P2")
  })

  it("opens the device drawer and connects browser direct printer", async () => {
    await renderApp(browserRuntimeContext)

    await act(async () => {
      const deviceButtons = Array.from(document.querySelectorAll("button")).filter((item) =>
        item.textContent?.includes("选择设备")
      )
      deviceButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    expect(document.body.textContent).toContain("设备与打印路径")

    await act(async () => {
      queryButton("连接浏览器直连打印机").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(4)
    })

    expect(browserPrinterMocks.connectBrowserPrinter).toHaveBeenCalledOnce()
  })

  it("keeps demo mode on the formal app surface without touching hardware APIs", async () => {
    const demoClient: ApiClient = {
      async listTemplates() {
        return fallbackTemplates
      },
      async listPrinters() {
        return []
      },
      async probePrinter(input) {
        return {
          ok: true,
          printerId: input.printerId,
          printerName: input.printerName,
          stage: "complete",
          message: "成功仿真",
          log: [],
          timingsMs: {},
        }
      },
      async previewTemplate() {
        return { artifact: makeArtifact("artifact-demo-1") }
      },
      async previewCanvas() {
        return { artifact: makeArtifact("artifact-demo-canvas-1", "canvas-1", "canvas") }
      },
      async previewSafeText() {
        return { artifact: makeArtifact("artifact-demo-safe-1", "safe-text-label", "safe_text") }
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
      async printCanvas() {
        return {
          preview: { artifact: makeArtifact("artifact-demo-canvas-1", "canvas-1", "canvas") },
          job: {
            id: "demo-canvas-1",
            status: "completed",
            artifactId: "artifact-demo-canvas-1",
            printerId: "demo-printer",
          },
        }
      },
      async printSafeText() {
        return {
          preview: {
            artifact: makeArtifact("artifact-demo-safe-1", "safe-text-label", "safe_text"),
          },
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

    await act(async () => {
      const nav = document.querySelector("a[href='/templates']") as HTMLAnchorElement | null
      nav?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    await act(async () => {
      queryButton("生成预览").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(4)
    })

    await act(async () => {
      queryButton("直接打印").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(4)
    })

    expect(document.body.textContent).toContain("completed")
    expect(browserPrinterMocks.restoreBrowserPrinter).not.toHaveBeenCalled()
    expect(browserPrinterMocks.connectBrowserPrinter).not.toHaveBeenCalled()
    expect(browserPrinterMocks.printPreviewArtifact).not.toHaveBeenCalled()
  })
})
