import initSqlite from "@sqlite.org/sqlite-wasm"
import { stableStringify } from "../../../packages/core/src/web.js"
import { normalizeCanvasDraftDocumentUnits } from "./lib/canvas-units.js"
import {
  createDefaultRuntimeAppSettings,
  normalizeRuntimeAppSettings,
  withUpdatedRuntimeAppSettings,
} from "./runtime-app-settings.js"
import type {
  RuntimeStoreAppSettings,
  RuntimeStoreSaveTemplateArgs,
  RuntimeStoreSaveWorkingCopyArgs,
  RuntimeStoreSnapshot,
} from "./runtime-store-contract.js"
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

const SQLITE_DB_FILE = "/tuckmark-runtime.sqlite3"
const SQLITE_VFS_DIRECTORY = "/tuckmark/runtime-vfs"
const SQLITE_SETTINGS_KEY = "global"
const MAX_SAVED_VERSIONS = 20
const MAX_AUTOSAVE_VERSIONS = 10
const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000

type SqliteModule = Awaited<ReturnType<typeof initSqlite>>
type SqliteSahPoolUtil = Awaited<ReturnType<SqliteModule["installOpfsSAHPoolVfs"]>>
type SqliteRow = Record<string, unknown>
type SqliteDatabase = {
  exec(sql: string, options?: { bind?: unknown[] | Record<string, unknown> }): unknown
  selectArray(sql: string, bind?: unknown): unknown[] | undefined
  selectObject(sql: string, bind?: unknown): SqliteRow | undefined
  selectObjects(sql: string, bind?: unknown): SqliteRow[]
}

type WorkerMethodMap = {
  init: undefined
  listTemplates: undefined
  listArchivedTemplates: undefined
  readTemplate: { templateId: string }
  readHistory: { templateId: string }
  readVersion: { versionId: string }
  saveTemplate: RuntimeStoreSaveTemplateArgs
  renameTemplate: { templateId: string; name: string }
  archiveTemplate: { templateId: string }
  restoreTemplate: { templateId: string }
  purgeTemplate: { templateId: string }
  saveAutosave: RuntimeStoreSaveWorkingCopyArgs
  replaceWorkingCopy: RuntimeStoreSaveWorkingCopyArgs
  loadWorkingCopy: { source: CanvasDraftSource }
  clearWorkingCopy: { source: CanvasDraftSource }
  clearTemplateAutosaves: { templateId: string }
  loadAppSettings: undefined
  saveAppSettings: {
    next: Partial<Omit<RuntimeStoreAppSettings, "version" | "updatedAt">>
  }
  exportSnapshot: undefined
  replaceSnapshot: { snapshot: RuntimeStoreSnapshot }
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

let sqlitePromise: Promise<SqliteModule> | null = null
let dbPromise: Promise<SqliteDatabase> | null = null
let sahPoolUtilPromise: Promise<SqliteSahPoolUtil> | null = null

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

function normalizeVersionSnapshot(
  version: UserTemplateVersionSnapshot
): UserTemplateVersionSnapshot {
  return {
    ...cloneValue(version),
    document: normalizeCanvasDraftDocumentUnits(version.document),
  }
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

function parseJsonColumn<T>(value: unknown): T {
  if (typeof value !== "string") {
    throw new Error("SQLite payload is not a string.")
  }
  return JSON.parse(value) as T
}

function readRows(db: SqliteDatabase, sql: string, bind?: unknown) {
  return db.selectObjects(sql, bind)
}

function readTemplateRecords(db: SqliteDatabase): UserTemplateRecord[] {
  const rows = readRows(db, "select payload from templates order by updated_at desc, id asc")
  return rows.map((row: SqliteRow) => parseJsonColumn<UserTemplateRecord>(row.payload))
}

function readVersionRecords(
  db: SqliteDatabase,
  templateId?: string,
  kind?: UserTemplateVersionKind
): UserTemplateVersionSnapshot[] {
  if (templateId && kind) {
    return readRows(
      db,
      `
        select payload
        from versions
        where template_id = ?1 and kind = ?2
        order by version_number desc, created_at desc, id desc
      `,
      [templateId, kind]
    ).map((row: SqliteRow) =>
      normalizeVersionSnapshot(parseJsonColumn<UserTemplateVersionSnapshot>(row.payload))
    )
  }
  if (templateId) {
    return readRows(
      db,
      `
        select payload
        from versions
        where template_id = ?1
        order by version_number desc, created_at desc, id desc
      `,
      [templateId]
    ).map((row: SqliteRow) =>
      normalizeVersionSnapshot(parseJsonColumn<UserTemplateVersionSnapshot>(row.payload))
    )
  }
  return readRows(db, "select payload from versions order by created_at desc, id desc").map(
    (row: SqliteRow) =>
      normalizeVersionSnapshot(parseJsonColumn<UserTemplateVersionSnapshot>(row.payload))
  )
}

function readWorkingCopyRecords(db: SqliteDatabase): CanvasWorkingCopyIndexEntry[] {
  return readRows(
    db,
    "select payload from working_copies order by updated_at desc, source_key asc"
  ).map((row: SqliteRow) => {
    const entry = parseJsonColumn<CanvasWorkingCopyIndexEntry>(row.payload)
    return {
      ...entry,
      draft: normalizeCanvasDraftDocumentUnits(entry.draft),
    }
  })
}

function readWorkingCopyBySource(
  db: SqliteDatabase,
  source: CanvasDraftSource
): CanvasWorkingCopyIndexEntry | null {
  const row = db.selectObject("select payload from working_copies where source_key = ?1", [
    createSourceKey(source),
  ])
  if (!row?.payload) {
    return null
  }
  const entry = parseJsonColumn<CanvasWorkingCopyIndexEntry>(row.payload)
  return {
    ...entry,
    draft: normalizeCanvasDraftDocumentUnits(entry.draft),
  }
}

function readSettingsRecord(db: SqliteDatabase): RuntimeStoreAppSettings {
  const row = db.selectObject("select payload from app_settings where key = ?1", [
    SQLITE_SETTINGS_KEY,
  ])
  if (!row?.payload) {
    return createDefaultRuntimeAppSettings()
  }
  return normalizeRuntimeAppSettings(parseJsonColumn<RuntimeStoreAppSettings>(row.payload))
}

function bootstrapDb(db: SqliteDatabase) {
  db.exec(`
    create table if not exists templates (
      id text primary key,
      updated_at text not null,
      payload text not null
    );
    create table if not exists versions (
      id text primary key,
      template_id text not null,
      kind text not null,
      version_number integer not null,
      created_at text not null,
      payload text not null
    );
    create index if not exists versions_template_idx on versions(template_id, version_number desc);
    create index if not exists versions_template_kind_idx on versions(template_id, kind, version_number desc);
    create table if not exists working_copies (
      source_key text primary key,
      source_kind text not null,
      source_ref text not null,
      template_id text,
      updated_at text not null,
      payload text not null
    );
    create table if not exists app_settings (
      key text primary key,
      updated_at text not null,
      payload text not null
    );
  `)
}

function withTransaction<T>(db: SqliteDatabase, callback: () => T): T {
  db.exec("begin immediate")
  try {
    const result = callback()
    db.exec("commit")
    return result
  } catch (error) {
    try {
      db.exec("rollback")
    } catch {
      // Ignore rollback failures after the original error.
    }
    throw error
  }
}

function upsertTemplateRecord(db: SqliteDatabase, template: UserTemplateRecord) {
  db.exec(
    `
      insert into templates (id, updated_at, payload)
      values (?1, ?2, ?3)
      on conflict(id) do update set
        updated_at = excluded.updated_at,
        payload = excluded.payload
    `,
    {
      bind: [template.id, template.updatedAt, JSON.stringify(template)],
    }
  )
}

function upsertVersionRecord(db: SqliteDatabase, version: UserTemplateVersionSnapshot) {
  db.exec(
    `
      insert into versions (id, template_id, kind, version_number, created_at, payload)
      values (?1, ?2, ?3, ?4, ?5, ?6)
      on conflict(id) do update set
        template_id = excluded.template_id,
        kind = excluded.kind,
        version_number = excluded.version_number,
        created_at = excluded.created_at,
        payload = excluded.payload
    `,
    {
      bind: [
        version.id,
        version.templateId,
        version.kind,
        version.version,
        version.createdAt,
        JSON.stringify(version),
      ],
    }
  )
}

function upsertWorkingCopyRecord(db: SqliteDatabase, entry: CanvasWorkingCopyIndexEntry) {
  const sourceRef =
    entry.source.kind === "user-template" ? entry.source.templateId : entry.source.presetId
  db.exec(
    `
      insert into working_copies (
        source_key,
        source_kind,
        source_ref,
        template_id,
        updated_at,
        payload
      )
      values (?1, ?2, ?3, ?4, ?5, ?6)
      on conflict(source_key) do update set
        source_kind = excluded.source_kind,
        source_ref = excluded.source_ref,
        template_id = excluded.template_id,
        updated_at = excluded.updated_at,
        payload = excluded.payload
    `,
    {
      bind: [
        entry.sourceKey,
        entry.source.kind,
        sourceRef,
        entry.templateId ?? null,
        entry.updatedAt,
        JSON.stringify(entry),
      ],
    }
  )
}

function writeSettingsRecord(db: SqliteDatabase, settings: RuntimeStoreAppSettings) {
  db.exec(
    `
      insert into app_settings (key, updated_at, payload)
      values (?1, ?2, ?3)
      on conflict(key) do update set
        updated_at = excluded.updated_at,
        payload = excluded.payload
    `,
    {
      bind: [SQLITE_SETTINGS_KEY, settings.updatedAt, JSON.stringify(settings)],
    }
  )
}

function trimVersions(
  db: SqliteDatabase,
  templateId: string,
  kind: UserTemplateVersionKind,
  limit: number
) {
  const staleRows = readRows(
    db,
    `
      select id
      from versions
      where template_id = ?1 and kind = ?2
      order by version_number desc, created_at desc, id desc
      limit -1 offset ?3
    `,
    [templateId, kind, limit]
  )
  for (const row of staleRows) {
    db.exec("delete from versions where id = ?1", { bind: [row.id] })
  }
}

function clearAutosaves(db: SqliteDatabase, templateId: string) {
  db.exec("delete from versions where template_id = ?1 and kind = 'autosave'", {
    bind: [templateId],
  })
}

async function resolveSqlite(): Promise<SqliteModule> {
  if (!sqlitePromise) {
    sqlitePromise = initSqlite()
  }
  const sqlite3 = await sqlitePromise
  return sqlite3
}

async function resolveSahPoolUtil(): Promise<SqliteSahPoolUtil> {
  if (!sahPoolUtilPromise) {
    sahPoolUtilPromise = (async () => {
      const sqlite3 = await resolveSqlite()
      return await sqlite3.installOpfsSAHPoolVfs({
        directory: SQLITE_VFS_DIRECTORY,
        initialCapacity: 12,
      })
    })()
  }
  return await sahPoolUtilPromise
}

async function resolveDb(): Promise<SqliteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const sahPoolUtil = await resolveSahPoolUtil()
      const db = new sahPoolUtil.OpfsSAHPoolDb(SQLITE_DB_FILE) as SqliteDatabase
      bootstrapDb(db)
      return db
    })()
  }
  return dbPromise
}

async function listTemplates() {
  const db = await resolveDb()
  const templates = readTemplateRecords(db)
  const versions = readVersionRecords(db)
  const versionMap = new Map(versions.map((version) => [version.id, version]))
  const workingCopies = readWorkingCopyRecords(db)
  const workingCopyMap = new Map(workingCopies.map((entry) => [entry.sourceKey, entry]))
  return templates
    .filter((template) => !template.archivedAt)
    .map((template) =>
      buildTemplateSummary(
        template,
        workingCopyMap.get(createSourceKey({ kind: "user-template", templateId: template.id })) ??
          null,
        versionMap.get(template.currentVersionId)?.document ?? null
      )
    )
}

async function listArchivedTemplates() {
  const db = await resolveDb()
  const templates = readTemplateRecords(db)
  const versions = readVersionRecords(db)
  const versionMap = new Map(versions.map((version) => [version.id, version]))
  const workingCopies = readWorkingCopyRecords(db)
  const workingCopyMap = new Map(workingCopies.map((entry) => [entry.sourceKey, entry]))
  return templates
    .filter((template) => Boolean(template.archivedAt))
    .sort(compareArchivedNewestFirst)
    .map((template) =>
      buildTemplateSummary(
        template,
        workingCopyMap.get(createSourceKey({ kind: "user-template", templateId: template.id })) ??
          null,
        versionMap.get(template.currentVersionId)?.document ?? null
      )
    )
}

async function readTemplate(templateId: string) {
  const db = await resolveDb()
  const row = db.selectObject("select payload from templates where id = ?1", [templateId])
  if (!row?.payload) {
    return null
  }
  const template = parseJsonColumn<UserTemplateRecord>(row.payload)
  const workingCopy = readWorkingCopyBySource(db, { kind: "user-template", templateId }) ?? null
  const versionRow = db.selectObject("select payload from versions where id = ?1", [
    template.currentVersionId,
  ])
  const fallbackDocument = versionRow?.payload
    ? parseJsonColumn<UserTemplateVersionSnapshot>(versionRow.payload).document
    : null
  return buildTemplateSummary(template, workingCopy, fallbackDocument)
}

async function readHistory(templateId: string): Promise<UserTemplateHistory | null> {
  const template = await readTemplate(templateId)
  if (!template) {
    return null
  }
  const db = await resolveDb()
  const versions = readVersionRecords(db, templateId).sort(compareVersionsNewestFirst)
  return {
    template,
    saved: versions.filter((version) => version.kind === "saved").map(normalizeVersionSnapshot),
    autosaves: versions
      .filter((version) => version.kind === "autosave")
      .map(normalizeVersionSnapshot),
  }
}

async function readVersion(versionId: string) {
  const db = await resolveDb()
  const row = db.selectObject("select payload from versions where id = ?1", [versionId])
  return row?.payload ? normalizeVersionSnapshot(parseJsonColumn(row.payload)) : null
}

async function saveTemplate(args: RuntimeStoreSaveTemplateArgs) {
  const db = await resolveDb()
  return withTransaction(db, () => {
    const templateId = args.templateId ?? createId("user-template")
    const currentTemplateRow = db.selectObject("select payload from templates where id = ?1", [
      templateId,
    ])
    const existing = currentTemplateRow?.payload
      ? parseJsonColumn<UserTemplateRecord>(currentTemplateRow.payload)
      : null
    const templateVersions = readVersionRecords(db, templateId)
    const nextVersionNumber = getNextSavedVersionNumber(templateVersions)
    const now = new Date().toISOString()
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
      description: args.description ?? existing?.description ?? "",
      width: document.width,
      height: document.height,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      archivedAt: existing?.archivedAt ?? null,
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

    upsertTemplateRecord(db, template)
    upsertVersionRecord(db, version)
    upsertWorkingCopyRecord(db, workingCopy)
    trimVersions(db, templateId, "saved", MAX_SAVED_VERSIONS)
    clearAutosaves(db, templateId)

    return {
      template: { ...cloneValue(template), fields: cloneValue(document.fields) },
      version: cloneValue(version),
      workingCopy: cloneValue(workingCopy),
    }
  })
}

async function renameTemplate(templateId: string, name: string) {
  const db = await resolveDb()
  return withTransaction(db, () => {
    const row = db.selectObject("select payload from templates where id = ?1", [templateId])
    if (!row?.payload) {
      return null
    }

    const renamedAt = new Date().toISOString()
    const template = parseJsonColumn<UserTemplateRecord>(row.payload)
    upsertTemplateRecord(db, {
      ...template,
      name,
      updatedAt: renamedAt,
    })

    const workingCopyKey = createSourceKey({ kind: "user-template", templateId })
    const workingCopyRow = db.selectObject(
      "select payload from working_copies where source_key = ?1",
      [workingCopyKey]
    )
    if (workingCopyRow?.payload) {
      const workingCopy = parseJsonColumn<CanvasWorkingCopyIndexEntry>(workingCopyRow.payload)
      upsertWorkingCopyRecord(db, {
        ...workingCopy,
        updatedAt: renamedAt,
        draft: {
          ...workingCopy.draft,
          name,
        },
      })
    }

    return readTemplate(templateId)
  })
}

async function saveAutosave(args: RuntimeStoreSaveWorkingCopyArgs) {
  const db = await resolveDb()
  return withTransaction(db, () => {
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
    upsertWorkingCopyRecord(db, workingCopy)

    if (!args.templateId) {
      return cloneValue(workingCopy)
    }

    const currentTemplate = db.selectObject("select payload from templates where id = ?1", [
      args.templateId,
    ])
    const currentTemplateRecord = currentTemplate?.payload
      ? parseJsonColumn<UserTemplateRecord>(currentTemplate.payload)
      : null
    const currentVersion = currentTemplateRecord
      ? (readVersionRecords(db, args.templateId).find(
          (version) => version.id === currentTemplateRecord.currentVersionId
        ) ?? null)
      : null
    if (
      currentVersion &&
      sameDocumentContent(normalizeCanvasDraftDocumentUnits(currentVersion.document), draft)
    ) {
      return cloneValue(workingCopy)
    }

    const previousAutosaves = readVersionRecords(db, args.templateId, "autosave").sort(
      compareVersionsOldestFirst
    )
    const newest = previousAutosaves[previousAutosaves.length - 1]
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
      Math.max(0, ...readVersionRecords(db, args.templateId).map((version) => version.version)) + 1
    const version: UserTemplateVersionSnapshot = {
      id: createId("user-template-autosave"),
      templateId: args.templateId,
      version: nextVersionNumber,
      kind: "autosave",
      createdAt: now,
      label: "未保存草稿",
      sourceVersionId: args.sourceVersionId,
      document: workingCopy.draft,
    }
    upsertVersionRecord(db, version)
    trimVersions(db, args.templateId, "autosave", MAX_AUTOSAVE_VERSIONS)
    return cloneValue(workingCopy)
  })
}

async function replaceWorkingCopy(args: RuntimeStoreSaveWorkingCopyArgs) {
  const db = await resolveDb()
  return withTransaction(db, () => {
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
    upsertWorkingCopyRecord(db, workingCopy)
    return cloneValue(workingCopy)
  })
}

async function archiveTemplate(templateId: string) {
  const db = await resolveDb()
  return withTransaction(db, () => {
    const row = db.selectObject("select payload from templates where id = ?1", [templateId])
    if (!row?.payload) {
      return null
    }
    const template = parseJsonColumn<UserTemplateRecord>(row.payload)
    const archivedAt = new Date().toISOString()
    upsertTemplateRecord(db, {
      ...template,
      archivedAt,
      updatedAt: archivedAt,
    })
    return readTemplate(templateId)
  })
}

async function restoreTemplate(templateId: string) {
  const db = await resolveDb()
  return withTransaction(db, () => {
    const row = db.selectObject("select payload from templates where id = ?1", [templateId])
    if (!row?.payload) {
      return null
    }
    const template = parseJsonColumn<UserTemplateRecord>(row.payload)
    const restoredAt = new Date().toISOString()
    upsertTemplateRecord(db, {
      ...template,
      archivedAt: null,
      updatedAt: restoredAt,
    })
    return readTemplate(templateId)
  })
}

async function purgeTemplate(templateId: string) {
  const db = await resolveDb()
  withTransaction(db, () => {
    db.exec("delete from versions where template_id = ?1", { bind: [templateId] })
    db.exec("delete from working_copies where source_key = ?1 or template_id = ?1", {
      bind: [templateId],
    })
    db.exec("delete from working_copies where source_key = ?1", {
      bind: [createSourceKey({ kind: "user-template", templateId })],
    })
    db.exec("delete from templates where id = ?1", { bind: [templateId] })
  })
}

async function loadWorkingCopy(source: CanvasDraftSource) {
  const db = await resolveDb()
  return readWorkingCopyBySource(db, source)
}

async function clearWorkingCopy(source: CanvasDraftSource) {
  const db = await resolveDb()
  withTransaction(db, () => {
    db.exec("delete from working_copies where source_key = ?1", {
      bind: [createSourceKey(source)],
    })
  })
}

async function clearTemplateAutosaves(templateId: string) {
  const db = await resolveDb()
  withTransaction(db, () => {
    clearAutosaves(db, templateId)
  })
}

async function loadAppSettings() {
  const db = await resolveDb()
  return readSettingsRecord(db)
}

async function saveAppSettings(
  next: Partial<Omit<RuntimeStoreAppSettings, "version" | "updatedAt">>
) {
  const db = await resolveDb()
  return withTransaction(db, () => {
    const current = readSettingsRecord(db)
    const updated = withUpdatedRuntimeAppSettings(current, next)
    writeSettingsRecord(db, updated)
    return updated
  })
}

async function exportSnapshot() {
  const db = await resolveDb()
  const snapshot: RuntimeStoreSnapshot = {
    schema: "tuckmark.runtime-export.v1",
    exportedAt: new Date().toISOString(),
    snapshotUpdatedAt: null,
    settings: readSettingsRecord(db),
    templates: readTemplateRecords(db),
    versions: readVersionRecords(db),
    workingCopies: readWorkingCopyRecords(db),
  }
  snapshot.snapshotUpdatedAt = computeSnapshotUpdatedAt(snapshot)
  return snapshot
}

async function replaceSnapshot(snapshot: RuntimeStoreSnapshot) {
  const db = await resolveDb()
  withTransaction(db, () => {
    db.exec("delete from versions")
    db.exec("delete from working_copies")
    db.exec("delete from templates")
    db.exec("delete from app_settings")
    for (const template of snapshot.templates) {
      upsertTemplateRecord(db, template)
    }
    for (const version of snapshot.versions) {
      upsertVersionRecord(db, version)
    }
    for (const workingCopy of snapshot.workingCopies) {
      upsertWorkingCopyRecord(db, workingCopy)
    }
    writeSettingsRecord(db, normalizeRuntimeAppSettings(snapshot.settings))
  })
}

async function isEmpty() {
  const db = await resolveDb()
  const counts = db.selectArray(
    `
      select
        (select count(*) from templates),
        (select count(*) from versions),
        (select count(*) from working_copies)
    `
  )
  return (
    !counts ||
    (Number(counts[0] ?? 0) === 0 && Number(counts[1] ?? 0) === 0 && Number(counts[2] ?? 0) === 0)
  )
}

async function resetForTest() {
  const db = await resolveDb()
  withTransaction(db, () => {
    db.exec("delete from versions")
    db.exec("delete from working_copies")
    db.exec("delete from templates")
    db.exec("delete from app_settings")
  })
}

async function dispatchRequest(request: WorkerRequest): Promise<unknown> {
  switch (request.method) {
    case "init":
      await resolveDb()
      return true
    case "listTemplates":
      return listTemplates()
    case "listArchivedTemplates":
      return listArchivedTemplates()
    case "readTemplate":
      return readTemplate((request.args as WorkerMethodMap["readTemplate"]).templateId)
    case "readHistory":
      return readHistory((request.args as WorkerMethodMap["readHistory"]).templateId)
    case "readVersion":
      return readVersion((request.args as WorkerMethodMap["readVersion"]).versionId)
    case "saveTemplate":
      return saveTemplate(request.args as WorkerMethodMap["saveTemplate"])
    case "renameTemplate":
      return renameTemplate(
        (request.args as WorkerMethodMap["renameTemplate"]).templateId,
        (request.args as WorkerMethodMap["renameTemplate"]).name
      )
    case "archiveTemplate":
      return archiveTemplate((request.args as WorkerMethodMap["archiveTemplate"]).templateId)
    case "restoreTemplate":
      return restoreTemplate((request.args as WorkerMethodMap["restoreTemplate"]).templateId)
    case "purgeTemplate":
      return purgeTemplate((request.args as WorkerMethodMap["purgeTemplate"]).templateId)
    case "saveAutosave":
      return saveAutosave(request.args as WorkerMethodMap["saveAutosave"])
    case "replaceWorkingCopy":
      return replaceWorkingCopy(request.args as WorkerMethodMap["replaceWorkingCopy"])
    case "loadWorkingCopy":
      return loadWorkingCopy((request.args as WorkerMethodMap["loadWorkingCopy"]).source)
    case "clearWorkingCopy":
      return clearWorkingCopy((request.args as WorkerMethodMap["clearWorkingCopy"]).source)
    case "clearTemplateAutosaves":
      return clearTemplateAutosaves(
        (request.args as WorkerMethodMap["clearTemplateAutosaves"]).templateId
      )
    case "loadAppSettings":
      return loadAppSettings()
    case "saveAppSettings":
      return saveAppSettings((request.args as WorkerMethodMap["saveAppSettings"]).next)
    case "exportSnapshot":
      return exportSnapshot()
    case "replaceSnapshot":
      return replaceSnapshot((request.args as WorkerMethodMap["replaceSnapshot"]).snapshot)
    case "isEmpty":
      return isEmpty()
    case "resetForTest":
      return resetForTest()
  }
}

globalThis.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  void dispatchRequest(request)
    .then((result) => {
      const response: WorkerResponse = {
        id: request.id,
        ok: true,
        result,
      }
      globalThis.postMessage(response)
    })
    .catch((error: unknown) => {
      const response: WorkerResponse = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
      globalThis.postMessage(response)
    })
})
