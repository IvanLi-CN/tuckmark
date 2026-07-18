import { stableStringify } from "../../../packages/core/src/web.js"
import { listStoredDraftDocuments } from "./canvas-editor-model.js"
import { normalizeCanvasDraftDocumentUnits } from "./lib/canvas-units.js"
import {
  createDefaultRuntimeAppSettings,
  normalizeRuntimeAppSettings,
  withUpdatedRuntimeAppSettings,
} from "./runtime-app-settings.js"
import type {
  RuntimeStore,
  RuntimeStoreAppSettings,
  RuntimeStoreSnapshot,
} from "./runtime-store-contract.js"
import { emitRuntimeStoreMutation } from "./runtime-store-events.js"
import type {
  CanvasDraftDocument,
  CanvasDraftSource,
  CanvasWorkingCopyIndexEntry,
  UserTemplateHistory,
  UserTemplateRecord,
  UserTemplateSummary,
  UserTemplateVersionKind,
  UserTemplateVersionSnapshot,
} from "./types.js"
import {
  createSqliteRuntimeStore,
  supportsSqliteRuntimeStore,
} from "./user-template-sqlite-store.js"

const DB_NAME = "tuckmark-user-template-store"
const DB_VERSION = 2
const TEMPLATE_STORE = "templates"
const VERSION_STORE = "versions"
const WORKING_COPY_STORE = "workingCopies"
const APP_SETTINGS_STORE = "appSettings"
const MAX_SAVED_VERSIONS = 20
const MAX_AUTOSAVE_VERSIONS = 10
const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000
const APP_SETTINGS_KEY = "global"

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function createSourceKey(source: CanvasDraftSource): string {
  switch (source.kind) {
    case "scratch":
      return `scratch:${source.presetId}`
    case "preset-template":
      return `preset:${source.presetId}`
    case "user-template":
      return `user:${source.templateId}`
  }
}

function isIndexedDbAvailable() {
  return typeof indexedDB !== "undefined"
}

function hasStore(db: IDBDatabase, storeName: string): boolean {
  const names = db.objectStoreNames as DOMStringList & {
    contains?: (value: string) => boolean
  }
  if (typeof names.contains === "function") {
    return names.contains(storeName)
  }
  for (let index = 0; index < names.length; index += 1) {
    if (names.item(index) === storeName) {
      return true
    }
  }
  return false
}

function getNextSavedVersionNumber(versions: Iterable<UserTemplateVersionSnapshot>): number {
  return (
    Math.max(
      0,
      ...Array.from(versions)
        .filter((version) => version.kind === "saved")
        .map((version) => version.version)
    ) + 1
  )
}

function toComparableDraft(draft: CanvasDraftDocument) {
  return {
    ...draft,
    id: undefined,
    presetId: undefined,
    source: undefined,
    templateId: undefined,
    baseVersionId: undefined,
    lastSavedAt: undefined,
  }
}

function sameDocumentContent(left: CanvasDraftDocument, right: CanvasDraftDocument): boolean {
  return stableStringify(toComparableDraft(left)) === stableStringify(toComparableDraft(right))
}

function compareVersionsNewestFirst(
  left: UserTemplateVersionSnapshot,
  right: UserTemplateVersionSnapshot
): number {
  return right.version - left.version || right.createdAt.localeCompare(left.createdAt)
}

function compareVersionsOldestFirst(
  left: UserTemplateVersionSnapshot,
  right: UserTemplateVersionSnapshot
): number {
  return left.version - right.version || left.createdAt.localeCompare(right.createdAt)
}

function compareArchivedNewestFirst(left: UserTemplateRecord, right: UserTemplateRecord): number {
  const leftArchivedAt = left.archivedAt ?? ""
  const rightArchivedAt = right.archivedAt ?? ""
  return (
    rightArchivedAt.localeCompare(leftArchivedAt) ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.id.localeCompare(right.id)
  )
}

function buildTemplateSummary(
  template: UserTemplateRecord,
  workingCopy: CanvasWorkingCopyIndexEntry | null,
  fallbackDocument: CanvasDraftDocument | null
): UserTemplateSummary {
  const workingDraft = workingCopy?.draft
    ? normalizeCanvasDraftDocumentUnits(workingCopy.draft)
    : null
  const fallbackDraft = fallbackDocument
    ? normalizeCanvasDraftDocumentUnits(fallbackDocument)
    : null
  const sourceDraft = workingDraft ?? fallbackDraft
  return {
    ...cloneValue(template),
    width: sourceDraft?.width ?? template.width,
    height: sourceDraft?.height ?? template.height,
    fields: cloneValue(sourceDraft?.fields ?? []),
  }
}

function normalizeVersionSnapshot(
  version: UserTemplateVersionSnapshot
): UserTemplateVersionSnapshot {
  return {
    ...cloneValue(version),
    document: normalizeCanvasDraftDocumentUnits(version.document),
  }
}

function computeSnapshotUpdatedAt(snapshot: RuntimeStoreSnapshot): string | null {
  const timestamps = [
    snapshot.settings.updatedAt,
    ...snapshot.templates.map((template) => template.updatedAt),
    ...snapshot.versions.map((version) => version.createdAt),
    ...snapshot.workingCopies.map((entry) => entry.updatedAt),
  ].filter((value) => value.length > 0)

  if (timestamps.length === 0) {
    return null
  }

  return timestamps.reduce((latest, current) => (current > latest ? current : latest))
}

function buildSnapshot(args: {
  settings: RuntimeStoreAppSettings
  templates: UserTemplateRecord[]
  versions: UserTemplateVersionSnapshot[]
  workingCopies: CanvasWorkingCopyIndexEntry[]
}): RuntimeStoreSnapshot {
  const snapshot: RuntimeStoreSnapshot = {
    schema: "tuckmark.runtime-export.v1",
    exportedAt: new Date().toISOString(),
    snapshotUpdatedAt: null,
    settings: normalizeRuntimeAppSettings(args.settings),
    templates: cloneValue(args.templates),
    versions: args.versions.map((version) => normalizeVersionSnapshot(version)),
    workingCopies: args.workingCopies.map((entry) => ({
      ...cloneValue(entry),
      draft: normalizeCanvasDraftDocumentUnits(entry.draft),
    })),
  }
  snapshot.snapshotUpdatedAt = computeSnapshotUpdatedAt(snapshot)
  return snapshot
}

function isSnapshotEmpty(snapshot: RuntimeStoreSnapshot): boolean {
  return (
    snapshot.templates.length === 0 &&
    snapshot.versions.length === 0 &&
    snapshot.workingCopies.length === 0 &&
    snapshot.settings.updatedAt === createDefaultRuntimeAppSettings().updatedAt
  )
}

class MemoryUserTemplateStore implements RuntimeStore {
  private readonly templates = new Map<string, UserTemplateRecord>()
  private readonly versions = new Map<string, UserTemplateVersionSnapshot>()
  private readonly workingCopies = new Map<string, CanvasWorkingCopyIndexEntry>()
  private appSettings = createDefaultRuntimeAppSettings()

  async listTemplates(): Promise<UserTemplateSummary[]> {
    const templates = Array.from(this.templates.values()).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    )
    return templates
      .filter((template) => !template.archivedAt)
      .map((template) =>
        buildTemplateSummary(
          template,
          this.workingCopies.get(
            createSourceKey({ kind: "user-template", templateId: template.id })
          ) ?? null,
          this.versions.get(template.currentVersionId)?.document ?? null
        )
      )
  }

  async listArchivedTemplates(): Promise<UserTemplateSummary[]> {
    const templates = Array.from(this.templates.values())
      .filter((template) => Boolean(template.archivedAt))
      .sort(compareArchivedNewestFirst)
    return templates.map((template) =>
      buildTemplateSummary(
        template,
        this.workingCopies.get(
          createSourceKey({ kind: "user-template", templateId: template.id })
        ) ?? null,
        this.versions.get(template.currentVersionId)?.document ?? null
      )
    )
  }

  async readTemplate(templateId: string): Promise<UserTemplateSummary | null> {
    const template = this.templates.get(templateId)
    if (!template) {
      return null
    }
    return buildTemplateSummary(
      template,
      this.workingCopies.get(createSourceKey({ kind: "user-template", templateId })) ?? null,
      this.versions.get(template.currentVersionId)?.document ?? null
    )
  }

  async readHistory(templateId: string): Promise<UserTemplateHistory | null> {
    const template = await this.readTemplate(templateId)
    if (!template) {
      return null
    }

    const history = Array.from(this.versions.values())
      .filter((version) => version.templateId === templateId)
      .sort(compareVersionsNewestFirst)

    return {
      template,
      saved: history
        .filter((version) => version.kind === "saved")
        .map((version) => normalizeVersionSnapshot(version)),
      autosaves: history
        .filter((version) => version.kind === "autosave")
        .map((version) => normalizeVersionSnapshot(version)),
    }
  }

  async readVersion(versionId: string): Promise<UserTemplateVersionSnapshot | null> {
    const version = this.versions.get(versionId)
    return version ? normalizeVersionSnapshot(version) : null
  }

  async saveTemplate(args: {
    name: string
    description?: string
    document: CanvasDraftDocument
    templateId?: string
    sourceVersionId?: string
  }): Promise<{
    template: UserTemplateSummary
    version: UserTemplateVersionSnapshot
    workingCopy: CanvasWorkingCopyIndexEntry
  }> {
    const now = new Date().toISOString()
    const document = normalizeCanvasDraftDocumentUnits(cloneValue(args.document))
    const templateId = args.templateId ?? createId("user-template")
    const existing = this.templates.get(templateId)
    const templateVersions = Array.from(this.versions.values()).filter(
      (version) => version.templateId === templateId
    )
    const nextVersionNumber = getNextSavedVersionNumber(templateVersions)

    document.templateId = templateId
    document.source = { kind: "user-template", templateId }
    document.baseVersionId = undefined
    document.lastSavedAt = now
    document.name = args.name

    const version: UserTemplateVersionSnapshot = {
      id: createId("user-template-version"),
      templateId,
      version: nextVersionNumber,
      kind: "saved",
      createdAt: now,
      label: `已保存版本 ${nextVersionNumber}`,
      sourceVersionId: args.sourceVersionId,
      document,
    }

    const template: UserTemplateRecord = {
      id: templateId,
      name: args.name,
      description: args.description ?? existing?.description ?? "",
      width: document.width,
      height: document.height,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      archivedAt: existing?.archivedAt ?? null,
      currentVersionId: version.id,
      fieldOrder: document.fields.map((field) => field.key),
    }

    this.templates.set(templateId, template)
    this.versions.set(version.id, version)
    this.trimVersions(templateId, "saved", MAX_SAVED_VERSIONS)
    this.clearVersions(templateId, "autosave")

    const workingCopy: CanvasWorkingCopyIndexEntry = {
      sourceKey: createSourceKey({ kind: "user-template", templateId }),
      source: { kind: "user-template", templateId },
      templateId,
      draft: cloneValue(document),
      updatedAt: now,
      baseVersionId: version.id,
    }
    this.workingCopies.set(workingCopy.sourceKey, workingCopy)

    return {
      template: {
        ...cloneValue(template),
        fields: cloneValue(document.fields),
      },
      version: cloneValue(version),
      workingCopy: cloneValue(workingCopy),
    }
  }

  async renameTemplate(templateId: string, name: string): Promise<UserTemplateSummary | null> {
    const existing = this.templates.get(templateId)
    if (!existing) {
      return null
    }

    const renamedAt = new Date().toISOString()
    const nextTemplate: UserTemplateRecord = {
      ...existing,
      name,
      updatedAt: renamedAt,
    }
    this.templates.set(templateId, nextTemplate)

    const sourceKey = createSourceKey({ kind: "user-template", templateId })
    const workingCopy = this.workingCopies.get(sourceKey)
    if (workingCopy) {
      this.workingCopies.set(sourceKey, {
        ...workingCopy,
        updatedAt: renamedAt,
        draft: {
          ...workingCopy.draft,
          name,
        },
      })
    }

    return await this.readTemplate(templateId)
  }

  async saveAutosave(args: {
    templateId?: string
    source: CanvasDraftSource
    document: CanvasDraftDocument
    sourceVersionId?: string
  }): Promise<CanvasWorkingCopyIndexEntry> {
    const now = new Date().toISOString()
    const draft = normalizeCanvasDraftDocumentUnits(cloneValue(args.document))
    const workingCopy: CanvasWorkingCopyIndexEntry = {
      sourceKey: createSourceKey(args.source),
      source: cloneValue(args.source),
      templateId: args.templateId,
      draft,
      updatedAt: now,
      baseVersionId: args.sourceVersionId,
    }
    this.workingCopies.set(workingCopy.sourceKey, workingCopy)

    if (!args.templateId) {
      return cloneValue(workingCopy)
    }

    const templateId = args.templateId
    const currentVersionId = this.templates.get(templateId)?.currentVersionId
    const currentVersion = currentVersionId
      ? Array.from(this.versions.values()).find((version) => version.id === currentVersionId)
      : null
    if (
      currentVersion &&
      sameDocumentContent(normalizeCanvasDraftDocumentUnits(currentVersion.document), draft)
    ) {
      return cloneValue(workingCopy)
    }

    const autosaveHistory = Array.from(this.versions.values())
      .filter((version) => version.templateId === templateId && version.kind === "autosave")
      .sort(compareVersionsOldestFirst)
    const newest = autosaveHistory[autosaveHistory.length - 1]
    if (newest) {
      const previousSaved = Date.parse(newest.createdAt)
      const nextSaved = Date.parse(now)
      if (Number.isFinite(previousSaved) && Number.isFinite(nextSaved)) {
        if (nextSaved - previousSaved < AUTOSAVE_INTERVAL_MS) {
          return cloneValue(workingCopy)
        }
      }
    }

    const nextVersionNumber =
      Math.max(
        0,
        ...Array.from(this.versions.values())
          .filter((version) => version.templateId === templateId)
          .map((version) => version.version)
      ) + 1

    const autosaveId = createId("user-template-autosave")
    this.versions.set(autosaveId, {
      id: autosaveId,
      templateId,
      version: nextVersionNumber,
      kind: "autosave",
      createdAt: now,
      label: "未保存草稿",
      sourceVersionId: args.sourceVersionId,
      document: draft,
    })
    this.trimVersions(templateId, "autosave", MAX_AUTOSAVE_VERSIONS)

    return cloneValue(workingCopy)
  }

  async archiveTemplate(templateId: string): Promise<UserTemplateSummary | null> {
    const existing = this.templates.get(templateId)
    if (!existing) {
      return null
    }
    const archivedAt = new Date().toISOString()
    const nextTemplate: UserTemplateRecord = {
      ...existing,
      archivedAt,
      updatedAt: archivedAt,
    }
    this.templates.set(templateId, nextTemplate)
    return await this.readTemplate(templateId)
  }

  async restoreTemplate(templateId: string): Promise<UserTemplateSummary | null> {
    const existing = this.templates.get(templateId)
    if (!existing) {
      return null
    }
    const restoredAt = new Date().toISOString()
    const nextTemplate: UserTemplateRecord = {
      ...existing,
      archivedAt: null,
      updatedAt: restoredAt,
    }
    this.templates.set(templateId, nextTemplate)
    return await this.readTemplate(templateId)
  }

  async purgeTemplate(templateId: string): Promise<void> {
    this.templates.delete(templateId)
    this.workingCopies.delete(createSourceKey({ kind: "user-template", templateId }))
    Array.from(this.versions.values())
      .filter((version) => version.templateId === templateId)
      .forEach((version) => {
        this.versions.delete(version.id)
      })
  }

  async replaceWorkingCopy(args: {
    templateId?: string
    source: CanvasDraftSource
    document: CanvasDraftDocument
    sourceVersionId?: string
  }): Promise<CanvasWorkingCopyIndexEntry> {
    const now = new Date().toISOString()
    const draft = normalizeCanvasDraftDocumentUnits(cloneValue(args.document))
    const workingCopy: CanvasWorkingCopyIndexEntry = {
      sourceKey: createSourceKey(args.source),
      source: cloneValue(args.source),
      templateId: args.templateId,
      draft,
      updatedAt: now,
      baseVersionId: args.sourceVersionId,
    }
    this.workingCopies.set(workingCopy.sourceKey, workingCopy)
    return cloneValue(workingCopy)
  }

  async loadWorkingCopy(source: CanvasDraftSource): Promise<CanvasWorkingCopyIndexEntry | null> {
    const entry = this.workingCopies.get(createSourceKey(source))
    return entry
      ? {
          ...cloneValue(entry),
          draft: normalizeCanvasDraftDocumentUnits(entry.draft),
        }
      : null
  }

  async clearWorkingCopy(source: CanvasDraftSource): Promise<void> {
    this.workingCopies.delete(createSourceKey(source))
  }

  async clearTemplateAutosaves(templateId: string): Promise<void> {
    this.clearVersions(templateId, "autosave")
  }

  async loadAppSettings(): Promise<RuntimeStoreAppSettings> {
    return cloneValue(this.appSettings)
  }

  async saveAppSettings(
    updater:
      | Partial<Omit<RuntimeStoreAppSettings, "version" | "updatedAt">>
      | ((
          current: RuntimeStoreAppSettings
        ) => Partial<Omit<RuntimeStoreAppSettings, "version" | "updatedAt">>)
  ): Promise<RuntimeStoreAppSettings> {
    const next = typeof updater === "function" ? updater(this.appSettings) : updater
    this.appSettings = withUpdatedRuntimeAppSettings(this.appSettings, next)
    return cloneValue(this.appSettings)
  }

  async exportSnapshot(): Promise<RuntimeStoreSnapshot> {
    return buildSnapshot({
      settings: this.appSettings,
      templates: Array.from(this.templates.values()),
      versions: Array.from(this.versions.values()),
      workingCopies: Array.from(this.workingCopies.values()),
    })
  }

  async replaceSnapshot(snapshot: RuntimeStoreSnapshot): Promise<void> {
    this.templates.clear()
    this.versions.clear()
    this.workingCopies.clear()
    this.appSettings = normalizeRuntimeAppSettings(snapshot.settings)
    for (const template of snapshot.templates) {
      this.templates.set(template.id, cloneValue(template))
    }
    for (const version of snapshot.versions) {
      this.versions.set(version.id, normalizeVersionSnapshot(version))
    }
    for (const entry of snapshot.workingCopies) {
      this.workingCopies.set(entry.sourceKey, {
        ...cloneValue(entry),
        draft: normalizeCanvasDraftDocumentUnits(entry.draft),
      })
    }
  }

  async isEmpty(): Promise<boolean> {
    return this.templates.size === 0 && this.versions.size === 0 && this.workingCopies.size === 0
  }

  async resetForTest(): Promise<void> {
    this.templates.clear()
    this.versions.clear()
    this.workingCopies.clear()
    this.appSettings = createDefaultRuntimeAppSettings()
  }
  private trimVersions(templateId: string, kind: UserTemplateVersionKind, limit: number): void {
    const versions = Array.from(this.versions.values())
      .filter((version) => version.templateId === templateId && version.kind === kind)
      .sort(compareVersionsNewestFirst)

    versions.slice(limit).forEach((version) => {
      this.versions.delete(version.id)
    })
  }

  private clearVersions(templateId: string, kind: UserTemplateVersionKind): void {
    Array.from(this.versions.values())
      .filter((version) => version.templateId === templateId && version.kind === kind)
      .forEach((version) => {
        this.versions.delete(version.id)
      })
  }
}

class IndexedDbUserTemplateStore extends MemoryUserTemplateStore {
  private dbPromise: Promise<IDBDatabase> | null = null

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!hasStore(db, TEMPLATE_STORE)) {
            db.createObjectStore(TEMPLATE_STORE, { keyPath: "id" })
          }
          if (!hasStore(db, VERSION_STORE)) {
            const store = db.createObjectStore(VERSION_STORE, { keyPath: "id" })
            store.createIndex("templateId", "templateId", { unique: false })
            store.createIndex("templateId_kind", ["templateId", "kind"], { unique: false })
          }
          if (!hasStore(db, WORKING_COPY_STORE)) {
            db.createObjectStore(WORKING_COPY_STORE, { keyPath: "sourceKey" })
          }
          if (!hasStore(db, APP_SETTINGS_STORE)) {
            db.createObjectStore(APP_SETTINGS_STORE, { keyPath: "key" })
          }
        }
        request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"))
        request.onsuccess = () => resolve(request.result)
      })
    }
    return this.dbPromise
  }

  private async transaction<T>(
    storeNames: string[],
    mode: IDBTransactionMode,
    run: (stores: Record<string, IDBObjectStore>, tx: IDBTransaction) => Promise<T>
  ): Promise<T> {
    const db = await this.open()
    const tx = db.transaction(storeNames, mode)
    const stores = Object.fromEntries(storeNames.map((name) => [name, tx.objectStore(name)]))
    return await run(stores, tx)
  }

  override async listTemplates(): Promise<UserTemplateSummary[]> {
    const templates = await this.transaction(
      [TEMPLATE_STORE, VERSION_STORE, WORKING_COPY_STORE],
      "readonly",
      async (stores) => {
        const records = await readAll<UserTemplateRecord>(stores[TEMPLATE_STORE])
        const versions = await readAll<UserTemplateVersionSnapshot>(stores[VERSION_STORE])
        const workingCopies = await readAll<CanvasWorkingCopyIndexEntry>(stores[WORKING_COPY_STORE])
        const versionMap = new Map(versions.map((version) => [version.id, version]))
        const workingCopyMap = new Map(workingCopies.map((entry) => [entry.sourceKey, entry]))
        return records
          .filter((template) => !template.archivedAt)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .map((template) =>
            buildTemplateSummary(
              template,
              workingCopyMap.get(
                createSourceKey({ kind: "user-template", templateId: template.id })
              ) ?? null,
              versionMap.get(template.currentVersionId)?.document ?? null
            )
          )
      }
    )
    return cloneValue(templates)
  }

  override async listArchivedTemplates(): Promise<UserTemplateSummary[]> {
    const templates = await this.transaction(
      [TEMPLATE_STORE, VERSION_STORE, WORKING_COPY_STORE],
      "readonly",
      async (stores) => {
        const records = await readAll<UserTemplateRecord>(stores[TEMPLATE_STORE])
        const versions = await readAll<UserTemplateVersionSnapshot>(stores[VERSION_STORE])
        const workingCopies = await readAll<CanvasWorkingCopyIndexEntry>(stores[WORKING_COPY_STORE])
        const versionMap = new Map(versions.map((version) => [version.id, version]))
        const workingCopyMap = new Map(workingCopies.map((entry) => [entry.sourceKey, entry]))
        return records
          .filter((template) => Boolean(template.archivedAt))
          .sort(compareArchivedNewestFirst)
          .map((template) =>
            buildTemplateSummary(
              template,
              workingCopyMap.get(
                createSourceKey({ kind: "user-template", templateId: template.id })
              ) ?? null,
              versionMap.get(template.currentVersionId)?.document ?? null
            )
          )
      }
    )
    return cloneValue(templates)
  }

  override async readTemplate(templateId: string): Promise<UserTemplateSummary | null> {
    const template = await this.transaction(
      [TEMPLATE_STORE, VERSION_STORE, WORKING_COPY_STORE],
      "readonly",
      async (stores) => {
        const record = await readOne<UserTemplateRecord>(stores[TEMPLATE_STORE], templateId)
        if (!record) {
          return null
        }
        const version = await readOne<UserTemplateVersionSnapshot>(
          stores[VERSION_STORE],
          record.currentVersionId
        )
        const workingCopy = await readOne<CanvasWorkingCopyIndexEntry>(
          stores[WORKING_COPY_STORE],
          createSourceKey({ kind: "user-template", templateId })
        )
        return buildTemplateSummary(record, workingCopy, version?.document ?? null)
      }
    )
    return template ? cloneValue(template) : null
  }

  override async readHistory(templateId: string): Promise<UserTemplateHistory | null> {
    const history = await this.transaction(
      [TEMPLATE_STORE, VERSION_STORE],
      "readonly",
      async (stores) => {
        const record = await readOne<UserTemplateRecord>(stores[TEMPLATE_STORE], templateId)
        if (!record) {
          return null
        }
        const versions = await readByIndex<UserTemplateVersionSnapshot>(
          stores[VERSION_STORE].index("templateId"),
          templateId
        )
        const currentVersion =
          versions.find((version) => version.id === record.currentVersionId) ?? null
        return {
          template: buildTemplateSummary(record, null, currentVersion?.document ?? null),
          saved: versions
            .filter((version) => version.kind === "saved")
            .sort(compareVersionsNewestFirst)
            .map((version) => normalizeVersionSnapshot(version)),
          autosaves: versions
            .filter((version) => version.kind === "autosave")
            .sort(compareVersionsNewestFirst)
            .map((version) => normalizeVersionSnapshot(version)),
        }
      }
    )
    return history
  }

  override async readVersion(versionId: string): Promise<UserTemplateVersionSnapshot | null> {
    const version = await this.transaction([VERSION_STORE], "readonly", async (stores) =>
      readOne<UserTemplateVersionSnapshot>(stores[VERSION_STORE], versionId)
    )
    return version ? normalizeVersionSnapshot(version) : null
  }

  override async saveTemplate(args: {
    name: string
    description?: string
    document: CanvasDraftDocument
    templateId?: string
    sourceVersionId?: string
  }): Promise<{
    template: UserTemplateSummary
    version: UserTemplateVersionSnapshot
    workingCopy: CanvasWorkingCopyIndexEntry
  }> {
    const templateId = args.templateId ?? createId("user-template")
    const current = await this.readHistory(templateId)
    const now = new Date().toISOString()
    const nextVersionNumber = getNextSavedVersionNumber(current?.saved ?? [])
    const document = normalizeCanvasDraftDocumentUnits(cloneValue(args.document))
    document.templateId = templateId
    document.source = { kind: "user-template", templateId }
    document.baseVersionId = undefined
    document.lastSavedAt = now
    document.name = args.name

    const version: UserTemplateVersionSnapshot = {
      id: createId("user-template-version"),
      templateId,
      version: nextVersionNumber,
      kind: "saved",
      createdAt: now,
      label: `已保存版本 ${nextVersionNumber}`,
      sourceVersionId: args.sourceVersionId,
      document,
    }
    const template: UserTemplateRecord = {
      id: templateId,
      name: args.name,
      description: args.description ?? current?.template.description ?? "",
      width: document.width,
      height: document.height,
      createdAt: current?.template.createdAt ?? now,
      updatedAt: now,
      archivedAt: current?.template.archivedAt ?? null,
      currentVersionId: version.id,
      fieldOrder: document.fields.map((field) => field.key),
    }
    const workingCopy: CanvasWorkingCopyIndexEntry = {
      sourceKey: createSourceKey({ kind: "user-template", templateId }),
      source: { kind: "user-template", templateId },
      templateId,
      draft: cloneValue(document),
      updatedAt: now,
      baseVersionId: version.id,
    }

    await this.transaction(
      [TEMPLATE_STORE, VERSION_STORE, WORKING_COPY_STORE],
      "readwrite",
      async (stores) => {
        await put(stores[TEMPLATE_STORE], template)
        await put(stores[VERSION_STORE], version)
        await put(stores[WORKING_COPY_STORE], workingCopy)
        await trimIndexedDbVersions(stores[VERSION_STORE], templateId, "saved", MAX_SAVED_VERSIONS)
        await deleteByIndex(stores[VERSION_STORE].index("templateId_kind"), [
          templateId,
          "autosave",
        ])
      }
    )

    return {
      template: { ...cloneValue(template), fields: cloneValue(document.fields) },
      version: cloneValue(version),
      workingCopy: cloneValue(workingCopy),
    }
  }

  override async renameTemplate(
    templateId: string,
    name: string
  ): Promise<UserTemplateSummary | null> {
    await this.transaction([TEMPLATE_STORE, WORKING_COPY_STORE], "readwrite", async (stores) => {
      const template = await readOne<UserTemplateRecord>(stores[TEMPLATE_STORE], templateId)
      if (!template) {
        return
      }

      const renamedAt = new Date().toISOString()
      await put(stores[TEMPLATE_STORE], {
        ...template,
        name,
        updatedAt: renamedAt,
      } satisfies UserTemplateRecord)

      const sourceKey = createSourceKey({ kind: "user-template", templateId })
      const workingCopy = await readOne<CanvasWorkingCopyIndexEntry>(
        stores[WORKING_COPY_STORE],
        sourceKey
      )
      if (!workingCopy) {
        return
      }

      await put(stores[WORKING_COPY_STORE], {
        ...workingCopy,
        updatedAt: renamedAt,
        draft: {
          ...workingCopy.draft,
          name,
        },
      } satisfies CanvasWorkingCopyIndexEntry)
    })
    return this.readTemplate(templateId)
  }

  override async saveAutosave(args: {
    templateId?: string
    source: CanvasDraftSource
    document: CanvasDraftDocument
    sourceVersionId?: string
  }): Promise<CanvasWorkingCopyIndexEntry> {
    const now = new Date().toISOString()
    const draft = normalizeCanvasDraftDocumentUnits(cloneValue(args.document))
    const workingCopy: CanvasWorkingCopyIndexEntry = {
      sourceKey: createSourceKey(args.source),
      source: cloneValue(args.source),
      templateId: args.templateId,
      draft,
      updatedAt: now,
      baseVersionId: args.sourceVersionId,
    }

    if (!args.templateId) {
      await this.transaction([WORKING_COPY_STORE], "readwrite", async (stores) => {
        await put(stores[WORKING_COPY_STORE], workingCopy)
      })
      return cloneValue(workingCopy)
    }

    const currentTemplate = await this.readTemplate(args.templateId)
    const currentVersion = currentTemplate
      ? await this.readVersion(currentTemplate.currentVersionId)
      : null
    if (
      currentVersion &&
      sameDocumentContent(
        normalizeCanvasDraftDocumentUnits(currentVersion.document),
        workingCopy.draft
      )
    ) {
      await this.transaction([WORKING_COPY_STORE], "readwrite", async (stores) => {
        await put(stores[WORKING_COPY_STORE], workingCopy)
      })
      return cloneValue(workingCopy)
    }

    const previousAutosaves = (
      await this.transaction([VERSION_STORE], "readonly", async (stores) =>
        readByIndex<UserTemplateVersionSnapshot>(stores[VERSION_STORE].index("templateId_kind"), [
          args.templateId,
          "autosave",
        ] as [string, UserTemplateVersionKind])
      )
    ).sort(compareVersionsOldestFirst)
    const newest = previousAutosaves[previousAutosaves.length - 1]
    if (newest) {
      const delta = Date.parse(now) - Date.parse(newest.createdAt)
      if (Number.isFinite(delta) && delta < AUTOSAVE_INTERVAL_MS) {
        await this.transaction([WORKING_COPY_STORE], "readwrite", async (stores) => {
          await put(stores[WORKING_COPY_STORE], workingCopy)
        })
        return cloneValue(workingCopy)
      }
    }

    const templateId = args.templateId
    const allVersions = await this.transaction([VERSION_STORE], "readonly", async (stores) =>
      readByIndex<UserTemplateVersionSnapshot>(
        stores[VERSION_STORE].index("templateId"),
        templateId
      )
    )
    const nextVersionNumber = Math.max(0, ...allVersions.map((version) => version.version)) + 1
    const version: UserTemplateVersionSnapshot = {
      id: createId("user-template-autosave"),
      templateId,
      version: nextVersionNumber,
      kind: "autosave",
      createdAt: now,
      label: "未保存草稿",
      sourceVersionId: args.sourceVersionId,
      document: workingCopy.draft,
    }

    await this.transaction([WORKING_COPY_STORE, VERSION_STORE], "readwrite", async (stores) => {
      await put(stores[WORKING_COPY_STORE], workingCopy)
      await put(stores[VERSION_STORE], version)
      await trimIndexedDbVersions(
        stores[VERSION_STORE],
        templateId,
        "autosave",
        MAX_AUTOSAVE_VERSIONS
      )
    })

    return cloneValue(workingCopy)
  }

  override async replaceWorkingCopy(args: {
    templateId?: string
    source: CanvasDraftSource
    document: CanvasDraftDocument
    sourceVersionId?: string
  }): Promise<CanvasWorkingCopyIndexEntry> {
    const now = new Date().toISOString()
    const draft = normalizeCanvasDraftDocumentUnits(cloneValue(args.document))
    const workingCopy: CanvasWorkingCopyIndexEntry = {
      sourceKey: createSourceKey(args.source),
      source: cloneValue(args.source),
      templateId: args.templateId,
      draft,
      updatedAt: now,
      baseVersionId: args.sourceVersionId,
    }
    await this.transaction([WORKING_COPY_STORE], "readwrite", async (stores) => {
      await put(stores[WORKING_COPY_STORE], workingCopy)
    })
    return cloneValue(workingCopy)
  }

  override async archiveTemplate(templateId: string): Promise<UserTemplateSummary | null> {
    await this.transaction([TEMPLATE_STORE], "readwrite", async (stores) => {
      const template = await readOne<UserTemplateRecord>(stores[TEMPLATE_STORE], templateId)
      if (!template) {
        return
      }
      const archivedAt = new Date().toISOString()
      await put(stores[TEMPLATE_STORE], {
        ...template,
        archivedAt,
        updatedAt: archivedAt,
      } satisfies UserTemplateRecord)
    })
    return this.readTemplate(templateId)
  }

  override async restoreTemplate(templateId: string): Promise<UserTemplateSummary | null> {
    await this.transaction([TEMPLATE_STORE], "readwrite", async (stores) => {
      const template = await readOne<UserTemplateRecord>(stores[TEMPLATE_STORE], templateId)
      if (!template) {
        return
      }
      const restoredAt = new Date().toISOString()
      await put(stores[TEMPLATE_STORE], {
        ...template,
        archivedAt: null,
        updatedAt: restoredAt,
      } satisfies UserTemplateRecord)
    })
    return this.readTemplate(templateId)
  }

  override async purgeTemplate(templateId: string): Promise<void> {
    await this.transaction(
      [TEMPLATE_STORE, VERSION_STORE, WORKING_COPY_STORE],
      "readwrite",
      async (stores) => {
        await remove(stores[TEMPLATE_STORE], templateId)
        await remove(
          stores[WORKING_COPY_STORE],
          createSourceKey({ kind: "user-template", templateId })
        )
        await deleteByIndex(stores[VERSION_STORE].index("templateId"), templateId)
      }
    )
  }

  override async loadWorkingCopy(
    source: CanvasDraftSource
  ): Promise<CanvasWorkingCopyIndexEntry | null> {
    const entry = await this.transaction([WORKING_COPY_STORE], "readonly", async (stores) =>
      readOne<CanvasWorkingCopyIndexEntry>(stores[WORKING_COPY_STORE], createSourceKey(source))
    )
    return entry
      ? {
          ...cloneValue(entry),
          draft: normalizeCanvasDraftDocumentUnits(entry.draft),
        }
      : null
  }

  override async clearWorkingCopy(source: CanvasDraftSource): Promise<void> {
    await this.transaction([WORKING_COPY_STORE], "readwrite", async (stores) => {
      await remove(stores[WORKING_COPY_STORE], createSourceKey(source))
    })
  }

  override async clearTemplateAutosaves(templateId: string): Promise<void> {
    await this.transaction([VERSION_STORE], "readwrite", async (stores) => {
      await deleteByIndex(stores[VERSION_STORE].index("templateId_kind"), [templateId, "autosave"])
    })
  }

  override async loadAppSettings(): Promise<RuntimeStoreAppSettings> {
    const settings = await this.transaction([APP_SETTINGS_STORE], "readonly", async (stores) => {
      const record = await readOne<{ key: string; payload: RuntimeStoreAppSettings }>(
        stores[APP_SETTINGS_STORE],
        APP_SETTINGS_KEY
      )
      return normalizeRuntimeAppSettings(record?.payload)
    })
    return settings
  }

  override async saveAppSettings(
    updater:
      | Partial<Omit<RuntimeStoreAppSettings, "version" | "updatedAt">>
      | ((
          current: RuntimeStoreAppSettings
        ) => Partial<Omit<RuntimeStoreAppSettings, "version" | "updatedAt">>)
  ): Promise<RuntimeStoreAppSettings> {
    const current = await this.loadAppSettings()
    const next = typeof updater === "function" ? updater(current) : updater
    const updated = withUpdatedRuntimeAppSettings(current, next)
    await this.transaction([APP_SETTINGS_STORE], "readwrite", async (stores) => {
      await put(stores[APP_SETTINGS_STORE], {
        key: APP_SETTINGS_KEY,
        payload: updated,
      })
    })
    return cloneValue(updated)
  }

  override async exportSnapshot(): Promise<RuntimeStoreSnapshot> {
    const snapshot = await this.transaction(
      [TEMPLATE_STORE, VERSION_STORE, WORKING_COPY_STORE, APP_SETTINGS_STORE],
      "readonly",
      async (stores) => {
        const templates = await readAll<UserTemplateRecord>(stores[TEMPLATE_STORE])
        const versions = await readAll<UserTemplateVersionSnapshot>(stores[VERSION_STORE])
        const workingCopies = await readAll<CanvasWorkingCopyIndexEntry>(stores[WORKING_COPY_STORE])
        const settingsRecord = await readOne<{ key: string; payload: RuntimeStoreAppSettings }>(
          stores[APP_SETTINGS_STORE],
          APP_SETTINGS_KEY
        )
        return buildSnapshot({
          settings: normalizeRuntimeAppSettings(settingsRecord?.payload),
          templates,
          versions,
          workingCopies,
        })
      }
    )
    return snapshot
  }

  override async replaceSnapshot(snapshot: RuntimeStoreSnapshot): Promise<void> {
    await this.transaction(
      [TEMPLATE_STORE, VERSION_STORE, WORKING_COPY_STORE, APP_SETTINGS_STORE],
      "readwrite",
      async (stores) => {
        await clearStore(stores[TEMPLATE_STORE])
        await clearStore(stores[VERSION_STORE])
        await clearStore(stores[WORKING_COPY_STORE])
        await clearStore(stores[APP_SETTINGS_STORE])
        for (const template of snapshot.templates) {
          await put(stores[TEMPLATE_STORE], cloneValue(template))
        }
        for (const version of snapshot.versions) {
          await put(stores[VERSION_STORE], normalizeVersionSnapshot(version))
        }
        for (const workingCopy of snapshot.workingCopies) {
          await put(stores[WORKING_COPY_STORE], {
            ...cloneValue(workingCopy),
            draft: normalizeCanvasDraftDocumentUnits(workingCopy.draft),
          })
        }
        await put(stores[APP_SETTINGS_STORE], {
          key: APP_SETTINGS_KEY,
          payload: normalizeRuntimeAppSettings(snapshot.settings),
        })
      }
    )
  }

  override async isEmpty(): Promise<boolean> {
    const counts = await this.transaction(
      [TEMPLATE_STORE, VERSION_STORE, WORKING_COPY_STORE],
      "readonly",
      async (stores) => {
        const templates = await countStore(stores[TEMPLATE_STORE])
        const versions = await countStore(stores[VERSION_STORE])
        const workingCopies = await countStore(stores[WORKING_COPY_STORE])
        return { templates, versions, workingCopies }
      }
    )
    return counts.templates === 0 && counts.versions === 0 && counts.workingCopies === 0
  }

  override async resetForTest(): Promise<void> {
    await this.transaction(
      [TEMPLATE_STORE, VERSION_STORE, WORKING_COPY_STORE, APP_SETTINGS_STORE],
      "readwrite",
      async (stores) => {
        await clearStore(stores[TEMPLATE_STORE])
        await clearStore(stores[VERSION_STORE])
        await clearStore(stores[WORKING_COPY_STORE])
        await clearStore(stores[APP_SETTINGS_STORE])
      }
    )
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"))
  })
}

async function readAll<T>(store: IDBObjectStore): Promise<T[]> {
  return await requestToPromise(store.getAll())
}

async function readOne<T>(store: IDBObjectStore, key: IDBValidKey): Promise<T | null> {
  const result = await requestToPromise(store.get(key))
  return (result as T | undefined) ?? null
}

async function readByIndex<T>(index: IDBIndex, query: IDBValidKey | IDBKeyRange): Promise<T[]> {
  return await requestToPromise(index.getAll(query))
}

async function put(store: IDBObjectStore, value: unknown): Promise<void> {
  await requestToPromise(store.put(value))
}

async function remove(store: IDBObjectStore, key: IDBValidKey): Promise<void> {
  await requestToPromise(store.delete(key))
}

async function clearStore(store: IDBObjectStore): Promise<void> {
  await requestToPromise(store.clear())
}

async function countStore(store: IDBObjectStore): Promise<number> {
  return await requestToPromise(store.count())
}

async function deleteByIndex(index: IDBIndex, query: IDBValidKey | IDBKeyRange): Promise<void> {
  const keys = await requestToPromise(index.getAllKeys(query))
  const objectStore = index.objectStore
  await Promise.all(keys.map((key) => remove(objectStore, key)))
}

async function trimIndexedDbVersions(
  store: IDBObjectStore,
  templateId: string,
  kind: UserTemplateVersionKind,
  limit: number
): Promise<void> {
  const versions = (
    await readByIndex<UserTemplateVersionSnapshot>(store.index("templateId_kind"), [
      templateId,
      kind,
    ])
  ).sort(compareVersionsNewestFirst)
  await Promise.all(versions.slice(limit).map((version) => remove(store, version.id)))
}

let legacyStorePromise: Promise<RuntimeStore> | undefined
let storePromise: Promise<RuntimeStore> | undefined

async function migrateLegacyDraftsToRuntimeStore(store: RuntimeStore): Promise<void> {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return
  }

  for (const item of listStoredDraftDocuments()) {
    const source: CanvasDraftSource =
      item.draft.source?.kind === "preset-template"
        ? { kind: "preset-template", presetId: item.presetId }
        : { kind: "scratch", presetId: item.presetId }
    const existing = await store.loadWorkingCopy(source)
    if (existing) {
      continue
    }
    await store.replaceWorkingCopy({
      source,
      document: item.draft,
    })
  }
}

async function resolveLegacyStore(): Promise<RuntimeStore> {
  if (!legacyStorePromise) {
    legacyStorePromise = (async () => {
      if (!isIndexedDbAvailable()) {
        return new MemoryUserTemplateStore()
      }
      try {
        const store = new IndexedDbUserTemplateStore()
        await store.listTemplates()
        return store
      } catch {
        return new MemoryUserTemplateStore()
      }
    })()
  }
  return await legacyStorePromise
}

async function resolveStore() {
  if (!storePromise) {
    storePromise = (async () => {
      const legacyStore = await resolveLegacyStore()
      if (!supportsSqliteRuntimeStore()) {
        return legacyStore
      }

      try {
        const sqliteStore = createSqliteRuntimeStore()
        await sqliteStore.listTemplates()
        if (await sqliteStore.isEmpty()) {
          const legacySnapshot = await legacyStore.exportSnapshot()
          if (!isSnapshotEmpty(legacySnapshot)) {
            await sqliteStore.replaceSnapshot(legacySnapshot)
          }
        }
        await migrateLegacyDraftsToRuntimeStore(sqliteStore)
        return sqliteStore
      } catch {
        return legacyStore
      }
    })()
  }
  return await storePromise
}

export function getCanvasDraftSourceKey(source: CanvasDraftSource): string {
  return createSourceKey(source)
}

export function getAutosaveIntervalMs(): number {
  return AUTOSAVE_INTERVAL_MS
}

export async function listUserTemplates(): Promise<UserTemplateSummary[]> {
  const store = await resolveStore()
  return store.listTemplates()
}

export async function listArchivedUserTemplates(): Promise<UserTemplateSummary[]> {
  const store = await resolveStore()
  return store.listArchivedTemplates()
}

export async function readUserTemplate(templateId: string): Promise<UserTemplateSummary | null> {
  const store = await resolveStore()
  return store.readTemplate(templateId)
}

export async function readUserTemplateHistory(
  templateId: string
): Promise<UserTemplateHistory | null> {
  const store = await resolveStore()
  return store.readHistory(templateId)
}

export async function readUserTemplateVersion(
  versionId: string
): Promise<UserTemplateVersionSnapshot | null> {
  const store = await resolveStore()
  return store.readVersion(versionId)
}

export async function saveUserTemplate(args: {
  name: string
  description?: string
  document: CanvasDraftDocument
  templateId?: string
  sourceVersionId?: string
}) {
  const store = await resolveStore()
  const result = await store.saveTemplate(args)
  emitRuntimeStoreMutation("template-saved")
  return result
}

export async function renameUserTemplate(
  templateId: string,
  name: string
): Promise<UserTemplateSummary | null> {
  const store = await resolveStore()
  const result = await store.renameTemplate(templateId, name)
  if (result) {
    emitRuntimeStoreMutation("template-renamed")
  }
  return result
}

export async function archiveUserTemplate(templateId: string): Promise<UserTemplateSummary | null> {
  const store = await resolveStore()
  const result = await store.archiveTemplate(templateId)
  if (result) {
    emitRuntimeStoreMutation("template-archived")
  }
  return result
}

export async function restoreUserTemplate(templateId: string): Promise<UserTemplateSummary | null> {
  const store = await resolveStore()
  const result = await store.restoreTemplate(templateId)
  if (result) {
    emitRuntimeStoreMutation("template-restored")
  }
  return result
}

export async function purgeUserTemplate(templateId: string): Promise<void> {
  const store = await resolveStore()
  await store.purgeTemplate(templateId)
  emitRuntimeStoreMutation("template-purged")
}

export async function saveUserTemplateAutosave(args: {
  templateId?: string
  source: CanvasDraftSource
  document: CanvasDraftDocument
  sourceVersionId?: string
}) {
  const store = await resolveStore()
  const result = await store.saveAutosave(args)
  emitRuntimeStoreMutation("autosave-saved")
  return result
}

export async function replaceUserTemplateWorkingCopy(args: {
  templateId?: string
  source: CanvasDraftSource
  document: CanvasDraftDocument
  sourceVersionId?: string
}) {
  const store = await resolveStore()
  const result = await store.replaceWorkingCopy(args)
  emitRuntimeStoreMutation("working-copy-replaced")
  return result
}

export async function loadWorkingCopy(
  source: CanvasDraftSource
): Promise<CanvasWorkingCopyIndexEntry | null> {
  const store = await resolveStore()
  return store.loadWorkingCopy(source)
}

export async function clearWorkingCopy(source: CanvasDraftSource): Promise<void> {
  const store = await resolveStore()
  await store.clearWorkingCopy(source)
  emitRuntimeStoreMutation("working-copy-cleared")
}

export async function clearTemplateAutosaves(templateId: string): Promise<void> {
  const store = await resolveStore()
  await store.clearTemplateAutosaves(templateId)
  emitRuntimeStoreMutation("template-autosaves-cleared")
}

export async function loadRuntimeAppSettings(): Promise<RuntimeStoreAppSettings> {
  const store = await resolveStore()
  return store.loadAppSettings()
}

export async function saveRuntimeAppSettings(
  updater:
    | Partial<Omit<RuntimeStoreAppSettings, "version" | "updatedAt">>
    | ((
        current: RuntimeStoreAppSettings
      ) => Partial<Omit<RuntimeStoreAppSettings, "version" | "updatedAt">>)
): Promise<RuntimeStoreAppSettings> {
  const store = await resolveStore()
  const result = await store.saveAppSettings(updater)
  emitRuntimeStoreMutation("app-settings-saved")
  return result
}

export async function exportRuntimeSnapshot(): Promise<RuntimeStoreSnapshot> {
  const store = await resolveStore()
  return store.exportSnapshot()
}

export async function replaceRuntimeSnapshot(snapshot: RuntimeStoreSnapshot): Promise<void> {
  const store = await resolveStore()
  await store.replaceSnapshot(snapshot)
  emitRuntimeStoreMutation("snapshot-replaced")
}

export async function resetUserTemplateStoreForTest(): Promise<void> {
  const store = await resolveStore()
  await store.resetForTest()
  storePromise = undefined
  legacyStorePromise = undefined
}

export { createDefaultRuntimeAppSettings } from "./runtime-app-settings.js"
export type {
  RuntimeStore,
  RuntimeStoreAppSettings,
  RuntimeStoreSnapshot,
} from "./runtime-store-contract.js"
