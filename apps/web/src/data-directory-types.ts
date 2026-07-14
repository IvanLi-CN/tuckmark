import type { RuntimeStoreSnapshot } from "./runtime-store-contract.js"

export type DataDirectoryManifestV1 = {
  schema: "tuckmark.data-dir-manifest.v1"
  generatedAt: string
  snapshotUpdatedAt: string | null
  source: "runtime-sync" | "backup-archive"
  files: {
    settings: string
    templatesDir: string
    draftsDir: string
    backupsDir: string
  }
  counts: {
    templates: number
    versions: number
    workingCopies: number
  }
}

export type RuntimeExportArchiveV1 = {
  schema: "tuckmark.runtime-export-archive.v1"
  exportedAt: string
  snapshot: RuntimeStoreSnapshot
}

export type DataDirectoryBackupEntry = {
  kind: "manual" | "protection"
  name: string
  path: string
  modifiedAt: string
  size: number
}

export type DataDirectoryAttachmentInspection =
  | {
      kind: "empty"
      handleName: string
      entryCount: number
    }
  | {
      kind: "existing"
      handleName: string
      manifest: DataDirectoryManifestV1
    }

export type DataDirectoryPermissionState =
  | "unsupported"
  | "unconfigured"
  | "prompt"
  | "granted"
  | "denied"

export type RuntimeSnapshotSummary = {
  exportedAt: string
  snapshotUpdatedAt: string | null
  templates: number
  versions: number
  workingCopies: number
}

export type DataDirectoryHealth =
  | "unsupported"
  | "unconfigured"
  | "permission-required"
  | "healthy"
  | "error"

export type DataDirectoryStatus = {
  supported: boolean
  configured: boolean
  directoryName: string | null
  permissionState: DataDirectoryPermissionState
  health: DataDirectoryHealth
  manifest: DataDirectoryManifestV1 | null
  lastSyncAt: string | null
  lastError: string | null
  backups: DataDirectoryBackupEntry[]
  leaseRole: "writer" | "follower" | "unsupported"
  leaseExpiresAt: string | null
  runtimeSummary: RuntimeSnapshotSummary
}
