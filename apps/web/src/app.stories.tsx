import type { Meta, StoryObj } from "@storybook/react-vite"

import { MockApiClient } from "./api-client.js"
import { App } from "./app.js"
import type { AppContext } from "./types.js"

const demoContext: AppContext = {
  apiBasePath: "/tuckmark/mock-api",
  basePath: "/tuckmark",
  isPages: true,
  mode: "demo-seeded",
  capabilities: {
    browserDirectPrintPath: "available",
    serviceApiPrintPath: "mocked",
  },
}

const mockShellContext: AppContext = {
  ...demoContext,
  mode: "mock-shell",
}

const meta: Meta<typeof App> = {
  title: "Tuckmark/App Surface",
  component: App,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Formal Tuckmark web surface rendered through the same route tree for runtime, Pages demo, and mock shell contracts.",
      },
    },
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
