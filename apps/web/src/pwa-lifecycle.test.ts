// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  PwaUpdateController,
  resolveServiceWorkerScope,
  resolveServiceWorkerUrl,
} from "./pwa-lifecycle.js"

const PERIODIC_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000
const ACTIVATION_STALE_UPDATE_CHECK_MS = 10 * 60 * 1000

function flushPromises(): Promise<void> {
  return Promise.resolve()
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

type BrowserState = {
  controller: PwaUpdateController
  registration: ServiceWorkerRegistration
  setOnline: (value: boolean) => void
  setVisibility: (value: DocumentVisibilityState) => void
  restore: () => void
}

function restoreProperty(
  target: object,
  key: "serviceWorker" | "onLine" | "visibilityState",
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor)
    return
  }
  Reflect.deleteProperty(target, key)
}

function installBrowserState(
  updateImpl: () => Promise<void> = () => Promise.resolve()
): BrowserState {
  let online = true
  let visibilityState: DocumentVisibilityState = "visible"
  const originalServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "serviceWorker"
  )
  const originalOnLineDescriptor = Object.getOwnPropertyDescriptor(navigator, "onLine")
  const originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState")
  const registration = {
    update: vi.fn(updateImpl),
    waiting: null,
    installing: null,
    addEventListener: vi.fn(),
  } as unknown as ServiceWorkerRegistration
  const serviceWorker = {
    controller: { state: "activated" },
    register: vi.fn(async () => registration),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as ServiceWorkerContainer

  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: serviceWorker,
  })
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  })
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibilityState,
  })

  return {
    controller: new PwaUpdateController(),
    registration,
    setOnline(value) {
      online = value
    },
    setVisibility(value) {
      visibilityState = value
    },
    restore() {
      restoreProperty(navigator, "serviceWorker", originalServiceWorkerDescriptor)
      restoreProperty(navigator, "onLine", originalOnLineDescriptor)
      restoreProperty(document, "visibilityState", originalVisibilityDescriptor)
    },
  }
}

describe("pwa-lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("resolves the service worker module without requiring browser globals", () => {
    expect(PwaUpdateController).toBeDefined()
  })

  it("resolves relative-base service worker URLs from the bundled module", () => {
    const moduleHref = "https://example.test/repo/assets/index.js"

    expect(
      resolveServiceWorkerUrl("./", "https://example.test/repo/templates", moduleHref).href
    ).toBe("https://example.test/repo/sw.js")
    expect(resolveServiceWorkerScope("./", "https://example.test/repo/templates", moduleHref)).toBe(
      "/repo/"
    )

    expect(
      resolveServiceWorkerUrl("./", "https://example.test/repo/templates/", moduleHref).href
    ).toBe("https://example.test/repo/sw.js")
    expect(
      resolveServiceWorkerScope("./", "https://example.test/repo/templates/", moduleHref)
    ).toBe("/repo/")
  })

  it("checks for updates immediately after service worker registration", async () => {
    const { controller, registration, restore } = installBrowserState()

    await controller.register()
    await flushPromises()

    expect(registration.update).toHaveBeenCalledTimes(1)

    controller.dispose()
    restore()
  })

  it("runs a low-frequency periodic update check while the page stays visible", async () => {
    const { controller, registration, restore } = installBrowserState()
    const unsubscribe = controller.subscribe(() => undefined)

    await controller.register()
    await flushPromises()
    vi.advanceTimersByTime(PERIODIC_UPDATE_CHECK_INTERVAL_MS - 1)
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(2)

    unsubscribe()
    controller.dispose()
    restore()
  })

  it("rechecks on activation only after the stale threshold has elapsed", async () => {
    const { controller, registration, restore } = installBrowserState()
    const unsubscribe = controller.subscribe(() => undefined)

    await controller.register()
    await flushPromises()
    vi.advanceTimersByTime(ACTIVATION_STALE_UPDATE_CHECK_MS - 1)
    window.dispatchEvent(new Event("focus"))
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    window.dispatchEvent(new Event("focus"))
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(2)

    unsubscribe()
    controller.dispose()
    restore()
  })

  it("skips hidden periodic checks and catches up once the page becomes visible again", async () => {
    const { controller, registration, restore, setVisibility } = installBrowserState()
    const unsubscribe = controller.subscribe(() => undefined)

    await controller.register()
    await flushPromises()

    setVisibility("hidden")
    vi.advanceTimersByTime(PERIODIC_UPDATE_CHECK_INTERVAL_MS)
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(1)

    setVisibility("visible")
    document.dispatchEvent(new Event("visibilitychange"))
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(2)

    unsubscribe()
    controller.dispose()
    restore()
  })

  it("skips offline checks and retries once the browser comes back online", async () => {
    const { controller, registration, restore, setOnline } = installBrowserState()
    const unsubscribe = controller.subscribe(() => undefined)

    await controller.register()
    await flushPromises()

    setOnline(false)
    vi.advanceTimersByTime(PERIODIC_UPDATE_CHECK_INTERVAL_MS)
    window.dispatchEvent(new Event("focus"))
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(1)

    setOnline(true)
    window.dispatchEvent(new Event("online"))
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(2)

    unsubscribe()
    controller.dispose()
    restore()
  })

  it("retries immediately when the startup update check failed before the browser came online", async () => {
    const { controller, registration, restore, setOnline } = installBrowserState(() =>
      navigator.onLine ? Promise.resolve() : Promise.reject(new Error("offline"))
    )
    const unsubscribe = controller.subscribe(() => undefined)

    setOnline(false)
    await controller.register()
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(1)

    setOnline(true)
    window.dispatchEvent(new Event("online"))
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(2)

    unsubscribe()
    controller.dispose()
    restore()
  })

  it("stops background polling once the last subscriber unsubscribes", async () => {
    const { controller, registration, restore } = installBrowserState()
    const unsubscribe = controller.subscribe(() => undefined)

    await controller.register()
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(1)

    unsubscribe()
    vi.advanceTimersByTime(PERIODIC_UPDATE_CHECK_INTERVAL_MS)
    window.dispatchEvent(new Event("focus"))
    window.dispatchEvent(new Event("online"))
    document.dispatchEvent(new Event("visibilitychange"))
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(1)

    controller.dispose()
    restore()
  })

  it("dedupes overlapping update triggers while a check is already in flight", async () => {
    const deferred = createDeferred<void>()
    const { controller, registration, restore } = installBrowserState(() => deferred.promise)
    const unsubscribe = controller.subscribe(() => undefined)

    const registerPromise = controller.register()
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(PERIODIC_UPDATE_CHECK_INTERVAL_MS)
    window.dispatchEvent(new Event("focus"))
    document.dispatchEvent(new Event("visibilitychange"))
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(1)

    deferred.resolve()
    await registerPromise
    await flushPromises()
    vi.advanceTimersByTime(ACTIVATION_STALE_UPDATE_CHECK_MS)
    window.dispatchEvent(new Event("focus"))
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(2)

    unsubscribe()
    controller.dispose()
    restore()
  })
})
