import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within } from "storybook/test"

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

export const Home: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/"],
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
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
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
    await canvas.findByLabelText("字号")
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
          "Text BBOX comparison for identical 20kΩ labels rendered with system sans and system mono font metrics.",
      },
    },
  },
  globals: {
    viewport: { value: "canvas-wide-editor", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByDisplayValue("系统无衬线 BBOX")
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

    const inlineEditor = (await canvas.findByLabelText("画布文本内联编辑")) as HTMLTextAreaElement
    const editorStyle = getComputedStyle(inlineEditor)
    await expect(editorStyle.textAlign).toBe("justify")
    await expect(editorStyle.textAlignLast).toBe("justify")
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
