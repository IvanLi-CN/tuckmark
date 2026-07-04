import type { Meta, StoryObj } from "@storybook/react-vite"
import React from "react"
import { expect, fn, userEvent, within } from "storybook/test"

import { Button } from "./button.js"
import { ConfirmDialog, PromptDialog } from "./dialog.js"

const meta = {
  title: "Tuckmark/UI/Dialog",
  component: ConfirmDialog,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Project-owned modal dialogs used where browser alert, confirm, or prompt dialogs would otherwise block the workbench.",
      },
    },
  },
} satisfies Meta<typeof ConfirmDialog>

export default meta

type Story = StoryObj<typeof meta>

function ConfirmDialogExample({ onConfirm = fn() }: { onConfirm?: () => void }) {
  const [open, setOpen] = React.useState(true)

  return (
    <div className="grid min-h-[240px] min-w-[420px] place-items-center bg-background p-8">
      <Button type="button" onClick={() => setOpen(true)}>
        打开确认对话框
      </Button>
      <ConfirmDialog
        open={open}
        title="确认更新 Tuckmark Web"
        description="更新会刷新当前页面。请先确认当前编辑内容已经保存。"
        cancelLabel="稍后"
        confirmLabel="更新"
        onOpenChange={setOpen}
        onConfirm={onConfirm}
      />
    </div>
  )
}

function PromptDialogExample({
  defaultValue = "本地发货模板",
  onConfirm = fn(),
}: {
  defaultValue?: string
  onConfirm?: (value: string) => void
}) {
  const [open, setOpen] = React.useState(true)

  return (
    <div className="grid min-h-[260px] min-w-[440px] place-items-center bg-background p-8">
      <Button type="button" onClick={() => setOpen(true)}>
        打开命名对话框
      </Button>
      <PromptDialog
        open={open}
        title="保存为用户模板"
        description="为这个浏览器本地模板命名。保存后会进入版本历史，可以继续编辑。"
        label="模板名称"
        defaultValue={defaultValue}
        cancelLabel="取消"
        confirmLabel="保存"
        requiredMessage="请输入模板名称。"
        onOpenChange={setOpen}
        onConfirm={onConfirm}
      />
    </div>
  )
}

export const ConfirmUpdate: Story = {
  args: {
    open: true,
    title: "确认更新 Tuckmark Web",
    description: "更新会刷新当前页面。请先确认当前编辑内容已经保存。",
    onOpenChange: fn(),
    onConfirm: fn(),
  },
  render: (args) => <ConfirmDialogExample onConfirm={args.onConfirm} />,
  play: async ({ args }) => {
    const dialog = within(document.body).getByRole("dialog", { name: "确认更新 Tuckmark Web" })
    await expect(dialog).toBeVisible()
    await userEvent.click(within(dialog).getByRole("button", { name: "更新" }))
    await expect(args.onConfirm).toHaveBeenCalled()
  },
}

export const PromptTemplateName: Story = {
  args: {
    open: true,
    title: "保存为用户模板",
    description: "为这个浏览器本地模板命名。保存后会进入版本历史，可以继续编辑。",
    onOpenChange: fn(),
    onConfirm: fn(),
  },
  render: (args) => <PromptDialogExample onConfirm={args.onConfirm as (value: string) => void} />,
  play: async ({ args }) => {
    const dialog = within(document.body).getByRole("dialog", { name: "保存为用户模板" })
    const input = within(dialog).getByLabelText("模板名称")
    await userEvent.clear(input)
    await userEvent.type(input, "线缆标签")
    await userEvent.click(within(dialog).getByRole("button", { name: "保存" }))
    await expect(args.onConfirm).toHaveBeenCalledWith("线缆标签")
  },
}

export const PromptValidation: Story = {
  args: {
    open: true,
    title: "保存为用户模板",
    description: "为这个浏览器本地模板命名。保存后会进入版本历史，可以继续编辑。",
    onOpenChange: fn(),
    onConfirm: fn(),
  },
  render: (args) => (
    <PromptDialogExample defaultValue="" onConfirm={args.onConfirm as (value: string) => void} />
  ),
  play: async ({ args }) => {
    const dialog = within(document.body).getByRole("dialog", { name: "保存为用户模板" })
    await userEvent.click(within(dialog).getByRole("button", { name: "保存" }))
    await expect(within(dialog).getByText("请输入模板名称。")).toBeVisible()
    await expect(args.onConfirm).not.toHaveBeenCalled()
  },
}

export const StateGallery: Story = {
  args: {
    open: true,
    title: "确认更新 Tuckmark Web",
    description: "更新会刷新当前页面。请先确认当前编辑内容已经保存。",
    onOpenChange: fn(),
    onConfirm: fn(),
  },
  render: () => (
    <div className="grid w-[560px] max-w-[calc(100vw-32px)] gap-4 p-6">
      <section className="grid gap-2 rounded-xl border border-border/70 bg-card p-4 text-card-foreground shadow-sm">
        <h2 className="text-base font-semibold">确认对话框</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          用于替换浏览器 confirm，动作明确且保持取消路径。
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline">
            稍后
          </Button>
          <Button type="button">更新</Button>
        </div>
      </section>
      <section className="grid gap-3 rounded-xl border border-border/70 bg-card p-4 text-card-foreground shadow-sm">
        <div className="grid gap-2">
          <h2 className="text-base font-semibold">输入对话框</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            用于替换浏览器 prompt，字段、错误和确认动作都在项目 UI 内完成。
          </p>
        </div>
        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="dialog-gallery-template-name">
            模板名称
          </label>
          <input
            id="dialog-gallery-template-name"
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
            defaultValue="本地发货模板"
          />
          <p className="text-sm leading-5 text-destructive">请输入模板名称。</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline">
            取消
          </Button>
          <Button type="button">保存</Button>
        </div>
      </section>
    </div>
  ),
}
