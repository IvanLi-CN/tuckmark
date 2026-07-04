import type { Meta, StoryObj } from "@storybook/react-vite"
import React from "react"
import { expect, userEvent, within } from "storybook/test"

import { formatCanvasDimension } from "../../lib/canvas-dimensions.js"
import { DimensionPicker } from "./dimension-picker.js"

const meta = {
  title: "Tuckmark/Canvas/DimensionPicker",
  component: DimensionPicker,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof DimensionPicker>

export default meta

type Story = StoryObj<typeof meta>

const dimensionOptions = [
  { width: 48, height: 28 },
  { width: 48, height: 20 },
  { width: 40, height: 16 },
  { width: 64, height: 30 },
]

function StatefulDimensionPicker({ warning }: { warning?: string }) {
  const [dimension, setDimension] = React.useState({ width: 48, height: 28 })
  return (
    <div className="grid max-w-sm gap-4 p-6">
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold text-foreground">标签尺寸</h2>
        <p className="text-sm text-muted-foreground">宽高分开输入，候选尺寸作为一个项目应用。</p>
      </div>
      <DimensionPicker
        value={dimension}
        options={dimensionOptions}
        warning={warning}
        onCommit={setDimension}
      />
      <div className="rounded-xl border border-border/70 bg-background px-3 py-2 text-sm text-muted-foreground">
        当前尺寸：{formatCanvasDimension(dimension)}
      </div>
    </div>
  )
}

function HeaderDimensionPicker() {
  const [dimension, setDimension] = React.useState({ width: 48, height: 28 })
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-background/80 p-3">
      <DimensionPicker
        variant="inline"
        value={dimension}
        options={dimensionOptions}
        onCommit={setDimension}
      />
    </div>
  )
}

export const Gallery: Story = {
  args: {
    value: { width: 48, height: 28 },
    options: dimensionOptions,
    onCommit: () => undefined,
  },
  render: () => (
    <div className="grid gap-6 p-6 md:grid-cols-2">
      <StatefulDimensionPicker />
      <StatefulDimensionPicker warning="当前画布宽度 64 mm 超过当前打印目标宽度 48 mm；可继续编辑和预览，直接打印会被拦截。" />
      <div className="grid max-w-md gap-4 p-6">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold text-foreground">编辑台头部</h2>
          <p className="text-sm text-muted-foreground">画布尺寸在编辑台标题右侧紧凑修改。</p>
        </div>
        <HeaderDimensionPicker />
      </div>
      <div className="grid max-w-sm gap-4 p-6">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold text-foreground">只读状态</h2>
          <p className="text-sm text-muted-foreground">历史版本查看时不能修改画布尺寸。</p>
        </div>
        <DimensionPicker
          disabled
          value={{ width: 48, height: 28 }}
          options={dimensionOptions}
          onCommit={() => undefined}
        />
      </div>
    </div>
  ),
}

export const FilteringPlay: Story = {
  args: {
    value: { width: 48, height: 28 },
    options: dimensionOptions,
    onCommit: () => undefined,
  },
  render: () => <StatefulDimensionPicker />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByLabelText("展开尺寸建议")).toBeNull()
    await expect(canvas.queryByLabelText("收起尺寸建议")).toBeNull()
    const widthInput = canvas.getByLabelText("标签宽度")
    const heightInput = canvas.getByLabelText("标签高度")
    await userEvent.clear(heightInput)
    await userEvent.clear(widthInput)
    await userEvent.type(widthInput, "40")
    await expect(canvas.findByRole("option", { name: "40 × 16 mm" })).resolves.toBeVisible()
    await userEvent.click(canvas.getByText("宽高分开输入，候选尺寸作为一个项目应用。"))
    await expect(canvas.queryByRole("option", { name: "40 × 16 mm" })).not.toBeInTheDocument()
  },
}
