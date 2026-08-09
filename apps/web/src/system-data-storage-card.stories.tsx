import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, within } from "storybook/test"
import { SystemDataStorageCard } from "./system-data-storage-card.js"
import {
  createBackupListDataDirectoryStatus,
  createConfiguredHealthyDataDirectoryStatus,
  createDirectoryAttachChoiceDialog,
  createImportConfirmDialog,
  createPendingDraftsDialog,
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
  decorators: [
    (Story) => (
      <div style={{ minHeight: "100vh", padding: 40, background: "#d9e2e9" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    busy: null,
    dialog: null,
    status: createUnconfiguredDataDirectoryStatus(),
    onCancelDialog: () => undefined,
    onChooseDirectory: () => undefined,
    onConfirmAttachment: () => undefined,
    onConfirmImport: () => undefined,
    onConfirmRestore: () => undefined,
    onConfirmForcedReplacement: () => undefined,
    onCreateBackup: () => undefined,
    onExportArchive: () => undefined,
    onInspectImportArchive: () => undefined,
    onInspectRestoreBackup: () => undefined,
    onRequestPermission: () => undefined,
    onOpenForceReplacementConfirmation: () => undefined,
    onRetryPendingDrafts: () => undefined,
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

export const PendingDrafts: Story = {
  args: {
    dialog: createPendingDraftsDialog(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body)
    await expect(canvas.getByText("请先处理未保存草稿")).toBeVisible()
    const processButtons = canvas.getAllByRole("button", { name: "去处理" })
    await expect(processButtons).toHaveLength(2)
    await expect(canvas.getByRole("button", { name: "管理员强制替换" })).toBeVisible()
  },
}

export const PendingDraftsMobile: Story = {
  ...PendingDrafts,
  parameters: {
    viewport: {
      defaultViewport: "data-replacement-mobile",
    },
  },
  globals: {
    viewport: { value: "data-replacement-mobile", isRotated: false },
  },
}

export const ForceReplacementConfirmation: Story = {
  parameters: {
    viewport: {
      defaultViewport: "data-replacement-mobile",
    },
  },
  args: {
    dialog: createPendingDraftsDialog({ forceConfirmation: true }),
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
    const canvas = within(canvasElement)
    await expect(canvas.getByText("DEVD 数据存储")).toBeVisible()
    await expect(canvas.getByText("全局 revision")).toBeVisible()
    const toolbar = canvas.getByRole("toolbar", { name: "DEVD 数据维护操作" })
    await expect(within(toolbar).getByRole("button", { name: "立即备份" })).toHaveClass(
      "tm-action-button__control"
    )
    await expect(within(toolbar).getByRole("button", { name: "导出 ZIP 数据" })).toHaveClass(
      "tm-action-button__control"
    )
    await expect(within(toolbar).getByRole("button", { name: "导入 ZIP 数据" })).toHaveClass(
      "tm-action-button__control"
    )
    await expect(canvas.queryByText("授权目录")).not.toBeInTheDocument()
    await expect(canvas.queryByText("接管写入")).not.toBeInTheDocument()
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
