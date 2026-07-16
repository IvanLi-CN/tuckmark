import type { RuntimeStore } from "./runtime-store-contract.js"

type WorkerMethodMap = {
  init: undefined
  listTemplates: undefined
  readTemplate: { templateId: string }
  readHistory: { templateId: string }
  readVersion: { versionId: string }
  saveTemplate: Parameters<RuntimeStore["saveTemplate"]>[0]
  saveAutosave: Parameters<RuntimeStore["saveAutosave"]>[0]
  replaceWorkingCopy: Parameters<RuntimeStore["replaceWorkingCopy"]>[0]
  loadWorkingCopy: { source: Parameters<RuntimeStore["loadWorkingCopy"]>[0] }
  clearWorkingCopy: { source: Parameters<RuntimeStore["clearWorkingCopy"]>[0] }
  clearTemplateAutosaves: { templateId: string }
  loadAppSettings: undefined
  saveAppSettings: {
    next: Partial<
      Omit<Awaited<ReturnType<RuntimeStore["loadAppSettings"]>>, "version" | "updatedAt">
    >
  }
  exportSnapshot: undefined
  replaceSnapshot: { snapshot: Awaited<ReturnType<RuntimeStore["exportSnapshot"]>> }
  isEmpty: undefined
  resetForTest: undefined
}

type WorkerRequest<T extends keyof WorkerMethodMap = keyof WorkerMethodMap> = {
  id: number
  method: T
  args: WorkerMethodMap[T]
}

type WorkerResponse =
  | {
      id: number
      ok: true
      result: unknown
    }
  | {
      id: number
      ok: false
      error: string
    }

function canUseSqliteRuntimeStore(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof window !== "undefined" &&
    typeof window.isSecureContext === "boolean" &&
    window.isSecureContext
  )
}

class SqliteRuntimeStoreClient implements RuntimeStore {
  private worker: Worker | null = null
  private readyPromise: Promise<void> | null = null
  private nextRequestId = 1
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (reason?: unknown) => void
    }
  >()

  private ensureWorker() {
    if (!this.worker) {
      this.worker = new Worker(new URL("./user-template-sqlite-worker.ts", import.meta.url), {
        type: "module",
      })
      this.worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
        const response = event.data
        const entry = this.pending.get(response.id)
        if (!entry) {
          return
        }
        this.pending.delete(response.id)
        if (response.ok) {
          entry.resolve(response.result)
          return
        }
        entry.reject(new Error(response.error))
      })
      this.worker.addEventListener("error", (event) => {
        for (const [id, entry] of this.pending) {
          this.pending.delete(id)
          entry.reject(event.error ?? new Error(event.message))
        }
      })
    }
    return this.worker
  }

  private async request<T extends keyof WorkerMethodMap>(
    method: T,
    args: WorkerMethodMap[T]
  ): Promise<unknown> {
    const worker = this.ensureWorker()
    if (!this.readyPromise) {
      this.readyPromise = this.requestRaw("init", undefined).then(() => undefined)
    }
    if (method !== "init") {
      await this.readyPromise
    }
    return this.requestRaw(method, args, worker)
  }

  private requestRaw<T extends keyof WorkerMethodMap>(
    method: T,
    args: WorkerMethodMap[T],
    worker = this.ensureWorker()
  ) {
    this.nextRequestId += 1
    const id = this.nextRequestId
    const payload: WorkerRequest<T> = {
      id,
      method,
      args,
    }
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage(payload)
    })
  }

  async listTemplates() {
    return (await this.request("listTemplates", undefined)) as Awaited<
      ReturnType<RuntimeStore["listTemplates"]>
    >
  }

  async readTemplate(templateId: string) {
    return (await this.request("readTemplate", { templateId })) as Awaited<
      ReturnType<RuntimeStore["readTemplate"]>
    >
  }

  async readHistory(templateId: string) {
    return (await this.request("readHistory", { templateId })) as Awaited<
      ReturnType<RuntimeStore["readHistory"]>
    >
  }

  async readVersion(versionId: string) {
    return (await this.request("readVersion", { versionId })) as Awaited<
      ReturnType<RuntimeStore["readVersion"]>
    >
  }

  async saveTemplate(args: Parameters<RuntimeStore["saveTemplate"]>[0]) {
    return (await this.request("saveTemplate", args)) as Awaited<
      ReturnType<RuntimeStore["saveTemplate"]>
    >
  }

  async saveAutosave(args: Parameters<RuntimeStore["saveAutosave"]>[0]) {
    return (await this.request("saveAutosave", args)) as Awaited<
      ReturnType<RuntimeStore["saveAutosave"]>
    >
  }

  async replaceWorkingCopy(args: Parameters<RuntimeStore["replaceWorkingCopy"]>[0]) {
    return (await this.request("replaceWorkingCopy", args)) as Awaited<
      ReturnType<RuntimeStore["replaceWorkingCopy"]>
    >
  }

  async loadWorkingCopy(source: Parameters<RuntimeStore["loadWorkingCopy"]>[0]) {
    return (await this.request("loadWorkingCopy", { source })) as Awaited<
      ReturnType<RuntimeStore["loadWorkingCopy"]>
    >
  }

  async clearWorkingCopy(source: Parameters<RuntimeStore["clearWorkingCopy"]>[0]) {
    await this.request("clearWorkingCopy", { source })
  }

  async clearTemplateAutosaves(templateId: string) {
    await this.request("clearTemplateAutosaves", { templateId })
  }

  async loadAppSettings() {
    return (await this.request("loadAppSettings", undefined)) as Awaited<
      ReturnType<RuntimeStore["loadAppSettings"]>
    >
  }

  async saveAppSettings(updater: Parameters<RuntimeStore["saveAppSettings"]>[0]) {
    const current = await this.loadAppSettings()
    const next = typeof updater === "function" ? updater(current) : updater
    return (await this.request("saveAppSettings", { next })) as Awaited<
      ReturnType<RuntimeStore["saveAppSettings"]>
    >
  }

  async exportSnapshot() {
    return (await this.request("exportSnapshot", undefined)) as Awaited<
      ReturnType<RuntimeStore["exportSnapshot"]>
    >
  }

  async replaceSnapshot(snapshot: Awaited<ReturnType<RuntimeStore["exportSnapshot"]>>) {
    await this.request("replaceSnapshot", { snapshot })
  }

  async isEmpty() {
    return (await this.request("isEmpty", undefined)) as Awaited<
      ReturnType<RuntimeStore["isEmpty"]>
    >
  }

  async resetForTest() {
    await this.request("resetForTest", undefined)
  }
}

export function supportsSqliteRuntimeStore() {
  return canUseSqliteRuntimeStore()
}

export function createSqliteRuntimeStore(): RuntimeStore {
  return new SqliteRuntimeStoreClient()
}
