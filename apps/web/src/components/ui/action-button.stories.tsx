import type { Meta, StoryObj } from "@storybook/react-vite"
import { Copy, Eye, Plus, Trash2, Upload } from "lucide-react"

import { ActionButton } from "./action-button.js"

const meta = {
  title: "Tuckmark/UI/ActionButton",
  component: ActionButton,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof ActionButton>

export default meta

type Story = StoryObj<typeof meta>

export const Gallery: Story = {
  args: {
    name: "导入模板",
  },
  render: () => (
    <div className="grid gap-8 p-6">
      <section className="grid gap-4">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold text-foreground">Action button modes</h2>
          <p className="text-sm text-muted-foreground">
            Icon-only buttons expose their name through the accessible label and tooltip.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton name="导入模板" icon={Upload} mode="icon" variant="outline" />
          <ActionButton name="新增模板" mode="text" variant="outline" />
          <ActionButton name="生成预览" icon={Eye} mode="icon-text" variant="outline" />
          <ActionButton name="直接打印" icon={Copy} />
        </div>
      </section>

      <section className="grid gap-4">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold text-foreground">Sizes</h2>
          <p className="text-sm text-muted-foreground">
            Shared sizes cover dense toolbars and regular action rows.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton name="新增行" icon={Plus} mode="icon-text" size="xs" variant="outline" />
          <ActionButton name="复制行" icon={Copy} mode="icon-text" size="sm" variant="outline" />
          <ActionButton name="删除行" icon={Trash2} mode="icon-text" variant="outline" />
          <ActionButton name="生成预览" icon={Eye} mode="icon-text" size="lg" />
        </div>
      </section>
    </div>
  ),
}
