import type { DataArchiveInspection } from "./data-directory-service.js"
import type {
  DataDirectoryAttachmentInspection,
  DataDirectoryBackupEntry,
  DataDirectoryManifestV1,
  DataDirectoryStatus,
  RuntimeExportArchiveV1,
  RuntimeSnapshotSummary,
} from "./data-directory-types.js"
import type { WorkbenchDataDirectoryDialogState } from "./workbench-controller.js"

const STORY_TIMESTAMP = "2026-07-14T22:03:00.000Z"
const STORY_BACKUP_TIMESTAMP = "2026-07-14T09:15:00.000Z"
const STORY_PROTECTION_TIMESTAMP = "2026-07-14T08:55:00.000Z"
const STORY_EXPORT_LABEL = "tuckmark-export-2026-07-14.zip"
const STORY_BACKUP_NAME = "backup-2026-07-14T09-15-00.000Z.zip"
const STORY_PROTECTION_NAME = "protection-2026-07-14T08-55-00.000Z.zip"

function clone<T>(value: T): T {
  return structuredClone(value)
}

function createManifest(counts: DataDirectoryManifestV1["counts"]): DataDirectoryManifestV1 {
  return {
    schema: "tuckmark.data-dir-manifest.v1",
    generatedAt: STORY_TIMESTAMP,
    snapshotUpdatedAt: STORY_TIMESTAMP,
    source: "runtime-sync",
    files: {
      settings: "settings/app-settings.json",
      templatesDir: "templates",
      draftsDir: "drafts",
      backupsDir: "backups",
    },
    counts,
  }
}

function createRuntimeSummary(counts: RuntimeSnapshotSummary): RuntimeSnapshotSummary {
  return {
    exportedAt: counts.exportedAt,
    snapshotUpdatedAt: counts.snapshotUpdatedAt,
    templates: counts.templates,
    versions: counts.versions,
    workingCopies: counts.workingCopies,
  }
}

function createArchiveInspection(
  label: string,
  summary: RuntimeSnapshotSummary
): DataArchiveInspection {
  return {
    label,
    snapshot: {
      schema: "tuckmark.runtime-export.v1" as RuntimeExportArchiveV1["snapshot"]["schema"],
      exportedAt: STORY_TIMESTAMP,
      snapshotUpdatedAt: STORY_TIMESTAMP,
      settings: {
        version: 1,
        updatedAt: STORY_TIMESTAMP,
        defaultRenderOptions: {
          printWidthDots: 384,
          paperType: "gap",
          threshold: 128,
          xOffsetDots: 0,
        },
        permissionNudgeSeen: true,
      },
      templates: [],
      versions: [],
      workingCopies: [],
    },
    summary,
  }
}

function createBackupEntry(kind: "manual" | "protection"): DataDirectoryBackupEntry {
  const isManual = kind === "manual"
  const name = isManual ? STORY_BACKUP_NAME : STORY_PROTECTION_NAME
  const timestamp = isManual ? STORY_BACKUP_TIMESTAMP : STORY_PROTECTION_TIMESTAMP
  return {
    kind,
    name,
    path: `backups/${kind}/${name}`,
    modifiedAt: timestamp,
    size: isManual ? 24_500 : 22_200,
  }
}

const baseStatus: DataDirectoryStatus = {
  supported: true,
  configured: false,
  directoryName: null,
  permissionState: "unconfigured",
  health: "unconfigured",
  manifest: null,
  lastSyncAt: null,
  lastError: null,
  backups: [],
  leaseRole: "writer",
  leaseExpiresAt: "2026-07-14T22:03:15.000Z",
  runtimeSummary: createRuntimeSummary({
    exportedAt: STORY_TIMESTAMP,
    snapshotUpdatedAt: STORY_TIMESTAMP,
    templates: 3,
    versions: 9,
    workingCopies: 4,
  }),
}

export function createUnsupportedDataDirectoryStatus(): DataDirectoryStatus {
  return {
    ...clone(baseStatus),
    supported: false,
    permissionState: "unsupported",
    health: "unsupported",
    leaseRole: "unsupported",
    leaseExpiresAt: null,
  }
}

export function createUnconfiguredDataDirectoryStatus(): DataDirectoryStatus {
  return clone(baseStatus)
}

export function createConfiguredHealthyDataDirectoryStatus(): DataDirectoryStatus {
  return {
    ...clone(baseStatus),
    configured: true,
    directoryName: "TuckmarkData",
    permissionState: "granted",
    health: "healthy",
    manifest: createManifest({
      templates: 3,
      versions: 9,
      workingCopies: 4,
    }),
    lastSyncAt: STORY_TIMESTAMP,
  }
}

export function createBackupListDataDirectoryStatus(): DataDirectoryStatus {
  return {
    ...createConfiguredHealthyDataDirectoryStatus(),
    backups: [createBackupEntry("manual"), createBackupEntry("protection")],
  }
}

export function createPermissionDeniedDataDirectoryStatus(): DataDirectoryStatus {
  return {
    ...clone(baseStatus),
    configured: true,
    directoryName: "TuckmarkData",
    permissionState: "prompt",
    health: "permission-required",
    lastError: "需要先授予数据目录读写权限。",
  }
}

export function createDirectoryAttachChoiceDialog(): WorkbenchDataDirectoryDialogState {
  const inspection: DataDirectoryAttachmentInspection = {
    kind: "existing",
    handleName: "WarehouseData",
    manifest: createManifest({
      templates: 8,
      versions: 24,
      workingCopies: 6,
    }),
  }
  return {
    kind: "attach-choice",
    handle: {} as FileSystemDirectoryHandle,
    inspection,
  }
}

export function createImportConfirmDialog(): WorkbenchDataDirectoryDialogState {
  return {
    kind: "import-confirm",
    inspection: createArchiveInspection(STORY_EXPORT_LABEL, {
      exportedAt: STORY_TIMESTAMP,
      snapshotUpdatedAt: STORY_TIMESTAMP,
      templates: 5,
      versions: 18,
      workingCopies: 3,
    }),
  }
}

export function createRestoreConfirmDialog(): WorkbenchDataDirectoryDialogState {
  const entry = createBackupEntry("manual")
  return {
    kind: "restore-confirm",
    entry,
    inspection: createArchiveInspection(entry.name, {
      exportedAt: STORY_TIMESTAMP,
      snapshotUpdatedAt: STORY_TIMESTAMP,
      templates: 4,
      versions: 12,
      workingCopies: 2,
    }),
  }
}
