import type { AgentImportItem, AgentImportSession, AgentImportTemplate } from "@tuckmark/inventory"

import type { AgentImportClient } from "./agent-import-client.js"

const cableTemplate: AgentImportTemplate = {
  source: "system",
  id: "cable-tag",
  name: "Cable Tag",
  fields: [
    { key: "name", label: "名称", required: true, multiline: false },
    { key: "port", label: "规格", required: false, multiline: false },
    { key: "location", label: "库位", required: false, multiline: false },
  ],
  recommendedUses: [
    { scope: "electronics", weight: 90 },
    { scope: "cable", weight: 100 },
  ],
}

const shippingTemplate: AgentImportTemplate = {
  source: "system",
  id: "shipping-compact",
  name: "Compact Shipping Label",
  fields: [
    { key: "recipient", label: "名称", required: true, multiline: false },
    { key: "address", label: "规格", required: true, multiline: true },
    { key: "orderId", label: "物料码", required: true, multiline: false },
  ],
  recommendedUses: [{ scope: "shipping", weight: 100 }],
}

function cloneSession(session: AgentImportSession): AgentImportSession {
  return JSON.parse(JSON.stringify(session)) as AgentImportSession
}

export function createAgentImportDemoSession(
  overrides: Partial<AgentImportSession> = {}
): AgentImportSession {
  const newItem: AgentImportItem = {
    id: "demo-new-regulator",
    kind: "new",
    selected: true,
    material: {
      fullName: "TPS62933DRLR",
      baseName: "TPS62933",
      variantName: "DRLR",
      packageName: "SOT-583",
      description: "同步降压转换器，Mock 提案仅用于演示确认页。",
      matrixCode: "P2-A104",
      packagingRemark: "编带一盘 3000pcs",
      datasheets: [
        {
          title: "Manufacturer datasheet",
          url: "https://manufacturer.example/tps62933.pdf",
          source: "manufacturer",
        },
      ],
    },
    quantity: 120,
    labelPrintQuantity: 2,
    sourceNote: "Mock 订单提案 · 收货批次 A",
    needsAttention: "型号后缀来自商品标题，建议在导入前核对封装。",
    template: cableTemplate,
    templateAlternatives: [shippingTemplate],
    templateInput: {
      name: "TPS62933DRLR",
      port: "SOT-583",
      location: "A-03-12",
    },
    revision: 0,
    pendingTemplateEventId: null,
  }
  const restockItem: AgentImportItem = {
    id: "demo-restock-resistor",
    kind: "restock",
    selected: true,
    material: {
      fullName: "RC0603FR-0710KL",
      baseName: "RC0603FR",
      variantName: "10K 1%",
      packageName: "0603",
      description: "既有物料；保留它原有的标签绑定。",
      packagingRemark: "整盘",
      datasheets: [],
    },
    targetMaterialId: "inventory-material-demo-resistor",
    targetMaterialUpdatedAt: "2030-07-29T08:00:00.000Z",
    quantity: 500,
    sourceNote: "Mock 订单提案 · 收货批次 B",
    templateAlternatives: [],
    templateInput: {},
    revision: 0,
    pendingTemplateEventId: null,
  }
  return {
    id: "demo-agent-import-session",
    state: "open",
    createdAt: "2030-07-29T08:00:00.000Z",
    expiresAt: "2030-07-29T08:30:00.000Z",
    proposal: {
      schema: "tuckmark.agent-import.v1",
      sourceNote: "Mock Taobao order interpretation",
      items: [newItem, restockItem],
    },
    events: [],
    ...overrides,
  }
}

export function createAgentImportDemoClient(
  seed = createAgentImportDemoSession()
): AgentImportClient {
  let session = cloneSession(seed)
  return {
    async getSession() {
      return cloneSession(session)
    },
    async updateItem(args) {
      session = {
        ...session,
        proposal: {
          ...session.proposal,
          items: session.proposal.items.map((item) =>
            item.id === args.itemId ? { ...args.item, revision: args.expectedRevision + 1 } : item
          ),
        },
      }
      return cloneSession(session)
    },
    async requestTemplateInput(args) {
      const eventId = `demo-template-event-${args.itemId}`
      const revision = args.expectedRevision + 1
      session = {
        ...session,
        proposal: {
          ...session.proposal,
          items: session.proposal.items.map((item) =>
            item.id === args.itemId
              ? {
                  ...item,
                  template: args.template,
                  templateInput: {},
                  pendingTemplateEventId: eventId,
                  revision,
                }
              : item
          ),
        },
        events: [
          ...session.events,
          {
            id: eventId,
            type: "template-input-requested",
            itemId: args.itemId,
            revision,
            template: args.template,
            createdAt: "2030-07-29T08:05:00.000Z",
            status: "open",
          },
        ],
      }
      return cloneSession(session)
    },
    async confirm() {
      session = { ...session, state: "completed" }
      return cloneSession(session)
    },
    async listEvents() {
      return session.events.filter((event) => event.status === "open")
    },
  }
}
