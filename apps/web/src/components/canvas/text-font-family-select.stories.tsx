import type { Meta, StoryObj } from "@storybook/react-vite"
import React from "react"
import { expect, userEvent, within } from "storybook/test"

import type { TextFontFamily } from "../../../../../packages/core/src/web.js"
import { TextFontFamilySelect } from "./text-font-family-select.js"

const meta = {
  title: "Tuckmark/Canvas/TextFontFamilySelect",
  component: TextFontFamilySelect,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof TextFontFamilySelect>

export default meta

type Story = StoryObj<typeof meta>

function StatefulTextFontFamilySelect({ initialValue }: { initialValue: TextFontFamily }) {
  const [value, setValue] = React.useState<TextFontFamily>(initialValue)

  return (
    <div className="grid max-w-sm gap-4 p-6">
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold text-foreground">字体选择</h2>
        <p className="text-sm text-muted-foreground">
          官方中文与工业字体固定内置，系统兼容字体单独归组保留。
        </p>
      </div>
      <TextFontFamilySelect id="font-family" value={value} onValueChange={setValue} />
    </div>
  )
}

export const Gallery: Story = {
  args: {
    value: "noto-sans-sc",
    onValueChange: () => undefined,
  },
  render: () => (
    <div className="grid gap-6 p-6 md:grid-cols-3">
      <StatefulTextFontFamilySelect initialValue="noto-sans-sc" />
      <StatefulTextFontFamilySelect initialValue="ibm-plex-mono" />
      <StatefulTextFontFamilySelect initialValue="system-sans" />
    </div>
  ),
}

export const GroupedPreviewPlay: Story = {
  args: {
    value: "noto-sans-sc",
    onValueChange: () => undefined,
  },
  render: () => <StatefulTextFontFamilySelect initialValue="noto-sans-sc" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("combobox"))
    await expect(canvas.getByText("官方中文")).toBeVisible()
    await expect(canvas.getByText("官方工业")).toBeVisible()
    await expect(canvas.getByText("系统兼容")).toBeVisible()
    await expect(canvas.getByRole("option", { name: "IBM Plex Mono" })).toBeVisible()
    await expect(canvas.getByRole("option", { name: "系统无衬线" })).toBeVisible()
  },
}
