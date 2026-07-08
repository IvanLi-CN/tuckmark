import type { Meta, StoryObj } from "@storybook/react-vite"
import React from "react"
import { expect, userEvent, within } from "storybook/test"

import type { TextFontFamily } from "../../../../../packages/core/src/web.js"
import {
  clearTextFontUsageState,
  loadTextFontUsageState,
  persistTextFontUsageState,
} from "../../lib/text-font-usage.js"
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
          列表直接展示对应字体效果，内置字体池超过 20 种，并继续兼容旧草稿值。
        </p>
      </div>
      <TextFontFamilySelect id="font-family" value={value} onValueChange={setValue} />
    </div>
  )
}

function SeededTextFontFamilySelect({ initialValue }: { initialValue: TextFontFamily }) {
  React.useEffect(() => {
    persistTextFontUsageState({
      fonts: {
        ...loadTextFontUsageState().fonts,
        "ibm-plex-mono": {
          id: "ibm-plex-mono",
          lastUsedAt: "2026-07-08T05:00:00.000Z",
          totalUsedMs: 900,
        },
        "noto-sans-sc": {
          id: "noto-sans-sc",
          lastUsedAt: "2026-07-08T04:00:00.000Z",
          totalUsedMs: 8_000,
        },
        "space-grotesk": {
          id: "space-grotesk",
          lastUsedAt: "2026-07-08T03:00:00.000Z",
          totalUsedMs: 7_000,
        },
        "source-serif-4": {
          id: "source-serif-4",
          lastUsedAt: "2026-07-08T02:00:00.000Z",
          totalUsedMs: 6_000,
        },
        arial: {
          id: "arial",
          lastUsedAt: "2026-07-08T01:00:00.000Z",
          totalUsedMs: 5_000,
        },
      },
    })
    return () => {
      clearTextFontUsageState()
    }
  }, [])

  return <StatefulTextFontFamilySelect initialValue={initialValue} />
}

export const Gallery: Story = {
  args: {
    value: "noto-sans-sc",
    onValueChange: () => undefined,
  },
  render: () => (
    <div className="grid gap-6 p-6 md:grid-cols-3">
      <SeededTextFontFamilySelect initialValue="noto-sans-sc" />
      <SeededTextFontFamilySelect initialValue="ibm-plex-mono" />
      <SeededTextFontFamilySelect initialValue="arial" />
    </div>
  ),
}

export const FlatPreviewPlay: Story = {
  args: {
    value: "noto-sans-sc",
    onValueChange: () => undefined,
  },
  render: () => <SeededTextFontFamilySelect initialValue="noto-sans-sc" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("combobox"))
    await expect(canvas.getByText("常用字体")).toBeVisible()
    await expect(canvas.getByRole("option", { name: "IBM Plex Mono" })).toBeVisible()
    await expect(canvas.getByRole("option", { name: "Times New Roman" })).toBeVisible()
    await expect(canvas.getByRole("option", { name: "Verdana" })).toBeVisible()
  },
}
