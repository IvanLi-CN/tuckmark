import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"

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

export const Light: Story = {
  args: {
    theme: "light",
  },
}

export const PreparingCurrentRoute: Story = {
  args: {
    statusText: "正在准备工作台",
    detailText: "当前页面就绪后会立即进入，离线版本会在后台准备。",
  },
}

export const SlowStart: Story = {
  parameters: {
    viewport: {
      defaultViewport: "launch-mobile",
    },
  },
  args: {
    state: "slow",
    statusText: "工作台启动时间较长",
    detailText: "启动时间较长。建议检查最新版本后重新启动。",
    onUpdateRestart: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole("status", { name: "Tuckmark 工作台启动时间较长" })).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "检查更新并重启" }))
    await expect(args.onUpdateRestart).toHaveBeenCalledTimes(1)
  },
}

export const Recovery: Story = {
  args: {
    state: "recovery",
    statusText: "无法启动工作台",
    detailText: "启动超过一分钟仍未完成，程序无法自动恢复。请重新加载，或检查最新版本后重启。",
    onRetry: fn(),
    onUpdateRestart: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole("alert", { name: "Tuckmark 无法启动工作台" })).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "重新加载" }))
    await expect(args.onRetry).toHaveBeenCalledTimes(1)
    await userEvent.click(canvas.getByRole("button", { name: "检查更新并重启" }))
    await expect(args.onUpdateRestart).toHaveBeenCalledTimes(1)
  },
}

export const Dark: Story = {
  args: {
    theme: "dark",
  },
}
