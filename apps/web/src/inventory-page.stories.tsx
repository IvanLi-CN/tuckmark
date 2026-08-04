import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within } from "storybook/test"

import type { AppContext } from "./types.js"
import { WorkbenchAppStory } from "./workbench-app.js"
import type { WorkbenchStoryStateOverrides } from "./workbench-controller.js"

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

const demoContext: AppContext = {
  apiBasePath: "",
  basePath: "",
  surface: "browser-static",
  mode: "demo",
  capabilities: {
    browserDirectPrintPath: "mocked",
    serviceApiPrintPath: "mocked",
  },
}

const materialOne = {
  id: "inventory-material-tps62933drlr",
  fullName: "TPS62933DRLR",
  baseName: "TPS62933",
  variantName: "DRLR",
  packageName: "SOT-583",
  description: "同步降压 28V",
  deviceDetails: "",
  matrixCode: "P2-Y404125469",
  packagingRemark: "编带一盘 3000pcs",
  currentQuantity: 128,
  createdAt: "2026-07-20T09:00:00.000Z",
  updatedAt: "2026-07-20T10:30:00.000Z",
  archivedAt: null,
  labelBindings: [
    {
      id: "inventory-binding-main",
      templateSource: "system" as const,
      templateId: "shipping-compact",
      templateName: "Compact Shipping Label",
      printQuantity: 1,
      fieldOverrides: {
        recipient: "TPS62933DRLR",
        address: "Moon Street 42 Shanghai",
        orderId: "P2-Y404125469",
      },
      createdAt: "2026-07-20T09:05:00.000Z",
      updatedAt: "2026-07-20T09:05:00.000Z",
    },
  ],
}

const materialTwo = {
  id: "inventory-material-xt60",
  fullName: "XT60H-F",
  baseName: "XT60H",
  variantName: "F",
  packageName: "Connector",
  description: "黄铜镀金母头",
  deviceDetails: "",
  packagingRemark: "散装备件",
  currentQuantity: 42,
  createdAt: "2026-07-19T08:00:00.000Z",
  updatedAt: "2026-07-20T11:10:00.000Z",
  archivedAt: null,
  labelBindings: [],
}

const adjustmentStoryState = {
  configured: true,
  materials: [materialOne, materialTwo],
  adjustments: [
    {
      id: "inventory-adjustment-1",
      materialId: materialOne.id,
      kind: "in" as const,
      quantityDelta: 80,
      targetQuantity: null,
      quantityAfter: 128,
      note: "补充到货",
      actor: "web",
      createdAt: "2026-07-20T09:40:00.000Z",
    },
    {
      id: "inventory-adjustment-2",
      materialId: materialOne.id,
      kind: "out" as const,
      quantityDelta: -12,
      targetQuantity: null,
      quantityAfter: 128,
      note: "装配领料",
      actor: "web",
      createdAt: "2026-07-20T10:12:00.000Z",
    },
    {
      id: "inventory-adjustment-3",
      materialId: materialOne.id,
      kind: "correction" as const,
      quantityDelta: 4,
      targetQuantity: 128,
      quantityAfter: 128,
      note: "盘点校正",
      actor: "web",
      createdAt: "2026-07-20T10:28:00.000Z",
    },
  ],
} satisfies NonNullable<WorkbenchStoryStateOverrides["inventoryStoryState"]>

const meta = {
  title: "Tuckmark/Workbench/Inventory Page",
  component: WorkbenchAppStory,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    context: runtimeContext,
    initialEntries: ["/inventory"],
  },
} satisfies Meta<typeof WorkbenchAppStory>

export default meta

type Story = StoryObj<typeof meta>

export const LocalOnlyEmptyInventory: Story = {
  args: {
    storyStateOverrides: {
      inventoryStoryState: {
        configured: false,
        materials: [],
        adjustments: [],
      },
    },
  },
}

export const EmptyInventory: Story = {
  args: {
    storyStateOverrides: {
      inventoryStoryState: {
        configured: true,
        materials: [],
        adjustments: [],
      },
    },
  },
}

export const MaterialList: Story = {
  args: {
    storyStateOverrides: {
      inventoryStoryState: {
        configured: true,
        materials: [materialOne, materialTwo],
        adjustments: [],
      },
    },
  },
}

export const EditMaterialAndBindings: Story = {
  args: {
    initialEntries: [`/inventory/${materialOne.id}`],
    storyStateOverrides: {
      inventoryStoryState: adjustmentStoryState,
    },
  },
}

export const AdjustAndPrint: Story = {
  args: {
    context: demoContext,
    initialEntries: [`/inventory/${materialOne.id}`],
    storyStateOverrides: {
      inventoryStoryState: adjustmentStoryState,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "打印当前标签" }))
    await expect(canvas.getByAltText("preview artifact")).toBeVisible()
  },
}

export const NewMaterialDetail: Story = {
  args: {
    initialEntries: ["/inventory/new"],
    storyStateOverrides: {
      inventoryStoryState: adjustmentStoryState,
    },
  },
}
