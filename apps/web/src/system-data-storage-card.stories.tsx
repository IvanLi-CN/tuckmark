import type { Meta, StoryObj } from "@storybook/react-vite"
import type { DataDirectoryStatus } from "./data-directory-types.js"
import { SystemDataStorageCard } from "./system-data-storage-card.js"

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
  leaseExpiresAt: new Date(Date.now() + 15_000).toISOString(),
  runtimeSummary: {
    exportedAt: new Date().toISOString(),
    snapshotUpdatedAt: new Date().toISOString(),
    templates: 3,
    versions: 9,
    workingCopies: 4,
  },
}

const meta = {
  title: "Tuckmark/System/Data Storage Card",
  component: SystemDataStorageCard,
  parameters: {
    layout: "padded",
  },
  args: {
    busy: null,
    dialog: null,
    status: baseStatus,
    onCancelDialog: () => undefined,
    onChooseDirectory: () => undefined,
    onConfirmAttachment: () => undefined,
    onConfirmImport: () => undefined,
    onConfirmRestore: () => undefined,
    onCreateBackup: () => undefined,
    onExportArchive: () => undefined,
    onInspectImportArchive: () => undefined,
    onInspectRestoreBackup: () => undefined,
    onRequestPermission: () => undefined,
    onSyncNow: () => undefined,
    onTakeOverWrites: () => undefined,
  },
} satisfies Meta<typeof SystemDataStorageCard>

export default meta

type Story = StoryObj<typeof meta>

export const Unsupported: Story = {
  args: {
    status: {
      ...baseStatus,
      supported: false,
      permissionState: "unsupported",
      health: "unsupported",
      leaseRole: "unsupported",
    },
  },
}

export const Unconfigured: Story = {
  args: {
    status: baseStatus,
  },
}

export const ConfiguredHealthy: Story = {
  args: {
    status: {
      ...baseStatus,
      configured: true,
      directoryName: "TuckmarkData",
      permissionState: "granted",
      health: "healthy",
      manifest: {
        schema: "tuckmark.data-dir-manifest.v1",
        generatedAt: new Date().toISOString(),
        snapshotUpdatedAt: new Date().toISOString(),
        source: "runtime-sync",
        files: {
          settings: "settings/app-settings.json",
          templatesDir: "templates",
          draftsDir: "drafts",
          backupsDir: "backups",
        },
        counts: {
          templates: 3,
          versions: 9,
          workingCopies: 4,
        },
      },
      lastSyncAt: new Date().toISOString(),
    },
  },
}

export const DirectoryAttachChoice: Story = {
  args: {
    status: baseStatus,
    dialog: {
      kind: "attach-choice",
      handle: {} as FileSystemDirectoryHandle,
      inspection: {
        kind: "existing",
        handleName: "WarehouseData",
        manifest: {
          schema: "tuckmark.data-dir-manifest.v1",
          generatedAt: new Date().toISOString(),
          snapshotUpdatedAt: new Date().toISOString(),
          source: "runtime-sync",
          files: {
            settings: "settings/app-settings.json",
            templatesDir: "templates",
            draftsDir: "drafts",
            backupsDir: "backups",
          },
          counts: {
            templates: 8,
            versions: 24,
            workingCopies: 6,
          },
        },
      },
    },
  },
}

export const BackupList: Story = {
  args: {
    status: {
      ...baseStatus,
      configured: true,
      directoryName: "TuckmarkData",
      permissionState: "granted",
      health: "healthy",
      manifest: {
        schema: "tuckmark.data-dir-manifest.v1",
        generatedAt: new Date().toISOString(),
        snapshotUpdatedAt: new Date().toISOString(),
        source: "runtime-sync",
        files: {
          settings: "settings/app-settings.json",
          templatesDir: "templates",
          draftsDir: "drafts",
          backupsDir: "backups",
        },
        counts: {
          templates: 3,
          versions: 9,
          workingCopies: 4,
        },
      },
      lastSyncAt: new Date().toISOString(),
      backups: [
        {
          kind: "manual",
          name: "backup-2026-07-14T09-15-00.000Z.zip",
          path: "backups/manual/backup-2026-07-14T09-15-00.000Z.zip",
          modifiedAt: new Date().toISOString(),
          size: 24_500,
        },
        {
          kind: "protection",
          name: "protection-2026-07-14T08-55-00.000Z.zip",
          path: "backups/protection/protection-2026-07-14T08-55-00.000Z.zip",
          modifiedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
          size: 22_200,
        },
      ],
    },
  },
}

export const ImportConfirm: Story = {
  args: {
    status: baseStatus,
    dialog: {
      kind: "import-confirm",
      inspection: {
        label: "tuckmark-export-2026-07-14.zip",
        snapshot: {
          schema: "tuckmark.runtime-export.v1",
          exportedAt: new Date().toISOString(),
          snapshotUpdatedAt: new Date().toISOString(),
          settings: {
            version: 1,
            updatedAt: new Date().toISOString(),
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
        summary: {
          exportedAt: new Date().toISOString(),
          snapshotUpdatedAt: new Date().toISOString(),
          templates: 5,
          versions: 18,
          workingCopies: 3,
        },
      },
    },
  },
}

export const RestoreConfirm: Story = {
  args: {
    status: {
      ...baseStatus,
      configured: true,
      directoryName: "TuckmarkData",
      permissionState: "granted",
      health: "healthy",
      manifest: null,
      backups: [
        {
          kind: "manual",
          name: "backup-2026-07-14T09-15-00.000Z.zip",
          path: "backups/manual/backup-2026-07-14T09-15-00.000Z.zip",
          modifiedAt: new Date().toISOString(),
          size: 24_500,
        },
      ],
    },
    dialog: {
      kind: "restore-confirm",
      entry: {
        kind: "manual",
        name: "backup-2026-07-14T09-15-00.000Z.zip",
        path: "backups/manual/backup-2026-07-14T09-15-00.000Z.zip",
        modifiedAt: new Date().toISOString(),
        size: 24_500,
      },
      inspection: {
        label: "backup-2026-07-14T09-15-00.000Z.zip",
        snapshot: {
          schema: "tuckmark.runtime-export.v1",
          exportedAt: new Date().toISOString(),
          snapshotUpdatedAt: new Date().toISOString(),
          settings: {
            version: 1,
            updatedAt: new Date().toISOString(),
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
        summary: {
          exportedAt: new Date().toISOString(),
          snapshotUpdatedAt: new Date().toISOString(),
          templates: 4,
          versions: 12,
          workingCopies: 2,
        },
      },
    },
  },
}

export const PermissionDenied: Story = {
  args: {
    status: {
      ...baseStatus,
      configured: true,
      directoryName: "TuckmarkData",
      permissionState: "prompt",
      health: "permission-required",
      lastError: "需要先授予数据目录读写权限。",
    },
  },
}
