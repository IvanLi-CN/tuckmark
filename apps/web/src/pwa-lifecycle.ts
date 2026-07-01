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
  private registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null
  private reloadOnControllerChange = false

  subscribe(listener: PwaUpdateListener): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => {
      this.listeners.delete(listener)
    }
  }

  register(): Promise<ServiceWorkerRegistration | null> {
    if (!serviceWorkersSupported()) {
      this.setSnapshot({ status: "unsupported" })
      return Promise.resolve(null)
    }
    if (this.registrationPromise) {
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
        this.watchRegistration(registration)
        return registration
          .update()
          .catch(() => undefined)
          .then(() => registration)
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
