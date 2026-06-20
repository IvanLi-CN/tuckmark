import {
  buildPreviewArtifact,
  createPreviewDataUrl,
  fallbackTemplates,
  seededPrinters,
} from "./demo-data.js"
import type {
  AppContext,
  PreviewArtifact,
  PreviewResult,
  PrintResult,
  Printer,
  RenderOptions,
  SetupRefreshResult,
  Template,
} from "./types.js"

type JsonResponse = { error?: string }

type PreviewTemplateInput = {
  templateId: string
  input: Record<string, string>
  renderOptions: RenderOptions
}

type PreviewSafeTextInput = {
  text: string
  title: string
  renderOptions: RenderOptions
}

type PrintArtifactInput = {
  printerId: string
  printerName?: string
  artifactId: string
}

type PrintTemplateInput = {
  printerId: string
  printerName?: string
  templateId: string
  input: Record<string, string>
  renderOptions: RenderOptions
}

type PrintSafeTextInput = {
  printerId: string
  printerName?: string
  text: string
  title: string
  renderOptions: RenderOptions
}

export interface ApiClient {
  listTemplates(): Promise<Template[]>
  listPrinters(): Promise<Printer[]>
  previewTemplate(input: PreviewTemplateInput): Promise<PreviewResult>
  previewSafeText(input: PreviewSafeTextInput): Promise<PreviewResult>
  printArtifact(input: PrintArtifactInput): Promise<PrintResult>
  printTemplate(input: PrintTemplateInput): Promise<PrintResult>
  printSafeText(input: PrintSafeTextInput): Promise<PrintResult>
  previewImageUrl(artifact: PreviewArtifact): string
  artifactPacketsUrl(artifactId: string): string
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const json = (await response.json()) as T & JsonResponse
  if (!response.ok) {
    throw new Error(json.error ?? `Request failed: ${response.status}`)
  }
  return json
}

export class HttpApiClient implements ApiClient {
  constructor(private readonly context: AppContext) {}

  async listTemplates(): Promise<Template[]> {
    const response = await requestJson<{ templates: Template[] }>(
      `${this.context.apiBasePath}/templates`
    )
    return response.templates
  }

  async listPrinters(): Promise<Printer[]> {
    const response = await requestJson<{ printers: Printer[] }>(
      `${this.context.apiBasePath}/printers`
    )
    return response.printers
  }

  previewTemplate(input: PreviewTemplateInput): Promise<PreviewResult> {
    return requestJson(`${this.context.apiBasePath}/preview/template`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
  }

  previewSafeText(input: PreviewSafeTextInput): Promise<PreviewResult> {
    return requestJson(`${this.context.apiBasePath}/preview/safe-text`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
  }

  printArtifact(input: PrintArtifactInput): Promise<PrintResult> {
    return requestJson(`${this.context.apiBasePath}/print/artifact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
  }

  printTemplate(input: PrintTemplateInput): Promise<PrintResult> {
    return requestJson(`${this.context.apiBasePath}/print/template`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
  }

  printSafeText(input: PrintSafeTextInput): Promise<PrintResult> {
    return requestJson(`${this.context.apiBasePath}/print/safe-text`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
  }

  previewImageUrl(artifact: PreviewArtifact): string {
    return `${this.context.apiBasePath}/artifacts/${artifact.id}/png`
  }

  artifactPacketsUrl(artifactId: string): string {
    return `${this.context.apiBasePath}/artifacts/${artifactId}/packets`
  }
}

export class MockApiClient implements ApiClient {
  constructor(private readonly context: AppContext) {}

  async listTemplates(): Promise<Template[]> {
    return fallbackTemplates
  }

  async listPrinters(): Promise<Printer[]> {
    return this.context.mode === "demo-seeded" ? seededPrinters : []
  }

  async previewTemplate(input: PreviewTemplateInput): Promise<PreviewResult> {
    return {
      artifact: buildPreviewArtifact(
        input.templateId,
        input.renderOptions,
        `${input.templateId}-${this.context.mode}`
      ),
    }
  }

  async previewSafeText(input: PreviewSafeTextInput): Promise<PreviewResult> {
    return {
      artifact: buildPreviewArtifact(
        undefined,
        input.renderOptions,
        `safe-text-${this.context.mode}`
      ),
    }
  }

  async printArtifact(input: PrintArtifactInput): Promise<PrintResult> {
    return {
      id: `mock-job-${input.artifactId}`,
      status: "completed",
    }
  }

  async printTemplate(input: PrintTemplateInput): Promise<PrintResult> {
    const preview = await this.previewTemplate(input)
    return {
      preview,
      job: {
        id: `mock-template-${input.templateId}`,
        status: "completed",
        artifactId: preview.artifact.id,
        printerId: input.printerId,
      },
    }
  }

  async printSafeText(input: PrintSafeTextInput): Promise<PrintResult> {
    const preview = await this.previewSafeText(input)
    return {
      preview,
      job: {
        id: "mock-safe-text",
        status: "completed",
        artifactId: preview.artifact.id,
        printerId: input.printerId,
      },
    }
  }

  previewImageUrl(artifact: PreviewArtifact): string {
    return createPreviewDataUrl(artifact.templateId)
  }

  artifactPacketsUrl(artifactId: string): string {
    return `${this.context.apiBasePath}/artifacts/${artifactId}/packets`
  }
}

export function createApiClient(context: AppContext): ApiClient {
  return context.mode === "runtime" ? new HttpApiClient(context) : new MockApiClient(context)
}

export async function loadSetup(
  client: ApiClient,
  printers: Printer[],
  preferredName: string
): Promise<SetupRefreshResult> {
  const nextPrinters = await client.listPrinters()
  const nextSelectedPrinter =
    nextPrinters.find((printer) => printer.name === preferredName) ??
    nextPrinters.find((printer) => printers.some((item) => item.id === printer.id)) ??
    (nextPrinters.length === 1 ? nextPrinters[0] : null)

  return {
    printers: nextPrinters,
    selectedPrinter: nextSelectedPrinter,
  }
}
