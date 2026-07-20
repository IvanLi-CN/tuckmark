import type {
  CanvasDraftDocument,
  CanvasDraftSource,
  CanvasWorkingCopyIndexEntry,
  DocumentRenderOptions,
  PrinterDeviceCalibration,
  PrinterModelPreset,
  PrintStrengthLevel,
  UserTemplateHistory,
  UserTemplateSummary,
  UserTemplateVersionSnapshot,
} from "./types.js"

export type RuntimeStoreAppSettings = {
  version: 1 | 2
  updatedAt: string
  documentDefaults: DocumentRenderOptions
  printerModelPresets: Record<string, PrinterModelPreset>
  printerDeviceCalibrations: Record<string, PrinterDeviceCalibration>
  permissionNudgeSeen: boolean
  showTextBoundingBoxes: boolean
}

export type LegacyRuntimeStoreAppSettings = {
  version?: 1
  updatedAt?: string
  defaultRenderOptions?: Partial<{
    printerDpi: number
    printWidthDots: number
    paperType: DocumentRenderOptions["paperType"]
    threshold: number
    xOffsetDots: number
    printStrengthLevel: PrintStrengthLevel
  }>
  permissionNudgeSeen?: boolean
}

export type RuntimeStoreSnapshot = {
  schema: "tuckmark.runtime-export.v1"
  exportedAt: string
  snapshotUpdatedAt: string | null
  settings: RuntimeStoreAppSettings
  templates: Array<{
    id: string
    name: string
    description: string
    width: number
    height: number
    createdAt: string
    updatedAt: string
    archivedAt?: string | null
    currentVersionId: string
    fieldOrder: string[]
  }>
  versions: UserTemplateVersionSnapshot[]
  workingCopies: CanvasWorkingCopyIndexEntry[]
}

export type RuntimeStoreSaveTemplateArgs = {
  name: string
  description?: string
  document: CanvasDraftDocument
  templateId?: string
  sourceVersionId?: string
}

export type RuntimeStoreSaveWorkingCopyArgs = {
  templateId?: string
  source: CanvasDraftSource
  document: CanvasDraftDocument
  sourceVersionId?: string
}

export interface RuntimeStore {
  listTemplates(): Promise<UserTemplateSummary[]>
  listArchivedTemplates(): Promise<UserTemplateSummary[]>
  readTemplate(templateId: string): Promise<UserTemplateSummary | null>
  readHistory(templateId: string): Promise<UserTemplateHistory | null>
  readVersion(versionId: string): Promise<UserTemplateVersionSnapshot | null>
  saveTemplate(args: RuntimeStoreSaveTemplateArgs): Promise<{
    template: UserTemplateSummary
    version: UserTemplateVersionSnapshot
    workingCopy: CanvasWorkingCopyIndexEntry
  }>
  renameTemplate(templateId: string, name: string): Promise<UserTemplateSummary | null>
  archiveTemplate(templateId: string): Promise<UserTemplateSummary | null>
  restoreTemplate(templateId: string): Promise<UserTemplateSummary | null>
  purgeTemplate(templateId: string): Promise<void>
  saveAutosave(args: RuntimeStoreSaveWorkingCopyArgs): Promise<CanvasWorkingCopyIndexEntry>
  replaceWorkingCopy(args: RuntimeStoreSaveWorkingCopyArgs): Promise<CanvasWorkingCopyIndexEntry>
  loadWorkingCopy(source: CanvasDraftSource): Promise<CanvasWorkingCopyIndexEntry | null>
  clearWorkingCopy(source: CanvasDraftSource): Promise<void>
  clearTemplateAutosaves(templateId: string): Promise<void>
  loadAppSettings(): Promise<RuntimeStoreAppSettings>
  saveAppSettings(
    updater:
      | Partial<Omit<RuntimeStoreAppSettings, "version" | "updatedAt">>
      | ((
          current: RuntimeStoreAppSettings
        ) => Partial<Omit<RuntimeStoreAppSettings, "version" | "updatedAt">>)
  ): Promise<RuntimeStoreAppSettings>
  exportSnapshot(): Promise<RuntimeStoreSnapshot>
  replaceSnapshot(snapshot: RuntimeStoreSnapshot): Promise<void>
  isEmpty(): Promise<boolean>
  resetForTest(): Promise<void>
}
