import type { Meta, StoryObj } from "@storybook/react-vite"

import { DemoApiClient } from "./api-client.js"
import { App } from "./app.js"
import type { AppContext } from "./types.js"

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

const meta: Meta<typeof App> = {
  title: "Tuckmark/App Surface",
  component: App,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Formal Tuckmark web surface rendered through the same route tree for browser runtime and demo contracts.",
      },
    },
  },
}

export default meta

type Story = StoryObj<typeof App>

export const BrowserRuntime: Story = {
  args: {
    context: runtimeContext,
  },
}

export const DemoMode: Story = {
  args: {
    context: demoContext,
    client: new DemoApiClient(demoContext),
  },
}
