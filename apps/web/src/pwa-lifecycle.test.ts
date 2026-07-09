// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  PwaUpdateController,
  resolveServiceWorkerScope,
  resolveServiceWorkerUrl,
  resolveVersionMetadataUrl,
} from "./pwa-lifecycle.js"

const PERIODIC_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000
const ACTIVATION_STALE_UPDATE_CHECK_MS = 10 * 60 * 1000

type FakeWorkerHandle = {
  worker: ServiceWorker
  postMessage: ReturnType<typeof vi.fn>
  dispatchStateChange: (state: ServiceWorkerState) => void
}

type FakeRegistrationHandle = {
  registration: ServiceWorkerRegistration
  update: ReturnType<typeof vi.fn>
  unregister: ReturnType<typeof vi.fn>
  setWaitingWorker: (worker: ServiceWorker | null) => void
  setInstallingWorker: (worker: ServiceWorker | null) => void
  dispatchUpdateFound: () => void
}

type BrowserState = {
  controller: PwaUpdateController
  fetchMock: ReturnType<typeof vi.fn>
  registration: ServiceWorkerRegistration
  registrationHandle: FakeRegistrationHandle
  setOnline: (value: boolean) => void
  setVisibility: (value: DocumentVisibilityState) => void
  restore: () => void
}

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

function restoreProperty(
  target: object,
  key: string,
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor)
    return
  }
  Reflect.deleteProperty(target, key)
}

function createFakeWorker(initialState: ServiceWorkerState = "installing"): FakeWorkerHandle {
  const stateChangeListeners: Array<() => void> = []
  const postMessage = vi.fn()
  const worker = {
    state: initialState,
    postMessage,
    addEventListener: vi.fn((type: string, listener: () => void) => {
      if (type === "statechange") {
        stateChangeListeners.push(listener)
      }
    }),
  } as unknown as ServiceWorker

  return {
    worker,
    postMessage,
    dispatchStateChange(state) {
      ;(worker as { state: ServiceWorkerState }).state = state
      for (const listener of stateChangeListeners) {
        listener()
      }
    },
  }
}

function createFakeRegistration(
  updateImpl: () => Promise<void> = () => Promise.resolve(),
  unregisterImpl: () => Promise<boolean> = () => Promise.resolve(true)
): FakeRegistrationHandle {
  const updateFoundListeners: Array<() => void> = []
  const registration = {
    update: vi.fn(updateImpl),
    unregister: vi.fn(unregisterImpl),
    waiting: null,
    installing: null,
    addEventListener: vi.fn((type: string, listener: () => void) => {
      if (type === "updatefound") {
        updateFoundListeners.push(listener)
      }
    }),
  } as unknown as ServiceWorkerRegistration

  return {
    registration,
    update: registration.update as ReturnType<typeof vi.fn>,
    unregister: registration.unregister as ReturnType<typeof vi.fn>,
    setWaitingWorker(worker) {
      ;(registration as { waiting: ServiceWorker | null }).waiting = worker
    },
    setInstallingWorker(worker) {
      ;(registration as { installing: ServiceWorker | null }).installing = worker
    },
    dispatchUpdateFound() {
      for (const listener of updateFoundListeners) {
        listener()
      }
    },
  }
}

function installBrowserState({
  updateImpl,
  fetchImpl,
  withServiceWorker = true,
  serviceWorkerController = { state: "activated" } as ServiceWorker,
  buildMetadata = {
    appVersion: "",
    buildRef: "f7a7393",
  },
  remoteMetadata = buildMetadata,
  reloadWindow,
}: {
  updateImpl?: () => Promise<void>
  fetchImpl?: typeof fetch
  withServiceWorker?: boolean
  serviceWorkerController?: ServiceWorker | null
  buildMetadata?: {
    appVersion: string
    buildRef: string
  }
  remoteMetadata?: {
    appVersion: string
    buildRef: string
  }
  reloadWindow?: () => void
} = {}): BrowserState {
  let online = true
  let visibilityState: DocumentVisibilityState = "visible"
  const originalServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "serviceWorker"
  )
  const originalOnLineDescriptor = Object.getOwnPropertyDescriptor(navigator, "onLine")
  const originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState")
  const originalFetch = globalThis.fetch
  const originalCachesDescriptor = Object.getOwnPropertyDescriptor(globalThis, "caches")
  const originalAppVersionDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "__TUCKMARK_APP_VERSION__"
  )
  const originalBuildRefDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "__TUCKMARK_BUILD_REF__"
  )
  const registrationHandle = createFakeRegistration(updateImpl)
  const fetchMock = vi.fn(
    fetchImpl ??
      (async () =>
        new Response(JSON.stringify(remoteMetadata), {
          headers: { "content-type": "application/json" },
        }))
  )
  const cacheKeys = ["tuckmark-app-old", "other-cache"]
  const cacheDelete = vi.fn(async () => true)
  const cacheStorage = {
    keys: vi.fn(async () => cacheKeys),
    delete: cacheDelete,
  } as unknown as CacheStorage

  if (withServiceWorker) {
    const serviceWorker = {
      controller: serviceWorkerController,
      register: vi.fn(async () => registrationHandle.registration),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as ServiceWorkerContainer

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorker,
    })
  } else {
    Reflect.deleteProperty(navigator, "serviceWorker")
  }
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  })
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibilityState,
  })
  globalThis.fetch = fetchMock as typeof fetch
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: cacheStorage,
  })
  Object.defineProperty(globalThis, "__TUCKMARK_APP_VERSION__", {
    configurable: true,
    value: buildMetadata.appVersion,
  })
  Object.defineProperty(globalThis, "__TUCKMARK_BUILD_REF__", {
    configurable: true,
    value: buildMetadata.buildRef,
  })

  return {
    controller: new PwaUpdateController({ fetchImpl: fetchMock as typeof fetch, reloadWindow }),
    fetchMock,
    registration: registrationHandle.registration,
    registrationHandle,
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
      globalThis.fetch = originalFetch
      restoreProperty(globalThis, "caches", originalCachesDescriptor)
      restoreProperty(globalThis, "__TUCKMARK_APP_VERSION__", originalAppVersionDescriptor)
      restoreProperty(globalThis, "__TUCKMARK_BUILD_REF__", originalBuildRefDescriptor)
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

  it("resolves relative-base service worker and version metadata URLs from the bundled module", () => {
    const moduleHref = "https://example.test/repo/assets/index.js"

    expect(
      resolveServiceWorkerUrl("./", "https://example.test/repo/templates", moduleHref).href
    ).toBe("https://example.test/repo/sw.js")
    expect(resolveServiceWorkerScope("./", "https://example.test/repo/templates", moduleHref)).toBe(
      "/repo/"
    )
    expect(
      resolveVersionMetadataUrl("./", "https://example.test/repo/templates", moduleHref).href
    ).toBe("https://example.test/repo/version.json")
  })

  it("checks both the service worker and version probe immediately after registration", async () => {
    const { controller, registration, fetchMock, restore } = installBrowserState()

    await controller.register()
    await flushPromises()

    expect(registration.update).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    controller.dispose()
    restore()
  })

  it("runs a low-frequency periodic update check while the page stays visible", async () => {
    const { controller, registration, fetchMock, restore } = installBrowserState()
    const unsubscribe = controller.subscribe(() => undefined)

    await controller.register()
    await flushPromises()
    vi.advanceTimersByTime(PERIODIC_UPDATE_CHECK_INTERVAL_MS - 1)
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    unsubscribe()
    controller.dispose()
    restore()
  })

  it("rechecks on activation only after the stale threshold has elapsed", async () => {
    const { controller, registration, fetchMock, restore } = installBrowserState()
    const unsubscribe = controller.subscribe(() => undefined)

    await controller.register()
    await flushPromises()
    vi.advanceTimersByTime(ACTIVATION_STALE_UPDATE_CHECK_MS - 1)
    window.dispatchEvent(new Event("focus"))
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    window.dispatchEvent(new Event("focus"))
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    unsubscribe()
    controller.dispose()
    restore()
  })

  it("skips hidden periodic checks and catches up once the page becomes visible again", async () => {
    const { controller, registration, fetchMock, restore, setVisibility } = installBrowserState()
    const unsubscribe = controller.subscribe(() => undefined)

    await controller.register()
    await flushPromises()

    setVisibility("hidden")
    vi.advanceTimersByTime(PERIODIC_UPDATE_CHECK_INTERVAL_MS)
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    setVisibility("visible")
    document.dispatchEvent(new Event("visibilitychange"))
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    unsubscribe()
    controller.dispose()
    restore()
  })

  it("skips offline checks and retries once the browser comes back online", async () => {
    const { controller, registration, fetchMock, restore, setOnline } = installBrowserState()
    const unsubscribe = controller.subscribe(() => undefined)

    await controller.register()
    await flushPromises()

    setOnline(false)
    vi.advanceTimersByTime(PERIODIC_UPDATE_CHECK_INTERVAL_MS)
    window.dispatchEvent(new Event("focus"))
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    setOnline(true)
    window.dispatchEvent(new Event("online"))
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    unsubscribe()
    controller.dispose()
    restore()
  })

  it("stops background polling once the last subscriber unsubscribes", async () => {
    const { controller, registration, fetchMock, restore } = installBrowserState()
    const unsubscribe = controller.subscribe(() => undefined)

    await controller.register()
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    unsubscribe()
    vi.advanceTimersByTime(PERIODIC_UPDATE_CHECK_INTERVAL_MS)
    window.dispatchEvent(new Event("focus"))
    window.dispatchEvent(new Event("online"))
    document.dispatchEvent(new Event("visibilitychange"))
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    controller.dispose()
    restore()
  })

  it("dedupes overlapping service-worker and probe triggers while a check is already in flight", async () => {
    const deferred = createDeferred<void>()
    const { controller, registration, fetchMock, restore } = installBrowserState({
      updateImpl: () => deferred.promise,
      fetchImpl: vi.fn(() => deferred.promise.then(() => new Response('{"buildRef":"f7a7393"}'))),
    })
    const unsubscribe = controller.subscribe(() => undefined)

    const registerPromise = controller.register()
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(PERIODIC_UPDATE_CHECK_INTERVAL_MS)
    window.dispatchEvent(new Event("focus"))
    document.dispatchEvent(new Event("visibilitychange"))
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    deferred.resolve()
    await registerPromise
    await flushPromises()
    vi.advanceTimersByTime(ACTIVATION_STALE_UPDATE_CHECK_MS)
    window.dispatchEvent(new Event("focus"))
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    unsubscribe()
    controller.dispose()
    restore()
  })

  it("falls back to a version probe when service workers are unavailable", async () => {
    const { controller, restore } = installBrowserState({
      withServiceWorker: false,
      remoteMetadata: {
        appVersion: "",
        buildRef: "e499426",
      },
    })
    const observed: Array<{
      status: string
      source: string
      buildRef: string | null
    }> = []
    const unsubscribe = controller.subscribe((snapshot) => {
      observed.push({
        status: snapshot.status,
        source: snapshot.source,
        buildRef: snapshot.detectedBuildMetadata?.buildRef ?? null,
      })
    })

    const registration = await controller.register()
    await flushPromises()

    expect(registration).toBeNull()
    expect(observed[observed.length - 1]).toEqual({
      status: "ready",
      source: "version-probe",
      buildRef: "e499426",
    })

    unsubscribe()
    controller.dispose()
    restore()
  })

  it("preserves a service worker registration error when the version probe matches", async () => {
    const serviceWorkerError = new Error("registration blocked")
    const { controller, restore } = installBrowserState()
    ;(
      navigator.serviceWorker as ServiceWorkerContainer & {
        register: ReturnType<typeof vi.fn>
      }
    ).register.mockRejectedValueOnce(serviceWorkerError)
    let latestSnapshot = ""
    let latestError: string | null = null
    const unsubscribe = controller.subscribe((snapshot) => {
      latestSnapshot = `${snapshot.status}:${snapshot.source}`
      latestError = snapshot.error
    })

    const registration = await controller.register()
    await flushPromises()

    expect(registration).toBeNull()
    await vi.waitFor(() => {
      expect(latestSnapshot).toBe("error:none")
    })
    expect(latestError).toBe("registration blocked")

    unsubscribe()
    controller.dispose()
    restore()
  })

  it("suppresses a service worker registration error when the version probe finds a newer build", async () => {
    const serviceWorkerError = new Error("registration blocked")
    const { controller, restore } = installBrowserState({
      remoteMetadata: {
        appVersion: "",
        buildRef: "e499426",
      },
    })
    ;(
      navigator.serviceWorker as ServiceWorkerContainer & {
        register: ReturnType<typeof vi.fn>
      }
    ).register.mockRejectedValueOnce(serviceWorkerError)
    let latestSnapshot = ""
    let latestError: string | null = null
    let latestBuildRef: string | null = null
    const unsubscribe = controller.subscribe((snapshot) => {
      latestSnapshot = `${snapshot.status}:${snapshot.source}`
      latestError = snapshot.error
      latestBuildRef = snapshot.detectedBuildMetadata?.buildRef ?? null
    })

    const registration = await controller.register()
    await flushPromises()

    expect(registration).toBeNull()
    await vi.waitFor(() => {
      expect(latestSnapshot).toBe("ready:version-probe")
    })
    expect(latestError).toBeNull()
    expect(latestBuildRef).toBe("e499426")

    unsubscribe()
    controller.dispose()
    restore()
  })

  it("surfaces a stranded old shell as ready when the probe mismatches and the controller is missing", async () => {
    const { controller, restore } = installBrowserState({
      serviceWorkerController: null,
      remoteMetadata: {
        appVersion: "",
        buildRef: "e499426",
      },
    })
    let latestSnapshot = null as null | {
      status: string
      source: string
      registration: boolean
    }
    const unsubscribe = controller.subscribe((snapshot) => {
      latestSnapshot = {
        status: snapshot.status,
        source: snapshot.source,
        registration: snapshot.registration !== null,
      }
    })

    await controller.register()
    await flushPromises()

    expect(latestSnapshot).toEqual({
      status: "ready",
      source: "version-probe",
      registration: true,
    })

    unsubscribe()
    controller.dispose()
    restore()
  })

  it("preserves a version-probe prompt when an installing worker finishes without an active controller", async () => {
    const { controller, registrationHandle, restore } = installBrowserState({
      serviceWorkerController: null,
      remoteMetadata: {
        appVersion: "",
        buildRef: "e499426",
      },
    })
    const observedSources: Array<string> = []
    const unsubscribe = controller.subscribe((snapshot) => {
      observedSources.push(`${snapshot.status}:${snapshot.source}`)
    })
    const installingWorker = createFakeWorker("installing")

    await controller.register()
    await flushPromises()

    registrationHandle.setInstallingWorker(installingWorker.worker)
    registrationHandle.dispatchUpdateFound()
    installingWorker.dispatchStateChange("installed")
    await flushPromises()

    expect(observedSources).toContain("ready:version-probe")
    expect(observedSources[observedSources.length - 1]).toBe("ready:version-probe")

    unsubscribe()
    controller.dispose()
    restore()
  })

  it("clears a version-probe prompt once the remote metadata matches again", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"appVersion":"","buildRef":"e499426"}'))
      .mockResolvedValueOnce(new Response('{"appVersion":"","buildRef":"f7a7393"}'))
    const { controller, restore } = installBrowserState({
      fetchImpl: fetchMock as typeof fetch,
    })
    let latestSnapshot = ""
    const unsubscribe = controller.subscribe((snapshot) => {
      latestSnapshot = `${snapshot.status}:${snapshot.source}`
    })

    await controller.register()
    await flushPromises()
    expect(latestSnapshot).toBe("ready:version-probe")

    vi.advanceTimersByTime(ACTIVATION_STALE_UPDATE_CHECK_MS)
    window.dispatchEvent(new Event("focus"))
    await flushPromises()
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => {
      expect(latestSnapshot).toBe("idle:none")
    })

    unsubscribe()
    controller.dispose()
    restore()
  })

  it("retries a failed startup version probe once the browser comes back online", async () => {
    const fetchMock = vi.fn(async () => {
      if (!navigator.onLine) {
        throw new Error("offline")
      }
      return new Response('{"appVersion":"","buildRef":"e499426"}')
    })
    const { controller, restore, setOnline } = installBrowserState({
      withServiceWorker: false,
      fetchImpl: fetchMock as typeof fetch,
    })
    let latestSnapshot = ""
    const unsubscribe = controller.subscribe((snapshot) => {
      latestSnapshot = `${snapshot.status}:${snapshot.source}`
    })

    setOnline(false)
    await controller.register()
    await flushPromises()
    expect(latestSnapshot).toBe("idle:none")

    setOnline(true)
    window.dispatchEvent(new Event("online"))
    await flushPromises()
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => {
      expect(latestSnapshot).toBe("ready:version-probe")
    })

    unsubscribe()
    controller.dispose()
    restore()
  })

  it("clears cached app shell state before reloading a version-probe update", async () => {
    const reloadWindow = vi.fn()
    const { controller, registrationHandle, restore } = installBrowserState({
      remoteMetadata: {
        appVersion: "",
        buildRef: "e499426",
      },
      reloadWindow,
    })
    let latestSnapshot = ""
    const unsubscribe = controller.subscribe((snapshot) => {
      latestSnapshot = `${snapshot.status}:${snapshot.source}`
    })

    await controller.register()
    await flushPromises()

    controller.applyUpdate()
    await flushPromises()

    expect(registrationHandle.unregister).toHaveBeenCalledTimes(1)
    expect(caches.keys).toHaveBeenCalledTimes(1)
    expect(caches.delete).toHaveBeenCalledWith("tuckmark-app-old")
    expect(caches.delete).not.toHaveBeenCalledWith("other-cache")
    await vi.waitFor(() => {
      expect(reloadWindow).toHaveBeenCalledTimes(1)
    })
    expect(latestSnapshot).toBe("activating:version-probe")

    unsubscribe()
    controller.dispose()
    restore()
  })
})
