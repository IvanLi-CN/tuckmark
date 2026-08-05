import { requestIpc } from "@tuckmark/ipc"

export type DevdErrorBody = {
  status?: string
  code?: string
  expectedRevision?: number
  actualRevision?: number
  error?: string
}

export class DevdIpcError extends Error {
  constructor(
    readonly status: number,
    readonly body: DevdErrorBody
  ) {
    super(body.error ?? `DEVD request failed with status ${status}.`)
  }
}

export class DevdIpcClient {
  private revision: number | null = null

  constructor(readonly instance: string) {}

  private async request<T>(
    path: string,
    init?: { method?: string; body?: unknown; headers?: Record<string, string> }
  ) {
    const request = {
      instance: this.instance,
      path,
      ...(init?.method ? { method: init.method } : {}),
      ...(init?.body === undefined ? {} : { body: init.body }),
      ...(init?.headers ? { headers: init.headers } : {}),
    }
    const response = await requestIpc<DevdErrorBody & T>(request)
    if (response.status < 200 || response.status >= 300) {
      throw new DevdIpcError(response.status, response.body)
    }
    return response.body
  }

  async status() {
    const result = await this.request<{
      revision: number
      configured: boolean
      counts: Record<string, number>
    }>("/api/data/status")
    this.revision = result.revision
    return result
  }

  async snapshot() {
    const result = await this.request<{ revision: number; data: any }>("/api/data/runtime/snapshot")
    this.revision = result.revision
    return result.data
  }

  private async expectedRevision(): Promise<number> {
    return this.revision ?? (await this.status()).revision
  }

  async runtimeCommand<T>(command: string, args: unknown): Promise<T> {
    const result = await this.request<{ revision: number; data: T }>(
      `/api/data/runtime/${command}`,
      {
        method: "POST",
        body: { expectedRevision: await this.expectedRevision(), args },
      }
    )
    this.revision = result.revision
    return result.data
  }

  async listMaterials(query = "", includeArchived = false) {
    const params = new URLSearchParams({ query, includeArchived: String(includeArchived) })
    const result = await this.request<{ revision: number; data: any[] }>(
      `/api/data/inventory/materials?${params.toString()}`
    )
    this.revision = result.revision
    return result.data
  }

  async listAdjustments(materialId?: string) {
    const params = new URLSearchParams()
    if (materialId) params.set("materialId", materialId)
    const result = await this.request<{ revision: number; data: any[] }>(
      `/api/data/inventory/adjustments?${params.toString()}`
    )
    this.revision = result.revision
    return result.data
  }

  async inventoryCommand<T>(command: string, args: unknown): Promise<T> {
    const result = await this.request<{ revision: number; data: T }>(
      `/api/data/inventory/${command}`,
      {
        method: "POST",
        body: { expectedRevision: await this.expectedRevision(), args },
      }
    )
    this.revision = result.revision
    return result.data
  }

  async printInventoryBinding<T>(args: unknown): Promise<T> {
    const result = await this.request<{ revision: number; data: T }>(
      "/api/data/inventory/print-binding",
      {
        method: "POST",
        body: { expectedRevision: await this.expectedRevision(), args },
      }
    )
    this.revision = result.revision
    return result.data
  }

  async agentImport<T>(
    path: string,
    init: { method?: string; body?: unknown; secret: string }
  ): Promise<T> {
    return await this.request<T>(path, {
      ...(init.method ? { method: init.method } : {}),
      ...(init.body === undefined ? {} : { body: init.body }),
      ...(init.secret ? { headers: { "x-tuckmark-agent-import-key": init.secret } } : {}),
    })
  }
}
