import type {
  AgentImportEvent,
  AgentImportItem,
  AgentImportSession,
  AgentImportTemplate,
  InventoryMaterial,
} from "@tuckmark/inventory"
import { buildSvg, getTemplateById } from "../../../packages/core/src/web.js"

import { compileDraftToFilledCanvasDefinition } from "./canvas-editor-model.js"
import { HttpRuntimeStore } from "./devd-data-client.js"

type TemplateRuntimeStore = Pick<HttpRuntimeStore, "readTemplate">

type SessionResponse = { session: AgentImportSession }

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed: ${response.status}`)
  }
  return payload
}

export interface AgentImportClient {
  renderTemplatePreview(
    template: AgentImportTemplate,
    input: Record<string, string>
  ): Promise<string | null>
  getSession(sessionId: string, secret: string): Promise<AgentImportSession>
  getRestockTargets(
    sessionId: string,
    secret: string
  ): Promise<Array<{ itemId: string; material: InventoryMaterial }>>
  updateItem(args: {
    sessionId: string
    secret: string
    itemId: string
    expectedRevision: number
    item: AgentImportItem
  }): Promise<AgentImportSession>
  requestTemplateInput(args: {
    sessionId: string
    secret: string
    itemId: string
    expectedRevision: number
    template: AgentImportTemplate
  }): Promise<AgentImportSession>
  confirm(sessionId: string, secret: string): Promise<AgentImportSession>
  listEvents(sessionId: string, secret: string): Promise<AgentImportEvent[]>
}

export class HttpAgentImportClient implements AgentImportClient {
  constructor(
    private readonly apiBasePath = "/api",
    private readonly runtimeStore: TemplateRuntimeStore = new HttpRuntimeStore()
  ) {}

  async renderTemplatePreview(
    template: AgentImportTemplate,
    input: Record<string, string>
  ): Promise<string | null> {
    try {
      if (template.source === "system") {
        const definition = getTemplateById(template.id)
        return buildSvg(definition.width, definition.height, definition.elements, input)
      }
      const savedTemplate = await this.runtimeStore.readTemplate(template.id)
      if (!savedTemplate?.document) return null
      const definition = compileDraftToFilledCanvasDefinition(savedTemplate.document, input)
      return buildSvg(definition.width, definition.height, definition.elements, {})
    } catch {
      return null
    }
  }

  async getSession(sessionId: string, secret: string): Promise<AgentImportSession> {
    const response = await requestJson<SessionResponse>(
      `${this.apiBasePath}/agent-import/sessions/${encodeURIComponent(sessionId)}`,
      { headers: { "x-tuckmark-agent-import-key": secret } }
    )
    return response.session
  }

  async getRestockTargets(
    sessionId: string,
    secret: string
  ): Promise<Array<{ itemId: string; material: InventoryMaterial }>> {
    const response = await requestJson<{
      targets: Array<{ itemId: string; material: InventoryMaterial }>
    }>(
      `${this.apiBasePath}/agent-import/sessions/${encodeURIComponent(sessionId)}/restock-targets`,
      { headers: { "x-tuckmark-agent-import-key": secret } }
    )
    return response.targets
  }

  async updateItem(args: {
    sessionId: string
    secret: string
    itemId: string
    expectedRevision: number
    item: AgentImportItem
  }): Promise<AgentImportSession> {
    const response = await requestJson<SessionResponse>(
      `${this.apiBasePath}/agent-import/sessions/${encodeURIComponent(args.sessionId)}/items/${encodeURIComponent(args.itemId)}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-tuckmark-agent-import-key": args.secret,
        },
        body: JSON.stringify({ expectedRevision: args.expectedRevision, item: args.item }),
      }
    )
    return response.session
  }

  async requestTemplateInput(args: {
    sessionId: string
    secret: string
    itemId: string
    expectedRevision: number
    template: AgentImportTemplate
  }): Promise<AgentImportSession> {
    const response = await requestJson<SessionResponse>(
      `${this.apiBasePath}/agent-import/sessions/${encodeURIComponent(args.sessionId)}/items/${encodeURIComponent(args.itemId)}/template-input`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tuckmark-agent-import-key": args.secret,
        },
        body: JSON.stringify({
          expectedRevision: args.expectedRevision,
          template: args.template,
        }),
      }
    )
    return response.session
  }

  async confirm(sessionId: string, secret: string): Promise<AgentImportSession> {
    const response = await requestJson<SessionResponse>(
      `${this.apiBasePath}/agent-import/sessions/${encodeURIComponent(sessionId)}/confirm`,
      {
        method: "POST",
        headers: { "x-tuckmark-agent-import-key": secret },
      }
    )
    return response.session
  }

  async listEvents(sessionId: string, secret: string): Promise<AgentImportEvent[]> {
    const response = await requestJson<{ events: AgentImportEvent[] }>(
      `${this.apiBasePath}/agent-import/sessions/${encodeURIComponent(sessionId)}/events`,
      { headers: { "x-tuckmark-agent-import-key": secret } }
    )
    return response.events
  }
}
