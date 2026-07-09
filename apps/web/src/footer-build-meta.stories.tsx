import type { Meta, StoryObj } from "@storybook/react-vite"

import { FooterBuildMeta } from "./footer-build-meta.js"

const meta = {
  title: "Tuckmark/Workbench/Footer Build Meta",
  component: FooterBuildMeta,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Owner-facing footer metadata fragment. Tagged builds keep the release version visible and expose the build reference on hover; untagged builds show the build reference directly.",
      },
    },
  },
  args: {
    appVersion: "0.2.0-preview.11",
    buildRef: "e499426",
  },
  render: (args) => (
    <div className="tm-footer max-w-fit">
      <FooterBuildMeta {...args} />
    </div>
  ),
} satisfies Meta<typeof FooterBuildMeta>

export default meta

type Story = StoryObj<typeof meta>

function OverviewCard({
  label,
  appVersion,
  buildRef,
}: {
  label: string
  appVersion: string
  buildRef: string
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[1.25rem] border border-border/70 bg-card/90 p-4 shadow-[0_8px_18px_rgba(73,46,24,0.08)]">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <div className="tm-footer max-w-fit px-4 py-2">
        <FooterBuildMeta appVersion={appVersion} buildRef={buildRef} />
      </div>
    </div>
  )
}

export const Overview: Story = {
  render: () => (
    <div className="grid gap-4 md:grid-cols-3">
      <OverviewCard label="Tagged build" appVersion="0.2.0-preview.11" buildRef="e499426" />
      <OverviewCard label="Untagged build" appVersion="" buildRef="e499426" />
      <OverviewCard label="Local fallback" appVersion="0.1.0" buildRef="" />
    </div>
  ),
}

export const TaggedBuild: Story = {}

TaggedBuild.parameters = {
  docs: {
    description: {
      story: "Hover the footer metadata to reveal the build reference tooltip for a tagged build.",
    },
  },
}

export const UntaggedBuild: Story = {
  args: {
    appVersion: "",
    buildRef: "e499426",
  },
}

export const LocalFallback: Story = {
  args: {
    appVersion: "0.1.0",
    buildRef: "",
  },
}
