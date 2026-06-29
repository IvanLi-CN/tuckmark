// @vitest-environment jsdom

import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { emptySyncState } from "../../../packages/core/src/web.js"
import type { ApiClient } from "./api-client.js"
import { App } from "./app.js"
import { createDraftFromPreset, getDraftStorageKey, getPresetById } from "./canvas-editor-model.js"
import { fallbackTemplates } from "./demo-data.js"
import { loadRecentActivity } from "./lib/recent-activity.js"
import type { AppContext, PreviewArtifact } from "./types.js"
import {
  loadWorkingCopy,
  readUserTemplateHistory,
  resetUserTemplateStoreForTest,
  saveUserTemplate,
  saveUserTemplateAutosave,
} from "./user-template-store.js"

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

vi.mock("react-konva", async () => {
  const React = await import("react")
  const createMockNode = (options?: { imperativeHandle?: object }) =>
    React.forwardRef<object, React.HTMLAttributes<HTMLElement>>(function MockNode(props, ref) {
      const { children } = props
      React.useImperativeHandle<object, object>(ref, () => options?.imperativeHandle ?? {}, [])
      return React.createElement("div", null, children)
    })

  return {
    Group: createMockNode(),
    Layer: createMockNode(),
    Line: createMockNode(),
    Rect: createMockNode(),
    Stage: createMockNode(),
    Text: createMockNode(),
    Transformer: createMockNode({
      imperativeHandle: {
        nodes() {},
        shouldOverdrawWholeArea() {},
        getLayer() {
          return {
            batchDraw() {},
          }
        },
      },
    }),
  }
})

vi.mock("./browser-printer.js", () => browserPrinterMocks)
vi.mock("./browser-print-payload.js", () => browserPayloadMocks)

const fetchMock = vi.fn<typeof fetch>()
const originalFetch = globalThis.fetch
const originalIndexedDb = globalThis.indexedDB
const originalMatchMedia = window.matchMedia
let mountedRoot: ReturnType<typeof ReactDOM.createRoot> | null = null
let viewportWidth = 1440

function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key) {
      return store.get(key) ?? null
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key) {
      store.delete(key)
    },
    setItem(key, value) {
      store.set(key, value)
    },
  }
}

function installLocalStorage(storage: Storage): Storage {
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  })
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    })
  }
  return storage
}

function createCanvasContextStub(): CanvasRenderingContext2D {
  return {
    font: "",
    fillStyle: "#000000",
    scale() {},
    transform() {},
    setTransform() {},
    resetTransform() {},
    translate() {},
    rotate() {},
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    bezierCurveTo() {},
    quadraticCurveTo() {},
    arc() {},
    rect() {},
    clip() {},
    stroke() {},
    fill() {},
    clearRect() {},
    strokeRect() {},
    fillRect() {},
    setLineDash() {},
    measureText(text: string) {
      return { width: Math.max(Array.from(text).length, 1) * 7.25 } as TextMetrics
    },
    drawImage() {},
    getImageData(_sx: number, _sy: number, sw: number, sh: number) {
      const width = Math.max(Math.floor(sw), 1)
      const height = Math.max(Math.floor(sh), 1)
      return {
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
        colorSpace: "srgb",
      } as ImageData
    },
    putImageData() {},
  } as unknown as CanvasRenderingContext2D
}

function installCanvasStubs(): void {
  if (typeof HTMLCanvasElement === "undefined") {
    return
  }

  const contextStub = createCanvasContextStub()
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    value: () => contextStub,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
    value: () => "data:image/png;base64,",
    configurable: true,
    writable: true,
  })
  Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
    value: (callback: BlobCallback) => callback(new Blob([""], { type: "image/png" })),
    configurable: true,
    writable: true,
  })
}

const memoryStorage = installLocalStorage(createMemoryStorage())

installCanvasStubs()

function matchesMediaQuery(query: string, width: number) {
  const minMatch = query.match(/\(min-width:\s*(\d+)px\)/)
  if (minMatch) {
    return width >= Number(minMatch[1])
  }

  const maxMatch = query.match(/\(max-width:\s*(\d+)px\)/)
  if (maxMatch) {
    return width <= Number(maxMatch[1])
  }

  return false
}

function createMatchMediaResult(query: string): MediaQueryList {
  return {
    matches: matchesMediaQuery(query, viewportWidth),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return true
    },
  } as MediaQueryList
}

function createFakeIndexedDb(): IDBFactory {
  const databases = new Map<string, Map<string, Map<string, unknown>>>()

  function createDomStringList(values: string[]): DOMStringList {
    return {
      length: values.length,
      item(index: number) {
        return values[index] ?? null
      },
      contains(value: string) {
        return values.includes(value)
      },
    } as DOMStringList
  }

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
        const objectStoreIndexMaps = new Map<
          string,
          Map<string, { keyPath: string | string[]; unique: boolean }>
        >()
        const database = {
          close() {},
          createObjectStore(storeName: string) {
            if (!stores.has(storeName)) {
              stores.set(storeName, new Map())
            }
            if (!objectStoreIndexMaps.has(storeName)) {
              objectStoreIndexMaps.set(storeName, new Map())
            }
            return {
              createIndex(
                indexName: string,
                keyPath: string | string[],
                options?: IDBIndexParameters
              ) {
                objectStoreIndexMaps
                  .get(storeName)
                  ?.set(indexName, { keyPath, unique: options?.unique ?? false })
                return {} as IDBIndex
              },
            } as IDBObjectStore
          },
          deleteObjectStore() {},
          transaction(storeNames: string | string[]) {
            const names = Array.isArray(storeNames) ? storeNames : [storeNames]
            for (const storeName of names) {
              if (!stores.has(storeName)) {
                stores.set(storeName, new Map())
              }
              if (!objectStoreIndexMaps.has(storeName)) {
                objectStoreIndexMaps.set(storeName, new Map())
              }
            }
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
              objectStoreNames: createDomStringList(names),
              objectStore(requestedStoreName: string) {
                const store = stores.get(requestedStoreName) as Map<string, unknown>
                const indexDefinitions = objectStoreIndexMaps.get(requestedStoreName) ?? new Map()

                const readIndexItems = (indexName: string, query: unknown) => {
                  const definition = indexDefinitions.get(indexName)
                  if (!definition) {
                    return []
                  }
                  return Array.from(store.values()).filter((value) => {
                    const record = value as Record<string, unknown>
                    if (Array.isArray(definition.keyPath)) {
                      const expected = Array.isArray(query) ? query : [query]
                      return definition.keyPath.every(
                        (segment: string, index: number) => record[segment] === expected[index]
                      )
                    }
                    return record[definition.keyPath] === query
                  })
                }

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
                  getAll() {
                    const getAllRequest = createRequest<unknown[]>() as unknown as {
                      readyState: IDBRequestReadyState
                      result: unknown[]
                      onsuccess: IDBRequest<unknown[]>["onsuccess"]
                    }
                    queueMicrotask(() => {
                      getAllRequest.readyState = "done"
                      getAllRequest.result = Array.from(store.values()).map((value) =>
                        structuredClone(value)
                      )
                      getAllRequest.onsuccess?.call(
                        getAllRequest as unknown as IDBRequest<unknown[]>,
                        new Event("success")
                      )
                    })
                    return getAllRequest
                  },
                  delete(key: string) {
                    const deleteRequest = createRequest<undefined>() as unknown as {
                      readyState: IDBRequestReadyState
                      result: undefined
                      onsuccess: IDBRequest<undefined>["onsuccess"]
                    }
                    queueMicrotask(() => {
                      store.delete(key)
                      deleteRequest.readyState = "done"
                      deleteRequest.result = undefined
                      deleteRequest.onsuccess?.call(
                        deleteRequest as unknown as IDBRequest<undefined>,
                        new Event("success")
                      )
                    })
                    return deleteRequest
                  },
                  clear() {
                    const clearRequest = createRequest<undefined>() as unknown as {
                      readyState: IDBRequestReadyState
                      result: undefined
                      onsuccess: IDBRequest<undefined>["onsuccess"]
                    }
                    queueMicrotask(() => {
                      store.clear()
                      clearRequest.readyState = "done"
                      clearRequest.result = undefined
                      clearRequest.onsuccess?.call(
                        clearRequest as unknown as IDBRequest<undefined>,
                        new Event("success")
                      )
                    })
                    return clearRequest
                  },
                  index(indexName: string) {
                    return {
                      objectStore: this as IDBObjectStore,
                      getAll(query?: unknown) {
                        const request = createRequest<unknown[]>() as unknown as {
                          readyState: IDBRequestReadyState
                          result: unknown[]
                          onsuccess: IDBRequest<unknown[]>["onsuccess"]
                        }
                        queueMicrotask(() => {
                          request.readyState = "done"
                          request.result = readIndexItems(indexName, query).map((value) =>
                            structuredClone(value)
                          )
                          request.onsuccess?.call(
                            request as unknown as IDBRequest<unknown[]>,
                            new Event("success")
                          )
                        })
                        return request
                      },
                      getAllKeys(query?: unknown) {
                        const request = createRequest<unknown[]>() as unknown as {
                          readyState: IDBRequestReadyState
                          result: unknown[]
                          onsuccess: IDBRequest<unknown[]>["onsuccess"]
                        }
                        queueMicrotask(() => {
                          request.readyState = "done"
                          request.result = readIndexItems(indexName, query).map((value) => {
                            const record = value as Record<string, unknown>
                            return String(record.id ?? record.sourceKey ?? "")
                          })
                          request.onsuccess?.call(
                            request as unknown as IDBRequest<unknown[]>,
                            new Event("success")
                          )
                        })
                        return request
                      },
                    } as IDBIndex
                  },
                  put(value: { artifact: { id: string } }) {
                    const putRequest = createRequest<string>() as unknown as {
                      readyState: IDBRequestReadyState
                      result: string
                      onsuccess: IDBRequest<string>["onsuccess"]
                    }
                    queueMicrotask(() => {
                      const record = value as Record<string, unknown>
                      const artifact =
                        typeof record.artifact === "object" && record.artifact !== null
                          ? (record.artifact as { id?: string })
                          : undefined
                      const key = String(record.id ?? record.sourceKey ?? artifact?.id ?? "")
                      store.set(key, structuredClone(value))
                      putRequest.readyState = "done"
                      putRequest.result = key
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
          objectStoreNames: createDomStringList(Array.from(stores.keys())),
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

async function renderApp(context: AppContext, client?: ApiClient, path = "/"): Promise<void> {
  document.body.innerHTML = '<div id="root"></div>'
  const rootElement = document.getElementById("root")
  if (!rootElement) {
    throw new Error("Missing root element")
  }

  window.history.replaceState({}, "", path)

  await act(async () => {
    mountedRoot = ReactDOM.createRoot(rootElement)
    mountedRoot.render(<App context={context} client={client} />)
    await flush()
  })
}

beforeEach(async () => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  globalThis.fetch = fetchMock
  globalThis.indexedDB = createFakeIndexedDb()
  viewportWidth = 1440
  window.matchMedia = vi.fn((query: string) => createMatchMediaResult(query))
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

  memoryStorage.clear()
  await resetUserTemplateStoreForTest()
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
  window.matchMedia = originalMatchMedia
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
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: emptySyncState() })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: emptySyncState() })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: emptySyncState() })))
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
      fetchMock.mock.calls.some(
        (call) =>
          String(call[0]).includes("/api/artifacts/") && String(call[0]).endsWith("/packets")
      )
    ).toBe(true)
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
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: emptySyncState() })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: emptySyncState() })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: emptySyncState() })))
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
      fetchMock.mock.calls.some(
        (call) =>
          String(call[0]).includes("/api/artifacts/") && String(call[0]).endsWith("/packets")
      )
    ).toBe(true)
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
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: emptySyncState() })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: emptySyncState() })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: emptySyncState() })))
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

    expect(
      fetchMock.mock.calls.filter((call) => call[0] === "/api/preview/template").length
    ).toBeGreaterThanOrEqual(1)

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

    const previewCallsAfterEdit = fetchMock.mock.calls.filter(
      (call) => call[0] === "/api/preview/template"
    ).length
    expect(previewCallsAfterEdit).toBeGreaterThanOrEqual(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(319)
      await flush()
    })

    const previewCallsBeforeDebounce = fetchMock.mock.calls.filter(
      (call) => call[0] === "/api/preview/template"
    ).length
    expect(previewCallsBeforeDebounce).toBe(previewCallsAfterEdit)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
      await flush(4)
    })

    expect(
      fetchMock.mock.calls.filter((call) => call[0] === "/api/preview/template").length
    ).toBeGreaterThan(previewCallsBeforeDebounce)
    expect(
      fetchMock.mock.calls.some(
        (call) =>
          String(call[0]).includes("/api/artifacts/") && String(call[0]).endsWith("/packets")
      )
    ).toBe(true)
  })

  it("hydrates recent activity from sync state on server-http startup", async () => {
    const syncedState = {
      ...emptySyncState(),
      updatedAt: "2026-06-28T10:00:00.000Z",
      templateUsageRecords: [
        {
          kind: "template_usage" as const,
          recordId: "template:shipping-compact",
          version: 1,
          vectorClock: { browser: 1, service: 0 },
          updatedAt: "2026-06-28T10:00:00.000Z",
          hash: "template-hash",
          deleted: false,
          conflicts: [],
          payload: {
            id: "shipping-compact",
            name: "Shipping Label",
            description: "Recent template",
            usedAt: "2026-06-28T10:00:00.000Z",
          },
        },
      ],
      recentPrintRecords: [
        {
          kind: "recent_print" as const,
          recordId: "print:template:shipping-compact",
          version: 1,
          vectorClock: { browser: 1, service: 0 },
          updatedAt: "2026-06-28T10:05:00.000Z",
          hash: "print-hash",
          deleted: false,
          conflicts: [],
          payload: {
            id: "template:shipping-compact",
            title: "shipping-compact",
            kind: "template" as const,
            printedAt: "2026-06-28T10:05:00.000Z",
            printerName: "Mock P2",
          },
        },
      ],
      canvasDraftRecords: [],
    }

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
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: syncedState })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: syncedState })))

    await renderApp(serverRuntimeContext)
    await flush(6)

    expect(document.body.textContent).toContain("Shipping Label")
    expect(document.body.textContent).toContain("Mock P2")
    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/sync/state")).toBe(true)
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
      async getSyncState() {
        return emptySyncState()
      },
      async mergeSyncState(state) {
        return state
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

  it("keeps the source user-template working copy when saving as a new template", async () => {
    const baseDraft = createDraftFromPreset(getPresetById("shipping-wide"))
    const saved = await saveUserTemplate({
      name: "Source Template",
      document: {
        ...baseDraft,
        name: "Source Template",
        source: { kind: "user-template", templateId: "seed-will-be-replaced" },
      },
    })

    const unsavedDraft = structuredClone(saved.workingCopy.draft)
    unsavedDraft.name = "Source Template Draft"
    unsavedDraft.fields = unsavedDraft.fields.map((field, index) =>
      index === 0 ? { ...field, defaultValue: "Unsaved Receiver" } : field
    )
    await saveUserTemplateAutosave({
      templateId: saved.template.id,
      source: { kind: "user-template", templateId: saved.template.id },
      document: unsavedDraft,
      sourceVersionId: saved.version.id,
    })

    const originalPrompt = window.prompt
    window.prompt = () => "Copied Template"
    try {
      await renderApp(
        browserRuntimeContext,
        undefined,
        `/canvas?source=user-template&templateId=${saved.template.id}`
      )
      await flush(8)

      await act(async () => {
        queryButton("另存为").dispatchEvent(new MouseEvent("click", { bubbles: true }))
        await flush(8)
      })

      const templates = await readUserTemplateHistory(saved.template.id)
      expect(templates?.autosaves).toHaveLength(1)

      const workingCopy = await loadWorkingCopy({
        kind: "user-template",
        templateId: saved.template.id,
      })
      expect(workingCopy?.draft.name).toBe("Source Template Draft")
    } finally {
      window.prompt = originalPrompt
    }
  })

  it("does not create an autosave when opening an unchanged user template", async () => {
    const baseDraft = createDraftFromPreset(getPresetById("shipping-wide"))
    const saved = await saveUserTemplate({
      name: "Stable Template",
      document: {
        ...baseDraft,
        name: "Stable Template",
        source: { kind: "user-template", templateId: "seed-will-be-replaced" },
      },
    })

    await renderApp(
      browserRuntimeContext,
      undefined,
      `/canvas?source=user-template&templateId=${saved.template.id}`
    )
    await flush(8)

    const history = await readUserTemplateHistory(saved.template.id)
    expect(history?.saved).toHaveLength(1)
    expect(history?.autosaves).toHaveLength(0)
  })

  it("does not persist user-template undo state into scratch draft storage", async () => {
    const baseDraft = createDraftFromPreset(getPresetById("shipping-wide"))
    const saved = await saveUserTemplate({
      name: "Undo Source",
      document: {
        ...baseDraft,
        name: "Undo Source",
        source: { kind: "user-template", templateId: "seed-will-be-replaced" },
      },
    })

    const savedDraftStorageKey = getDraftStorageKey("shipping-wide")
    expect(memoryStorage.getItem(savedDraftStorageKey)).toBeNull()

    await renderApp(
      browserRuntimeContext,
      undefined,
      `/canvas?source=user-template&templateId=${saved.template.id}`
    )
    await flush(8)

    await act(async () => {
      queryButton("文本").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(4)
    })

    await act(async () => {
      queryButton("撤销").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(4)
    })

    expect(memoryStorage.getItem(savedDraftStorageKey)).toBeNull()
  })

  it("prefers synced scratch drafts over stale indexeddb working copies on startup", async () => {
    const preset = getPresetById("shipping-wide")
    const syncedDraft = createDraftFromPreset(preset)
    syncedDraft.name = "Synced scratch draft"
    window.localStorage.setItem(getDraftStorageKey(preset.id), JSON.stringify(syncedDraft))

    const staleDraft = structuredClone(syncedDraft)
    staleDraft.name = "Stale indexeddb draft"
    await saveUserTemplateAutosave({
      source: { kind: "scratch", presetId: preset.id },
      document: staleDraft,
    })

    await renderApp(
      browserRuntimeContext,
      undefined,
      `/canvas?source=scratch&presetId=${preset.id}`
    )
    await flush(8)

    expect(document.body.textContent).toContain("当前草稿：Synced scratch draft")
    expect(document.body.textContent).not.toContain("当前草稿：Stale indexeddb draft")
  })

  it("persists grid and snap toggles into the user-template working copy", async () => {
    const baseDraft = createDraftFromPreset(getPresetById("shipping-wide"))
    const saved = await saveUserTemplate({
      name: "Assist Settings",
      document: {
        ...baseDraft,
        name: "Assist Settings",
        source: { kind: "user-template", templateId: "seed-will-be-replaced" },
      },
    })

    await renderApp(
      browserRuntimeContext,
      undefined,
      `/canvas?source=user-template&templateId=${saved.template.id}`
    )
    await flush(8)

    await act(async () => {
      queryButton("网格").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(4)
    })

    await act(async () => {
      queryButton("吸附").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(4)
    })

    const workingCopy = await loadWorkingCopy({
      kind: "user-template",
      templateId: saved.template.id,
    })
    expect(workingCopy?.draft.editor.gridEnabled).toBe(false)
    expect(workingCopy?.draft.editor.snapEnabled).toBe(false)
  })

  it("records recent template usage when previewing a user template row", async () => {
    const baseDraft = createDraftFromPreset(getPresetById("shipping-wide"))
    const saved = await saveUserTemplate({
      name: "Recent User Template",
      description: "User template recent activity",
      document: {
        ...baseDraft,
        name: "Recent User Template",
        source: { kind: "user-template", templateId: "seed-will-be-replaced" },
      },
    })

    await renderApp(browserRuntimeContext, undefined, "/templates")
    await flush(8)

    await act(async () => {
      const targetCard = Array.from(document.querySelectorAll(".tm-template-card")).find((item) =>
        item.textContent?.includes("Recent User Template")
      ) as HTMLElement | undefined
      const surface = targetCard?.querySelector(
        ".tm-template-card__surface"
      ) as HTMLButtonElement | null
      surface?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(8)
    })

    await act(async () => {
      queryButton("生成预览").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(8)
    })

    const recent = loadRecentActivity()
    expect(recent.templates[0]?.id).toBe(saved.template.id)
    expect(recent.templates[0]?.name).toBe("Recent User Template")
  })
})
