import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within } from "storybook/test"

import {
  createAgentImportDemoClient,
  createAgentImportDemoSession,
} from "./agent-import-demo-data.js"
import { AgentImportPage } from "./agent-import-page.js"

const meta = {
  title: "Tuckmark/Agent Import/Confirmation Page",
  component: AgentImportPage,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AgentImportPage>

export default meta

type Story = StoryObj<typeof meta>

const waitingSeed = createAgentImportDemoSession()
const waitingItem = waitingSeed.proposal.items.find((item) => item.id === "demo-new-regulator")
if (!waitingItem?.template) {
  throw new Error("Agent import Storybook seed is missing its new-item template.")
}

export const ReadyToConfirm: Story = {
  args: {
    initialSession: createAgentImportDemoSession(),
    client: createAgentImportDemoClient(),
    localTemplatesLoader: async () => [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole("table", { name: "新增物品" })).toBeVisible()
    await expect(canvas.getByRole("table", { name: "增加库存" })).toBeVisible()
    await expect(canvas.getAllByLabelText("导入此物料")[0]).toBeChecked()
    await expect(canvas.getAllByRole("button", { name: "保存当前编辑" })).toHaveLength(2)
    await expect(canvas.queryByRole("button", { name: "展开物料详情" })).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole("button", { name: "编辑物料全名" }))
    await expect(canvas.getByLabelText("物料全名")).toHaveFocus()
    await userEvent.keyboard("{Escape}")
    await userEvent.click(canvas.getByRole("button", { name: "编辑标签数量" }))
    await expect(canvas.getByLabelText("标签数量")).toHaveValue(2)
    await userEvent.keyboard("{Escape}")
    await userEvent.hover(canvas.getByRole("button", { name: "预览标签" }))
    await expect(within(document.body).getByRole("tooltip")).toHaveTextContent("预览标签")
    await userEvent.unhover(canvas.getByRole("button", { name: "预览标签" }))
    await userEvent.click(canvas.getByRole("button", { name: "预览标签" }))
    await expect(canvas.getByRole("img", { name: "Cable Tag预览" })).toBeVisible()
    await expect(canvas.getByRole("button", { name: "收起标签预览" })).toBeVisible()
  },
}

export const TemplateWaitingForAgent: Story = {
  args: {
    initialSession: createAgentImportDemoSession({
      proposal: {
        ...waitingSeed.proposal,
        items: waitingSeed.proposal.items.map((item) =>
          item.id === "demo-new-regulator"
            ? {
                ...item,
                pendingTemplateEventId: "demo-template-event-demo-new-regulator",
                templateInput: {},
                revision: 1,
              }
            : item
        ),
      },
      events: [
        {
          id: "demo-template-event-demo-new-regulator",
          type: "template-input-requested",
          itemId: "demo-new-regulator",
          revision: 1,
          template: waitingItem.template,
          createdAt: "2030-07-29T08:05:00.000Z",
          status: "open",
        },
      ],
    }),
    client: createAgentImportDemoClient(),
    localTemplatesLoader: async () => [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole("button", { name: "编辑物料全名" })).toBeEnabled()
    await expect(canvas.getByRole("button", { name: "编辑标签模板" })).toBeDisabled()
    await expect(canvas.getByRole("button", { name: "确认导入选中项" })).toBeDisabled()
  },
}

export const Completed: Story = {
  args: {
    initialSession: createAgentImportDemoSession({ state: "completed" }),
    client: createAgentImportDemoClient(),
    localTemplatesLoader: async () => [],
  },
}

export const TemplateSwitchRequestsAgentInput: Story = {
  args: {
    initialSession: createAgentImportDemoSession(),
    client: createAgentImportDemoClient(),
    localTemplatesLoader: async () => [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "编辑标签模板" }))
    await userEvent.selectOptions(canvas.getByLabelText("标签模板"), "system:shipping-compact")
    await expect(canvas.getByText("等待 Agent 补全", { exact: true })).toBeVisible()
    await expect(canvas.getByRole("button", { name: "确认导入选中项" })).toBeDisabled()
  },
}
