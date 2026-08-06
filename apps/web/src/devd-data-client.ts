import {
  createDefaultRuntimeAppSettings,
  normalizeRuntimeAppSettings,
} from "./runtime-app-settings.js"
import type {
  RuntimeStore,
  RuntimeStoreAppSettings,
  RuntimeStoreSaveTemplateArgs,
  RuntimeStoreSaveWorkingCopyArgs,
  RuntimeStoreSnapshot,
} from "./runtime-store-contract.js"
import type {
  CanvasDraftSource,
  CanvasWorkingCopyIndexEntry,
  UserTemplateHistory,
  UserTemplateSummary,
  UserTemplateVersionSnapshot,
} from "./types.js"

declare const __TUCKMARK_WEB_SURFACE__: "server-http" | "browser-static"

type RevisionResponse<T> = { revision: number; data: T }
type SettingsUpdater =
  | Partial<Omit<RuntimeStoreAppSettings, "version" | "updatedAt">>
  | ((
      current: RuntimeStoreAppSettings
    ) => Partial<Omit<RuntimeStoreAppSettings, "version" | "updatedAt">>)

type PendingAutosave = {
  args: RuntimeStoreSaveWorkingCopyArgs
  inFlight: boolean
  timer: ReturnType<typeof setTimeout> | null
  waiters: Array<{
    resolve: (value: CanvasWorkingCopyIndexEntry) => void
    reject: (error: unknown) => void
  }>
}

const AUTOSAVE_COALESCE_MS = 150

export class DevdDataConflictError extends Error {
  readonly code = "revision_conflict"

  constructor(
    readonly actualRevision: number,
    message: string
  ) {
    super(message)
  }
}

export function isServerHttpDataSurface(): boolean {
  const configured = (import.meta.env as Record<string, string | undefined>).TUCKMARK_WEB_SURFACE
  if ((import.meta.env as Record<string, string | undefined>).MODE === "test") {
    return configured === "server-http"
  }
  if (configured === "server-http" || configured === "browser-static")
    return configured === "server-http"
  return (
    typeof __TUCKMARK_WEB_SURFACE__ !== "undefined" && __TUCKMARK_WEB_SURFACE__ === "server-http"
  )
}

export class DevdDataClient {
  private revision: number | null = null
  private snapshotRequest: Promise<RuntimeStoreSnapshot> | null = null
  private replacementSnapshotRequest: Promise<RuntimeStoreSnapshot> | null = null
  private minimumSnapshotRevision = 0
  private mutationQueue: Promise<void> = Promise.resolve()
  private readonly pendingAutosaves = new Map<string, PendingAutosave>()

  private acceptRevision(revision: number): void {
    if (this.revision !== null && revision < this.revision) {
      throw new DevdDataConflictError(
        this.revision,
        "DEVD data changed while this response was loading. Refresh and retry your edit."
      )
    }
    this.revision = revision
  }

  private rememberRevision(revision: number): void {
    this.revision = Math.max(this.revision ?? revision, revision)
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`/api/data${path}`, init)
    const body = (await response.json()) as any
    if (!response.ok) {
      if (response.status === 409 && body.code === "revision_conflict") {
        this.rememberRevision(body.actualRevision)
        throw new DevdDataConflictError(body.actualRevision, body.error)
      }
      throw new Error(body.error ?? `DEVD data request failed (${response.status}).`)
    }
    return body as T
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue
    let release: () => void = () => undefined
    this.mutationQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    return previous.then(operation).finally(release)
  }

  private async sendRuntimeCommand<T>(command: string, args: unknown): Promise<T> {
    const expectedRevision = this.revision ?? (await this.status()).revision
    const response = await this.request<RevisionResponse<T>>(`/runtime/${command}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision, args }),
    })
    this.acceptRevision(response.revision)
    return response.data
  }

  async status() {
    const status = await this.request<{
      configured: boolean
      health: "healthy" | "error"
      directoryName: string
      revision: number
      counts: {
        templates: number
        versions: number
        workingCopies: number
        materials: number
        adjustments: number
      }
    }>("/status")
    this.acceptRevision(status.revision)
    return status
  }

  async snapshot(): Promise<RuntimeStoreSnapshot> {
    if (this.snapshotRequest) return await this.snapshotRequest

    let request: Promise<RuntimeStoreSnapshot>
    request = this.request<RevisionResponse<RuntimeStoreSnapshot>>("/runtime/snapshot").then(
      async (response) => {
        if (response.revision < this.minimumSnapshotRevision) {
          if (this.replacementSnapshotRequest && this.replacementSnapshotRequest !== request) {
            return await this.replacementSnapshotRequest
          }
          if (this.snapshotRequest === request) this.snapshotRequest = null
          return await this.snapshot()
        }
        this.acceptRevision(response.revision)
        return response.data
      }
    )
    this.snapshotRequest = request
    if (this.minimumSnapshotRevision > 0) this.replacementSnapshotRequest = request
    try {
      return await request
    } finally {
      if (this.snapshotRequest === request) this.snapshotRequest = null
    }
  }

  async runtimeCommand<T>(command: string, args: unknown): Promise<T> {
    return this.enqueueMutation(() => this.sendRuntimeCommand<T>(command, args))
  }

  async updateSettings(updater: SettingsUpdater): Promise<RuntimeStoreAppSettings> {
    return this.enqueueMutation(async () => {
      const snapshot = await this.snapshot()
      const current = normalizeRuntimeAppSettings(
        snapshot.settings ?? createDefaultRuntimeAppSettings()
      )
      const patch = typeof updater === "function" ? updater(current) : updater
      return await this.sendRuntimeCommand<RuntimeStoreAppSettings>("save-settings", { patch })
    })
  }

  saveAutosave(args: RuntimeStoreSaveWorkingCopyArgs): Promise<CanvasWorkingCopyIndexEntry> {
    const key = sourceKey(args.source)
    let pending = this.pendingAutosaves.get(key)
    if (!pending) {
      pending = { args, inFlight: false, timer: null, waiters: [] }
      this.pendingAutosaves.set(key, pending)
      this.scheduleAutosave(key, pending)
    } else {
      pending.args = args
    }
    return new Promise<CanvasWorkingCopyIndexEntry>((resolve, reject) => {
      pending?.waiters.push({ resolve, reject })
    })
  }

  private scheduleAutosave(key: string, pending: PendingAutosave): void {
    if (pending.inFlight || pending.timer) return
    pending.timer = setTimeout(() => {
      pending.timer = null
      void this.flushAutosave(key, pending)
    }, AUTOSAVE_COALESCE_MS)
  }

  private async flushAutosave(key: string, pending: PendingAutosave): Promise<void> {
    if (this.pendingAutosaves.get(key) !== pending || pending.inFlight) return
    const args = pending.args
    pending.inFlight = true
    try {
      const result = await this.runtimeCommand<CanvasWorkingCopyIndexEntry>("save-autosave", args)
      pending.inFlight = false
      if (pending.args !== args) {
        this.scheduleAutosave(key, pending)
        return
      }
      this.pendingAutosaves.delete(key)
      for (const { resolve } of pending.waiters.splice(0)) resolve(result)
    } catch (error) {
      pending.inFlight = false
      if (error instanceof DevdDataConflictError) {
        // request() retained the authoritative revision, so the same draft can
        // be safely retried without dropping its coalesced callers.
        this.scheduleAutosave(key, pending)
        return
      }
      this.pendingAutosaves.delete(key)
      for (const { reject } of pending.waiters.splice(0)) reject(error)
    }
  }

  async listMaterials(query = "", includeArchived = false) {
    const params = new URLSearchParams({ query, includeArchived: String(includeArchived) })
    const response = await this.request<RevisionResponse<any[]>>(`/inventory/materials?${params}`)
    this.acceptRevision(response.revision)
    return response.data
  }

  async listAdjustments(materialId?: string) {
    const params = new URLSearchParams()
    if (materialId) params.set("materialId", materialId)
    const response = await this.request<RevisionResponse<any[]>>(`/inventory/adjustments?${params}`)
    this.acceptRevision(response.revision)
    return response.data
  }

  async inventoryCommand<T>(command: string, args: unknown): Promise<T> {
    return this.enqueueMutation(async () => {
      const expectedRevision = this.revision ?? (await this.status()).revision
      const response = await this.request<RevisionResponse<T>>(`/inventory/${command}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision, args }),
      })
      this.acceptRevision(response.revision)
      return response.data
    })
  }

  async exportArchive() {
    const response = await this.request<RevisionResponse<any>>("/archive")
    this.acceptRevision(response.revision)
    return response.data
  }

  async inspectArchive(archive: unknown) {
    const response = await this.request<{
      data: { archiveHash: string; summary: Record<string, number>; conflicts: string[] }
    }>("/archive/inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(archive),
    })
    return response.data
  }

  async importArchive(archive: unknown, archiveHash: string, mode: "merge" | "replace") {
    return this.enqueueMutation(async () => {
      const expectedRevision = this.revision ?? (await this.status()).revision
      const response = await this.request<RevisionResponse<unknown>>("/archive/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision, archiveHash, mode, archive }),
      })
      this.acceptRevision(response.revision)
      return response.data
    })
  }

  async createBackup() {
    return this.enqueueMutation(async () => {
      const expectedRevision = this.revision ?? (await this.status()).revision
      const response = await this.request<RevisionResponse<{ name: string }>>("/backups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision }),
      })
      this.acceptRevision(response.revision)
      return response.data
    })
  }

  invalidate(revision: number): void {
    this.minimumSnapshotRevision = Math.max(this.minimumSnapshotRevision, revision)
    this.snapshotRequest = null
    this.replacementSnapshotRequest = null
  }
}

export const devdDataClient = new DevdDataClient()

export function subscribeDevdDataEvents(args: {
  onEvent: (event: { revision: number; domains: string[]; reason: string }) => void
  onConnectionChange?: (state: "connected" | "reconnecting") => void
}): () => void {
  if (typeof EventSource === "undefined") return () => undefined
  const source = new EventSource("/api/data/events")
  source.addEventListener("open", () => {
    args.onConnectionChange?.("connected")
    void devdDataClient
      .status()
      .then((status) => {
        const event = {
          revision: status.revision,
          domains: ["templates", "inventory", "settings", "archive"],
          reason: "sse-reconnected",
        }
        window.dispatchEvent(new CustomEvent("tuckmark:devd-data-revision", { detail: event }))
        args.onEvent(event)
      })
      .catch(() => args.onConnectionChange?.("reconnecting"))
  })
  source.addEventListener("error", () => args.onConnectionChange?.("reconnecting"))
  source.addEventListener("data-revision", (raw) => {
    const event = JSON.parse((raw as MessageEvent<string>).data) as {
      revision: number
      domains: string[]
      reason: string
    }
    devdDataClient.invalidate(event.revision)
    window.dispatchEvent(new CustomEvent("tuckmark:devd-data-revision", { detail: event }))
    args.onEvent(event)
  })
  return () => source.close()
}

function sourceKey(source: CanvasDraftSource): string {
  if (source.kind === "user-template") return `user:${source.templateId}`
  if (source.kind === "preset-template") return `preset:${source.presetId}`
  return `scratch:${source.presetId}`
}

function summary(
  snapshot: RuntimeStoreSnapshot,
  record: RuntimeStoreSnapshot["templates"][number]
): UserTemplateSummary {
  const working = snapshot.workingCopies.find(
    (item) => item.sourceKey === sourceKey({ kind: "user-template", templateId: record.id })
  )
  const version = snapshot.versions.find((item) => item.id === record.currentVersionId)
  const document = working?.draft ?? version?.document ?? null
  return { ...record, fields: document?.fields ?? [], document }
}

export class HttpRuntimeStore implements RuntimeStore {
  async listTemplates() {
    const snapshot = await devdDataClient.snapshot()
    return snapshot.templates
      .filter((item) => !item.archivedAt)
      .map((item) => summary(snapshot, item))
  }

  async listArchivedTemplates() {
    const snapshot = await devdDataClient.snapshot()
    return snapshot.templates
      .filter((item) => Boolean(item.archivedAt))
      .map((item) => summary(snapshot, item))
  }

  async readTemplate(templateId: string) {
    const snapshot = await devdDataClient.snapshot()
    const record = snapshot.templates.find((item) => item.id === templateId)
    return record ? summary(snapshot, record) : null
  }

  async readHistory(templateId: string): Promise<UserTemplateHistory | null> {
    const snapshot = await devdDataClient.snapshot()
    const record = snapshot.templates.find((item) => item.id === templateId)
    if (!record) return null
    const versions = snapshot.versions
      .filter((item) => item.templateId === templateId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    return {
      template: summary(snapshot, record),
      saved: versions.filter((item) => item.kind === "saved"),
      autosaves: versions.filter((item) => item.kind === "autosave"),
    }
  }

  async readVersion(versionId: string): Promise<UserTemplateVersionSnapshot | null> {
    return (await devdDataClient.snapshot()).versions.find((item) => item.id === versionId) ?? null
  }

  async saveTemplate(args: RuntimeStoreSaveTemplateArgs) {
    return await devdDataClient.runtimeCommand<{
      template: UserTemplateSummary
      version: UserTemplateVersionSnapshot
      workingCopy: CanvasWorkingCopyIndexEntry
    }>("save-template", args)
  }

  async renameTemplate(templateId: string, name: string) {
    return await devdDataClient.runtimeCommand<UserTemplateSummary>("rename-template", {
      templateId,
      name,
    })
  }
  async archiveTemplate(templateId: string) {
    return await devdDataClient.runtimeCommand<UserTemplateSummary>("archive-template", {
      templateId,
    })
  }
  async restoreTemplate(templateId: string) {
    return await devdDataClient.runtimeCommand<UserTemplateSummary>("restore-template", {
      templateId,
    })
  }
  async purgeTemplate(templateId: string) {
    await devdDataClient.runtimeCommand("purge-template", { templateId })
  }
  async saveAutosave(args: RuntimeStoreSaveWorkingCopyArgs) {
    return await devdDataClient.saveAutosave(args)
  }
  async replaceWorkingCopy(args: RuntimeStoreSaveWorkingCopyArgs) {
    return await devdDataClient.runtimeCommand<CanvasWorkingCopyIndexEntry>(
      "replace-working-copy",
      args
    )
  }
  async loadWorkingCopy(source: CanvasDraftSource) {
    return (
      (await devdDataClient.snapshot()).workingCopies.find(
        (item) => item.sourceKey === sourceKey(source)
      ) ?? null
    )
  }
  async clearWorkingCopy(source: CanvasDraftSource) {
    await devdDataClient.runtimeCommand("clear-working-copy", { source })
  }
  async clearTemplateAutosaves(templateId: string) {
    await devdDataClient.runtimeCommand("clear-template-autosaves", { templateId })
  }
  async loadAppSettings(): Promise<RuntimeStoreAppSettings> {
    const settings = (await devdDataClient.snapshot()).settings
    return normalizeRuntimeAppSettings(settings ?? createDefaultRuntimeAppSettings())
  }
  async saveAppSettings(
    updater:
      | Partial<Omit<RuntimeStoreAppSettings, "version" | "updatedAt">>
      | ((
          current: RuntimeStoreAppSettings
        ) => Partial<Omit<RuntimeStoreAppSettings, "version" | "updatedAt">>)
  ) {
    return await devdDataClient.updateSettings(updater)
  }
  async exportSnapshot() {
    return await devdDataClient.snapshot()
  }
  async replaceSnapshot(snapshot: RuntimeStoreSnapshot) {
    await devdDataClient.runtimeCommand("replace-snapshot", { snapshot })
  }
  async isEmpty() {
    const snapshot = await devdDataClient.snapshot()
    return (
      snapshot.templates.length === 0 &&
      snapshot.versions.length === 0 &&
      snapshot.workingCopies.length === 0
    )
  }
  async resetForTest() {
    await this.replaceSnapshot({
      schema: "tuckmark.runtime-export.v1",
      exportedAt: new Date().toISOString(),
      snapshotUpdatedAt: null,
      settings: createDefaultRuntimeAppSettings(),
      templates: [],
      versions: [],
      workingCopies: [],
    })
  }
}
