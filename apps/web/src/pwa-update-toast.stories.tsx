import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"

import type { PwaUpdateSnapshot } from "./pwa-lifecycle.js"
import { PwaUpdateToast } from "./pwa-update-toast.js"

function snapshot(
  status: PwaUpdateSnapshot["status"],
  error: string | null = null
): PwaUpdateSnapshot {
  return {
    status,
    registration: null,
    waitingWorker: null,
    error,
  }
}

const meta: Meta<typeof PwaUpdateToast> = {
  title: "Tuckmark/PWA Update Toast",
  component: PwaUpdateToast,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Non-blocking PWA update prompt used by the Tuckmark workbench shell after a new browser-static version is ready to activate.",
      },
    },
  },
  args: {
    onUpdate: fn(),
  },
  decorators: [
    (Story) => (
      <div className="grid min-h-[220px] w-[560px] max-w-[calc(100vw-32px)] place-items-end bg-background p-6">
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof PwaUpdateToast>

export const Ready: Story = {
  args: {
    snapshot: snapshot("ready"),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole("button", { name: "更新" })
    await expect(canvas.getByText("新版本可用")).toBeVisible()
    await expect(button).toBeEnabled()
    await userEvent.click(button)
    await expect(args.onUpdate).toHaveBeenCalled()
  },
}

export const Activating: Story = {
  args: {
    snapshot: snapshot("activating"),
  },
}

export const StateGallery: Story = {
  args: {
    snapshot: snapshot("ready"),
  },
  parameters: {
    docs: {
      description: {
        story: "Curated overview of all owner-facing PWA update states.",
      },
    },
  },
  render: (args) => (
    <div className="grid w-[640px] max-w-[calc(100vw-32px)] gap-4">
      {[snapshot("ready"), snapshot("activating")].map((item) => (
        <div key={item.status} className="relative min-h-[84px]">
          <PwaUpdateToast {...args} snapshot={item} placement="inline" />
        </div>
      ))}
    </div>
  ),
}
