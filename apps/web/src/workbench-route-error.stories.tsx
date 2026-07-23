import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, within } from "storybook/test"

import { WorkbenchRouteErrorPanel } from "./workbench-route-error.js"

const meta = {
  title: "Tuckmark/Workbench/Route Error",
  component: WorkbenchRouteErrorPanel,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  render: (args) => (
    <div className="tm-theme-scope tm-theme-scope--light min-h-screen p-6">
      <WorkbenchRouteErrorPanel {...args} />
    </div>
  ),
} satisfies Meta<typeof WorkbenchRouteErrorPanel>

export default meta

type Story = StoryObj<typeof meta>

export const ChunkLoadFailure: Story = {
  args: {
    error: new Error(
      "Failed to fetch dynamically imported module: http://127.0.0.1:23620/src/workbench-templates-route.tsx"
    ),
    onGoHome: fn(),
    onReload: fn(),
    onRetry: fn(),
    pathLabel: "/templates",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("页面暂时没有加载出来")).toBeInTheDocument()
    await expect(canvas.getByText("你可以尝试")).toBeInTheDocument()
    await expect(canvas.queryByText("Something went wrong!")).toBeNull()
    await expect(canvas.queryByText(/开发服务重启|切换分支|热更新中断/)).toBeNull()
  },
}

export const GenericFailure: Story = {
  args: {
    error: new Error("Printer preview pipeline crashed while hydrating template state."),
    onGoHome: fn(),
    onReload: fn(),
    onRetry: fn(),
    pathLabel: "/system",
  },
}
