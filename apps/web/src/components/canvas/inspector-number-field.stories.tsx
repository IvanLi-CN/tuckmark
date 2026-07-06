import type { Meta, StoryObj } from "@storybook/react-vite"
import React from "react"
import { expect, userEvent, within } from "storybook/test"

import { InspectorNumberField } from "./inspector-number-field.js"

const meta = {
  title: "Tuckmark/Canvas/InspectorNumberField",
  component: InspectorNumberField,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof InspectorNumberField>

export default meta

type Story = StoryObj<typeof meta>

function StatefulInspectorNumberField() {
  const [value, setValue] = React.useState(21.234)
  return (
    <div className="grid max-w-sm gap-3 p-6">
      <InspectorNumberField id="story-width" label="宽" value={value} onValueChange={setValue} />
      <div className="text-xs text-muted-foreground">当前值：{value.toFixed(1)}</div>
    </div>
  )
}

export const Gallery: Story = {
  args: {
    id: "gallery-width",
    label: "宽",
    value: 21.234,
    onValueChange: () => undefined,
  },
  render: () => (
    <div className="grid max-w-sm gap-2 p-6">
      <InspectorNumberField
        id="gallery-x"
        label="X"
        value={7.499999999999972}
        onValueChange={() => undefined}
      />
      <InspectorNumberField
        id="gallery-width"
        label="宽"
        value={21.234}
        onValueChange={() => undefined}
      />
      <InspectorNumberField
        disabled
        id="gallery-disabled"
        label="高"
        value={11.428155}
        onValueChange={() => undefined}
      />
    </div>
  ),
}

export const TypingPlay: Story = {
  args: {
    id: "story-width",
    label: "宽",
    value: 21.234,
    onValueChange: () => undefined,
  },
  render: () => <StatefulInspectorNumberField />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const widthInput = canvas.getByLabelText("宽")
    await expect(widthInput).toHaveValue(21.2)
    await userEvent.clear(widthInput)
    await userEvent.type(widthInput, "7.76")
    await expect(widthInput).toHaveValue(7.8)
  },
}
