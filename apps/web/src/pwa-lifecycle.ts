import {
  hasBuildMetadataMismatch,
  normalizeRuntimeBuildMetadata,
  type RuntimeBuildMetadata,
} from "./version-metadata.js"

export type PwaUpdateStatus =
  | "unsupported"
  | "idle"
  | "installing"
  | "ready"
  | "activating"
  | "updated"
  | "error"

export type PwaUpdateSource = "none" | "service-worker" | "version-probe"

export type PwaUpdateSnapshot = {
  status: PwaUpdateStatus
  source: PwaUpdateSource
  registration: ServiceWorkerRegistration | null
  waitingWorker: ServiceWorker | null
  detectedBuildMetadata: RuntimeBuildMetadata | null
  error: string | null
}

export type PwaUpdateListener = (snapshot: PwaUpdateSnapshot) => void

type PwaUpdateCheckReason = "register" | "interval" | "visibilitychange" | "focus" | "online"
type VersionProbeResult = "failed" | "current" | "stale"

type PwaUpdateControllerOptions = {
  fetchImpl?: typeof fetch
  reloadWindow?: () => void
}

const INITIAL_SNAPSHOT: PwaUpdateSnapshot = {
  status: "idle",
  source: "none",
  registration: null,
  waitingWorker: null,
  detectedBuildMetadata: null,
  error: null,
}
const PERIODIC_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000
const ACTIVATION_STALE_UPDATE_CHECK_MS = 10 * 60 * 1000
const APP_CACHE_PREFIX = "tuckmark-app-"

function serviceWorkersSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator
}

function resolveDeploymentBase(baseUrl: string, locationHref: string, moduleHref: string): URL {
  if (baseUrl.startsWith("./")) {
    return new URL("../", moduleHref)
  }
  return new URL(baseUrl, locationHref)
}

function resolveCurrentRuntimeBuildMetadata(): RuntimeBuildMetadata {
  const runtimeGlobals = globalThis as typeof globalThis & {
    __TUCKMARK_APP_VERSION__?: string
    __TUCKMARK_BUILD_REF__?: string
  }
  const appVersion =
    typeof __TUCKMARK_APP_VERSION__ === "string"
      ? __TUCKMARK_APP_VERSION__
      : runtimeGlobals.__TUCKMARK_APP_VERSION__
  const buildRef =
    typeof __TUCKMARK_BUILD_REF__ === "string"
      ? __TUCKMARK_BUILD_REF__
      : runtimeGlobals.__TUCKMARK_BUILD_REF__

  return normalizeRuntimeBuildMetadata({
    appVersion,
    buildRef,
  })
}

function parseRuntimeBuildMetadata(value: unknown): RuntimeBuildMetadata | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const candidate = value as {
    appVersion?: unknown
    buildRef?: unknown
  }
  const metadata = normalizeRuntimeBuildMetadata({
    appVersion: typeof candidate.appVersion === "string" ? candidate.appVersion : "",
    buildRef: typeof candidate.buildRef === "string" ? candidate.buildRef : "",
  })

  return metadata.appVersion || metadata.buildRef ? metadata : null
}

export function resolveServiceWorkerUrl(
  baseUrl: string,
  locationHref: string,
  moduleHref: string
): URL {
  return new URL("sw.js", resolveDeploymentBase(baseUrl, locationHref, moduleHref))
}

export function resolveServiceWorkerScope(
  baseUrl: string,
  locationHref: string,
  moduleHref: string
): string {
  return resolveDeploymentBase(baseUrl, locationHref, moduleHref).pathname
}

export function resolveVersionMetadataUrl(
  baseUrl: string,
  locationHref: string,
  moduleHref: string
): URL {
  return new URL("version.json", resolveDeploymentBase(baseUrl, locationHref, moduleHref))
}

export class PwaUpdateController {
  private snapshot: PwaUpdateSnapshot =
    serviceWorkersSupported() || typeof fetch === "function"
      ? INITIAL_SNAPSHOT
      : {
          ...INITIAL_SNAPSHOT,
          status: "unsupported",
        }
  private listeners = new Set<PwaUpdateListener>()
  private registration: ServiceWorkerRegistration | null = null
  private registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null
  private reloadOnControllerChange = false
  private updateCheckPromise: Promise<void> | null = null
  private lastUpdateCheckAt: number | null = null
  private periodicCheckTimer: number | null = null
  private runtimeListenersAttached = false

  constructor(private readonly options: PwaUpdateControllerOptions = {}) {}

  subscribe(listener: PwaUpdateListener): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.stopRuntimeChecks()
      }
    }
  }

  register(): Promise<ServiceWorkerRegistration | null> {
    if (this.registrationPromise) {
      if (this.listeners.size > 0) {
        this.startRuntimeChecks()
      }
      return this.registrationPromise
    }

    if (!serviceWorkersSupported()) {
      if (!this.canProbeVersionMetadata()) {
        this.setSnapshot({ status: "unsupported", source: "none" })
        return Promise.resolve(null)
      }
      this.setSnapshot({
        status: "idle",
        source: "none",
        registration: null,
        waitingWorker: null,
        detectedBuildMetadata: null,
        error: null,
      })
      if (this.listeners.size > 0) {
        this.startRuntimeChecks()
      }
      this.registrationPromise = this.checkForUpdates("register").then(() => null)
      return this.registrationPromise
    }

    navigator.serviceWorker.addEventListener("controllerchange", this.handleControllerChange)
    this.registrationPromise = navigator.serviceWorker
      .register(
        resolveServiceWorkerUrl(import.meta.env.BASE_URL, window.location.href, import.meta.url),
        {
          scope: resolveServiceWorkerScope(
            import.meta.env.BASE_URL,
            window.location.href,
            import.meta.url
          ),
        }
      )
      .then((registration) => {
        this.registration = registration
        this.watchRegistration(registration)
        if (this.listeners.size > 0) {
          this.startRuntimeChecks()
        }
        return this.checkForUpdates("register").then(() => registration)
      })
      .catch(async (error: unknown) => {
        this.registration = null
        if (this.listeners.size > 0) {
          this.startRuntimeChecks()
        }
        const probeResult = await this.checkVersionProbe()
        if (probeResult !== "stale" && this.snapshot.source !== "version-probe") {
          this.setSnapshot({
            status: "error",
            source: "none",
            error: error instanceof Error ? error.message : String(error),
          })
        }
        return null
      })

    return this.registrationPromise
  }

  dispose(): void {
    if (serviceWorkersSupported()) {
      navigator.serviceWorker.removeEventListener("controllerchange", this.handleControllerChange)
    }
    this.stopRuntimeChecks()
    this.registration = null
    this.registrationPromise = null
    this.updateCheckPromise = null
    this.lastUpdateCheckAt = null
  }

  applyUpdate(): void {
    const worker = this.snapshot.waitingWorker
    if (worker) {
      this.reloadOnControllerChange = true
      this.setSnapshot({ status: "activating", source: "service-worker" })
      worker.postMessage({ type: "SKIP_WAITING" })
      return
    }

    if (this.snapshot.source === "version-probe") {
      this.setSnapshot({ status: "activating" })
      void this.resetCachedShellForProbeUpdate().finally(() => {
        this.reloadWindow()
      })
      return
    }

    this.setSnapshot({ status: "installing" })
  }

  private startRuntimeChecks(): void {
    if (!this.runtimeListenersAttached) {
      document.addEventListener("visibilitychange", this.handleVisibilityChange)
      window.addEventListener("focus", this.handleWindowFocus)
      window.addEventListener("online", this.handleOnline)
      this.runtimeListenersAttached = true
    }
    if (this.periodicCheckTimer === null) {
      this.periodicCheckTimer = window.setInterval(() => {
        void this.checkForUpdates("interval")
      }, PERIODIC_UPDATE_CHECK_INTERVAL_MS)
    }
  }

  private stopRuntimeChecks(): void {
    if (
      this.runtimeListenersAttached &&
      typeof document !== "undefined" &&
      typeof window !== "undefined"
    ) {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange)
      window.removeEventListener("focus", this.handleWindowFocus)
      window.removeEventListener("online", this.handleOnline)
      this.runtimeListenersAttached = false
    }
    if (this.periodicCheckTimer !== null && typeof window !== "undefined") {
      window.clearInterval(this.periodicCheckTimer)
      this.periodicCheckTimer = null
    }
  }

  private async resetCachedShellForProbeUpdate(): Promise<void> {
    const cacheStorage = typeof caches === "undefined" ? null : caches
    const cleanupTasks: Array<Promise<unknown>> = []

    if (this.registration && typeof this.registration.unregister === "function") {
      cleanupTasks.push(this.registration.unregister().catch(() => false))
    }

    if (cacheStorage) {
      cleanupTasks.push(
        cacheStorage
          .keys()
          .then((keys) =>
            Promise.all(
              keys
                .filter((key) => key.startsWith(APP_CACHE_PREFIX))
                .map((key) => cacheStorage.delete(key))
            )
          )
          .catch(() => undefined)
      )
    }

    if (cleanupTasks.length > 0) {
      await Promise.all(cleanupTasks)
    }
  }

  private checkForUpdates(reason: PwaUpdateCheckReason) {
    if (!this.registration && !this.canProbeVersionMetadata()) {
      return Promise.resolve()
    }
    if (!this.shouldCheckForUpdates(reason)) {
      return Promise.resolve()
    }
    if (this.updateCheckPromise) {
      return this.updateCheckPromise
    }

    let successful = false
    const tasks: Array<Promise<void>> = []

    if (this.registration) {
      tasks.push(
        this.registration
          .update()
          .then(() => {
            successful = true
          })
          .catch(() => undefined)
      )
    }
    if (this.canProbeVersionMetadata()) {
      tasks.push(
        this.checkVersionProbe()
          .then((probeResult) => {
            if (probeResult !== "failed") {
              successful = true
            }
          })
          .catch(() => undefined)
      )
    }

    const updateRequest = Promise.all(tasks).then(() => {
      if (successful) {
        this.lastUpdateCheckAt = Date.now()
      }
    })
    const trackedUpdateRequest = updateRequest.finally(() => {
      if (this.updateCheckPromise === trackedUpdateRequest) {
        this.updateCheckPromise = null
      }
    })
    this.updateCheckPromise = trackedUpdateRequest
    return trackedUpdateRequest
  }

  private shouldCheckForUpdates(reason: PwaUpdateCheckReason): boolean {
    if (reason === "register") {
      return true
    }
    if (!this.isBrowserOnline()) {
      return false
    }
    if (
      (reason === "interval" || reason === "visibilitychange" || reason === "focus") &&
      !this.isPageVisible()
    ) {
      return false
    }
    if (reason === "interval") {
      return this.isUpdateCheckStale(PERIODIC_UPDATE_CHECK_INTERVAL_MS)
    }
    return this.isUpdateCheckStale(ACTIVATION_STALE_UPDATE_CHECK_MS)
  }

  private isUpdateCheckStale(thresholdMs: number): boolean {
    if (this.lastUpdateCheckAt === null) {
      return true
    }
    return Date.now() - this.lastUpdateCheckAt >= thresholdMs
  }

  private isPageVisible(): boolean {
    return typeof document === "undefined" || document.visibilityState !== "hidden"
  }

  private isBrowserOnline(): boolean {
    return typeof navigator === "undefined" || navigator.onLine !== false
  }

  private canProbeVersionMetadata(): boolean {
    return this.getFetchImpl() !== null && typeof window !== "undefined"
  }

  private getFetchImpl(): typeof fetch | null {
    if (this.options.fetchImpl) {
      return this.options.fetchImpl
    }
    return typeof fetch === "function" ? fetch.bind(globalThis) : null
  }

  private reloadWindow(): void {
    if (this.options.reloadWindow) {
      this.options.reloadWindow()
      return
    }
    window.location.reload()
  }

  private async checkVersionProbe(): Promise<VersionProbeResult> {
    const fetchImpl = this.getFetchImpl()
    if (!fetchImpl) {
      return "failed"
    }

    try {
      const response = await fetchImpl(
        resolveVersionMetadataUrl(import.meta.env.BASE_URL, window.location.href, import.meta.url),
        {
          cache: "no-store",
          headers: {
            accept: "application/json",
          },
        }
      )
      if (!response.ok) {
        return "failed"
      }

      const remoteMetadata = parseRuntimeBuildMetadata(await response.json())
      if (!remoteMetadata) {
        return "failed"
      }

      if (hasBuildMetadataMismatch(resolveCurrentRuntimeBuildMetadata(), remoteMetadata)) {
        this.setVersionProbeReady(remoteMetadata)
        return "stale"
      } else {
        this.clearVersionProbeReady()
        return "current"
      }
    } catch {
      return "failed"
    }
  }

  private setVersionProbeReady(remoteMetadata: RuntimeBuildMetadata): void {
    if (this.snapshot.waitingWorker || this.snapshot.source === "service-worker") {
      return
    }

    this.setSnapshot({
      status: this.snapshot.status === "activating" ? "activating" : "ready",
      source: "version-probe",
      registration: this.registration,
      waitingWorker: null,
      detectedBuildMetadata: remoteMetadata,
      error: null,
    })
  }

  private clearVersionProbeReady(): void {
    if (this.snapshot.source !== "version-probe" || this.snapshot.status === "activating") {
      return
    }

    this.setSnapshot({
      status: "idle",
      source: "none",
      registration: this.registration,
      waitingWorker: null,
      detectedBuildMetadata: null,
      error: null,
    })
  }

  private watchRegistration(registration: ServiceWorkerRegistration): void {
    if (registration.waiting) {
      this.setSnapshot({
        registration,
        waitingWorker: registration.waiting,
        status: "ready",
        source: "service-worker",
        detectedBuildMetadata: null,
        error: null,
      })
    } else {
      this.syncIdleState(registration)
    }

    registration.addEventListener("updatefound", () => {
      const installing = registration.installing
      if (!installing) {
        return
      }
      if (this.snapshot.source === "version-probe" && this.snapshot.status === "ready") {
        this.setSnapshot({
          registration,
          waitingWorker: null,
          error: null,
        })
      } else {
        this.setSnapshot({
          registration,
          waitingWorker: null,
          status: "installing",
          source: "service-worker",
          detectedBuildMetadata:
            this.snapshot.source === "version-probe" ? this.snapshot.detectedBuildMetadata : null,
          error: null,
        })
      }
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed") {
          if (navigator.serviceWorker.controller) {
            this.setSnapshot({
              registration,
              waitingWorker: registration.waiting ?? installing,
              status: "ready",
              source: "service-worker",
              detectedBuildMetadata: null,
              error: null,
            })
          } else {
            this.syncIdleState(registration)
          }
        }
        if (installing.state === "redundant") {
          this.setSnapshot({
            registration,
            waitingWorker: null,
            status: "error",
            source: "service-worker",
            detectedBuildMetadata: null,
            error: "更新暂不可用，请稍后重试。",
          })
        }
      })
    })
  }

  private syncIdleState(registration: ServiceWorkerRegistration | null): void {
    if (this.snapshot.source === "version-probe") {
      this.setSnapshot({
        registration,
        waitingWorker: null,
      })
      return
    }

    this.setSnapshot({
      registration,
      waitingWorker: null,
      status: "idle",
      source: "none",
      detectedBuildMetadata: null,
      error: null,
    })
  }

  private handleControllerChange = (): void => {
    if (!this.reloadOnControllerChange) {
      return
    }
    this.reloadOnControllerChange = false
    this.setSnapshot({ status: "updated" })
    this.reloadWindow()
  }

  private handleVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") {
      return
    }
    void this.checkForUpdates("visibilitychange")
  }

  private handleWindowFocus = (): void => {
    void this.checkForUpdates("focus")
  }

  private handleOnline = (): void => {
    void this.checkForUpdates("online")
  }

  private setSnapshot(next: Partial<PwaUpdateSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...next,
    }
    for (const listener of this.listeners) {
      listener(this.snapshot)
    }
  }
}

export const pwaUpdateController = new PwaUpdateController()
