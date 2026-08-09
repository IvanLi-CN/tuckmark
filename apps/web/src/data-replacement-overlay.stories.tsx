import type { Meta, StoryObj } from "@storybook/react-vite"

import { DataReplacementOverlay } from "./data-replacement-overlay.js"

const meta = {
  title: "Tuckmark/System/Data Replacement Overlay",
  component: DataReplacementOverlay,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div style={{ minHeight: "100vh", background: "#d9e2e9", padding: 40 }}>
        <main
          style={{
            maxWidth: 1120,
            margin: "0 auto",
            border: "1px solid #a8b3bb",
            background: "#f8fafb",
            padding: 24,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 22 }}>本地数据目录与备份</h1>
          <p style={{ marginBottom: 0 }}>正在准备数据集切换，其他操作已暂停。</p>
        </main>
        <Story />
      </div>
    ),
  ],
  args: {
    active: true,
  },
} satisfies Meta<typeof DataReplacementOverlay>

export default meta

type Story = StoryObj<typeof meta>

export const Active: Story = {}
