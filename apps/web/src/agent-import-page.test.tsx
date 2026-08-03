// @vitest-environment jsdom

import type { InventoryMaterial } from "@tuckmark/inventory"
import { act } from "react"
import ReactDOM from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import type { AgentImportClient } from "./agent-import-client.js"
import {
  createAgentImportDemoClient,
  createAgentImportDemoSession,
} from "./agent-import-demo-data.js"
import { AgentImportPage } from "./agent-import-page.js"

let mountedRoot: ReturnType<typeof ReactDOM.createRoot> | null = null

async function flush(times = 4): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

async function renderNode(node: React.ReactNode) {
  document.body.innerHTML = '<div id="root"></div>'
  const rootElement = document.getElementById("root")
  if (!rootElement) throw new Error("Missing root element")
  await act(async () => {
    mountedRoot = ReactDOM.createRoot(rootElement)
    mountedRoot.render(node)
    await flush()
  })
}

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => {
      mountedRoot?.unmount()
      await flush()
    })
  }
  mountedRoot = null
  document.body.innerHTML = ""
})

describe("AgentImportPage", () => {
  it("does not render datasheet fields or notices", async () => {
    const seed = createAgentImportDemoSession()
    const client = createAgentImportDemoClient(seed)

    await renderNode(<AgentImportPage initialSession={seed} client={client} />)
    await act(async () => {
      await flush(8)
    })

    expect(document.body.textContent).not.toContain("数据手册")
  })

  it("renders restock rows from the authoritative DEVD target rather than the proposal", async () => {
    const seed = createAgentImportDemoSession({
      proposal: {
        ...createAgentImportDemoSession().proposal,
        items: createAgentImportDemoSession().proposal.items.map((item) =>
          item.kind === "restock"
            ? {
                ...item,
                material: {
                  ...item.material,
                  fullName: "Spoofed mock proposal material",
                  baseName: "SPOOF-100",
                  packageName: "SPOOF",
                },
              }
            : item
        ),
      },
    })
    const target: InventoryMaterial = {
      id: "inventory-material-demo-resistor",
      fullName: "Authoritative mock resistor",
      baseName: "AUTH-10K",
      packageName: "0603",
      description: "Mock DEVD target",
      deviceDetails: "",
      packagingRemark: "reel",
      currentQuantity: 42,
      createdAt: "2030-07-28T08:00:00.000Z",
      updatedAt: "2030-07-29T08:00:00.000Z",
      archivedAt: null,
      labelBindings: [],
    }
    const client: AgentImportClient = {
      async renderTemplatePreview() {
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" />'
      },
      async getSession() {
        return seed
      },
      async getRestockTargets() {
        return [{ itemId: "demo-restock-resistor", material: target }]
      },
      async updateItem() {
        return seed
      },
      async requestTemplateInput() {
        return seed
      },
      async confirm() {
        return seed
      },
      async listEvents() {
        return []
      },
    }

    await renderNode(<AgentImportPage initialSession={seed} client={client} />)
    await act(async () => {
      await flush(8)
    })

    expect(document.body.textContent).toContain("Authoritative mock resistor")
    expect(document.body.textContent).not.toContain("Spoofed mock proposal material")
  })
})
