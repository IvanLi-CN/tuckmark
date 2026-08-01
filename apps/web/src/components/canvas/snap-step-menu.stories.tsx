import type { Meta, StoryObj } from "@storybook/react-vite"
import React from "react"
import { expect, fireEvent, userEvent, within } from "storybook/test"

import { SnapStepMenu } from "./snap-step-menu.js"

const meta = {
  title: "Tuckmark/Canvas/SnapStepMenu",
  component: SnapStepMenu,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof SnapStepMenu>

export default meta

type Story = StoryObj<typeof meta>

function StatefulSnapStepMenu({ initialValue = 1 }: { initialValue?: 0.25 | 0.5 | 1 }) {
  const [enabled, setEnabled] = React.useState(true)
  const [value, setValue] = React.useState<0.25 | 0.5 | 1>(initialValue)

  return (
    <div className="flex min-h-48 items-start justify-start rounded-xl border border-border/70 bg-background/80 p-6">
      <SnapStepMenu
        snapEnabled={enabled}
        value={value}
        onToggle={() => setEnabled((current) => !current)}
        onChange={setValue}
      />
    </div>
  )
}

export const Gallery: Story = {
  args: {
    snapEnabled: true,
    value: 1,
    onToggle: () => undefined,
    onChange: () => undefined,
  },
  render: () => <StatefulSnapStepMenu />,
}

export const ContextMenuPlay: Story = {
  args: {
    snapEnabled: true,
    value: 0.5,
    onToggle: () => undefined,
    onChange: () => undefined,
  },
  render: () => <StatefulSnapStepMenu initialValue={0.5} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    fireEvent.contextMenu(canvas.getByRole("button", { name: "吸附" }))

    const page = within(document.body)
    await expect(page.getByText("吸附步长")).toBeVisible()
    await expect(page.getByRole("button", { name: "1/4 格" })).toBeVisible()
    await expect(page.getByRole("button", { name: "1/2 格" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    await userEvent.click(page.getByRole("button", { name: "1/4 格" }))
    await expect(page.getByText("吸附步长")).not.toBeInTheDocument()
  },
}
