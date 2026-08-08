// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CrossTabCoordinator, RuntimeDataSourceChangedError } from "./cross-tab-coordinator.js"

const replacementStorageKey = "tuckmark.runtime-replacement.v1"
const canvasDraftAttentionStorageKey = "tuckmark.canvas-draft-attention.v1"

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    clear() {
      entries.clear()
    },
    getItem(key) {
      return entries.get(key) ?? null
    },
    key(index) {
      return Array.from(entries.keys())[index] ?? null
    },
    removeItem(key) {
      entries.delete(key)
    },
    setItem(key, value) {
      entries.set(key, value)
    },
  }
}

let storage: Storage

function installQueueingLocks(): void {
  let active = false
  const queue: Array<{
    callback: () => Promise<unknown>
    reject: (reason?: unknown) => void
    resolve: (value: unknown) => void
  }> = []

  const drain = () => {
    if (active) {
      return
    }
    const next = queue.shift()
    if (!next) {
      return
    }
    active = true
    void next
      .callback()
      .then(next.resolve, next.reject)
      .finally(() => {
        active = false
        drain()
      })
  }

  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_name: string, _options: unknown, callback: () => Promise<unknown>) =>
        new Promise<unknown>((resolve, reject) => {
          queue.push({ callback, reject, resolve })
          drain()
        }),
    },
  })
}

describe("CrossTabCoordinator runtime replacement", () => {
  const coordinators: CrossTabCoordinator[] = []

  beforeEach(() => {
    storage = createMemoryStorage()
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storage,
    })
  })

  afterEach(() => {
    for (const coordinator of coordinators.splice(0)) {
      coordinator.stop()
    }
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    })
    storage.clear()
  })

  it("blocks a second writer while a runtime replacement is active", async () => {
    const primary = new CrossTabCoordinator()
    const secondary = new CrossTabCoordinator()
    coordinators.push(primary, secondary)
    primary.start()
    secondary.start()

    await primary.runExclusiveRuntimeReplacement(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: replacementStorageKey }))
      expect(secondary.getRuntimeReplacementState().active).toBe(true)
      secondary.requestTakeover()
      await expect(secondary.runAsWriter(async () => "write")).rejects.toThrow("数据源已切换")
    })

    window.dispatchEvent(new StorageEvent("storage", { key: replacementStorageKey }))
    expect(primary.getRuntimeReplacementState()).toMatchObject({
      active: false,
      generation: 1,
    })
    expect(secondary.getRuntimeReplacementState()).toMatchObject({
      active: false,
      generation: 1,
    })
  })

  it("cancels an older queued runtime request after a replacement changes generation", async () => {
    installQueueingLocks()
    const primary = new CrossTabCoordinator()
    const secondary = new CrossTabCoordinator()
    coordinators.push(primary, secondary)
    primary.start()
    secondary.start()

    let releaseInitialRead: () => void = () => undefined
    let initialReadEntered: () => void = () => undefined
    const initialReadReady = new Promise<void>((resolve) => {
      initialReadEntered = resolve
    })
    const initialReadGate = new Promise<void>((resolve) => {
      releaseInitialRead = resolve
    })
    const initialRead = secondary.runRuntimeAccess(async () => {
      initialReadEntered()
      await initialReadGate
      return "initial"
    })
    await initialReadReady

    const replacement = primary.runExclusiveRuntimeReplacement(async () => "replaced")
    let staleRequestRan = false
    const staleRequest = secondary.runRuntimeAccess(async () => {
      staleRequestRan = true
      return "stale"
    })

    releaseInitialRead()
    await expect(initialRead).resolves.toBe("initial")
    await expect(replacement).resolves.toBe("replaced")
    await expect(staleRequest).rejects.toBeInstanceOf(RuntimeDataSourceChangedError)
    expect(staleRequestRan).toBe(false)
  })

  it("records active canvas sessions and delivers a processing reminder to their source tab", () => {
    const systemTab = new CrossTabCoordinator()
    const canvasTab = new CrossTabCoordinator()
    coordinators.push(systemTab, canvasTab)
    systemTab.start()
    canvasTab.start()

    const releaseCanvasSession = canvasTab.registerCanvasDraftSession("user:power-module")
    expect(systemTab.getCanvasDraftSessions("user:power-module")).toHaveLength(1)

    const onAttention = vi.fn()
    canvasTab.subscribeCanvasDraftAttention(onAttention)
    systemTab.requestCanvasDraftAttention("user:power-module")
    const request = storage.getItem(canvasDraftAttentionStorageKey)
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: canvasDraftAttentionStorageKey,
        newValue: request,
      })
    )

    expect(onAttention).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKey: "user:power-module" })
    )

    releaseCanvasSession()
    expect(systemTab.getCanvasDraftSessions("user:power-module")).toEqual([])
  })
})
