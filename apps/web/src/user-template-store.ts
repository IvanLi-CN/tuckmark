import { stableStringify } from "../../../packages/core/src/web.js"
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

const DB_NAME = "tuckmark-user-template-store"
const DB_VERSION = 1
const TEMPLATE_STORE = "templates"
const VERSION_STORE = "versions"
const WORKING_COPY_STORE = "workingCopies"
const MAX_SAVED_VERSIONS = 20
const MAX_AUTOSAVE_VERSIONS = 10
const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000

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

function buildTemplateSummary(
  template: UserTemplateRecord,
  workingCopy: CanvasWorkingCopyIndexEntry | null,
  fallbackDocument: CanvasDraftDocument | null
): UserTemplateSummary {
  return {
    ...cloneValue(template),
    fields: cloneValue(workingCopy?.draft.fields ?? fallbackDocument?.fields ?? []),
  }
}

class MemoryUserTemplateStore {
  private readonly templates = new Map<string, UserTemplateRecord>()
  private readonly versions = new Map<string, UserTemplateVersionSnapshot>()
  private readonly workingCopies = new Map<string, CanvasWorkingCopyIndexEntry>()

  async listTemplates(): Promise<UserTemplateSummary[]> {
    const templates = Array.from(this.templates.values()).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    )
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
      saved: history.filter((version) => version.kind === "saved").map(cloneValue),
      autosaves: history.filter((version) => version.kind === "autosave").map(cloneValue),
    }
  }

  async readVersion(versionId: string): Promise<UserTemplateVersionSnapshot | null> {
    const version = this.versions.get(versionId)
    return version ? cloneValue(version) : null
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
    const document = cloneValue(args.document)
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

  async saveAutosave(args: {
    templateId?: string
    source: CanvasDraftSource
    document: CanvasDraftDocument
    sourceVersionId?: string
  }): Promise<CanvasWorkingCopyIndexEntry> {
    const now = new Date().toISOString()
    const draft = cloneValue(args.document)
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
    if (currentVersion && sameDocumentContent(currentVersion.document, draft)) {
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

  async replaceWorkingCopy(args: {
    templateId?: string
    source: CanvasDraftSource
    document: CanvasDraftDocument
    sourceVersionId?: string
  }): Promise<CanvasWorkingCopyIndexEntry> {
    const now = new Date().toISOString()
    const workingCopy: CanvasWorkingCopyIndexEntry = {
      sourceKey: createSourceKey(args.source),
      source: cloneValue(args.source),
      templateId: args.templateId,
      draft: cloneValue(args.document),
      updatedAt: now,
      baseVersionId: args.sourceVersionId,
    }
    this.workingCopies.set(workingCopy.sourceKey, workingCopy)
    return cloneValue(workingCopy)
  }

  async loadWorkingCopy(source: CanvasDraftSource): Promise<CanvasWorkingCopyIndexEntry | null> {
    const entry = this.workingCopies.get(createSourceKey(source))
    return entry ? cloneValue(entry) : null
  }

  async clearWorkingCopy(source: CanvasDraftSource): Promise<void> {
    this.workingCopies.delete(createSourceKey(source))
  }

  async clearTemplateAutosaves(templateId: string): Promise<void> {
    this.clearVersions(templateId, "autosave")
  }

  async resetForTest(): Promise<void> {
    this.templates.clear()
    this.versions.clear()
    this.workingCopies.clear()
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
          template: {
            ...record,
            fields: cloneValue(currentVersion?.document.fields ?? []),
          },
          saved: versions
            .filter((version) => version.kind === "saved")
            .sort(compareVersionsNewestFirst),
          autosaves: versions
            .filter((version) => version.kind === "autosave")
            .sort(compareVersionsNewestFirst),
        }
      }
    )
    return history ? cloneValue(history) : null
  }

  override async readVersion(versionId: string): Promise<UserTemplateVersionSnapshot | null> {
    const version = await this.transaction([VERSION_STORE], "readonly", async (stores) =>
      readOne<UserTemplateVersionSnapshot>(stores[VERSION_STORE], versionId)
    )
    return version ? cloneValue(version) : null
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
    const document = cloneValue(args.document)
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

  override async saveAutosave(args: {
    templateId?: string
    source: CanvasDraftSource
    document: CanvasDraftDocument
    sourceVersionId?: string
  }): Promise<CanvasWorkingCopyIndexEntry> {
    const now = new Date().toISOString()
    const workingCopy: CanvasWorkingCopyIndexEntry = {
      sourceKey: createSourceKey(args.source),
      source: cloneValue(args.source),
      templateId: args.templateId,
      draft: cloneValue(args.document),
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
    if (currentVersion && sameDocumentContent(currentVersion.document, workingCopy.draft)) {
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
      document: cloneValue(args.document),
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
    const workingCopy: CanvasWorkingCopyIndexEntry = {
      sourceKey: createSourceKey(args.source),
      source: cloneValue(args.source),
      templateId: args.templateId,
      draft: cloneValue(args.document),
      updatedAt: now,
      baseVersionId: args.sourceVersionId,
    }
    await this.transaction([WORKING_COPY_STORE], "readwrite", async (stores) => {
      await put(stores[WORKING_COPY_STORE], workingCopy)
    })
    return cloneValue(workingCopy)
  }

  override async loadWorkingCopy(
    source: CanvasDraftSource
  ): Promise<CanvasWorkingCopyIndexEntry | null> {
    const entry = await this.transaction([WORKING_COPY_STORE], "readonly", async (stores) =>
      readOne<CanvasWorkingCopyIndexEntry>(stores[WORKING_COPY_STORE], createSourceKey(source))
    )
    return entry ? cloneValue(entry) : null
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

  override async resetForTest(): Promise<void> {
    await this.transaction(
      [TEMPLATE_STORE, VERSION_STORE, WORKING_COPY_STORE],
      "readwrite",
      async (stores) => {
        await clearStore(stores[TEMPLATE_STORE])
        await clearStore(stores[VERSION_STORE])
        await clearStore(stores[WORKING_COPY_STORE])
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

let storePromise:
  | Promise<{
      listTemplates(): Promise<UserTemplateSummary[]>
      readTemplate(templateId: string): Promise<UserTemplateSummary | null>
      readHistory(templateId: string): Promise<UserTemplateHistory | null>
      readVersion(versionId: string): Promise<UserTemplateVersionSnapshot | null>
      saveTemplate(args: {
        name: string
        description?: string
        document: CanvasDraftDocument
        templateId?: string
        sourceVersionId?: string
      }): Promise<{
        template: UserTemplateSummary
        version: UserTemplateVersionSnapshot
        workingCopy: CanvasWorkingCopyIndexEntry
      }>
      saveAutosave(args: {
        templateId?: string
        source: CanvasDraftSource
        document: CanvasDraftDocument
        sourceVersionId?: string
      }): Promise<CanvasWorkingCopyIndexEntry>
      replaceWorkingCopy(args: {
        templateId?: string
        source: CanvasDraftSource
        document: CanvasDraftDocument
        sourceVersionId?: string
      }): Promise<CanvasWorkingCopyIndexEntry>
      loadWorkingCopy(source: CanvasDraftSource): Promise<CanvasWorkingCopyIndexEntry | null>
      clearWorkingCopy(source: CanvasDraftSource): Promise<void>
      clearTemplateAutosaves(templateId: string): Promise<void>
      resetForTest(): Promise<void>
    }>
  | undefined

async function resolveStore() {
  if (!storePromise) {
    storePromise = (async () => {
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
  return store.saveTemplate(args)
}

export async function saveUserTemplateAutosave(args: {
  templateId?: string
  source: CanvasDraftSource
  document: CanvasDraftDocument
  sourceVersionId?: string
}) {
  const store = await resolveStore()
  return store.saveAutosave(args)
}

export async function replaceUserTemplateWorkingCopy(args: {
  templateId?: string
  source: CanvasDraftSource
  document: CanvasDraftDocument
  sourceVersionId?: string
}) {
  const store = await resolveStore()
  return store.replaceWorkingCopy(args)
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
}

export async function clearTemplateAutosaves(templateId: string): Promise<void> {
  const store = await resolveStore()
  await store.clearTemplateAutosaves(templateId)
}

export async function resetUserTemplateStoreForTest(): Promise<void> {
  const store = await resolveStore()
  await store.resetForTest()
  storePromise = undefined
}
