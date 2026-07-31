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
  tags: ["autodocs"],
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

export const DevdHealthy: Story = {
  args: {
    status: {
      ...createConfiguredHealthyDataDirectoryStatus(),
      owner: "devd",
      revision: 42,
      connectionState: "connected",
      directoryName: "tuckmark-mock-data",
      permissionState: "granted",
      leaseRole: "unsupported",
    },
  },
  play: async ({ canvasElement }) => {
    const text = canvasElement.textContent ?? ""
    if (!text.includes("DEVD 数据存储") || !text.includes("全局 revision")) {
      throw new Error("DEVD status content is missing.")
    }
    if (text.includes("授权目录") || text.includes("接管写入")) {
      throw new Error("Browser directory controls leaked into the DEVD surface.")
    }
  },
}

export const DevdReconnecting: Story = {
  args: {
    status: {
      ...createConfiguredHealthyDataDirectoryStatus(),
      owner: "devd",
      revision: 42,
      connectionState: "reconnecting",
      directoryName: "tuckmark-mock-data",
      permissionState: "granted",
      leaseRole: "unsupported",
    },
  },
}

export const DevdUnavailable: Story = {
  args: {
    status: {
      ...createConfiguredHealthyDataDirectoryStatus(),
      owner: "devd",
      revision: 42,
      connectionState: "reconnecting",
      directoryName: "tuckmark-mock-data",
      health: "error",
      lastError: "DEVD 暂时无法读取数据目录。",
      permissionState: "granted",
      leaseRole: "unsupported",
    },
  },
}
