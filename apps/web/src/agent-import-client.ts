import type {
  AgentImportEvent,
  AgentImportItem,
  AgentImportLocalTemplate,
  AgentImportSession,
  AgentImportTemplate,
} from "@tuckmark/inventory"

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
  getSession(sessionId: string, secret: string): Promise<AgentImportSession>
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
    localTemplate?: AgentImportLocalTemplate
  }): Promise<AgentImportSession>
  confirm(sessionId: string, secret: string): Promise<AgentImportSession>
  listEvents(sessionId: string, secret: string): Promise<AgentImportEvent[]>
}

export class HttpAgentImportClient implements AgentImportClient {
  constructor(private readonly apiBasePath = "/api") {}

  async getSession(sessionId: string, secret: string): Promise<AgentImportSession> {
    const response = await requestJson<SessionResponse>(
      `${this.apiBasePath}/agent-import/sessions/${encodeURIComponent(sessionId)}`,
      { headers: { "x-tuckmark-agent-import-key": secret } }
    )
    return response.session
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
    localTemplate?: AgentImportLocalTemplate
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
          localTemplate: args.localTemplate,
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
