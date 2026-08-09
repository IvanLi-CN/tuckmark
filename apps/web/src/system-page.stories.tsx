import type { Meta, StoryObj } from "@storybook/react-vite"

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
import type { AppContext } from "./types.js"
import { WorkbenchAppStory } from "./workbench-app.js"

const runtimeContext: AppContext = {
  apiBasePath: "",
  basePath: "",
  surface: "browser-static",
  mode: "runtime",
  capabilities: {
    browserDirectPrintPath: "available",
    serviceApiPrintPath: "disabled",
  },
}

const meta = {
  title: "Tuckmark/Workbench/System Page",
  component: WorkbenchAppStory,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    context: runtimeContext,
    initialEntries: ["/system"],
  },
} satisfies Meta<typeof WorkbenchAppStory>

export default meta

type Story = StoryObj<typeof meta>

export const Unsupported: Story = {
  args: {
    storyStateOverrides: {
      dataDirectoryStatus: createUnsupportedDataDirectoryStatus(),
    },
  },
}

export const Unconfigured: Story = {
  args: {
    storyStateOverrides: {
      dataDirectoryStatus: createUnconfiguredDataDirectoryStatus(),
    },
  },
}

export const ConfiguredHealthy: Story = {
  args: {
    storyStateOverrides: {
      dataDirectoryStatus: createConfiguredHealthyDataDirectoryStatus(),
    },
  },
}

export const DirectoryAttachChoice: Story = {
  args: {
    storyStateOverrides: {
      dataDirectoryDialog: createDirectoryAttachChoiceDialog(),
      dataDirectoryStatus: createUnconfiguredDataDirectoryStatus(),
    },
  },
}

export const BackupList: Story = {
  args: {
    storyStateOverrides: {
      dataDirectoryStatus: createBackupListDataDirectoryStatus(),
    },
  },
}

export const ImportConfirm: Story = {
  args: {
    storyStateOverrides: {
      dataDirectoryDialog: createImportConfirmDialog(),
      dataDirectoryStatus: createUnconfiguredDataDirectoryStatus(),
    },
  },
}

export const RestoreConfirm: Story = {
  args: {
    storyStateOverrides: {
      dataDirectoryDialog: createRestoreConfirmDialog(),
      dataDirectoryStatus: {
        ...createConfiguredHealthyDataDirectoryStatus(),
        manifest: null,
        backups: [createBackupListDataDirectoryStatus().backups[0]],
      },
    },
  },
}

export const PermissionDenied: Story = {
  args: {
    storyStateOverrides: {
      dataDirectoryStatus: createPermissionDeniedDataDirectoryStatus(),
    },
  },
}
