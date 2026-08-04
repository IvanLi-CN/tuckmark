import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, within } from "storybook/test"

import { MarkdownContent } from "./markdown-content.js"

const meta = {
  title: "Tuckmark/Inventory/Device Details",
  component: MarkdownContent,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof MarkdownContent>

export default meta

type Story = StoryObj<typeof meta>

export const TechnicalDetails: Story = {
  args: {
    value: "## 电气特性\n\n- 输入范围：4.5V 至 28V\n- 输出：3.3V\n- 封装：SOT-583",
  },
}

export const EmptyDetails: Story = {
  args: {
    value: "",
  },
}

export const RemoteImageIsInert: Story = {
  args: {
    value: "外部证据：![跟踪像素](https://tracker.example/pixel)",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole("img")).not.toBeInTheDocument()
    await expect(canvas.getByText("跟踪像素")).toBeInTheDocument()
  },
}
