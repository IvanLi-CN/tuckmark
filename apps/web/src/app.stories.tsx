import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent, userEvent, within } from "storybook/test"

import type { ApiClient } from "./api-client.js"
import { DemoApiClient } from "./api-client.js"
import {
  createDraftFromPreset,
  getPresetById,
  toggleElementBinding,
} from "./canvas-editor-model.js"
import { fallbackTemplates } from "./demo-data.js"
import {
  clearRecentCanvasDimensions,
  recordRecentCanvasDimension,
} from "./lib/canvas-dimensions.js"
import type { PwaUpdateSnapshot } from "./pwa-lifecycle.js"
import type { AppContext } from "./types.js"
import {
  resetUserTemplateStoreForTest,
  saveUserTemplate,
  saveUserTemplateAutosave,
} from "./user-template-store.js"
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

const longTitleTemplates = fallbackTemplates.map((template, index) =>
  index === 0
    ? {
        ...template,
        name: "Compact Shipping Label For Warehouse Returns And International Forwarding",
      }
    : template
)

const longTitleDemoBaseClient = new DemoApiClient(demoContext)
const longTitleDemoClient = Object.assign(Object.create(longTitleDemoBaseClient), {
  async listTemplates() {
    return longTitleTemplates
  },
}) as ApiClient

const strandedPwaUpdateSnapshot: PwaUpdateSnapshot = {
  status: "ready",
  source: "version-probe",
  registration: null,
  waitingWorker: null,
  detectedBuildMetadata: {
    appVersion: "",
    buildRef: "e499426",
  },
  error: null,
}

const meta: Meta<typeof WorkbenchAppStory> = {
  title: "Tuckmark/Workbench",
  component: WorkbenchAppStory,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Formal Tuckmark multi-page workbench shell. Storybook uses MemoryRouter fallback while preserving the same page components and shared workbench controller.",
      },
    },
  },
}

export default meta

type Story = StoryObj<typeof WorkbenchAppStory>

async function seedUserTemplateFixtures() {
  await resetUserTemplateStoreForTest()

  const presetDraft = createDraftFromPreset(getPresetById("shipping-wide"))
  const recipientElement = presetDraft.elements.find((element) => element.kind === "text")
  const noteElement = presetDraft.elements.filter((element) => element.kind === "text")[1]
  if (!recipientElement || !noteElement) {
    return
  }

  let draft = toggleElementBinding(presetDraft, recipientElement.id, true)
  draft = toggleElementBinding(draft, noteElement.id, true)
  draft = {
    ...draft,
    name: "本地发货模板",
    fields: draft.fields.map((field, index) =>
      index === 0
        ? { ...field, label: "收件人", defaultValue: "Koha Cat" }
        : { ...field, label: "备注", defaultValue: "Handle with care" }
    ),
  }

  const saved = await saveUserTemplate({
    name: "本地发货模板",
    document: draft,
  })

  const savedDraft = structuredClone(saved.workingCopy.draft)
  savedDraft.fields = savedDraft.fields.map((field, index) =>
    index === 0 ? { ...field, defaultValue: "Warehouse Desk 7" } : field
  )
  await saveUserTemplate({
    name: "本地发货模板",
    templateId: saved.template.id,
    sourceVersionId: saved.version.id,
    document: savedDraft,
  })

  const autosaveDraft = structuredClone(savedDraft)
  autosaveDraft.fields = autosaveDraft.fields.map((field, index) =>
    index === 1 ? { ...field, defaultValue: "Auto-saved note" } : field
  )
  await saveUserTemplateAutosave({
    templateId: saved.template.id,
    source: { kind: "user-template", templateId: saved.template.id },
    document: autosaveDraft,
    sourceVersionId: saved.version.id,
  })
}

function seedDimensionFixtures() {
  clearRecentCanvasDimensions()
  recordRecentCanvasDimension({ width: 64, height: 30 })
  recordRecentCanvasDimension({ width: 48, height: 20 })
}

function getCanvasInteractionSurface(canvasElement: HTMLElement) {
  const paper = canvasElement.querySelector<HTMLElement>(".tm-stage-paper--base")
  const stage = canvasElement.querySelector<HTMLElement>(".konvajs-content")
  if (!paper || !stage) {
    throw new Error("expected canvas paper and Konva stage")
  }
  const bounds = paper.getBoundingClientRect()
  return {
    stage,
    left: bounds.left,
    top: bounds.top,
    scale: bounds.width / 384,
  }
}

function toCanvasPointer(
  surface: ReturnType<typeof getCanvasInteractionSurface>,
  xMillimeters: number,
  yMillimeters: number
) {
  return {
    clientX: surface.left + xMillimeters * 8 * surface.scale,
    clientY: surface.top + yMillimeters * 8 * surface.scale,
  }
}

export const Home: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/"],
  },
}

export const HomeWithStrandedPwaUpdate: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/"],
    pwaUpdateSnapshot: strandedPwaUpdateSnapshot,
  },
}

export const HomeSelectableContract: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/"],
  },
}

export const TemplatesWorkspace: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/templates"],
  },
  loaders: [
    async () => {
      await resetUserTemplateStoreForTest()
      return {}
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const addTemplateButtons = canvas.getAllByRole("button", { name: "新增模板" })
    await expect(addTemplateButtons).toHaveLength(2)
    await expect(addTemplateButtons[1]).toHaveClass(/tm-template-list__empty-action-button/)
    await canvas.findByRole("link", { name: "GitHub" })
    await canvas.findByText("v0.1.0")
    await canvas.findByRole("link", { name: "© 2026 Ivan Li" })
    await canvas.findByText("Service API: disabled")
    await canvas.findByText("Browser direct: available")
  },
}

export const TemplatesWorkspaceImportPackage: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/templates"],
  },
  loaders: [
    async () => {
      await resetUserTemplateStoreForTest()
      return {}
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const chooser = canvas.getByLabelText("选择模板包文件")
    const file = new File(
      [
        JSON.stringify({
          schema: "tuckmark.user-template-package.v1",
          id: "agent-ina219-bin",
          name: "INA219 模块盒",
          description: "Agent generated module storage label",
          canvas: { width: 192, height: 96 },
          fields: [
            { key: "part", label: "型号", defaultValue: "INA219", multiline: false },
            { key: "bus", label: "接口", defaultValue: "I2C", multiline: false },
          ],
          elements: [
            {
              kind: "text",
              key: "part",
              x: 10,
              y: 36,
              width: 172,
              fontSize: 24,
              fontWeight: "bold",
              align: "center",
              maxLines: 1,
              rotation: 0,
            },
            {
              kind: "text",
              key: "bus",
              x: 10,
              y: 68,
              width: 172,
              fontSize: 14,
              fontWeight: "normal",
              align: "center",
              maxLines: 1,
              rotation: 0,
            },
          ],
          sampleInput: { part: "INA219", bus: "I2C" },
          renderOptions: { paperType: "gap", printWidthDots: 384 },
        }),
      ],
      "ina219.package.json",
      { type: "application/json" }
    )

    await userEvent.upload(chooser, file)
    await canvas.findByText("INA219 模块盒")
    await canvas.findByText("已导入 INA219 模块盒")
  },
}

export const TemplatesWorkspaceWithUserTemplates: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/templates"],
  },
  loaders: [
    async () => {
      await seedUserTemplateFixtures()
      return {}
    },
  ],
}

export const TemplatesList: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/templates"],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("tab", { name: "列表" }))
  },
}

export const TemplatesListEditing: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/templates"],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("tab", { name: "列表" }))
    const [firstRecipientButton] = canvas.getAllByRole("button", { name: "Koha Cat" })
    await userEvent.click(firstRecipientButton)
  },
}

export const TemplatesSelectableEditing: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/templates"],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("tab", { name: "列表" }))
    const [firstRecipientButton] = canvas.getAllByRole("button", { name: "Koha Cat" })
    await userEvent.click(firstRecipientButton)
  },
}

export const CanvasWorkspace: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
  },
}

export const CanvasWorkspaceWide: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "wide-default",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
    docs: {
      description: {
        story:
          "New canvas text defaults to a 5.0 mm font design size; the inspector keeps the established 字号 label.",
      },
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
}

export const CanvasWorkspaceWheelNavigation: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "wide-default",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
    docs: {
      description: {
        story:
          "Coarse wheel input zooms around the pointer; fine two-axis pan gestures, horizontal wheel input, and Space + drag pan the stage.",
      },
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const paper = canvasElement.querySelector(".tm-stage-paper--base")
    const stage = canvasElement.querySelector(".konvajs-content")
    if (!(paper instanceof HTMLElement) || !stage) {
      throw new Error("Missing canvas stage surface")
    }

    const before = paper.getBoundingClientRect()
    await fireEvent.wheel(stage, { deltaY: -96 })
    const afterZoom = paper.getBoundingClientRect()

    await expect(afterZoom.width).toBeGreaterThan(before.width)

    await new Promise((resolve) => setTimeout(resolve, 150))
    await fireEvent.wheel(stage, { deltaX: 96 })
    const afterPan = paper.getBoundingClientRect()

    await expect(afterPan.width).toBeCloseTo(afterZoom.width, 1)
    await expect(afterPan.x).toBeLessThan(afterZoom.x - 80)

    await new Promise((resolve) => setTimeout(resolve, 150))
    for (const deltaY of [5, 8, 5, 4, 2, 1]) {
      await fireEvent.wheel(stage, { deltaY })
    }
    await new Promise((resolve) => setTimeout(resolve, 60))
    const afterFinePan = paper.getBoundingClientRect()

    await expect(afterFinePan.width).toBeCloseTo(afterPan.width, 1)
    await expect(afterFinePan.y).toBeLessThan(afterPan.y - 20)
  },
}

export const CanvasWorkspaceMarqueeSelection: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "marquee-selection",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
    docs: {
      description: {
        story:
          "Marquee selection chrome stays in stage space so its dashed border remains 1 logical px even at the seeded 344% zoom level.",
      },
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText("344%")
    await canvas.findByText("未选择元素")
  },
}

export const CanvasWorkspaceDimensionPicker: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "wide-default",
  },
  loaders: [
    async () => {
      seedDimensionFixtures()
      return {}
    },
  ],
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const widthInput = canvas.getByLabelText("标签宽度")
    const heightInput = canvas.getByLabelText("标签高度")
    await userEvent.clear(heightInput)
    await userEvent.clear(widthInput)
    await userEvent.type(widthInput, "64")
    await canvas.findByRole("option", { name: "64 × 30 mm" })
  },
}

export const CanvasWorkspaceSelectableDefault: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "wide-default",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
    docs: {
      description: {
        story:
          "Canvas chrome is intentionally non-selectable, while read-only metadata fields and live editors preserve copy and edit affordances.",
      },
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
}

export const CanvasWorkspaceSelectableText: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "text-selected",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
}

export const CanvasWorkspaceClipboard: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "text-ready",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
    docs: {
      description: {
        story:
          "Clipboard entry points keep duplicate semantics separate from `新副本`, while paste enters a placement mode that follows the cursor, respects the active snap grid, and reports progress through toast-style feedback instead of reflowing the pane.",
      },
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const clipboardItems: Array<{
      data: Record<string, Blob>
      getType: (type: string) => Promise<Blob>
      types: string[]
    }> = []
    const originalClipboard = navigator.clipboard
    const originalClipboardItem = window.ClipboardItem
    const originalSecureContext = Object.getOwnPropertyDescriptor(window, "isSecureContext")

    class StoryClipboardItem {
      readonly data: Record<string, Blob>
      readonly types: string[]

      constructor(data: Record<string, Blob>) {
        this.data = data
        this.types = Object.keys(data)
      }

      async getType(type: string) {
        const blob = this.data[type]
        if (!blob) {
          throw new DOMException(`Missing clipboard type: ${type}`, "NotFoundError")
        }
        return blob
      }
    }

    Object.defineProperty(navigator, "clipboard", {
      value: {
        read: async () => clipboardItems,
        write: async (items: StoryClipboardItem[]) => {
          clipboardItems.splice(0, clipboardItems.length, ...items)
        },
      },
      configurable: true,
    })
    Object.defineProperty(window, "ClipboardItem", {
      value: StoryClipboardItem,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    })

    try {
      const beforeCount = canvasElement.querySelectorAll(
        '.tm-layer-list--inspector input[aria-label$="图层名称"]'
      ).length

      await userEvent.click(canvas.getByRole("button", { name: "拷贝" }))
      await expect(canvas.findByText("已拷贝所选图层。")).resolves.toBeVisible()

      await userEvent.click(canvas.getByRole("button", { name: "粘贴" }))
      await expect(
        canvas.findByText("移动鼠标以放置，单击确认，按 Esc 取消。")
      ).resolves.toBeVisible()
      await expect(canvas.findByText("单色编辑，所见即所得。")).resolves.toBeVisible()
      await expect(
        canvasElement.querySelectorAll('.tm-layer-list--inspector input[aria-label$="图层名称"]')
          .length
      ).toBe(beforeCount + 1)
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        value: originalClipboard,
        configurable: true,
      })
      if (originalClipboardItem) {
        Object.defineProperty(window, "ClipboardItem", {
          value: originalClipboardItem,
          configurable: true,
          writable: true,
        })
      } else {
        Reflect.deleteProperty(window, "ClipboardItem")
      }
      if (originalSecureContext) {
        Object.defineProperty(window, "isSecureContext", originalSecureContext)
      } else {
        Reflect.deleteProperty(window, "isSecureContext")
      }
    }
  },
}

export const CanvasWorkspaceSnapEnabled: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "rect-selected",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
    docs: {
      description: {
        story:
          "When `吸附` is enabled, ordinary dragging and selection dragging both resolve through the same live `1mm` snap path.",
      },
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const snapButton = await canvas.findByRole("button", { name: "吸附" })
    await expect(snapButton).toHaveAttribute("aria-pressed", "true")
  },
}

export const CanvasWorkspaceMagneticSnap: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "magnetic-snap",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
    docs: {
      description: {
        story:
          "A deterministic edge-alignment setup: the selected rectangle can magnetically align to the locked, rotated reference bounds and canvas edges while `吸附` is active.",
      },
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const snapButton = await canvas.findByRole("button", { name: "吸附" })
    await expect(snapButton).toHaveAttribute("aria-pressed", "true")
    const stage = canvasElement.querySelector(".konvajs-content")
    if (!stage) {
      throw new Error("expected Konva stage content")
    }

    const stageRect = stage.getBoundingClientRect()
    const start = {
      clientX: stageRect.left + 188,
      clientY: stageRect.top + 282,
    }
    const target = {
      clientX: stageRect.left + 283,
      clientY: stageRect.top + 282,
    }

    await userEvent.pointer([
      { target: stage, coords: start },
      { keys: "[MouseLeft>]", target: stage, coords: start },
      { target: stage, coords: target },
    ])
    await expect(canvas.getByTestId("canvas-stage-shell")).toHaveAttribute("data-snap-guides", "1")

    await fireEvent.mouseUp(window, target)
    await expect(canvas.getByTestId("canvas-stage-shell")).toHaveAttribute("data-snap-guides", "0")
  },
}

export const CanvasWorkspaceTransformerBottomCenterSnap: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "text-bottom-center-snap",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
    docs: {
      description: {
        story:
          "Dragging the selected text container through its `bottom-center` handle keeps snapping and guides on the active Y axis only, even when the reference text shares the same left edge.",
      },
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const surface = getCanvasInteractionSurface(canvasElement)
    const start = toCanvasPointer(surface, 24, 10.4)
    const target = toCanvasPointer(surface, 24, 13.6)

    await userEvent.pointer([
      { target: surface.stage, coords: start },
      { keys: "[MouseLeft>]", target: surface.stage, coords: start },
      { target: surface.stage, coords: target },
    ])
    await expect(canvas.getByTestId("canvas-stage-shell")).toHaveAttribute("data-snap-guides", "1")
    await expect(canvas.getByTestId("canvas-stage-shell")).toHaveAttribute(
      "data-snap-guide-signature",
      "y:13.2:element"
    )

    await fireEvent.mouseUp(window, target)
    await expect(canvas.getByTestId("canvas-stage-shell")).toHaveAttribute("data-snap-guides", "0")
    await expect(canvas.getByTestId("canvas-stage-shell")).not.toHaveAttribute(
      "data-snap-guide-signature"
    )
  },
}

export const CanvasWorkspaceLineEndpointCenterSnap: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "line-endpoint-center-snap",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
    docs: {
      description: {
        story:
          "Line endpoints resolve direct-handle snapping per axis, so one endpoint can show two simultaneous guides while converging on center coordinates.",
      },
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const surface = getCanvasInteractionSurface(canvasElement)
    const start = toCanvasPointer(surface, 15.8, 9.4)
    const target = toCanvasPointer(surface, 31.6, 9.6)

    await userEvent.pointer([
      { target: surface.stage, coords: start },
      { keys: "[MouseLeft>]", target: surface.stage, coords: start },
      { target: surface.stage, coords: target },
    ])
    await expect(canvas.getByTestId("canvas-stage-shell")).toHaveAttribute("data-snap-guides", "2")
    await expect(canvas.getByTestId("canvas-stage-shell")).toHaveAttribute(
      "data-snap-guide-signature",
      "x:32:element|y:10:element"
    )

    await fireEvent.mouseUp(window, target)
    await expect(canvas.getByTestId("canvas-stage-shell")).toHaveAttribute("data-snap-guides", "0")
    await expect(canvas.getByTestId("canvas-stage-shell")).not.toHaveAttribute(
      "data-snap-guide-signature"
    )
  },
}

export const CanvasWorkspaceTransformerBottomCenterGuideState: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "text-bottom-center-guide-state",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
    docs: {
      description: {
        story:
          "Stable capture state for the bottom-center resize contract: only the snapped bottom guide remains visible while the fixed left and right edges stay silent.",
      },
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
}

export const CanvasWorkspaceLineEndpointCenterGuideState: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "line-endpoint-center-guide-state",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
    docs: {
      description: {
        story:
          "Stable capture state for point-handle snapping: the selected line endpoint lands on both element center axes and keeps one winner guide per axis.",
      },
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
}

export const CanvasWorkspaceNarrow: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "narrow-default",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-narrow-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-narrow-editor", isRotated: false },
  },
}

export const CanvasWorkspaceTextDoubleClickEditing: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "text-ready",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText("已选 1 项")

    const paper = canvasElement.querySelector(".tm-stage-paper--base")
    const stageCanvas = canvasElement.querySelector(".tm-stage--overlay canvas")
    if (!(paper instanceof HTMLElement) || !(stageCanvas instanceof HTMLCanvasElement)) {
      throw new Error("Missing canvas stage surface")
    }

    const readNumber = (label: string) => {
      const input = canvas.getByLabelText(label) as HTMLInputElement
      return Number(input.value)
    }
    const paperWidth = readNumber("标签宽度")
    const paperHeight = readNumber("标签高度")
    const x = readNumber("X")
    const y = readNumber("Y")
    const width = readNumber("宽")
    const height = readNumber("高")
    const paperRect = paper.getBoundingClientRect()
    const clientX = paperRect.left + ((x + width / 2) / paperWidth) * paperRect.width
    const clientY = paperRect.top + ((y + height / 2) / paperHeight) * paperRect.height

    for (const type of [
      "mousedown",
      "mouseup",
      "click",
      "mousedown",
      "mouseup",
      "click",
      "dblclick",
    ]) {
      stageCanvas.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          button: 0,
        })
      )
    }

    const inlineEditor = await canvas.findByLabelText("画布文本内联编辑")
    await expect(inlineEditor).toHaveFocus()
  },
}

export const CanvasWorkspaceTextReady: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "text-ready",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText("已选 1 项")
    const fontSize = await canvas.findByLabelText("字号")
    await expect(fontSize).toHaveDisplayValue("5.0")
  },
}

export const CanvasWorkspaceTextSelected: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "text-selected",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const inlineEditor = (await canvas.findByLabelText("画布文本内联编辑")) as HTMLTextAreaElement
    await userEvent.type(inlineEditor, "{End}{Enter}内联编辑")
    await expect(inlineEditor.value).toContain("\n内联编辑")
    await userEvent.keyboard("{Control>}{Enter}{/Control}")
    await expect(canvas.queryByLabelText("画布文本内联编辑")).not.toBeInTheDocument()
    await canvas.findByDisplayValue(/内联编辑/)

    await expect((await canvas.findAllByDisplayValue("文本 2")).length).toBeGreaterThan(0)
    await canvas.findByLabelText("字号")
    await canvas.findByLabelText("行高")
    await canvas.findByLabelText("字体")
    await userEvent.click(canvas.getByRole("combobox", { name: "字体" }))
    await canvas.findByRole("option", { name: "IBM Plex Mono" })
    await canvas.findByRole("option", { name: "Times New Roman" })
    await expect(canvas.queryByText("官方中文")).toBeNull()
    await userEvent.keyboard("{Escape}")
    await canvas.findByRole("group", { name: "文本九宫格对齐" })
    await canvas.findByLabelText("文本左上对齐")
    const horizontalStretch = await canvas.findByRole("button", { name: "水平拉升" })
    await expect(horizontalStretch).toHaveAttribute("aria-pressed", "false")
    await userEvent.click(horizontalStretch)
    await expect(horizontalStretch).toHaveAttribute("aria-pressed", "true")
    await userEvent.click(horizontalStretch)
    await expect(horizontalStretch).toHaveAttribute("aria-pressed", "false")
    const justifyText = await canvas.findByRole("button", { name: "两端对齐" })
    await expect(justifyText).toHaveAttribute("aria-pressed", "false")
    await userEvent.click(justifyText)
    await expect(justifyText).toHaveAttribute("aria-pressed", "true")
    await userEvent.click(justifyText)
    await expect(justifyText).toHaveAttribute("aria-pressed", "false")
    const verticalStretch = await canvas.findByRole("button", { name: "垂直拉升" })
    await userEvent.click(verticalStretch)
    await expect(verticalStretch).toHaveAttribute("aria-pressed", "true")
    await userEvent.click(verticalStretch)
    await expect(verticalStretch).toHaveAttribute("aria-pressed", "false")
    const verticalText = await canvas.findByRole("button", { name: "纵向文本" })
    await expect(verticalText).toHaveAttribute("aria-pressed", "false")
    await userEvent.click(verticalText)
    await expect(verticalText).toHaveAttribute("aria-pressed", "true")
    await userEvent.click(verticalText)
    await expect(verticalText).toHaveAttribute("aria-pressed", "false")
    const rotationInput = await canvas.findByLabelText("旋转")
    await expect(rotationInput).toHaveDisplayValue("0")
    await canvas.findByRole("button", { name: "逆时针旋转 45 度" })
    const rotateClockwise = await canvas.findByRole("button", { name: "顺时针旋转 45 度" })
    await userEvent.click(rotateClockwise)
    await expect(rotationInput).toHaveDisplayValue("45")
  },
}

export const CanvasWorkspaceTextFontMetrics: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "text-font-metrics",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
    docs: {
      description: {
        story:
          "Text BBOX comparison for identical 20kΩ labels rendered with official Noto Sans SC and IBM Plex Mono font metrics.",
      },
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByDisplayValue("Noto Sans SC BBOX")
    await canvas.findByText("字体")
  },
}

export const CanvasWorkspaceTextInlineEditingClickAwayCommit: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "text-selected",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const inlineEditor = (await canvas.findByLabelText("画布文本内联编辑")) as HTMLTextAreaElement
    await userEvent.type(inlineEditor, "{End}点击提交")

    const stageCanvas = canvasElement.querySelector(".tm-stage--overlay canvas")
    if (!(stageCanvas instanceof HTMLCanvasElement)) {
      throw new Error("Missing canvas stage surface")
    }
    const stageRect = stageCanvas.getBoundingClientRect()
    for (const type of ["mousedown", "mouseup", "click"]) {
      stageCanvas.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: stageRect.left + 20,
          clientY: stageRect.top + 20,
          button: 0,
        })
      )
    }

    await expect(canvas.queryByLabelText("画布文本内联编辑")).not.toBeInTheDocument()
    await canvas.findByDisplayValue(/点击提交/)
  },
}

export const CanvasWorkspaceTextInlineEditingJustify: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "text-justify-selected",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const justifyText = await canvas.findByRole("button", { name: "两端对齐" })
    await expect(justifyText).toHaveAttribute("aria-pressed", "true")
    await expect(await canvas.findByLabelText("文本左上对齐")).toHaveAttribute(
      "aria-pressed",
      "true"
    )

    const inlineEditor = (await canvas.findByLabelText("画布文本内联编辑")) as HTMLTextAreaElement
    const editorStyle = getComputedStyle(inlineEditor)
    await expect(editorStyle.textAlign).toBe("justify")
    await expect(editorStyle.textAlignLast).toBe("justify")
  },
}

export const CanvasWorkspaceTextInlineEditingJustifyMultiline: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "text-justify-multiline-selected",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const justifyText = await canvas.findByRole("button", { name: "两端对齐" })
    await expect(justifyText).toHaveAttribute("aria-pressed", "true")
    await expect(await canvas.findByLabelText("文本左上对齐")).toHaveAttribute(
      "aria-pressed",
      "true"
    )

    const inlineEditor = (await canvas.findByLabelText("画布文本内联编辑")) as HTMLTextAreaElement
    const editorStyle = getComputedStyle(inlineEditor)
    await expect(editorStyle.textAlign).toBe("justify")
    await expect(parseFloat(inlineEditor.style.top)).toBe(0)
  },
}

export const CanvasWorkspaceTextInlineEditingCenteredAlignment: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "text-centered-selected",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByLabelText("文本居中对齐")).toHaveAttribute(
      "aria-pressed",
      "true"
    )

    const inlineEditor = (await canvas.findByLabelText("画布文本内联编辑")) as HTMLTextAreaElement
    const editorStyle = getComputedStyle(inlineEditor)
    await expect(editorStyle.textAlign).toBe("center")
    await expect(parseFloat(inlineEditor.style.left)).not.toBe(0)
  },
}

export const CanvasWorkspaceTextInlineEditingCancel: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "text-selected",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const inlineEditor = (await canvas.findByLabelText("画布文本内联编辑")) as HTMLTextAreaElement
    await userEvent.type(inlineEditor, "{End}取消内容")
    await userEvent.keyboard("{Escape}")
    await expect(canvas.queryByLabelText("画布文本内联编辑")).not.toBeInTheDocument()
    await expect(canvas.queryByDisplayValue(/取消内容/)).not.toBeInTheDocument()
  },
}

export const CanvasWorkspaceRectSelected: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "rect-selected",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect((await canvas.findAllByDisplayValue("直角矩形")).length).toBeGreaterThan(0)
    await expect(await canvas.findByLabelText("圆角")).toHaveValue("0")
  },
}

export const CanvasWorkspaceCircleSelected: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "circle-selected",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect((await canvas.findAllByDisplayValue("圆形示例")).length).toBeGreaterThan(0)
    await canvas.findByLabelText("边长")
  },
}

export const CanvasWorkspaceTriangleSelected: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "triangle-selected",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect((await canvas.findAllByDisplayValue("三角形示例")).length).toBeGreaterThan(0)
    await canvas.findByLabelText("宽")
    await canvas.findByLabelText("高")
  },
}

export const CanvasWorkspaceLineSelected: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "line-selected",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect((await canvas.findAllByDisplayValue("端点线段")).length).toBeGreaterThan(0)
    await canvas.findByLabelText("X2")
    await canvas.findByLabelText("Y2")
  },
}

export const CanvasWorkspaceBarcodeSelected: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "barcode-selected",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
}

export const CanvasWorkspaceBarcodeInvalid: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "barcode-invalid",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
}

export const CanvasWorkspaceDataMatrixSelected: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "datamatrix-selected",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect((await canvas.findAllByDisplayValue("资产矩阵码")).length).toBeGreaterThan(0)
    await canvas.findByLabelText("边长")
    await canvas.findByLabelText("编码")
    await canvas.findByText("固定使用通用 ECC200 方形符号，不提供额外格式开关。")
  },
}

export const CanvasWorkspaceDataMatrixInvalid: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "datamatrix-invalid",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect((await canvas.findAllByDisplayValue("待修正数据矩阵码")).length).toBeGreaterThan(0)
    await canvas.findByText("数据矩阵码内容为空")
    const sections = Array.from(canvasElement.querySelectorAll<HTMLElement>(".tm-editor-section"))
    const contentSection = sections.find(
      (section) => section.querySelector(".tm-editor-section__title")?.textContent === "内容"
    )
    const geometrySection = sections.find(
      (section) => section.querySelector(".tm-editor-section__title")?.textContent === "几何与样式"
    )
    expect(contentSection).toBeTruthy()
    expect(contentSection?.textContent ?? "").toContain("数据矩阵码内容为空")
    expect(geometrySection).toBeTruthy()
    expect(geometrySection?.textContent ?? "").not.toContain("数据矩阵码内容为空")
  },
}

export const CanvasWorkspaceOutputTab: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "output-tab",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
}

export const CanvasWorkspaceUserTemplateVersions: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas?source=user-template&panel=versions"],
  },
  loaders: [
    async () => {
      await seedUserTemplateFixtures()
      const presetDraft = createDraftFromPreset(getPresetById("shipping-wide"))
      const recipientElement = presetDraft.elements.find((element) => element.kind === "text")
      if (!recipientElement) {
        return { templateId: null }
      }
      let draft = toggleElementBinding(presetDraft, recipientElement.id, true)
      draft = {
        ...draft,
        name: "本地发货模板",
        fields: draft.fields.map((field) => ({
          ...field,
          label: "收件人",
          defaultValue: "Koha Cat",
        })),
      }
      const result = await saveUserTemplate({
        name: "版本故事模板",
        document: draft,
      })
      await saveUserTemplateAutosave({
        templateId: result.template.id,
        source: { kind: "user-template", templateId: result.template.id },
        document: {
          ...structuredClone(result.workingCopy.draft),
          fields: result.workingCopy.draft.fields.map((field) => ({
            ...field,
            defaultValue: "Autosave preview",
          })),
        },
        sourceVersionId: result.version.id,
      })
      return { templateId: result.template.id }
    },
  ],
  render: (_args, context) => {
    const templateId = context.loaded?.templateId as string | null
    return (
      <WorkbenchAppStory
        context={runtimeContext}
        initialEntries={[
          templateId
            ? `/canvas?source=user-template&templateId=${templateId}&panel=versions`
            : "/canvas?panel=versions",
        ]}
      />
    )
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
}

export const CanvasWorkspaceOutputTabPlay: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "wide-default",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "输出" }))
  },
}

export const CanvasWorkspaceOutputErrorBubble: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "output-tab",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "直接打印" }))
    await canvas.findByRole("button", { name: "查看操作失败详情" })
  },
}

export const CanvasWorkspaceDraftRestore: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/canvas"],
    canvasScenario: "draft-restore",
  },
  parameters: {
    viewport: {
      defaultViewport: "canvas-wide-editor",
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
}

export const DemoMode: Story = {
  args: {
    context: demoContext,
    client: new DemoApiClient(demoContext),
    initialEntries: ["/templates"],
  },
}

export const TemplatesLargeGridLongTitle: Story = {
  args: {
    context: demoContext,
    client: longTitleDemoClient,
    initialEntries: ["/templates"],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("tab", { name: "大图" }))
  },
}

export const TemplatesDisabledRailNarrow: Story = {
  args: {
    context: demoContext,
    client: new DemoApiClient(demoContext),
    initialEntries: ["/templates"],
  },
  parameters: {
    viewport: {
      defaultViewport: "template-single-outlet",
    },
  },
  globals: {
    viewport: { value: "template-single-outlet", isRotated: false },
  },
}

export const TemplatesSingleOutletNarrow: Story = {
  args: {
    context: demoContext,
    client: new DemoApiClient(demoContext),
    initialEntries: ["/templates"],
  },
  parameters: {
    viewport: {
      defaultViewport: "template-single-outlet",
    },
  },
  globals: {
    viewport: { value: "template-single-outlet", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: /Compact Shipping Label/ }))
  },
}

export const TemplatesStackedPreviewNarrow: Story = {
  args: {
    context: demoContext,
    client: new DemoApiClient(demoContext),
    initialEntries: ["/templates"],
  },
  parameters: {
    viewport: {
      defaultViewport: "template-stacked-preview",
    },
  },
  globals: {
    viewport: { value: "template-stacked-preview", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: /Compact Shipping Label/ }))
  },
}
