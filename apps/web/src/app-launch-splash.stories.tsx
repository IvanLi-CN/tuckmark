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
    statusText: "正在准备当前页面状态",
    detailText: "正在准备当前页面所需的最小运行时状态。",
    progressPercent: 50,
    steps: [
      {
        id: "bootstrap-loaded",
        label: "启动运行时引导",
        state: "complete",
      },
      {
        id: "current-route-chunk-ready",
        label: "装载当前页面模块",
        state: "complete",
      },
      {
        id: "current-route-data-ready",
        label: "准备当前页面状态",
        state: "active",
      },
      {
        id: "offline-warmup",
        label: "补齐离线资源缓存",
        state: "pending",
      },
    ],
  },
}

export const Dark: Story = {
  args: {
    theme: "dark",
  },
}
