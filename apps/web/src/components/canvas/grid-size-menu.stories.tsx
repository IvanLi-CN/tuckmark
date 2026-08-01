import type { Meta, StoryObj } from "@storybook/react-vite"
import React from "react"
import { expect, fireEvent, userEvent, within } from "storybook/test"

import { GridSizeMenu } from "./grid-size-menu.js"

const meta = {
  title: "Tuckmark/Canvas/GridSizeMenu",
  component: GridSizeMenu,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof GridSizeMenu>

export default meta

type Story = StoryObj<typeof meta>

function StatefulGridSizeMenu({ initialValue = 1 }: { initialValue?: 1 | 2 | 2.5 | 5 | 10 }) {
  const [enabled, setEnabled] = React.useState(true)
  const [value, setValue] = React.useState<1 | 2 | 2.5 | 5 | 10>(initialValue)

  return (
    <div className="flex min-h-48 items-start justify-start rounded-xl border border-border/70 bg-background/80 p-6">
      <GridSizeMenu
        gridEnabled={enabled}
        value={value}
        onToggle={() => setEnabled((current) => !current)}
        onChange={setValue}
      />
    </div>
  )
}

export const Gallery: Story = {
  args: {
    gridEnabled: true,
    value: 1,
    onToggle: () => undefined,
    onChange: () => undefined,
  },
  render: () => <StatefulGridSizeMenu />,
}

export const ContextMenuPlay: Story = {
  args: {
    gridEnabled: true,
    value: 2.5,
    onToggle: () => undefined,
    onChange: () => undefined,
  },
  render: () => <StatefulGridSizeMenu initialValue={2.5} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const gridButton = canvas.getByRole("button", { name: "网格" })
    fireEvent.contextMenu(gridButton, { clientX: 180, clientY: 80 })

    const page = within(document.body)
    await expect(page.getByText("网格尺寸")).toBeVisible()
    await expect(page.getByRole("button", { name: "1mm" })).toBeVisible()
    await expect(page.getByRole("button", { name: "2mm" })).toBeVisible()
    await expect(page.getByRole("button", { name: "2.5mm" })).toBeVisible()
    await expect(page.getByRole("button", { name: "5mm" })).toBeVisible()
    await expect(page.getByRole("button", { name: "10mm" })).toBeVisible()
    await expect(page.getByRole("button", { name: "1mm" })).toHaveAttribute("aria-pressed", "false")
    await userEvent.click(page.getByRole("button", { name: "5mm" }))
    await expect(page.getByText("网格尺寸")).not.toBeInTheDocument()
  },
}
