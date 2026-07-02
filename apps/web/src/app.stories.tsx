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
