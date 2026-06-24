import type { Meta, StoryObj } from "@storybook/react-vite"

import { Input } from "./input.js"

const meta = {
  title: "Tuckmark/UI/Input",
  component: Input,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof Input>

export default meta

type Story = StoryObj<typeof meta>

const sizeSamples = [
  {
    label: "Default / xs",
    density: "default" as const,
    size: "xs" as const,
    value: "Browser static",
  },
  {
    label: "Default / sm",
    density: "default" as const,
    size: "sm" as const,
    value: "Browser static",
  },
  {
    label: "Default / md",
    density: "default" as const,
    size: "md" as const,
    value: "Browser static",
  },
  {
    label: "Default / lg",
    density: "default" as const,
    size: "lg" as const,
    value: "Browser static",
  },
  { label: "Compact / xs", density: "compact" as const, size: "xs" as const, value: "TM-001" },
  { label: "Compact / sm", density: "compact" as const, size: "sm" as const, value: "TM-001" },
  { label: "Compact / md", density: "compact" as const, size: "md" as const, value: "Koha Cat" },
  {
    label: "Compact / lg",
    density: "compact" as const,
    size: "lg" as const,
    value: "Moon Street 42",
  },
] as const

const contentFitSamples = [
  {
    label: "Content fit / xs",
    size: "xs" as const,
    value: "TM-001",
    minWidthPx: 84,
    maxWidthPx: 132,
  },
  {
    label: "Content fit / min",
    size: "sm" as const,
    value: "TM-001",
    minWidthPx: 96,
    maxWidthPx: 168,
  },
  {
    label: "Content fit / short",
    size: "md" as const,
    value: "Koha Cat",
    minWidthPx: 96,
    maxWidthPx: 168,
  },
  {
    label: "Content fit / address",
    size: "md" as const,
    value: "Moon Street 42 Shanghai",
    minWidthPx: 132,
    maxWidthPx: 224,
  },
  {
    label: "Content fit / note",
    size: "lg" as const,
    value: "fragile",
    minWidthPx: 96,
    maxWidthPx: 132,
  },
] as const

export const Gallery: Story = {
  render: () => (
    <div className="grid gap-8 p-6">
      <section className="grid gap-4">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold text-foreground">Input size gallery</h2>
          <p className="text-sm text-muted-foreground">
            Full public size system for normal fields and compact table inputs.
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
          <div className="grid grid-cols-[160px_1fr] gap-x-4 border-b border-border/60 bg-muted/45 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <span>Variant</span>
            <span>Preview</span>
          </div>
          {sizeSamples.map((sample) => (
            <div
              key={sample.label}
              className="grid grid-cols-[160px_1fr] items-center gap-x-4 border-b border-border/60 px-4 py-2 last:border-b-0"
            >
              <span className="text-sm text-foreground">{sample.label}</span>
              <div className="max-w-sm">
                <Input density={sample.density} size={sample.size} defaultValue={sample.value} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold text-foreground">Compact content-fit gallery</h2>
          <p className="text-sm text-muted-foreground">
            Compact inputs with adaptive width plus explicit minimum and maximum bounds.
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
          <div className="grid grid-cols-[160px_1fr] gap-x-4 border-b border-border/60 bg-muted/45 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <span>Variant</span>
            <span>Preview</span>
          </div>
          {contentFitSamples.map((sample) => (
            <div
              key={sample.label}
              className="grid grid-cols-[160px_1fr] items-center gap-x-4 border-b border-border/60 px-4 py-2 last:border-b-0"
            >
              <span className="text-sm text-foreground">{sample.label}</span>
              <Input
                density="compact"
                size={sample.size}
                widthMode="content-fit"
                minWidthPx={sample.minWidthPx}
                maxWidthPx={sample.maxWidthPx}
                defaultValue={sample.value}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  ),
}
