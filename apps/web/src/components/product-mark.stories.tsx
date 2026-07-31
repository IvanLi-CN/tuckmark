import type { Meta, StoryObj } from "@storybook/react-vite"

import { ProductMark } from "./product-mark.js"

const meta = {
  title: "Tuckmark/Brand/ProductMark",
  component: ProductMark,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <div
        className="tm-theme-scope tm-theme-scope--light min-h-48 bg-background p-8"
        style={{ backgroundColor: "#f6efe6", backgroundImage: "none" }}
      >
        <div className="max-w-sm rounded-lg border border-border bg-card p-6">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof ProductMark>

export default meta

type Story = StoryObj<typeof meta>

export const Gallery: Story = {
  render: () => (
    <div className="grid max-w-sm gap-8" data-testid="product-mark-gallery">
      <section className="grid gap-3">
        <h2 className="text-sm font-semibold text-foreground">Header mark</h2>
        <ProductMark />
      </section>
      <section className="grid gap-3">
        <h2 className="text-sm font-semibold text-foreground">Compact mark</h2>
        <ProductMark compact />
      </section>
    </div>
  ),
}

export const Default: Story = {}

export const Compact: Story = {
  args: {
    compact: true,
  },
}
