// @vitest-environment jsdom

import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import type { DataDirectoryStatus } from "./data-directory-types.js"
import { SystemDataStorageCard } from "./system-data-storage-card.js"

let mountedRoot: ReturnType<typeof ReactDOM.createRoot> | null = null

async function flush(times = 2): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

async function renderNode(node: React.ReactNode) {
  document.body.innerHTML = '<div id="root"></div>'
  const rootElement = document.getElementById("root")
  if (!rootElement) {
    throw new Error("Missing root element")
  }
  await act(async () => {
    mountedRoot = ReactDOM.createRoot(rootElement)
    mountedRoot.render(node)
    await flush(4)
  })
}

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => {
      mountedRoot?.unmount()
      await flush()
    })
  }
  mountedRoot = null
  document.body.innerHTML = ""
})

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
  leaseExpiresAt: null,
  runtimeSummary: {
    exportedAt: new Date().toISOString(),
    snapshotUpdatedAt: new Date().toISOString(),
    templates: 2,
    versions: 5,
    workingCopies: 3,
  },
}

function renderCard(overrides: Partial<React.ComponentProps<typeof SystemDataStorageCard>> = {}) {
  return renderNode(
    <SystemDataStorageCard
      busy={null}
      dialog={null}
      status={baseStatus}
      onCancelDialog={() => undefined}
      onChooseDirectory={() => undefined}
      onConfirmAttachment={() => undefined}
      onConfirmImport={() => undefined}
      onConfirmRestore={() => undefined}
      onCreateBackup={() => undefined}
      onExportArchive={() => undefined}
      onInspectImportArchive={() => undefined}
      onInspectRestoreBackup={() => undefined}
      onRequestPermission={() => undefined}
      onSyncNow={() => undefined}
      onTakeOverWrites={() => undefined}
      {...overrides}
    />
  )
}

describe("SystemDataStorageCard", () => {
  it("renders the unconfigured state with data management actions", async () => {
    await renderCard()

    expect(document.body.textContent).toContain("未配置")
    expect(document.body.textContent).toContain("SQLite + OPFS")
    expect(document.body.textContent).toContain("导出数据")
    expect(document.body.textContent).toContain("导入数据")
  })

  it("shows a follower warning when another tab owns the write lease", async () => {
    await renderCard({
      status: {
        ...baseStatus,
        configured: true,
        directoryName: "TuckmarkData",
        permissionState: "granted",
        health: "healthy",
        leaseRole: "follower",
      },
    })

    expect(document.body.textContent).toContain("当前标签不是写入者")
    expect(document.body.textContent).toContain("接管写入")
  })

  it("renders the import confirmation summary dialog", async () => {
    await renderCard({
      dialog: {
        kind: "import-confirm",
        inspection: {
          label: "runtime-export.zip",
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
              showTextBoundingBoxes: false,
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
    })

    expect(document.body.textContent).toContain("确认导入整库数据")
    expect(document.body.textContent).toContain("runtime-export.zip")
    expect(document.body.textContent).toContain("4 模板 / 12 版本 / 2 草稿")
  })
})
