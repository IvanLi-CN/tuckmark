import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"

import type { PwaUpdateSnapshot } from "./pwa-lifecycle.js"
import { PwaUpdateToast } from "./pwa-update-toast.js"

function snapshot(
  status: PwaUpdateSnapshot["status"],
  options?: {
    source?: PwaUpdateSnapshot["source"]
    buildRef?: string
    error?: string | null
  }
): PwaUpdateSnapshot {
  return {
    status,
    source: options?.source ?? "none",
    registration: null,
    waitingWorker: null,
    detectedBuildMetadata: options?.buildRef
      ? {
          appVersion: "",
          buildRef: options.buildRef,
        }
      : null,
    error: options?.error ?? null,
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
          "Non-blocking PWA update prompt used by the Tuckmark workbench shell after a new browser-static version is ready to activate, whether it came from a waiting service worker or a stranded-client version probe mismatch.",
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
    snapshot: snapshot("ready", { source: "service-worker" }),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole("button", { name: "更新" })
    await expect(canvas.getByText("新版本可用")).toBeVisible()
    await expect(button).toBeEnabled()
    await userEvent.click(button)
    const dialog = within(document.body).getByRole("dialog", { name: "确认更新 Tuckmark Web" })
    await expect(dialog).toBeVisible()
    await userEvent.click(within(dialog).getByRole("button", { name: "更新" }))
    await expect(args.onUpdate).toHaveBeenCalled()
  },
}

export const Activating: Story = {
  args: {
    snapshot: snapshot("activating", { source: "service-worker" }),
  },
}

export const VersionProbeReady: Story = {
  args: {
    snapshot: snapshot("ready", {
      source: "version-probe",
      buildRef: "e499426",
    }),
  },
}

export const StateGallery: Story = {
  args: {
    snapshot: snapshot("ready", { source: "service-worker" }),
  },
  parameters: {
    docs: {
      description: {
        story:
          "Curated overview of the owner-facing update prompt states for both the waiting-service-worker path and the stranded-client version-probe fallback.",
      },
    },
  },
  render: (args) => (
    <div className="grid w-[640px] max-w-[calc(100vw-32px)] gap-4">
      {[
        {
          label: "Waiting service worker ready",
          item: snapshot("ready", { source: "service-worker" }),
        },
        {
          label: "Version probe mismatch ready",
          item: snapshot("ready", { source: "version-probe", buildRef: "e499426" }),
        },
        {
          label: "Activating update",
          item: snapshot("activating", { source: "service-worker" }),
        },
      ].map(({ label, item }) => (
        <div
          key={`${item.status}-${item.source}-${label}`}
          className="rounded-[1.25rem] border border-border/70 bg-card/80 p-4 shadow-[0_8px_18px_rgba(73,46,24,0.08)]"
        >
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </div>
          <div className="relative min-h-[84px]">
            <PwaUpdateToast {...args} snapshot={item} placement="inline" />
          </div>
        </div>
      ))}
    </div>
  ),
}
