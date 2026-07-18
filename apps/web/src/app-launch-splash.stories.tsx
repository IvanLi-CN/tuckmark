import type { Meta, StoryObj } from "@storybook/react-vite"

import { AppLaunchSplash } from "./app-launch-splash.js"

const meta: Meta<typeof AppLaunchSplash> = {
  title: "Tuckmark/App Launch Splash",
  component: AppLaunchSplash,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Static startup shell used by the browser-static install surface so cold PWA launches show a branded loading state before the routed React workbench mounts.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background">
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof AppLaunchSplash>

export const Default: Story = {}

export const PreparingCurrentRoute: Story = {
  args: {
    statusText: "正在准备工作台",
    detailText: "当前页面就绪后会立即进入，其他资产会在后台静默补齐。",
  },
}

export const Dark: Story = {
  args: {
    theme: "dark",
  },
}
