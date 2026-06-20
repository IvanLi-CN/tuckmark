import type { Meta, StoryObj } from "@storybook/react"

import { MockApiClient } from "./api-client.js"
import { App } from "./app.js"
import type { AppContext } from "./types.js"

const demoContext: AppContext = {
  apiBasePath: "/tuckmark/mock-api",
  basePath: "/tuckmark",
  isPages: true,
  mode: "demo-seeded",
  capabilities: {
    browserPrint: "available",
    serverPrint: "mocked",
    packetsSource: "mock",
  },
}

const mockShellContext: AppContext = {
  ...demoContext,
  mode: "mock-shell",
}

const meta: Meta<typeof App> = {
  title: "Tuckmark/App Surface",
  component: App,
  parameters: {
    layout: "fullscreen",
  },
}

export default meta

type Story = StoryObj<typeof App>

export const PagesDemo: Story = {
  args: {
    context: demoContext,
    client: new MockApiClient(demoContext),
  },
}

export const MockShell: Story = {
  args: {
    context: mockShellContext,
    client: new MockApiClient(mockShellContext),
  },
}
