import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent, within } from "storybook/test"

import type { ApiClient } from "./api-client.js"
import { DemoApiClient } from "./api-client.js"
import { fallbackTemplates } from "./demo-data.js"
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

export const Home: Story = {
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
}

export const TemplatesList: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/templates"],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "列表" }))
  },
}

export const TemplatesListEditing: Story = {
  args: {
    context: runtimeContext,
    initialEntries: ["/templates"],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "列表" }))
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
    await userEvent.click(canvas.getByRole("button", { name: "大图" }))
  },
}
