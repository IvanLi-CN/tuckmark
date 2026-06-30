import type { Meta, StoryObj } from "@storybook/react-vite"
import React from "react"

import { Combobox } from "./combobox.js"

const meta = {
  title: "Tuckmark/UI/Combobox",
  component: Combobox,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof Combobox>

export default meta

type Story = StoryObj<typeof meta>

const baseOptions = [
  { label: "收件人", value: "收件人" },
  { label: "地址", value: "地址" },
  { label: "订单号", value: "订单号" },
  { label: "备注", value: "备注" },
] as const

export const FieldAutocomplete: Story = {
  args: {
    value: "收",
    options: [...baseOptions],
    onValueChange: () => undefined,
  },
  render: () => {
    const [value, setValue] = React.useState("收")
    const [committed, setCommitted] = React.useState("收件人")

    return (
      <div className="grid max-w-md gap-4 p-6">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold text-foreground">Field autocomplete</h2>
          <p className="text-sm text-muted-foreground">
            输入时过滤已有字段，也支持展开后直接选择。
          </p>
        </div>
        <Combobox
          density="compact"
          size="md"
          value={value}
          options={[...baseOptions]}
          placeholder="输入字段名，可复用已有字段"
          onValueChange={setValue}
          onValueCommit={(nextValue) => {
            setValue(nextValue)
            setCommitted(nextValue)
          }}
        />
        <div className="rounded-xl border border-border/70 bg-background px-3 py-2 text-sm text-muted-foreground">
          当前提交值：{committed}
        </div>
      </div>
    )
  },
}
