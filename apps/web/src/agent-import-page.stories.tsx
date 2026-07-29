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
    await userEvent.selectOptions(canvas.getByLabelText("标签模板"), "system:shipping-compact")
    await expect(canvas.getByText("等待 Agent 根据字段合同补全")).toBeVisible()
    await expect(canvas.getByRole("button", { name: "确认导入选中项" })).toBeDisabled()
  },
}
