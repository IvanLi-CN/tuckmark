import type {
  DirectCanvasDefinition,
  PrinterProbeResult,
  SyncState,
} from "../../../packages/core/src/web.js"
import { emptySyncState } from "../../../packages/core/src/web.js"
import {
  listBrowserRuntimeTemplates,
  previewCanvasInBrowser,
  previewSafeTextInBrowser,
  previewTemplateInBrowser,
  readBrowserArtifact,
} from "./browser-runtime.js"
import { fallbackTemplates, seededPrinters } from "./demo-data.js"
import type {
  AppContext,
  ArtifactData,
  PreviewArtifact,
  PreviewResult,
  Printer,
  PrintResult,
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

type PreviewCanvasInput = {
  canvas: DirectCanvasDefinition
  renderOptions: RenderOptions
}

type PrintCanvasInput = {
  printerId: string
  printerName?: string
  canvas: DirectCanvasDefinition
  renderOptions: RenderOptions
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const json = (await response.json()) as T & JsonResponse
  if (!response.ok) {
    throw new Error(json.error ?? `Request failed: ${response.status}`)
  }
  return json
}

export interface ApiClient {
  listTemplates(): Promise<Template[]>
  listPrinters(): Promise<Printer[]>
  probePrinter(input: { printerId: string; printerName?: string }): Promise<PrinterProbeResult>
  getSyncState(): Promise<SyncState>
  mergeSyncState(state: SyncState): Promise<SyncState>
  previewTemplate(input: PreviewTemplateInput): Promise<PreviewResult>
  previewCanvas(input: PreviewCanvasInput): Promise<PreviewResult>
  previewSafeText(input: PreviewSafeTextInput): Promise<PreviewResult>
  printArtifact(input: PrintArtifactInput): Promise<PrintResult>
  printTemplate(input: PrintTemplateInput): Promise<PrintResult>
  printCanvas(input: PrintCanvasInput): Promise<PrintResult>
  printSafeText(input: PrintSafeTextInput): Promise<PrintResult>
  readArtifactData(artifact: PreviewArtifact): Promise<ArtifactData>
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

  probePrinter(input: { printerId: string; printerName?: string }): Promise<PrinterProbeResult> {
    return requestJson(`${this.context.apiBasePath}/printers/probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
  }

  async getSyncState(): Promise<SyncState> {
    const response = await requestJson<{ state: SyncState }>(
      `${this.context.apiBasePath}/sync/state`
    )
    return response.state
  }

  async mergeSyncState(state: SyncState): Promise<SyncState> {
    const response = await requestJson<{ state: SyncState }>(
      `${this.context.apiBasePath}/sync/state`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(state),
      }
    )
    return response.state
  }

  previewTemplate(input: PreviewTemplateInput): Promise<PreviewResult> {
    return requestJson(`${this.context.apiBasePath}/preview/template`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
  }

  previewCanvas(input: PreviewCanvasInput): Promise<PreviewResult> {
    return requestJson(`${this.context.apiBasePath}/preview/canvas`, {
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

  printCanvas(input: PrintCanvasInput): Promise<PrintResult> {
    return requestJson(`${this.context.apiBasePath}/print/canvas`, {
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

  async readArtifactData(artifact: PreviewArtifact): Promise<ArtifactData> {
    const packets = await requestJson<{
      artifactId: string
      packetsJsonPath: string
      packets: string[]
      packetCount: number
      totalBytes: number
    }>(`${this.context.apiBasePath}/artifacts/${artifact.id}/packets`)

    return {
      preview: {
        kind: "url",
        url: `${this.context.apiBasePath}/artifacts/${artifact.id}/png`,
      },
      packets,
    }
  }
}

export class BrowserRuntimeApiClient implements ApiClient {
  async listTemplates(): Promise<Template[]> {
    return listBrowserRuntimeTemplates()
  }

  async listPrinters(): Promise<Printer[]> {
    return []
  }

  async probePrinter(): Promise<PrinterProbeResult> {
    throw new Error("browser-static surface does not expose service-api printer probing.")
  }

  async getSyncState(): Promise<SyncState> {
    return emptySyncState()
  }

  async mergeSyncState(state: SyncState): Promise<SyncState> {
    return state
  }

  previewTemplate(input: PreviewTemplateInput): Promise<PreviewResult> {
    return previewTemplateInBrowser(input)
  }

  previewCanvas(input: PreviewCanvasInput): Promise<PreviewResult> {
    return previewCanvasInBrowser(input)
  }

  previewSafeText(input: PreviewSafeTextInput): Promise<PreviewResult> {
    return previewSafeTextInBrowser(input)
  }

  async printArtifact(input: PrintArtifactInput): Promise<PrintResult> {
    return {
      id: `browser-artifact-${input.artifactId}`,
      status: "ready",
    }
  }

  async printTemplate(input: PrintTemplateInput): Promise<PrintResult> {
    return {
      preview: await this.previewTemplate(input),
      status: "ready",
    }
  }

  async printCanvas(input: PrintCanvasInput): Promise<PrintResult> {
    return {
      preview: await this.previewCanvas(input),
      status: "ready",
    }
  }

  async printSafeText(input: PrintSafeTextInput): Promise<PrintResult> {
    return {
      preview: await this.previewSafeText(input),
      status: "ready",
    }
  }

  async readArtifactData(artifact: PreviewArtifact): Promise<ArtifactData> {
    const stored = await readBrowserArtifact(artifact.id)
    return stored.data
  }
}

export class DemoApiClient implements ApiClient {
  constructor(readonly _context: AppContext) {}

  async listTemplates(): Promise<Template[]> {
    return fallbackTemplates
  }

  async listPrinters(): Promise<Printer[]> {
    return seededPrinters
  }

  async probePrinter(input: {
    printerId: string
    printerName?: string
  }): Promise<PrinterProbeResult> {
    await sleep(360)
    return {
      ok: true,
      printerId: input.printerId,
      printerName: input.printerName,
      stage: "complete",
      message: "Demo probe completed successfully.",
      log: ["demo: open", "demo: connect", "demo: complete"],
      timingsMs: {
        connectMs: 320,
        discoverServiceMs: 140,
        discoverCharacteristicMs: 120,
        disconnectMs: 80,
      },
    }
  }

  async getSyncState(): Promise<SyncState> {
    return emptySyncState()
  }

  async mergeSyncState(state: SyncState): Promise<SyncState> {
    return state
  }

  async previewTemplate(input: PreviewTemplateInput): Promise<PreviewResult> {
    await sleep(420)
    return previewTemplateInBrowser(input)
  }

  async previewCanvas(input: PreviewCanvasInput): Promise<PreviewResult> {
    await sleep(420)
    return previewCanvasInBrowser(input)
  }

  async previewSafeText(input: PreviewSafeTextInput): Promise<PreviewResult> {
    await sleep(360)
    return previewSafeTextInBrowser(input)
  }

  async printArtifact(input: PrintArtifactInput): Promise<PrintResult> {
    await sleep(980)
    return {
      id: `demo-artifact-${input.artifactId}`,
      status: "completed",
    }
  }

  async printTemplate(input: PrintTemplateInput): Promise<PrintResult> {
    const preview = await this.previewTemplate(input)
    await sleep(980)
    return {
      preview,
      job: {
        id: `demo-template-${input.templateId}`,
        status: "completed",
        artifactId: preview.artifact.id,
        printerId: input.printerId,
      },
    }
  }

  async printCanvas(input: PrintCanvasInput): Promise<PrintResult> {
    const preview = await this.previewCanvas(input)
    await sleep(980)
    return {
      preview,
      job: {
        id: `demo-canvas-${input.canvas.id}`,
        status: "completed",
        artifactId: preview.artifact.id,
        printerId: input.printerId,
      },
    }
  }

  async printSafeText(input: PrintSafeTextInput): Promise<PrintResult> {
    const preview = await this.previewSafeText(input)
    await sleep(980)
    return {
      preview,
      job: {
        id: "demo-safe-text",
        status: "completed",
        artifactId: preview.artifact.id,
        printerId: input.printerId,
      },
    }
  }

  async readArtifactData(artifact: PreviewArtifact): Promise<ArtifactData> {
    const stored = await readBrowserArtifact(artifact.id)
    return stored.data
  }
}

export function createApiClient(context: AppContext): ApiClient {
  if (context.mode === "demo") {
    return new DemoApiClient(context)
  }
  return context.surface === "browser-static"
    ? new BrowserRuntimeApiClient()
    : new HttpApiClient(context)
}

export async function loadSetup(
  client: ApiClient,
  printers: Printer[],
  preferredName: string
): Promise<SetupRefreshResult> {
  const nextPrinters = await client.listPrinters()
  const preferredPrinter = nextPrinters.find((printer) => printer.name === preferredName)
  const matchingPrinter = nextPrinters.find((printer) =>
    printers.some((item) => item.id === printer.id)
  )
  const singletonPrinter = nextPrinters.length === 1 ? nextPrinters[0] : null

  if (preferredPrinter) {
    return {
      printers: nextPrinters,
      selectedPrinter: preferredPrinter,
      selectedPrinterReason: "preferred-name",
    }
  }

  if (matchingPrinter) {
    return {
      printers: nextPrinters,
      selectedPrinter: matchingPrinter,
      selectedPrinterReason: "same-id",
    }
  }

  if (singletonPrinter) {
    return {
      printers: nextPrinters,
      selectedPrinter: singletonPrinter,
      selectedPrinterReason: "singleton",
    }
  }

  return {
    printers: nextPrinters,
    selectedPrinter: null,
    selectedPrinterReason: "none",
  }
}
