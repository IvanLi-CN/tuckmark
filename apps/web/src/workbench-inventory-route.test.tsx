// @vitest-environment jsdom

import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

const inventoryStoreMocks = vi.hoisted(() => ({
  applyInventoryMaterialAdjustment: vi.fn(),
  archiveInventoryMaterial: vi.fn(),
  deleteInventoryMaterial: vi.fn(),
  getInventoryDataDirectoryReady: vi.fn(),
  listInventoryAdjustments: vi.fn(),
  listInventoryMaterials: vi.fn(),
  restoreInventoryMaterial: vi.fn(),
  saveInventoryMaterial: vi.fn(),
}))

vi.mock("./inventory-data-store.js", () => inventoryStoreMocks)

vi.mock("./workbench-app.js", () => ({
  EmptyMini: ({ text }: { text: string }) => <div>{text}</div>,
  PaneHeader: ({ title }: { title: string }) => <div>{title}</div>,
  createTemplatePrintSource: vi.fn(),
  createUserTemplatePrintSource: vi.fn(),
}))

vi.mock("./user-template-store.js", () => ({
  loadWorkingCopy: vi.fn().mockResolvedValue(null),
  readUserTemplateHistory: vi.fn().mockResolvedValue(null),
}))

vi.mock("./workbench-navigation.js", () => ({
  useWorkbenchNavigate: () => vi.fn(),
}))

import WorkbenchInventoryRoute from "./workbench-inventory-route.js"

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
    await flush(6)
  })
}

async function rerenderNode(node: React.ReactNode) {
  if (!mountedRoot) {
    throw new Error("Missing mounted root")
  }
  await act(async () => {
    mountedRoot?.render(node)
    await flush(6)
  })
}

function createInventoryRouteNode(controller: Record<string, unknown>, path = "/inventory") {
  const materialId = path.startsWith("/inventory/")
    ? decodeURIComponent(path.slice("/inventory/".length))
    : undefined
  return <WorkbenchInventoryRoute controller={controller as never} materialId={materialId} />
}

function createController(overrides: Record<string, unknown> = {}) {
  return {
    chooseDataDirectory: vi.fn(),
    inventoryStoryState: null,
    printSourceDirect: vi.fn(),
    renderOptions: {
      paperType: "continuous",
      printWidthDots: 384,
      threshold: 128,
      xOffsetDots: 0,
    },
    startupSyncReady: true,
    templates: [],
    userTemplates: [],
    ...overrides,
  }
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
  vi.clearAllMocks()
})

describe("WorkbenchInventoryRoute", () => {
  it("waits for startup readiness before scanning the inventory directory", async () => {
    const controller = createController({ startupSyncReady: false })

    await renderNode(createInventoryRouteNode(controller))

    expect(inventoryStoreMocks.listInventoryMaterials).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("正在初始化库存工作台")
  })

  it("loads materials first and then loads adjustments after startup is ready", async () => {
    inventoryStoreMocks.listInventoryMaterials.mockResolvedValue([
      {
        id: "inventory-material-1",
        fullName: "TPS62933DRLR",
        baseName: "TPS62933",
        variantName: "DRLR",
        packageName: "SOT-583",
        description: "同步降压 28V",
        matrixCode: "P2-Y404125469",
        packagingRemark: "编带一盘 3000pcs",
        currentQuantity: 128,
        createdAt: "2026-07-20T09:00:00.000Z",
        updatedAt: "2026-07-20T10:30:00.000Z",
        archivedAt: null,
        labelBindings: [],
      },
    ])
    inventoryStoreMocks.listInventoryAdjustments.mockResolvedValue([
      {
        id: "inventory-adjustment-1",
        materialId: "inventory-material-1",
        kind: "in",
        quantityDelta: 4,
        targetQuantity: null,
        quantityAfter: 128,
        note: "补货",
        actor: "web",
        createdAt: "2026-07-20T10:32:00.000Z",
      },
    ])

    const controller = createController({ startupSyncReady: false })
    await renderNode(createInventoryRouteNode(controller, "/inventory/inventory-material-1"))

    await rerenderNode(
      createInventoryRouteNode(
        createController({ startupSyncReady: true }),
        "/inventory/inventory-material-1"
      )
    )

    expect(inventoryStoreMocks.listInventoryMaterials).toHaveBeenCalledTimes(1)
    expect(inventoryStoreMocks.listInventoryAdjustments).toHaveBeenCalledWith(
      "inventory-material-1"
    )
    expect(document.body.textContent).toContain("TPS62933DRLR")
  })

  it("keeps the inventory page free of data-directory setup prompts", async () => {
    inventoryStoreMocks.listInventoryMaterials.mockResolvedValue([])

    await renderNode(
      createInventoryRouteNode(createController({ startupSyncReady: true }))
    )

    expect(document.body.textContent).toContain("还没有库存物料。")
    expect(document.body.textContent).not.toContain("配置数据目录")
    expect(document.body.textContent).not.toContain("本地数据目录未就绪")
  })

  it("renders the material detail page when opened with a material route", async () => {
    inventoryStoreMocks.listInventoryMaterials.mockResolvedValue([
      {
        id: "inventory-material-1",
        fullName: "TPS62933DRLR",
        baseName: "TPS62933",
        variantName: "DRLR",
        packageName: "SOT-583",
        description: "同步降压 28V",
        matrixCode: "P2-Y404125469",
        packagingRemark: "编带一盘 3000pcs",
        currentQuantity: 128,
        createdAt: "2026-07-20T09:00:00.000Z",
        updatedAt: "2026-07-20T10:30:00.000Z",
        archivedAt: null,
        labelBindings: [],
      },
    ])
    inventoryStoreMocks.listInventoryAdjustments.mockResolvedValue([])

    await renderNode(
      createInventoryRouteNode(createController({ startupSyncReady: true }), "/inventory/inventory-material-1")
    )

    expect(document.body.textContent).toContain("返回列表")
    expect(document.body.textContent).toContain("库存详情")
    expect(document.body.textContent).toContain("物料信息")
    expect(document.body.textContent).toContain("标签模板关联")
    expect(document.body.textContent).toContain("库存调整")
    expect(document.body.textContent).toContain("手动打印标签")
  })
})
