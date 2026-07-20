import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within } from "storybook/test"

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
          "Owner-facing footer metadata fragment. Tagged builds keep the release version visible, deep-link into the repository's OctoRill release list, and expose the build reference on hover; untagged builds show the build reference directly.",
      },
    },
  },
  args: {
    appVersion: "0.2.0-preview.11",
    buildRef: "e499426",
    repositoryUrl: "https://github.com/IvanLi-CN/tuckmark",
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
  repositoryUrl = "https://github.com/IvanLi-CN/tuckmark",
}: {
  label: string
  appVersion: string
  buildRef: string
  repositoryUrl?: string
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[1.25rem] border border-border/70 bg-card/90 p-4 shadow-[0_8px_18px_rgba(73,46,24,0.08)]">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <div className="tm-footer max-w-fit px-4 py-2">
        <FooterBuildMeta
          appVersion={appVersion}
          buildRef={buildRef}
          repositoryUrl={repositoryUrl}
        />
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
      story:
        "Hover or focus the tagged footer metadata to reveal the build reference tooltip while keeping the OctoRill release deep link clickable.",
    },
  },
}

TaggedBuild.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  const releaseLink = canvas.getByRole("link", { name: "v0.2.0-preview.11" })
  await expect(releaseLink).toHaveAttribute(
    "href",
    "https://octo-rill.ivanli.cc/IvanLi-CN/tuckmark/releases?highlight=tag%3Av0.2.0-preview.11&highlight_active=tag%3Av0.2.0-preview.11"
  )
  await expect(releaseLink).toHaveAttribute("target", "_blank")
  await userEvent.hover(releaseLink)
  await expect(canvasElement.ownerDocument.body).toHaveTextContent("build e499426")
}

export const UntaggedBuild: Story = {
  args: {
    appVersion: "",
    buildRef: "e499426",
    repositoryUrl: "https://github.com/IvanLi-CN/tuckmark",
  },
}

export const LocalFallback: Story = {
  args: {
    appVersion: "0.1.0",
    buildRef: "",
    repositoryUrl: "https://github.com/IvanLi-CN/tuckmark",
  },
}

export const TaggedBuildRepositoryFallback: Story = {
  args: {
    appVersion: "0.2.0-preview.11",
    buildRef: "e499426",
    repositoryUrl: "https://example.test/not-github",
  },
}
