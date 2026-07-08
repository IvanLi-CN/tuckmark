export type PwaUpdateStatus =
  | "unsupported"
  | "idle"
  | "installing"
  | "ready"
  | "activating"
  | "updated"
  | "error"

export type PwaUpdateSnapshot = {
  status: PwaUpdateStatus
  registration: ServiceWorkerRegistration | null
  waitingWorker: ServiceWorker | null
  error: string | null
}

export type PwaUpdateListener = (snapshot: PwaUpdateSnapshot) => void

const INITIAL_SNAPSHOT: PwaUpdateSnapshot = {
  status: "idle",
  registration: null,
  waitingWorker: null,
  error: null,
}
const PERIODIC_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000
const ACTIVATION_STALE_UPDATE_CHECK_MS = 10 * 60 * 1000

function serviceWorkersSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator
}

function resolveDeploymentBase(baseUrl: string, locationHref: string, moduleHref: string): URL {
  if (baseUrl.startsWith("./")) {
    return new URL("../", moduleHref)
  }
  return new URL(baseUrl, locationHref)
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

export class PwaUpdateController {
  private snapshot: PwaUpdateSnapshot = serviceWorkersSupported()
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
    if (!serviceWorkersSupported()) {
      this.setSnapshot({ status: "unsupported" })
      return Promise.resolve(null)
    }
    if (this.registrationPromise) {
      if (this.registration && this.listeners.size > 0) {
        this.startRuntimeChecks()
      }
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
      .catch((error: unknown) => {
        this.setSnapshot({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        })
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
    if (!worker) {
      this.setSnapshot({ status: "installing" })
      return
    }
    this.reloadOnControllerChange = true
    this.setSnapshot({ status: "activating" })
    worker.postMessage({ type: "SKIP_WAITING" })
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

  private checkForUpdates(
    reason: "register" | "interval" | "visibilitychange" | "focus" | "online"
  ) {
    const registration = this.registration
    if (!registration) {
      return Promise.resolve()
    }
    if (!this.shouldCheckForUpdates(reason)) {
      return Promise.resolve()
    }
    if (this.updateCheckPromise) {
      return this.updateCheckPromise
    }

    const updateRequest = registration
      .update()
      .then(() => {
        this.lastUpdateCheckAt = Date.now()
      })
      .catch(() => undefined)
    const trackedUpdateRequest = updateRequest.finally(() => {
      if (this.updateCheckPromise === trackedUpdateRequest) {
        this.updateCheckPromise = null
      }
    })
    this.updateCheckPromise = trackedUpdateRequest
    return trackedUpdateRequest
  }

  private shouldCheckForUpdates(
    reason: "register" | "interval" | "visibilitychange" | "focus" | "online"
  ): boolean {
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

  private watchRegistration(registration: ServiceWorkerRegistration): void {
    if (registration.waiting) {
      this.setSnapshot({
        registration,
        waitingWorker: registration.waiting,
        status: "ready",
        error: null,
      })
    } else {
      this.setSnapshot({
        registration,
        waitingWorker: null,
        status: "idle",
        error: null,
      })
    }

    registration.addEventListener("updatefound", () => {
      const installing = registration.installing
      if (!installing) {
        return
      }
      this.setSnapshot({
        registration,
        waitingWorker: null,
        status: "installing",
        error: null,
      })
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed") {
          if (navigator.serviceWorker.controller) {
            this.setSnapshot({
              registration,
              waitingWorker: registration.waiting ?? installing,
              status: "ready",
              error: null,
            })
          } else {
            this.setSnapshot({
              registration,
              waitingWorker: null,
              status: "idle",
              error: null,
            })
          }
        }
        if (installing.state === "redundant") {
          this.setSnapshot({
            registration,
            waitingWorker: null,
            status: "error",
            error: "更新暂不可用，请稍后重试。",
          })
        }
      })
    })
  }

  private handleControllerChange = (): void => {
    if (!this.reloadOnControllerChange) {
      return
    }
    this.reloadOnControllerChange = false
    this.setSnapshot({ status: "updated" })
    window.location.reload()
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
