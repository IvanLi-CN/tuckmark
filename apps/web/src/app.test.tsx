// @vitest-environment jsdom

import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { emptySyncState, resolveTextLayout } from "../../../packages/core/src/web.js"
import type { ApiClient } from "./api-client.js"
import { App } from "./app.js"
import {
  createDraftFromPreset,
  getDraftStorageKey,
  getElementSelectionBounds,
  getPresetById,
  toggleElementBinding,
} from "./canvas-editor-model.js"
import {
  cancelPendingPastePlacement,
  confirmPendingPastePlacement,
  createCanvasStateFromDraft,
  createSelectionDragPreview,
  isTransformerInteractionTarget,
  movePendingPasteToPoint,
  normalizeTransformedElementGeometry,
  projectCanvasTransformerBoxToStage,
  projectStageTransformerBoxToCanvas,
  startClipboardPastePlacement,
  zoomViewportAtPointer,
} from "./canvas-page.js"
import { buildInputFromTemplate, fallbackTemplates } from "./demo-data.js"
import { CANVAS_DOTS_PER_MILLIMETER } from "./lib/canvas-units.js"
import { loadRecentActivity } from "./lib/recent-activity.js"
import type { PwaUpdateSnapshot } from "./pwa-lifecycle.js"
import type { AppContext, CanvasDraftElement, PreviewArtifact } from "./types.js"
import {
  loadWorkingCopy,
  readUserTemplateHistory,
  replaceUserTemplateWorkingCopy,
  resetUserTemplateStoreForTest,
  saveUserTemplate,
  saveUserTemplateAutosave,
} from "./user-template-store.js"
import { WorkbenchApp } from "./workbench-app.js"

let heldUserTemplateLoadRelease: (() => void) | null = null

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

const pwaToastMocks = vi.hoisted(() => ({
  applyPwaUpdate: vi.fn(),
  usePwaUpdate: vi.fn<() => PwaUpdateSnapshot>(() => ({
    status: "idle",
    source: "none",
    registration: null,
    waitingWorker: null,
    detectedBuildMetadata: null,
    error: null,
  })),
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
vi.mock("./pwa-update-toast.js", async () => {
  const React = await import("react")
  return {
    applyPwaUpdate: pwaToastMocks.applyPwaUpdate,
    usePwaUpdate: pwaToastMocks.usePwaUpdate,
    PwaUpdateToast({
      snapshot,
      onUpdate,
    }: {
      snapshot: { status: string; error: string | null }
      onUpdate: () => void
    }) {
      const [confirmOpen, setConfirmOpen] = React.useState(false)
      if (snapshot.status !== "ready") {
        return null
      }
      return React.createElement(
        "aside",
        { "aria-label": "Tuckmark Web update status" },
        React.createElement("span", null, "新版本可用"),
        React.createElement(
          "button",
          {
            onClick: () => setConfirmOpen(true),
          },
          "更新"
        ),
        confirmOpen
          ? React.createElement(
              "div",
              { role: "dialog", "aria-label": "确认更新 Tuckmark Web" },
              React.createElement("p", null, "更新会刷新当前页面。"),
              React.createElement(
                "button",
                {
                  onClick: () => setConfirmOpen(false),
                },
                "稍后"
              ),
              React.createElement(
                "button",
                {
                  onClick: () => {
                    setConfirmOpen(false)
                    onUpdate()
                  },
                },
                "更新"
              )
            )
          : null
      )
    },
  }
})

const fetchMock = vi.fn<typeof fetch>()
const originalFetch = globalThis.fetch
const originalIndexedDb = globalThis.indexedDB
const originalMatchMedia = window.matchMedia
const originalNavigatorClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard")
const originalClipboardItem = globalThis.ClipboardItem
const originalSecureContext = Object.getOwnPropertyDescriptor(window, "isSecureContext")
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

type ClipboardBlobMap = Record<string, Blob>

class FakeClipboardItem {
  readonly data: ClipboardBlobMap
  readonly types: string[]

  constructor(data: ClipboardBlobMap) {
    this.data = data
    this.types = Object.keys(data)
  }

  async getType(type: string): Promise<Blob> {
    const blob = this.data[type]
    if (!blob) {
      throw new DOMException(`Missing clipboard type: ${type}`, "NotFoundError")
    }
    return blob
  }
}

function createClipboardItemFromTextMap(data: Record<string, string>) {
  return new FakeClipboardItem(
    Object.fromEntries(
      Object.entries(data).map(([type, value]) => [
        type,
        new Blob([value], {
          type: type.startsWith("web ") ? type.slice(4) : type,
        }),
      ])
    )
  )
}

let clipboardItems: FakeClipboardItem[] = []

const clipboardMocks = vi.hoisted(() => ({
  read: vi.fn(async () => clipboardItems),
  write: vi.fn(async (items: FakeClipboardItem[]) => {
    clipboardItems = items.map((item) => new FakeClipboardItem(item.data))
  }),
}))

function createClipboardData(initial?: Record<string, string>): DataTransfer {
  const store = new Map(Object.entries(initial ?? {}))
  return {
    dropEffect: "none",
    effectAllowed: "all",
    files: {} as FileList,
    items: {} as DataTransferItemList,
    types: Array.from(store.keys()),
    clearData(format?: string) {
      if (format) {
        store.delete(format)
      } else {
        store.clear()
      }
    },
    getData(format: string) {
      return store.get(format) ?? ""
    },
    setData(format: string, data: string) {
      store.set(format, data)
      return true
    },
    setDragImage() {},
  } as DataTransfer
}

function dispatchClipboardEvent(
  type: "copy" | "paste",
  clipboardData: DataTransfer,
  target: Window | HTMLElement = window
) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, "clipboardData", {
    value: clipboardData,
    configurable: true,
  })
  target.dispatchEvent(event)
  return event
}

async function readStoredClipboardText(type: string): Promise<string | null> {
  const item = clipboardItems[0]
  if (!item?.types.includes(type)) {
    return null
  }
  return (await item.getType(type)).text()
}

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
  const databaseIndexMaps = new Map<
    string,
    Map<string, Map<string, { keyPath: string | string[]; unique: boolean }>>
  >()

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
      databaseIndexMaps.delete(name)
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
        const objectStoreIndexMaps =
          databaseIndexMaps.get(name) ??
          new Map<string, Map<string, { keyPath: string | string[]; unique: boolean }>>()
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
          databaseIndexMaps.set(name, objectStoreIndexMaps)
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

function queryCanvasLayerNameInputs(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll('.tm-layer-list--inspector input[aria-label$="图层名称"]')
  ) as HTMLInputElement[]
}

async function selectFirstCanvasLayer(): Promise<HTMLInputElement> {
  const [layerNameInput] = queryCanvasLayerNameInputs()
  if (!layerNameInput) {
    throw new Error("Missing first canvas layer input")
  }

  await act(async () => {
    layerNameInput.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await flush()
  })

  return layerNameInput
}

function dispatchWindowKey(key: string, options?: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, ...options })
  window.dispatchEvent(event)
  return event
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

async function renderWorkbenchApp(
  context: AppContext,
  canvasScenario: Parameters<typeof WorkbenchApp>[0]["canvasScenario"],
  path = "/canvas"
): Promise<void> {
  document.body.innerHTML = '<div id="root"></div>'
  const rootElement = document.getElementById("root")
  if (!rootElement) {
    throw new Error("Missing root element")
  }

  window.history.replaceState({}, "", path)

  await act(async () => {
    mountedRoot = ReactDOM.createRoot(rootElement)
    mountedRoot.render(<WorkbenchApp context={context} canvasScenario={canvasScenario} />)
    await flush()
  })
}

function beginHoldingUserTemplateLoad(): Promise<void> {
  return new Promise<void>((resolve) => {
    heldUserTemplateLoadRelease = () => {
      heldUserTemplateLoadRelease = null
      resolve()
    }
  })
}

function releaseHeldUserTemplateLoad(): void {
  heldUserTemplateLoadRelease?.()
}

beforeEach(async () => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  clipboardItems = []
  clipboardMocks.read.mockClear()
  clipboardMocks.write.mockClear()
  Object.defineProperty(globalThis, "__TUCKMARK_APP_VERSION__", {
    value: "0.1.0",
    configurable: true,
  })
  Object.defineProperty(globalThis, "__TUCKMARK_BUILD_REF__", {
    value: "",
    configurable: true,
  })
  Object.defineProperty(globalThis, "__TUCKMARK_REPOSITORY_URL__", {
    value: "https://github.com/IvanLi-CN/tuckmark",
    configurable: true,
  })
  Object.defineProperty(globalThis, "__TUCKMARK_RIGHTS_URL__", {
    value: "https://ivanli.cc/",
    configurable: true,
  })
  globalThis.fetch = fetchMock
  globalThis.indexedDB = createFakeIndexedDb()
  viewportWidth = 1440
  window.matchMedia = vi.fn((query: string) => createMatchMediaResult(query))
  Object.defineProperty(navigator, "clipboard", {
    value: clipboardMocks,
    configurable: true,
  })
  Object.defineProperty(globalThis, "ClipboardItem", {
    value: FakeClipboardItem,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  })
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
  pwaToastMocks.applyPwaUpdate.mockReset()
  pwaToastMocks.usePwaUpdate.mockReturnValue({
    status: "idle",
    source: "none",
    registration: null,
    waitingWorker: null,
    detectedBuildMetadata: null,
    error: null,
  })

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
  if (originalNavigatorClipboard) {
    Object.defineProperty(navigator, "clipboard", originalNavigatorClipboard)
  } else {
    Reflect.deleteProperty(navigator, "clipboard")
  }
  if (originalClipboardItem) {
    Object.defineProperty(globalThis, "ClipboardItem", {
      value: originalClipboardItem,
      configurable: true,
      writable: true,
    })
  } else {
    Reflect.deleteProperty(globalThis, "ClipboardItem")
  }
  if (originalSecureContext) {
    Object.defineProperty(window, "isSecureContext", originalSecureContext)
  } else {
    Reflect.deleteProperty(window, "isSecureContext")
  }
  Reflect.deleteProperty(globalThis, "__TUCKMARK_APP_VERSION__")
  Reflect.deleteProperty(globalThis, "__TUCKMARK_BUILD_REF__")
  Reflect.deleteProperty(globalThis, "__TUCKMARK_REPOSITORY_URL__")
  Reflect.deleteProperty(globalThis, "__TUCKMARK_RIGHTS_URL__")
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
    expect(document.body.textContent).toContain("GitHub")
    expect(document.body.textContent).toContain("v0.1.0")
    expect(document.body.textContent).toContain("© 2026 Ivan Li")
    expect(document.body.textContent).not.toContain("Releases")
    expect(document.body.textContent).toContain("Service API: disabled")
    expect(document.body.textContent).toContain("Browser direct: available")
    expect(document.body.textContent).not.toContain("build ")

    const githubLink = document.querySelector<HTMLAnchorElement>(
      'a[href="https://github.com/IvanLi-CN/tuckmark"]'
    )
    const rightsLink = document.querySelector<HTMLAnchorElement>('a[href="https://ivanli.cc/"]')
    expect(githubLink?.textContent).toBe("GitHub")
    expect(rightsLink?.textContent).toBe("© 2026 Ivan Li")
  })

  it("renders tagged owner-facing builds as version with build reference in tooltip only", async () => {
    Object.defineProperty(globalThis, "__TUCKMARK_APP_VERSION__", {
      value: "0.2.0-preview.11",
      configurable: true,
    })
    Object.defineProperty(globalThis, "__TUCKMARK_BUILD_REF__", {
      value: "e4994267326eb940dca6878193b0c514e69a7f0e",
      configurable: true,
    })

    await renderApp(browserRuntimeContext)

    expect(document.body.textContent).toContain("v0.2.0-preview.11")
    expect(document.body.textContent).not.toContain("build e499426")
    const taggedFooterMeta = document.querySelector<HTMLElement>(".tm-footer__meta")
    expect(taggedFooterMeta?.textContent).toContain("v0.2.0-preview.11")
    expect(taggedFooterMeta?.getAttribute("tabindex")).toBe("0")

    await act(async () => {
      taggedFooterMeta?.focus()
      taggedFooterMeta?.dispatchEvent(new FocusEvent("focus", { bubbles: true }))
      taggedFooterMeta?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
      await flush()
    })

    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')
    expect(tooltip?.textContent).toContain("build e499426")
  })

  it("renders untagged owner-facing builds as build reference only", async () => {
    Object.defineProperty(globalThis, "__TUCKMARK_APP_VERSION__", {
      value: "",
      configurable: true,
    })
    Object.defineProperty(globalThis, "__TUCKMARK_BUILD_REF__", {
      value: "e499426",
      configurable: true,
    })

    await renderApp(browserRuntimeContext)

    expect(document.body.textContent).toContain("build e499426")
    expect(document.body.textContent).not.toContain("v0.1.0")
    const untaggedFooterMeta = document.querySelector<HTMLElement>(".tm-footer__meta")
    expect(untaggedFooterMeta?.getAttribute("tabindex")).toBeNull()
  })

  it("shows a non-blocking PWA update prompt when a new browser-static version is ready", async () => {
    pwaToastMocks.usePwaUpdate.mockReturnValue({
      status: "ready",
      source: "service-worker",
      registration: null,
      waitingWorker: null,
      detectedBuildMetadata: null,
      error: null,
    })

    await renderApp(browserRuntimeContext)

    expect(document.body.textContent).toContain("新版本可用")

    await act(async () => {
      queryButton("更新").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("更新会刷新当前页面")
    expect(pwaToastMocks.applyPwaUpdate).not.toHaveBeenCalled()

    const confirmButton = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
      (button) => button.textContent?.includes("更新")
    )
    if (!confirmButton) {
      throw new Error("Missing PWA update confirmation button")
    }

    await act(async () => {
      confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    expect(pwaToastMocks.applyPwaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready" })
    )
  })

  it("reuses the same owner-facing prompt when a version probe detects a stranded client", async () => {
    pwaToastMocks.usePwaUpdate.mockReturnValue({
      status: "ready",
      source: "version-probe",
      registration: null,
      waitingWorker: null,
      detectedBuildMetadata: {
        appVersion: "",
        buildRef: "e499426",
      },
      error: null,
    })

    await renderApp(browserRuntimeContext)

    expect(document.body.textContent).toContain("新版本可用")
    expect(document.querySelector('[aria-label="Tuckmark Web update status"]')).not.toBeNull()
  })

  it("keeps new-version caching silent until the update is ready", async () => {
    pwaToastMocks.usePwaUpdate.mockReturnValue({
      status: "installing",
      source: "service-worker",
      registration: null,
      waitingWorker: null,
      detectedBuildMetadata: null,
      error: null,
    })

    await renderApp(browserRuntimeContext)

    expect(document.body.textContent).not.toContain("新版本可用")
    expect(document.body.textContent).not.toContain("正在缓存")
    expect(document.querySelector('[aria-label="Tuckmark Web update status"]')).toBeNull()
  })

  it("marks shared shell chrome as non-selectable", async () => {
    await renderApp(browserRuntimeContext)

    const shell = document.querySelector(".tm-shell") as HTMLElement | null
    const header = document.querySelector(".tm-header") as HTMLElement | null
    const footer = document.querySelector(".tm-footer") as HTMLElement | null
    const navLink = document.querySelector(".tm-nav__link") as HTMLElement | null

    expect(shell?.className).toContain("tm-selectable-none")
    expect(header?.className).toContain("tm-selectable-none")
    expect(footer?.className).toContain("tm-selectable-none")
    expect(navLink?.className).toContain("tm-selectable-none")
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

  it("keeps template editing inputs selectable while display cells stay chrome-like", async () => {
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
        new Response(JSON.stringify({ artifact: makeArtifact("artifact-selectable") }))
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

    const firstCellButton = document.querySelector(
      ".tm-table tbody tr button.tm-table__cell"
    ) as HTMLButtonElement | null
    expect(firstCellButton).not.toBeNull()

    await act(async () => {
      firstCellButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    const input = document.querySelector(".tm-table tbody tr input") as HTMLInputElement | null
    expect(input).not.toBeNull()
    expect(input?.className).toContain("tm-selectable-text")
  })

  it("keeps layer name copyable without breaking layer selection", async () => {
    await renderApp(browserRuntimeContext, undefined, "/canvas")
    await flush(4)

    const layerNameInput = document.querySelector(
      '.tm-layer-list--inspector input[aria-label$="图层名称"]'
    ) as HTMLInputElement | null
    expect(layerNameInput).not.toBeNull()
    expect(layerNameInput?.className).toContain("tm-selectable-text")

    await act(async () => {
      layerNameInput?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    const removedHeaderStatus = document.querySelector(
      'input[aria-label="当前选择状态"]'
    ) as HTMLInputElement | null
    expect(removedHeaderStatus).toBeNull()
    const canvasStatus = document.querySelector(
      'input[aria-label="当前画布状态"]'
    ) as HTMLInputElement | null
    expect(canvasStatus?.value).toBe("已选 1 项")
  })

  it("starts keyboard clipboard pastes in placement mode and confirms on Enter", async () => {
    await renderApp(browserRuntimeContext, undefined, "/canvas")
    await flush(4)

    await selectFirstCanvasLayer()
    const originalLayerCount = queryCanvasLayerNameInputs().length

    const clipboardData = createClipboardData()
    const copyEvent = dispatchClipboardEvent("copy", clipboardData)
    await flush(2)

    expect(copyEvent.defaultPrevented).toBe(true)
    expect(clipboardData.getData("application/x.tuckmark-canvas-elements+json")).toContain(
      "tuckmark-canvas-elements"
    )

    const pasteEvent = dispatchClipboardEvent("paste", clipboardData)
    await flush(4)

    expect(pasteEvent.defaultPrevented).toBe(true)
    expect(queryCanvasLayerNameInputs()).toHaveLength(originalLayerCount + 1)
    expect(document.body.textContent).toContain("移动鼠标以放置，单击确认，按 Esc 取消。")
    expect(document.body.textContent).toContain("单色编辑，所见即所得。")
    expect(document.body.textContent).not.toContain("粘贴预览会跟随鼠标，单击确认落位。")

    await act(async () => {
      dispatchWindowKey("Enter")
      await flush(4)
    })

    expect(document.body.textContent).toContain("已粘贴 1 个图层。")
  })

  it("accepts async clipboard custom payloads during keyboard placement paste", async () => {
    await renderApp(browserRuntimeContext, undefined, "/canvas")
    await flush(4)

    await selectFirstCanvasLayer()
    const originalLayerCount = queryCanvasLayerNameInputs().length

    await act(async () => {
      queryButton("拷贝").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(4)
    })

    const clipboardPayload = await readStoredClipboardText(
      "web application/x.tuckmark-canvas-elements+json"
    )
    expect(clipboardPayload).not.toBeNull()

    const clipboardData = createClipboardData({
      "web application/x.tuckmark-canvas-elements+json": clipboardPayload ?? "",
    })
    dispatchClipboardEvent("paste", clipboardData)
    await flush(4)

    expect(queryCanvasLayerNameInputs()).toHaveLength(originalLayerCount + 1)
    expect(document.body.textContent).toContain("移动鼠标以放置，单击确认，按 Esc 取消。")
  })

  it("round-trips Data Matrix layers through clipboard payloads", async () => {
    await renderWorkbenchApp(browserRuntimeContext, "datamatrix-selected")
    await flush(4)

    const originalLayerCount = queryCanvasLayerNameInputs().length
    const clipboardData = createClipboardData()
    const copyEvent = dispatchClipboardEvent("copy", clipboardData)
    await flush(2)

    expect(copyEvent.defaultPrevented).toBe(true)
    expect(clipboardData.getData("application/x.tuckmark-canvas-elements+json")).toContain(
      '"kind":"datamatrix"'
    )
    expect(clipboardData.getData("text/plain")).toContain(
      "rack-a.lan-01|TM-0001|https://tuckmark.local"
    )

    const pasteEvent = dispatchClipboardEvent("paste", clipboardData)
    await flush(4)

    expect(pasteEvent.defaultPrevented).toBe(true)
    expect(queryCanvasLayerNameInputs()).toHaveLength(originalLayerCount + 1)
    expect(document.body.textContent).toContain("移动鼠标以放置，单击确认，按 Esc 取消。")

    await act(async () => {
      dispatchWindowKey("Enter")
      await flush(4)
    })

    expect(document.body.textContent).toContain("已粘贴 1 个图层。")
  })

  it("uses navigator clipboard buttons and waits for placement confirmation", async () => {
    await renderApp(browserRuntimeContext, undefined, "/canvas")
    await flush(4)

    await selectFirstCanvasLayer()
    const originalLayerCount = queryCanvasLayerNameInputs().length

    await act(async () => {
      queryButton("拷贝").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(4)
    })

    expect(clipboardMocks.write).toHaveBeenCalledTimes(1)
    await expect(
      readStoredClipboardText("web application/x.tuckmark-canvas-elements+json")
    ).resolves.toContain("tuckmark-canvas-elements")

    await act(async () => {
      queryButton("粘贴").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(4)
    })

    expect(clipboardMocks.read).toHaveBeenCalledTimes(1)
    expect(queryCanvasLayerNameInputs()).toHaveLength(originalLayerCount + 1)
    expect(document.body.textContent).toContain("移动鼠标以放置，单击确认，按 Esc 取消。")
    expect(document.body.textContent).toContain("单色编辑，所见即所得。")
    expect(queryButton("粘贴").disabled).toBe(true)
    expect(queryButton("新副本").disabled).toBe(true)
    expect(queryButton("删除").disabled).toBe(true)

    await act(async () => {
      dispatchWindowKey("Enter")
      await flush(4)
    })

    expect(queryCanvasLayerNameInputs()).toHaveLength(originalLayerCount + 1)
    expect(document.body.textContent).toContain("已粘贴 1 个图层。")
  })

  it("accepts keyboard clipboard payloads during async button placement paste", async () => {
    await renderApp(browserRuntimeContext, undefined, "/canvas")
    await flush(4)

    await selectFirstCanvasLayer()
    const originalLayerCount = queryCanvasLayerNameInputs().length
    const clipboardData = createClipboardData()
    dispatchClipboardEvent("copy", clipboardData)
    await flush(2)

    clipboardItems = [
      createClipboardItemFromTextMap({
        "application/x.tuckmark-canvas-elements+json": clipboardData.getData(
          "application/x.tuckmark-canvas-elements+json"
        ),
      }),
    ]

    await act(async () => {
      queryButton("粘贴").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(4)
    })

    expect(queryCanvasLayerNameInputs()).toHaveLength(originalLayerCount + 1)
    expect(document.body.textContent).toContain("移动鼠标以放置，单击确认，按 Esc 取消。")
  })

  it("converts plain-text paste into a pending text layer and confirms on Enter", async () => {
    await renderApp(browserRuntimeContext, undefined, "/canvas")
    await flush(4)

    const clipboardData = createClipboardData({
      "text/plain": "Line 1\nLine 2",
    })

    dispatchClipboardEvent("paste", clipboardData)
    await flush(4)

    expect(document.body.textContent).toContain("移动鼠标以放置，单击确认，按 Esc 取消。")

    await act(async () => {
      dispatchWindowKey("Enter")
      await flush(4)
    })

    expect(document.body.textContent).toContain("已将剪贴板文本粘贴为新文本图层。")
    expect(document.querySelector<HTMLTextAreaElement>("#text-value")?.value).toBe("Line 1\nLine 2")
  })

  it("cancels pending placement paste on Escape", async () => {
    await renderApp(browserRuntimeContext, undefined, "/canvas")
    await flush(4)

    const originalLayerCount = queryCanvasLayerNameInputs().length
    const clipboardData = createClipboardData({
      "text/plain": "Cancelled",
    })

    dispatchClipboardEvent("paste", clipboardData)
    await flush(4)

    expect(queryCanvasLayerNameInputs()).toHaveLength(originalLayerCount + 1)
    expect(document.body.textContent).toContain("移动鼠标以放置，单击确认，按 Esc 取消。")

    await act(async () => {
      dispatchWindowKey("Escape")
      await flush(4)
    })

    expect(queryCanvasLayerNameInputs()).toHaveLength(originalLayerCount)
    expect(document.body.textContent).toContain("已取消粘贴放置。")
  })

  it("tracks pending placement outside liveDraft until confirmation", () => {
    const draft = createDraftFromPreset(getPresetById("shipping-wide"))
    draft.editor.snapEnabled = false
    const sourceElement = draft.elements.find((element) => element.kind === "text")
    if (!sourceElement) {
      throw new Error("expected a text element in shipping-wide")
    }

    const initialState = createCanvasStateFromDraft(draft, {
      selectedIds: [sourceElement.id],
    })
    const previewState = startClipboardPastePlacement(
      initialState,
      {
        kind: "canvas",
        payload: {
          version: 1,
          kind: "tuckmark-canvas-elements",
          elements: [sourceElement],
        },
        signature: "text-source",
      },
      { width: 760, height: 520 },
      { x: 32.4, y: 18.6 }
    )

    expect(previewState.liveDraft.elements).toHaveLength(draft.elements.length)
    expect(previewState.draft.elements).toHaveLength(draft.elements.length + 1)
    expect(previewState.pendingPaste).not.toBeNull()

    const initialPreviewElement = previewState.draft.elements.find((element) =>
      previewState.pendingPaste?.ids.includes(element.id)
    )
    if (!initialPreviewElement) {
      throw new Error("expected initial pending preview element")
    }

    const movedState = movePendingPasteToPoint(previewState, { x: 40.4, y: 22.6 })
    const pendingElement = movedState.draft.elements.find((element) =>
      movedState.pendingPaste?.ids.includes(element.id)
    )
    if (!pendingElement) {
      throw new Error("expected pending preview element")
    }

    const pendingBounds = getElementSelectionBounds(pendingElement)
    expect(pendingBounds.x + pendingBounds.width / 2).toBeCloseTo(40.4, 0)
    expect(pendingBounds.y + pendingBounds.height / 2).toBeCloseTo(22.6, 0)

    const confirmedState = confirmPendingPastePlacement(movedState)
    expect(confirmedState.pendingPaste).toBeNull()
    expect(confirmedState.liveDraft.elements).toHaveLength(draft.elements.length + 1)
    expect(confirmedState.historyIndex).toBe(1)
    expect(confirmedState.outputStatus).toContain("已粘贴 1 个图层。")
  })

  it("does not route a nested Transformer handle event into element dragging", () => {
    const transformer = {
      className: "Transformer",
      getParent: () => null,
    }
    const transformerHandle = {
      className: "Rect",
      getParent: () => transformer,
    }
    const elementHitTarget = {
      className: "Rect",
      getParent: () => null,
    }

    expect(isTransformerInteractionTarget(transformerHandle as never)).toBe(true)
    expect(isTransformerInteractionTarget(elementHitTarget as never)).toBe(false)
  })

  it("zooms around the pointer without requiring a modifier key", () => {
    const viewport = { x: 120, y: 56, scale: 2 }
    const pointer = { x: 360, y: 216 }
    const canvasPoint = {
      x: (pointer.x - viewport.x) / (viewport.scale * CANVAS_DOTS_PER_MILLIMETER),
      y: (pointer.y - viewport.y) / (viewport.scale * CANVAS_DOTS_PER_MILLIMETER),
    }

    const zoomed = zoomViewportAtPointer(viewport, pointer, -1)

    expect(zoomed.scale).toBeGreaterThan(viewport.scale)
    expect((pointer.x - zoomed.x) / (zoomed.scale * CANVAS_DOTS_PER_MILLIMETER)).toBeCloseTo(
      canvasPoint.x
    )
    expect((pointer.y - zoomed.y) / (zoomed.scale * CANVAS_DOTS_PER_MILLIMETER)).toBeCloseTo(
      canvasPoint.y
    )
    expect(zoomViewportAtPointer({ ...viewport, scale: 5 }, pointer, -1).scale).toBe(5)
    expect(zoomViewportAtPointer({ ...viewport, scale: 0.45 }, pointer, 1).scale).toBe(0.45)
  })

  it("converts Transformer boxes between stage and canvas coordinates before snapping", () => {
    const viewport = { x: 120, y: 56, scale: 2 }
    const stageBox = { x: 184, y: 120, width: 160, height: 96, rotation: 0 }

    expect(projectStageTransformerBoxToCanvas(stageBox, viewport)).toEqual({
      x: 4,
      y: 4,
      width: 10,
      height: 6,
      rotation: 0,
    })
    expect(
      projectCanvasTransformerBoxToStage(
        {
          x: 4,
          y: 4,
          width: 10,
          height: 6,
          rotation: 0,
        },
        viewport
      )
    ).toEqual(stageBox)
  })

  it("moves the whole selected set during drag previews instead of only the grabbed element", () => {
    const draft = createDraftFromPreset(getPresetById("shipping-wide"))
    const selectedElements = draft.elements.filter(
      (element) => element.kind === "text" || element.kind === "qr"
    )
    const [draggedElement, companionElement] = selectedElements
    if (!draggedElement || !companionElement) {
      throw new Error("expected draggable multi-selection elements")
    }

    const preview = createSelectionDragPreview(
      draft,
      draggedElement.id,
      [draggedElement.id, companionElement.id],
      { x: draggedElement.x + 4.4, y: draggedElement.y + 7.6 },
      { x: 0, y: 0 },
      { x: 0, y: 0, scale: 1 },
      true
    )

    if (!preview) {
      throw new Error("expected drag preview")
    }

    const draggedPreview = preview.draft.elements.find(
      (element) => element.id === draggedElement.id
    )
    const companionPreview = preview.draft.elements.find(
      (element) => element.id === companionElement.id
    )
    if (!draggedPreview || !companionPreview) {
      throw new Error("expected moved preview elements")
    }

    expect(draggedPreview.x).toBeCloseTo(draggedElement.x + preview.deltaX, 6)
    expect(draggedPreview.y).toBeCloseTo(draggedElement.y + preview.deltaY, 6)
    expect(companionPreview.x).toBeCloseTo(companionElement.x + preview.deltaX, 6)
    expect(companionPreview.y).toBeCloseTo(companionElement.y + preview.deltaY, 6)
  })

  it("restores the previous selection when pending placement is cancelled", () => {
    const draft = createDraftFromPreset(getPresetById("shipping-wide"))
    const sourceElement = draft.elements.find((element) => element.kind === "text")
    if (!sourceElement) {
      throw new Error("expected a text element in shipping-wide")
    }

    const initialState = createCanvasStateFromDraft(draft, {
      selectedIds: [sourceElement.id],
    })
    const previewState = startClipboardPastePlacement(
      initialState,
      {
        kind: "text",
        text: "Preview",
        signature: "text:Preview",
      },
      { width: 760, height: 520 },
      { x: 28, y: 16 }
    )

    const cancelledState = cancelPendingPastePlacement(previewState)
    expect(cancelledState.pendingPaste).toBeNull()
    expect(cancelledState.draft.elements).toHaveLength(draft.elements.length)
    expect(cancelledState.liveDraft.elements).toHaveLength(draft.elements.length)
    expect(cancelledState.selectedIds).toEqual([sourceElement.id])
    expect(cancelledState.outputStatus).toContain("已取消粘贴放置。")
  })

  it("rejects malformed structured clipboard payloads without crashing paste", async () => {
    await renderApp(browserRuntimeContext, undefined, "/canvas")
    await flush(4)

    const originalLayerCount = queryCanvasLayerNameInputs().length
    const clipboardData = createClipboardData({
      "application/x.tuckmark-canvas-elements+json": JSON.stringify({
        version: 1,
        kind: "tuckmark-canvas-elements",
        elements: [
          {
            id: "rect-bad",
            kind: "rect",
            x: 2,
            y: 2,
            width: 10,
            height: 4,
            strokeWidth: 1,
            fill: "#111111",
            stroke: "#111111",
            radius: 0,
          },
        ],
      }),
    })

    dispatchClipboardEvent("paste", clipboardData)
    await flush(4)

    expect(queryCanvasLayerNameInputs()).toHaveLength(originalLayerCount)
    expect(document.body.textContent).toContain("剪贴板中的画布内容不可用。")
  })

  it("keeps copy enabled and paste disabled in read-only history mode", async () => {
    const baseDraft = createDraftFromPreset(getPresetById("shipping-wide"))
    const saved = await saveUserTemplate({
      name: "Readonly Clipboard",
      document: {
        ...baseDraft,
        name: "Readonly Clipboard",
        source: { kind: "user-template", templateId: "seed-will-be-replaced" },
      },
    })

    await renderApp(
      browserRuntimeContext,
      undefined,
      `/canvas?source=user-template&templateId=${saved.template.id}&panel=versions`
    )
    await flush(8)

    const versionButton = document.querySelector(
      ".tm-version-list__item"
    ) as HTMLButtonElement | null
    expect(versionButton).not.toBeNull()

    await act(async () => {
      versionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(4)
    })

    await selectFirstCanvasLayer()

    expect(queryButton("拷贝").disabled).toBe(false)
    expect(queryButton("粘贴").disabled).toBe(true)

    await act(async () => {
      queryButton("拷贝").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(4)
    })

    expect(clipboardMocks.write).toHaveBeenCalledTimes(1)
  })

  it("disables clipboard buttons when async clipboard support is unavailable", async () => {
    Object.defineProperty(window, "isSecureContext", {
      value: false,
      configurable: true,
    })

    await renderApp(browserRuntimeContext, undefined, "/canvas")
    await flush(4)

    await selectFirstCanvasLayer()

    expect(queryButton("拷贝").disabled).toBe(true)
    expect(queryButton("粘贴").disabled).toBe(true)
  })

  it("updates canvas inspector text fields without retaining the React event", async () => {
    await renderApp(browserRuntimeContext, undefined, "/canvas")
    await flush(4)

    const recipientLayerNameInput = document.querySelector(
      'input[aria-label="收件人 图层名称"]'
    ) as HTMLInputElement | null
    expect(recipientLayerNameInput).not.toBeNull()

    await act(async () => {
      recipientLayerNameInput?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush()
    })

    const textValue = document.querySelector("#text-value") as HTMLTextAreaElement | null
    expect(textValue).not.toBeNull()

    await act(async () => {
      if (!textValue) {
        throw new Error("Missing selected text inspector")
      }
      textValue.value = "Edited recipient"
      textValue.dispatchEvent(new Event("input", { bubbles: true }))
      await flush(4)
    })

    const updatedTextValue = document.querySelector("#text-value") as HTMLTextAreaElement | null
    expect(updatedTextValue?.value).toBe("Edited recipient")
    expect(document.getElementById("root")?.innerHTML).not.toBe("")
  })

  it("keeps inline text editing aligned with centered text metrics", async () => {
    await renderWorkbenchApp(browserRuntimeContext, "text-centered-selected")
    await flush(4)

    const inlineEditor = document.querySelector(
      'textarea[aria-label="画布文本内联编辑"]'
    ) as HTMLTextAreaElement | null
    expect(inlineEditor).not.toBeNull()

    const editorFrame = inlineEditor?.parentElement as HTMLDivElement | null
    expect(editorFrame).not.toBeNull()

    const scale = parseFloat(editorFrame?.style.width ?? "0") / 32
    const layout = resolveTextLayout({
      text: "MMM",
      fontSize: 8.9,
      fontFamily: "arial",
      fontWeight: "bold",
      width: 32,
      height: 14,
      lineHeight: 1.2,
      align: "center",
      verticalAlign: "middle",
      stretchX: false,
      stretchY: false,
      autoWrap: false,
      verticalText: false,
      maxLines: 1,
      measureText: ({ text }) => ({
        width: Math.max(Array.from(text).length, 1) * 7.25,
      }),
    })

    expect(parseFloat(inlineEditor?.style.left ?? "0")).toBeCloseTo(layout.contentX * scale, 3)
    expect(parseFloat(inlineEditor?.style.width ?? "0")).toBeCloseTo(layout.contentWidth * scale, 3)
    expect(parseFloat(inlineEditor?.style.top ?? "0")).toBeCloseTo(
      (layout.contentY + layout.textOffsetY) * scale,
      3
    )
  })

  it("preserves the chosen alignment cell when justify is enabled", async () => {
    await renderWorkbenchApp(browserRuntimeContext, "text-selected")
    await flush(4)

    const centeredAlignButton = document.querySelector(
      'button[aria-label="文本居中对齐"]'
    ) as HTMLButtonElement | null
    const justifyButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("两端对齐")
    ) as HTMLButtonElement | null

    expect(centeredAlignButton).not.toBeNull()
    expect(justifyButton).not.toBeNull()

    await act(async () => {
      centeredAlignButton?.click()
      await flush()
    })

    await act(async () => {
      justifyButton?.click()
      await flush()
    })

    expect(centeredAlignButton?.getAttribute("aria-pressed")).toBe("true")
    expect(justifyButton?.getAttribute("aria-pressed")).toBe("true")
  })

  it("keeps justify inline editing aligned for middle anchored text", async () => {
    await renderWorkbenchApp(browserRuntimeContext, "text-justify-centered-selected")
    await flush(4)

    const inlineEditor = document.querySelector(
      'textarea[aria-label="画布文本内联编辑"]'
    ) as HTMLTextAreaElement | null
    expect(inlineEditor).not.toBeNull()

    const editorFrame = inlineEditor?.parentElement as HTMLDivElement | null
    expect(editorFrame).not.toBeNull()

    const scale = parseFloat(editorFrame?.style.width ?? "0") / 21.3
    const layout = resolveTextLayout({
      text: "Koha Cat",
      fontSize: 3.5,
      fontFamily: "system-sans",
      fontWeight: "bold",
      width: 21.3,
      height: 6.6,
      lineHeight: 1.2,
      align: "justify",
      verticalAlign: "middle",
      stretchX: false,
      stretchY: false,
      autoWrap: true,
      verticalText: false,
      maxLines: 1,
      measureText: ({ text }) => ({
        width: Math.max(Array.from(text).length, 1) * 1.9,
      }),
    })

    expect(parseFloat(inlineEditor?.style.top ?? "0")).toBeCloseTo(layout.contentY * scale, 3)
  })

  it("keeps justify inline editing aligned for top anchored text", async () => {
    await renderWorkbenchApp(browserRuntimeContext, "text-justify-top-selected")
    await flush(4)

    const inlineEditor = document.querySelector(
      'textarea[aria-label="画布文本内联编辑"]'
    ) as HTMLTextAreaElement | null
    expect(inlineEditor).not.toBeNull()

    const editorFrame = inlineEditor?.parentElement as HTMLDivElement | null
    expect(editorFrame).not.toBeNull()

    const scale = parseFloat(editorFrame?.style.width ?? "0") / 22.5
    const layout = resolveTextLayout({
      text: "Name",
      fontSize: 4.3,
      fontFamily: "system-sans",
      fontWeight: "bold",
      width: 22.5,
      height: 12,
      lineHeight: 1.2,
      align: "justify",
      verticalAlign: "top",
      stretchX: false,
      stretchY: false,
      autoWrap: true,
      verticalText: false,
      maxLines: 1,
      measureText: ({ text }) => ({
        width: Math.max(Array.from(text).length, 1) * 2.32,
      }),
    })

    expect(parseFloat(inlineEditor?.style.top ?? "0")).toBeCloseTo(
      (layout.contentY + layout.textOffsetY) * scale,
      3
    )
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

    const nameInput = document.querySelector<HTMLInputElement>('[role="dialog"] input')
    if (!nameInput) {
      throw new Error("Missing template name input")
    }
    const saveButton = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
      (button) => button.textContent?.includes("保存")
    )
    if (!saveButton) {
      throw new Error("Missing template name save button")
    }

    await act(async () => {
      nameInput.value = "Copied Template"
      nameInput.dispatchEvent(new Event("input", { bubbles: true }))
      saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(8)
    })

    const templates = await readUserTemplateHistory(saved.template.id)
    expect(templates?.autosaves).toHaveLength(1)

    const workingCopy = await loadWorkingCopy({
      kind: "user-template",
      templateId: saved.template.id,
    })
    expect(workingCopy?.draft.name).toBe("Source Template Draft")
  })

  it("uses imported package sample values for initial template rows", () => {
    const importedTemplate = {
      id: "imported-component",
      name: "Imported Component",
      description: "",
      width: 192,
      height: 96,
      fields: [
        {
          key: "part",
          label: "Part",
          required: false,
          defaultValue: "INA226",
          sampleValue: "INA219",
        },
      ],
    }

    expect(buildInputFromTemplate(importedTemplate)).toMatchObject({ part: "INA219" })
    expect(
      buildInputFromTemplate({
        ...importedTemplate,
        id: "shipping-compact",
      })
    ).toMatchObject({ part: "INA219" })
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

    expect(document.body.textContent).toContain("用户模板：Stable Template")
    const history = await readUserTemplateHistory(saved.template.id)
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

  it("prefers synced preset-template drafts over stale indexeddb working copies on startup", async () => {
    const syncedDraft = createDraftFromPreset(getPresetById("ops-tag"))
    syncedDraft.presetId = "cable-tag"
    syncedDraft.source = { kind: "preset-template", presetId: "cable-tag" }
    syncedDraft.name = "Synced preset draft"
    const syncedDraftFirstElement = syncedDraft.elements[0]
    if (!syncedDraftFirstElement) {
      throw new Error("expected preset draft to include at least one element")
    }
    syncedDraft.elements = [
      ...syncedDraft.elements,
      { ...syncedDraftFirstElement, id: "extra-text" },
    ]
    window.localStorage.setItem(getDraftStorageKey("cable-tag"), JSON.stringify(syncedDraft))

    const staleDraft = structuredClone(syncedDraft)
    staleDraft.name = "Stale preset draft"
    staleDraft.elements = staleDraft.elements.slice(0, -1)
    await saveUserTemplateAutosave({
      source: { kind: "preset-template", presetId: "cable-tag" },
      document: staleDraft,
    })

    await renderApp(
      browserRuntimeContext,
      undefined,
      "/canvas?source=preset-template&templateId=cable-tag"
    )
    await flush(8)

    expect(document.body.textContent).toContain("系统模板：Synced preset draft")
    expect(document.body.textContent).not.toContain("系统模板：Stale preset draft")
  })

  it("waits for a user-template working copy before allowing preview from /templates", async () => {
    const baseDraft = createDraftFromPreset(getPresetById("shipping-wide"))
    const textElement = baseDraft.elements.find((element) => element.kind === "text")
    if (!textElement) {
      throw new Error("expected shipping-wide preset to include a text element")
    }
    const boundDraft = toggleElementBinding(baseDraft, textElement.id, true)
    const saved = await saveUserTemplate({
      name: "Async Preview",
      document: {
        ...boundDraft,
        name: "Async Preview",
        source: { kind: "user-template", templateId: "seed-will-be-replaced" },
      },
    })

    const actualStore = await vi.importActual<typeof import("./user-template-store.js")>(
      "./user-template-store.js"
    )
    const loadPromise = beginHoldingUserTemplateLoad()
    const originalLoadWorkingCopy = await import("./user-template-store.js")
    const loadWorkingCopySpy = vi.spyOn(originalLoadWorkingCopy, "loadWorkingCopy")
    loadWorkingCopySpy.mockImplementation(async (source) => {
      if (source.kind === "user-template" && source.templateId === saved.template.id) {
        await loadPromise
      }
      return actualStore.loadWorkingCopy(source)
    })

    try {
      await renderApp(browserRuntimeContext, undefined, "/templates")
      await flush(2)

      await act(async () => {
        const targetCard = Array.from(document.querySelectorAll(".tm-template-card")).find((item) =>
          item.textContent?.includes("Async Preview")
        ) as HTMLElement | undefined
        const surface = targetCard?.querySelector(
          ".tm-template-card__surface"
        ) as HTMLButtonElement | null
        surface?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        await flush(1)
      })

      expect(queryButton("生成预览").disabled).toBe(true)
      expect(document.body.textContent).toContain("正在读取本地模板草稿。")
      expect(browserPayloadMocks.materializeBrowserArtifactData).not.toHaveBeenCalled()

      releaseHeldUserTemplateLoad()
      await flush(8)
    } finally {
      releaseHeldUserTemplateLoad()
      vi.restoreAllMocks()
    }
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

  it("normalizes transformed element geometry without changing freeform dimensions", () => {
    const rect: CanvasDraftElement = {
      id: "rect-1",
      kind: "rect",
      x: 3.7,
      y: 6.2,
      width: 28.9,
      height: 10.9,
      strokeWidth: 0.25,
      fill: "none",
      stroke: "#111111",
      radius: 20,
      rotation: 17,
      meta: { name: "Rect", visible: true, locked: false },
    }

    expect(normalizeTransformedElementGeometry(rect)).toMatchObject({
      x: 3.7,
      y: 6.2,
      width: 28.9,
      height: 10.9,
      radius: 5.45,
      rotation: 17,
    })

    const text: CanvasDraftElement = {
      id: "text-1",
      kind: "text",
      x: 1.4,
      y: 2.6,
      width: 24.1,
      height: 11.9,
      fontSize: 4.4,
      fontFamily: "arial",
      lineHeight: 1.2,
      fontWeight: "bold",
      align: "left",
      verticalAlign: "top",
      stretchX: false,
      stretchY: false,
      autoWrap: true,
      verticalText: false,
      value: "20kΩ",
      rotation: 13,
      meta: { name: "Text", visible: true, locked: false },
    }

    expect(normalizeTransformedElementGeometry(text)).toMatchObject({
      x: 1.4,
      y: 2.6,
      width: 24.1,
      height: 11.9,
      fontSize: 4.4,
      rotation: 13,
    })
  })

  it("keeps a restored saved version as the current working copy after reopening", async () => {
    const baseDraft = createDraftFromPreset(getPresetById("shipping-wide"))
    const firstSave = await saveUserTemplate({
      name: "Restore Target",
      document: {
        ...baseDraft,
        name: "Restore Target",
        source: { kind: "user-template", templateId: "seed-will-be-replaced" },
      },
    })

    const secondDraft = structuredClone(firstSave.workingCopy.draft)
    secondDraft.name = "Restore Target v2"
    await saveUserTemplate({
      name: "Restore Target v2",
      templateId: firstSave.template.id,
      sourceVersionId: firstSave.version.id,
      document: secondDraft,
    })

    await renderApp(
      browserRuntimeContext,
      undefined,
      `/canvas?source=user-template&templateId=${firstSave.template.id}&panel=versions`
    )
    await flush(8)

    await act(async () => {
      const savedVersionButton = Array.from(
        document.querySelectorAll(".tm-version-list__item")
      ).find((item) => item.textContent?.includes(firstSave.version.label)) as
        | HTMLButtonElement
        | undefined
      savedVersionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(8)
    })

    await act(async () => {
      queryButton("恢复").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(8)
    })

    const workingCopy = await loadWorkingCopy({
      kind: "user-template",
      templateId: firstSave.template.id,
    })
    expect(workingCopy?.draft.name).toBe("Restore Target")
    expect(workingCopy?.baseVersionId).toBe(firstSave.version.id)

    await renderApp(
      browserRuntimeContext,
      undefined,
      `/canvas?source=user-template&templateId=${firstSave.template.id}`
    )
    await flush(8)

    expect(document.body.textContent).toContain("用户模板：Restore Target")
    expect(document.body.textContent).not.toContain("用户模板：Restore Target v2")

    const workingCopyAfterReopen = await loadWorkingCopy({
      kind: "user-template",
      templateId: firstSave.template.id,
    })
    expect(workingCopyAfterReopen?.draft.name).toBe("Restore Target")
  })

  it("blocks routed canvas interactions until the requested preset-template draft loads", async () => {
    const actualStore = await vi.importActual<typeof import("./user-template-store.js")>(
      "./user-template-store.js"
    )
    const loadPromise = beginHoldingUserTemplateLoad()
    const originalLoadWorkingCopy = await import("./user-template-store.js")
    const loadWorkingCopySpy = vi.spyOn(originalLoadWorkingCopy, "loadWorkingCopy")
    loadWorkingCopySpy.mockImplementation(async (source) => {
      if (source.kind === "preset-template" && source.presetId === "cable-tag") {
        await loadPromise
      }
      return actualStore.loadWorkingCopy(source)
    })

    try {
      await renderApp(
        browserRuntimeContext,
        undefined,
        "/canvas?source=preset-template&templateId=cable-tag"
      )
      await flush(1)

      expect(document.body.textContent).toContain("正在读取画布")
      expect(queryButton("保存").disabled).toBe(true)
      expect(queryButton("另存为").disabled).toBe(true)
      expect(queryButton("重置草稿").disabled).toBe(true)
      expect(document.body.textContent).not.toContain("可编辑文本")

      releaseHeldUserTemplateLoad()
      await flush(8)
    } finally {
      releaseHeldUserTemplateLoad()
      vi.restoreAllMocks()
    }
  })

  it("surfaces route load failures instead of falling back to an unrelated draft", async () => {
    const actualStore = await vi.importActual<typeof import("./user-template-store.js")>(
      "./user-template-store.js"
    )
    const originalLoadWorkingCopy = await import("./user-template-store.js")
    const loadWorkingCopySpy = vi.spyOn(originalLoadWorkingCopy, "loadWorkingCopy")
    loadWorkingCopySpy.mockImplementation(async (source) => {
      if (source.kind === "preset-template" && source.presetId === "cable-tag") {
        throw new Error("missing requested draft")
      }
      return actualStore.loadWorkingCopy(source)
    })

    try {
      await renderApp(
        browserRuntimeContext,
        undefined,
        "/canvas?source=preset-template&templateId=cable-tag"
      )
      await flush(8)

      expect(document.body.textContent).toContain("missing requested draft")
      expect(document.body.textContent).not.toContain("快递单宽版")
      expect(document.body.textContent).not.toContain("系统模板：Cable Tag")
    } finally {
      vi.restoreAllMocks()
    }
  })

  it("keeps scratch reset cleared across reload", async () => {
    const preset = getPresetById("shipping-wide")
    const syncedDraft = createDraftFromPreset(preset)
    syncedDraft.name = "Changed scratch"
    const syncedDraftFirstElement = syncedDraft.elements[0]
    if (!syncedDraftFirstElement) {
      throw new Error("expected scratch draft to include at least one element")
    }
    syncedDraft.elements = [
      ...syncedDraft.elements,
      { ...syncedDraftFirstElement, id: "extra-text" },
    ]
    window.localStorage.setItem(getDraftStorageKey(preset.id), JSON.stringify(syncedDraft))
    await saveUserTemplateAutosave({
      source: { kind: "scratch", presetId: preset.id },
      document: syncedDraft,
    })

    await renderApp(
      browserRuntimeContext,
      undefined,
      `/canvas?source=scratch&presetId=${preset.id}`
    )
    await flush(8)

    await act(async () => {
      queryButton("重置草稿").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(8)
    })

    expect(window.localStorage.getItem(getDraftStorageKey(preset.id))).toBeNull()

    await renderApp(
      browserRuntimeContext,
      undefined,
      `/canvas?source=scratch&presetId=${preset.id}`
    )
    await flush(8)

    expect(document.body.textContent).toContain("当前草稿：快递单宽版")
    expect(document.body.textContent).not.toContain("当前草稿：Changed scratch")
  })

  it("keeps preset-template reset cleared across reload", async () => {
    const presetDraft = createDraftFromPreset(getPresetById("shipping-wide"))
    presetDraft.presetId = "cable-tag"
    presetDraft.source = { kind: "preset-template", presetId: "cable-tag" }
    presetDraft.name = "Changed preset copy"
    window.localStorage.setItem(getDraftStorageKey("cable-tag"), JSON.stringify(presetDraft))
    await saveUserTemplateAutosave({
      source: { kind: "preset-template", presetId: "cable-tag" },
      document: presetDraft,
    })

    await renderApp(
      browserRuntimeContext,
      undefined,
      "/canvas?source=preset-template&templateId=cable-tag"
    )
    await flush(8)

    await act(async () => {
      queryButton("重置草稿").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(8)
    })

    expect(window.localStorage.getItem(getDraftStorageKey("cable-tag"))).toBeNull()

    await renderApp(
      browserRuntimeContext,
      undefined,
      "/canvas?source=preset-template&templateId=cable-tag"
    )
    await flush(8)

    expect(document.body.textContent).toContain("系统模板：Cable Tag")
    expect(document.body.textContent).not.toContain("系统模板：Changed preset copy")
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

  it("builds /templates columns from the user-template working copy schema", async () => {
    const baseDraft = createDraftFromPreset(getPresetById("shipping-wide"))
    const textElement = baseDraft.elements.find((element) => element.kind === "text")
    if (!textElement) {
      throw new Error("expected shipping-wide preset to include a text element")
    }
    const boundDraft = toggleElementBinding(baseDraft, textElement.id, true)
    const saved = await saveUserTemplate({
      name: "Schema Current",
      document: {
        ...boundDraft,
        name: "Schema Current",
        source: { kind: "user-template", templateId: "seed-will-be-replaced" },
      },
    })

    const updatedWorkingCopy = structuredClone(saved.workingCopy.draft)
    updatedWorkingCopy.fields = updatedWorkingCopy.fields.map((field, index) =>
      index === 0 ? { ...field, label: "收件人（当前草稿）" } : field
    )

    await replaceUserTemplateWorkingCopy({
      templateId: saved.template.id,
      source: { kind: "user-template", templateId: saved.template.id },
      document: updatedWorkingCopy,
      sourceVersionId: saved.version.id,
    })

    await renderApp(browserRuntimeContext, undefined, "/templates")
    await flush(8)

    await act(async () => {
      const targetCard = Array.from(document.querySelectorAll(".tm-template-card")).find((item) =>
        item.textContent?.includes("Schema Current")
      ) as HTMLElement | undefined
      const surface = targetCard?.querySelector(
        ".tm-template-card__surface"
      ) as HTMLButtonElement | null
      surface?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flush(8)
    })

    expect(document.body.textContent).toContain("收件人（当前草稿）")
  })

  it("previews user templates from the persisted working copy instead of the last saved version", async () => {
    const baseDraft = createDraftFromPreset(getPresetById("shipping-wide"))
    const textElement = baseDraft.elements.find((element) => element.kind === "text")
    if (!textElement) {
      throw new Error("expected shipping-wide preset to include a text element")
    }
    const boundDraft = toggleElementBinding(baseDraft, textElement.id, true)
    const saved = await saveUserTemplate({
      name: "Preview Current",
      document: {
        ...boundDraft,
        name: "Preview Current",
        source: { kind: "user-template", templateId: "seed-will-be-replaced" },
      },
    })

    const updatedWorkingCopy = structuredClone(saved.workingCopy.draft)
    updatedWorkingCopy.fields = updatedWorkingCopy.fields.map((field, index) =>
      index === 0 ? { ...field, defaultValue: "Current Working Copy" } : field
    )

    await replaceUserTemplateWorkingCopy({
      templateId: saved.template.id,
      source: { kind: "user-template", templateId: saved.template.id },
      document: updatedWorkingCopy,
      sourceVersionId: saved.version.id,
    })

    await renderApp(browserRuntimeContext, undefined, "/templates")
    await flush(8)

    await act(async () => {
      const targetCard = Array.from(document.querySelectorAll(".tm-template-card")).find((item) =>
        item.textContent?.includes("Preview Current")
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

    expect(browserPayloadMocks.materializeBrowserArtifactData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "canvas",
        canvas: expect.objectContaining({
          elements: expect.arrayContaining([
            expect.objectContaining({
              kind: "text",
              value: "Current Working Copy",
            }),
          ]),
        }),
      })
    )
  })
})
