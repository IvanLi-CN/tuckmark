// @vitest-environment jsdom

import { strFromU8, unzipSync } from "fflate"
import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { DataDirectoryStatus } from "./data-directory-types.js"

const devdDataClientMocks = vi.hoisted(() => ({
  exportArchive: vi.fn(),
}))

vi.mock("./devd-data-client.js", () => ({
  devdDataClient: devdDataClientMocks,
  isServerHttpDataSurface: () => false,
}))

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
    materials: 1,
    adjustments: 2,
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
      onConfirmForcedReplacement={() => undefined}
      onCreateBackup={() => undefined}
      onExportArchive={() => undefined}
      onInspectImportArchive={() => undefined}
      onInspectRestoreBackup={() => undefined}
      onRequestPermission={() => undefined}
      onOpenForceReplacementConfirmation={() => undefined}
      onRetryPendingDrafts={() => undefined}
      onSyncNow={() => undefined}
      onTakeOverWrites={() => undefined}
      {...overrides}
    />
  )
}

function getActionToolbar(label: string): HTMLElement {
  const toolbar = document.querySelector<HTMLElement>(`[role="toolbar"][aria-label="${label}"]`)
  if (!toolbar) {
    throw new Error(`Missing ${label}`)
  }
  return toolbar
}

function expectStandardActionButtons(toolbar: HTMLElement, names: string[]): void {
  const buttons = Array.from(toolbar.querySelectorAll("button"))
  expect(buttons.map((button) => button.textContent?.trim())).toEqual(names)
  expect(buttons.every((button) => button.classList.contains("tm-action-button__control"))).toBe(
    true
  )
}

describe("SystemDataStorageCard", () => {
  it("renders the unconfigured state with data management actions", async () => {
    await renderCard()

    expect(document.body.textContent).toContain("未配置")
    expect(document.body.textContent).toContain("统一数据目录，承载模板与库存 JSON 数据树")
    expect(document.body.textContent).toContain("导出 ZIP 数据")
    expect(document.body.textContent).toContain("导入 ZIP 数据")
    expectStandardActionButtons(getActionToolbar("浏览器数据维护操作"), [
      "授权目录",
      "重新请求权限",
      "立即同步",
      "立即备份",
      "导出 ZIP 数据",
      "导入 ZIP 数据",
    ])
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

  it("renders DEVD ownership without browser directory controls", async () => {
    await renderCard({
      status: {
        ...baseStatus,
        owner: "devd",
        configured: true,
        directoryName: "tuckmark-fixture",
        permissionState: "granted",
        health: "healthy",
        revision: 17,
        connectionState: "connected",
        leaseRole: "unsupported",
      },
    })

    expect(document.body.textContent).toContain("DEVD 数据存储")
    expect(document.body.textContent).toContain("tuckmark-fixture")
    expect(document.body.textContent).toContain("17")
    expect(document.body.textContent).toContain("已连接")
    expect(document.body.textContent).not.toContain("授权目录")
    expect(document.body.textContent).not.toContain("重新请求权限")
    expect(document.body.textContent).not.toContain("接管写入")
    expect(document.body.textContent).not.toContain("立即同步")
    expectStandardActionButtons(getActionToolbar("DEVD 数据维护操作"), [
      "立即备份",
      "导出 ZIP 数据",
      "导入 ZIP 数据",
    ])
  })

  it("uses the shared ZIP archive contract for DEVD imports", async () => {
    await renderCard({
      status: {
        ...baseStatus,
        owner: "devd",
        configured: true,
        directoryName: "tuckmark-fixture",
        permissionState: "granted",
        health: "healthy",
        revision: 17,
        connectionState: "connected",
        leaseRole: "unsupported",
      },
    })

    const importInput = document.querySelector('input[type="file"]')
    expect(importInput?.getAttribute("accept")).toBe(".zip,application/zip")
    expect(document.body.textContent).toContain("导出 ZIP 数据")
    expect(document.body.textContent).toContain("导入 ZIP 数据")
  })

  it("downloads DEVD archives as the v0.9.2-compatible ZIP tree", async () => {
    const archive = {
      exportedAt: "2026-08-01T00:00:00.000Z",
      runtime: {
        schema: "tuckmark.runtime-export.v1" as const,
        exportedAt: "2026-08-01T00:00:00.000Z",
        snapshotUpdatedAt: null,
        settings: {
          version: 2 as const,
          updatedAt: "2026-08-01T00:00:00.000Z",
          documentDefaults: { paperType: "gap" as const, threshold: 128 },
          printerModelPresets: {},
          printerDeviceCalibrations: {},
          permissionNudgeSeen: true,
          showTextBoundingBoxes: false,
        },
        templates: [],
        versions: [],
        workingCopies: [],
      },
      inventory: { materials: [], adjustments: [] },
    }
    devdDataClientMocks.exportArchive.mockResolvedValue(archive)
    const createObjectUrl = vi.fn((_: Blob) => "blob:tuckmark-test")
    const revokeObjectUrl = vi.fn()
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectUrl },
      revokeObjectURL: { configurable: true, value: revokeObjectUrl },
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)

    await renderCard({
      status: {
        ...baseStatus,
        owner: "devd",
        configured: true,
        directoryName: "tuckmark-fixture",
        permissionState: "granted",
        health: "healthy",
        revision: 17,
        connectionState: "connected",
        leaseRole: "unsupported",
      },
    })

    const exportButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("导出 ZIP 数据")
    )
    if (!exportButton) {
      throw new Error("Missing DEVD ZIP export button")
    }
    await act(async () => {
      exportButton.click()
      await flush(4)
    })

    expect(devdDataClientMocks.exportArchive).toHaveBeenCalledTimes(1)
    const exportedBlob = createObjectUrl.mock.calls[0]?.[0]
    if (!exportedBlob) {
      throw new Error("Missing DEVD ZIP export blob")
    }
    expect(exportedBlob.type).toBe("application/zip")
    const entries = unzipSync(new Uint8Array(await exportedBlob.arrayBuffer()))
    expect(Object.keys(entries).sort()).toEqual([
      "archive.json",
      "manifest.json",
      "settings/app-settings.json",
    ])
    expect(JSON.parse(strFromU8(entries["archive.json"] ?? new Uint8Array()))).toMatchObject({
      schema: "tuckmark.runtime-export-archive.v1",
      exportedAt: archive.exportedAt,
    })
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:tuckmark-test")
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
              version: 2,
              updatedAt: new Date().toISOString(),
              documentDefaults: {
                paperType: "gap",
                threshold: 128,
              },
              printerModelPresets: {},
              printerDeviceCalibrations: {},
              permissionNudgeSeen: true,
              showTextBoundingBoxes: false,
            },
            templates: [],
            versions: [],
            workingCopies: [],
          },
          inventorySnapshot: {
            materials: [],
            adjustments: [],
          },
          summary: {
            exportedAt: new Date().toISOString(),
            snapshotUpdatedAt: new Date().toISOString(),
            templates: 4,
            versions: 12,
            workingCopies: 2,
            materials: 3,
            adjustments: 9,
          },
        },
      },
    })

    expect(document.body.textContent).toContain("确认导入整库数据")
    expect(document.body.textContent).toContain("runtime-export.zip")
    expect(document.body.textContent).toContain("4 模板 / 12 版本 / 2 草稿 / 3 物料 / 9 流水")
  })

  it("requires a second administrator confirmation before forcing data replacement", async () => {
    const openForceConfirmation = vi.fn()
    const confirmForcedReplacement = vi.fn()
    const pendingDraftDialog = {
      kind: "drafts-required" as const,
      drafts: [
        {
          label: "电源模块标签",
          source: { kind: "user-template" as const, templateId: "power-module" },
          sourceKey: "user:power-module",
          updatedAt: "2026-08-08T10:00:00.000Z",
        },
      ],
      operation: {
        kind: "import" as const,
        inspection: {} as never,
      },
    }

    await renderCard({
      dialog: pendingDraftDialog,
      onOpenForceReplacementConfirmation: openForceConfirmation,
    })

    expect(document.body.textContent).toContain("请先处理未保存草稿")
    const forceButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("管理员强制替换")
    )
    if (!forceButton) {
      throw new Error("Missing administrator force button")
    }
    await act(async () => {
      forceButton.click()
      await flush()
    })
    expect(openForceConfirmation).toHaveBeenCalledTimes(1)
    expect(confirmForcedReplacement).not.toHaveBeenCalled()

    await renderCard({
      dialog: { ...pendingDraftDialog, kind: "force-replace" },
      onConfirmForcedReplacement: confirmForcedReplacement,
    })
    const confirmButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("放弃草稿并替换")
    )
    if (!confirmButton) {
      throw new Error("Missing force replacement confirmation button")
    }
    await act(async () => {
      confirmButton.click()
      await flush()
    })
    expect(confirmForcedReplacement).toHaveBeenCalledTimes(1)
  })

  it("rechecks pending drafts without forcing replacement", async () => {
    const retryPendingDrafts = vi.fn()
    const pendingDraftDialog = {
      kind: "drafts-required" as const,
      drafts: [
        {
          label: "电源模块标签",
          source: { kind: "user-template" as const, templateId: "power-module" },
          sourceKey: "user:power-module",
          updatedAt: "2026-08-08T10:00:00.000Z",
        },
      ],
      operation: {
        kind: "import" as const,
        inspection: {} as never,
      },
    }

    await renderCard({
      dialog: pendingDraftDialog,
      onRetryPendingDrafts: retryPendingDrafts,
    })

    const retryButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("重新检查并继续")
    )
    if (!retryButton) {
      throw new Error("Missing pending draft retry button")
    }
    await act(async () => {
      retryButton.click()
      await flush()
    })
    expect(retryPendingDrafts).toHaveBeenCalledTimes(1)
  })

  it("opens the matching draft in the restricted processing layout", async () => {
    const focus = vi.fn()
    const openWindow = vi.spyOn(window, "open").mockReturnValue({ focus } as unknown as Window)
    const pendingDraftDialog = {
      kind: "drafts-required" as const,
      drafts: [
        {
          label: "电源模块标签",
          source: { kind: "user-template" as const, templateId: "power-module" },
          sourceKey: "user:power-module",
          updatedAt: "2026-08-08T10:00:00.000Z",
        },
      ],
      operation: {
        kind: "import" as const,
        inspection: {} as never,
      },
    }

    await renderCard({ dialog: pendingDraftDialog })

    const processButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("去处理")
    )
    if (!processButton) {
      throw new Error("Missing draft processing button")
    }
    await act(async () => {
      processButton.click()
      await flush()
    })
    const [launchPath, target] = openWindow.mock.calls[0] ?? []
    const launchUrl = new URL(String(launchPath), window.location.origin)
    expect(target).toBe("_blank")
    expect(decodeURIComponent(launchUrl.searchParams.get("__tuckmark_redirect__") ?? "")).toBe(
      "/canvas/draft-processing?source=user-template&templateId=power-module"
    )
    expect(focus).toHaveBeenCalledTimes(1)
  })
})
