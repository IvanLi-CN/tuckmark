import type { Meta, StoryObj } from "@storybook/react-vite"
import { SystemDataStorageCard } from "./system-data-storage-card.js"
import {
  createBackupListDataDirectoryStatus,
  createConfiguredHealthyDataDirectoryStatus,
  createDirectoryAttachChoiceDialog,
  createImportConfirmDialog,
  createPermissionDeniedDataDirectoryStatus,
  createRestoreConfirmDialog,
  createUnconfiguredDataDirectoryStatus,
  createUnsupportedDataDirectoryStatus,
} from "./system-data-storage-story-fixtures.js"

const meta = {
  title: "Tuckmark/System/Data Storage Card",
  component: SystemDataStorageCard,
  parameters: {
    layout: "padded",
  },
  args: {
    busy: null,
    dialog: null,
    status: createUnconfiguredDataDirectoryStatus(),
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
    status: createUnsupportedDataDirectoryStatus(),
  },
}

export const Unconfigured: Story = {
  args: {
    status: createUnconfiguredDataDirectoryStatus(),
  },
}

export const ConfiguredHealthy: Story = {
  args: {
    status: createConfiguredHealthyDataDirectoryStatus(),
  },
}

export const DirectoryAttachChoice: Story = {
  args: {
    status: createUnconfiguredDataDirectoryStatus(),
    dialog: createDirectoryAttachChoiceDialog(),
  },
}

export const BackupList: Story = {
  args: {
    status: createBackupListDataDirectoryStatus(),
  },
}

export const ImportConfirm: Story = {
  args: {
    status: createUnconfiguredDataDirectoryStatus(),
    dialog: createImportConfirmDialog(),
  },
}

export const RestoreConfirm: Story = {
  args: {
    status: {
      ...createConfiguredHealthyDataDirectoryStatus(),
      manifest: null,
      backups: [createBackupListDataDirectoryStatus().backups[0]],
    },
    dialog: createRestoreConfirmDialog(),
  },
}

export const PermissionDenied: Story = {
  args: {
    status: createPermissionDeniedDataDirectoryStatus(),
  },
}
