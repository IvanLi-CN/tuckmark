import type { Meta, StoryObj } from "@storybook/react-vite"
import { AlignLeft, LayoutGrid, LayoutList, Rows3 } from "lucide-react"
import * as React from "react"

import { SegmentedTabs } from "./segmented-tabs.js"

const meta = {
  title: "Tuckmark/UI/SegmentedTabs",
  component: SegmentedTabs,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof SegmentedTabs>

export default meta

type Story = StoryObj<typeof meta>

function SegmentedTabsGallery() {
  const [view, setView] = React.useState("large")
  const [density, setDensity] = React.useState("comfortable")
  const [mode, setMode] = React.useState("barcode")

  return (
    <div className="grid gap-8 p-6">
      <section className="grid gap-3">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold text-foreground">Icon tabs</h2>
          <p className="text-sm text-muted-foreground">
            The selected state is a shared indicator that moves horizontally between tabs.
          </p>
        </div>
        <SegmentedTabs
          ariaLabel="模板列表视图"
          value={view}
          onValueChange={setView}
          items={[
            { value: "large", name: "大图", icon: LayoutGrid },
            { value: "list", name: "列表", icon: LayoutList },
          ]}
        />
      </section>

      <section className="grid gap-3">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold text-foreground">Icon and text tabs</h2>
          <p className="text-sm text-muted-foreground">
            Wider controls keep the same moving indicator behavior.
          </p>
        </div>
        <SegmentedTabs
          ariaLabel="表格密度"
          mode="icon-text"
          size="sm"
          value={density}
          onValueChange={setDensity}
          items={[
            { value: "compact", name: "紧凑", icon: Rows3 },
            { value: "comfortable", name: "舒适", icon: AlignLeft },
          ]}
        />
      </section>

      <section className="grid gap-3">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold text-foreground">Text tabs</h2>
          <p className="text-sm text-muted-foreground">
            Text-only tabs use the same reusable component without icon layout.
          </p>
        </div>
        <SegmentedTabs
          ariaLabel="标签内容类型"
          mode="text"
          size="sm"
          value={mode}
          onValueChange={setMode}
          items={[
            { value: "barcode", name: "条码" },
            { value: "plain", name: "文本" },
            { value: "qr", name: "二维码" },
          ]}
        />
      </section>
    </div>
  )
}

export const Gallery: Story = {
  args: {
    ariaLabel: "模板列表视图",
    items: [],
    value: "",
    onValueChange: () => {},
  },
  render: () => <SegmentedTabsGallery />,
}
