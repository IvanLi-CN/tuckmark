import { randomUUID } from "node:crypto"

import { ArtifactStore } from "./artifact-store.js"
import { parseCsvRows } from "./csv.js"
import { DetongerAdapter } from "./detonger-adapter.js"
import {
  renderCanvasToPreview,
  renderSafeTextLabelPreview,
  renderTemplateToPreview,
} from "./renderer.js"
import type {
  CanvasDraftRecord,
  RecentPrintRecord,
  SyncState,
  TemplateUsageRecord,
} from "./sync-state.js"
import { SyncStateStore } from "./sync-state-store.js"
import { getTemplateById, presetTemplates } from "./template-library.js"
import type {
  ArtifactPackets,
  BatchPreviewRequest,
  BatchPreviewResult,
  DirectCanvasPreviewRequest,
  PreviewArtifact,
  PreviewRequest,
  PreviewResult,
  PrintBatchRequest,
  PrintByArtifactRequest,
  PrintByTemplateRequest,
  PrintCanvasRequest,
  Printer,
  PrinterCapabilities,
  PrinterProbeResult,
  PrintJob,
  SafeTextLabelInput,
  TemplateDefinition,
} from "./types.js"

export interface TuckmarkServiceOptions {
  artifactStore?: ArtifactStore
  detonger?: DetongerAdapter
  syncStateStore?: SyncStateStore
}

export class TuckmarkService {
  readonly artifactStore: ArtifactStore
  readonly detonger: DetongerAdapter
  readonly syncStateStore: SyncStateStore
  readonly serverSidePrintEnabled: boolean

  constructor(options?: TuckmarkServiceOptions) {
    this.artifactStore = options?.artifactStore ?? new ArtifactStore()
    this.detonger = options?.detonger ?? new DetongerAdapter()
    this.syncStateStore = options?.syncStateStore ?? new SyncStateStore(this.artifactStore.root)
    const serverSidePrintFlag = process.env.TUCKMARK_ENABLE_SERVER_SIDE_PRINT?.trim().toLowerCase()
    this.serverSidePrintEnabled = serverSidePrintFlag === "1" || serverSidePrintFlag === "true"
  }

  async listTemplates(): Promise<TemplateDefinition[]> {
    return presetTemplates
  }

  private normalizeTemplateInput(
    template: TemplateDefinition,
    input: Record<string, string>
  ): Record<string, string> {
    const resolved: Record<string, string> = {}

    for (const field of template.fields) {
      const raw = input[field.key] ?? field.defaultValue ?? ""
      const value = raw.trim()
      if (field.required && value.length === 0) {
        throw new Error(`Missing required field: ${field.key}`)
      }
      resolved[field.key] = raw
    }

    for (const [key, value] of Object.entries(input)) {
      if (!(key in resolved)) {
        resolved[key] = value
      }
    }

    return resolved
  }

  private ensurePrintable(caps: PrinterCapabilities, artifact: PreviewArtifact): void {
    if (artifact.width > caps.printWidthDots) {
      throw new Error(
        `Artifact width ${artifact.width} exceeds printer width ${caps.printWidthDots}`
      )
    }
    if (!caps.supportedPaperTypes.includes(artifact.renderOptions.paperType)) {
      throw new Error(`Printer does not support paper type: ${artifact.renderOptions.paperType}`)
    }
  }

  async listPrinters(): Promise<Printer[]> {
    return this.detonger.scanPrinters()
  }

  async probePrinter(printerId: string, printerName?: string): Promise<PrinterProbeResult> {
    return this.detonger.probePrinter(printerId, printerName)
  }

  async previewTemplate(request: PreviewRequest): Promise<PreviewResult> {
    const template = getTemplateById(request.templateId)
    const normalizedInput = this.normalizeTemplateInput(template, request.input)
    const rendered = renderTemplateToPreview(template, normalizedInput, request.renderOptions)
    const artifact = await this.artifactStore.writeArtifact(rendered.artifact, {
      png: rendered.png,
      bitmap: rendered.bitmap,
      svg: rendered.svg,
    })
    return { artifact }
  }

  async previewCanvas(request: DirectCanvasPreviewRequest): Promise<PreviewResult> {
    const rendered = renderCanvasToPreview(request.canvas, request.renderOptions)
    const artifact = await this.artifactStore.writeArtifact(rendered.artifact, {
      png: rendered.png,
      bitmap: rendered.bitmap,
      svg: rendered.svg,
    })
    return { artifact }
  }

  async previewSafeTextLabel(request: SafeTextLabelInput): Promise<PreviewResult> {
    const rendered = renderSafeTextLabelPreview(request)
    const artifact = await this.artifactStore.writeArtifact(rendered.artifact, {
      png: rendered.png,
      bitmap: rendered.bitmap,
      svg: rendered.svg,
    })
    return { artifact }
  }

  async previewBatch(request: BatchPreviewRequest): Promise<BatchPreviewResult> {
    const template = getTemplateById(request.templateId)
    const rows = parseCsvRows(request.csvText)
    const items = []
    for (const [index, row] of rows.entries()) {
      const normalizedInput = this.normalizeTemplateInput(template, row)
      const rendered = renderTemplateToPreview(
        template,
        normalizedInput,
        request.renderOptions,
        index
      )
      const artifact = await this.artifactStore.writeArtifact(rendered.artifact, {
        png: rendered.png,
        bitmap: rendered.bitmap,
        svg: rendered.svg,
      })
      items.push({ index, input: row, artifact })
    }
    return {
      templateId: template.id,
      total: items.length,
      items,
    }
  }

  async getArtifact(artifactId: string): Promise<PreviewArtifact> {
    return this.artifactStore.getArtifact(artifactId)
  }

  async listArtifacts(): Promise<PreviewArtifact[]> {
    return this.artifactStore.listArtifacts()
  }

  async getSyncState(): Promise<SyncState> {
    return this.syncStateStore.readState()
  }

  async mergeSyncState(next: SyncState): Promise<SyncState> {
    return this.syncStateStore.mergeState(next)
  }

  async upsertTemplateUsageRecord(record: TemplateUsageRecord): Promise<SyncState> {
    const current = await this.getSyncState()
    return this.mergeSyncState({
      ...current,
      templateUsageRecords: [record],
      updatedAt: new Date().toISOString(),
    })
  }

  async upsertRecentPrintRecord(record: RecentPrintRecord): Promise<SyncState> {
    const current = await this.getSyncState()
    return this.mergeSyncState({
      ...current,
      recentPrintRecords: [record],
      updatedAt: new Date().toISOString(),
    })
  }

  async upsertCanvasDraftRecord(record: CanvasDraftRecord): Promise<SyncState> {
    const current = await this.getSyncState()
    return this.mergeSyncState({
      ...current,
      canvasDraftRecords: [record],
      updatedAt: new Date().toISOString(),
    })
  }

  async getArtifactPackets(artifactId: string): Promise<ArtifactPackets> {
    const artifact = await this.getArtifact(artifactId)
    return this.detonger.encodeArtifactPackets(artifact)
  }

  private resolveRequestedPrinter(
    printers: Printer[],
    request: { printerId: string; printerName?: string | undefined }
  ): Printer {
    const byId = printers.find((item) => item.id === request.printerId)
    if (byId) {
      return byId
    }

    if (request.printerName) {
      const byName = printers.find((item) => item.name === request.printerName)
      if (byName) {
        return byName
      }
    }

    const suffix = request.printerName ? ` (${request.printerName})` : ""
    throw new Error(
      `Printer is no longer available: ${request.printerId}${suffix}. Refresh printers and retry.`
    )
  }

  private async resolvePrintableRequest(request: {
    printerId: string
    printerName?: string | undefined
  }): Promise<Printer> {
    const printers = await this.listPrinters()
    const printer = this.resolveRequestedPrinter(printers, request)

    if (printer.id === request.printerId) {
      return printer
    }

    const refreshedPrinters = await this.listPrinters()
    return this.resolveRequestedPrinter(refreshedPrinters, {
      printerId: printer.id,
      printerName: printer.name ?? request.printerName,
    })
  }

  private ensureServerSidePrintEnabled(): void {
    if (!this.serverSidePrintEnabled) {
      throw new Error(
        "Server-side printer control is disabled. Set TUCKMARK_ENABLE_SERVER_SIDE_PRINT=1 to enable it."
      )
    }
  }

  async printByArtifact(request: PrintByArtifactRequest): Promise<PrintJob> {
    this.ensureServerSidePrintEnabled()
    const artifact = await this.getArtifact(request.artifactId)
    const printer = await this.resolvePrintableRequest(request)
    this.ensurePrintable(printer.capabilities, artifact)
    await this.detonger.printArtifact(printer.id, artifact)
    return {
      id: randomUUID(),
      artifactId: artifact.id,
      printerId: printer.id,
      createdAt: new Date().toISOString(),
      status: "completed",
    }
  }

  async printBatch(request: PrintBatchRequest): Promise<{ jobs: PrintJob[] }> {
    this.ensureServerSidePrintEnabled()
    const jobs: PrintJob[] = []
    for (const artifactId of request.artifactIds) {
      jobs.push(
        await this.printByArtifact({
          printerId: request.printerId,
          printerName: request.printerName,
          artifactId,
        })
      )
    }
    return { jobs }
  }

  async printByTemplate(
    request: PrintByTemplateRequest
  ): Promise<{ preview: PreviewResult; job: PrintJob }> {
    this.ensureServerSidePrintEnabled()
    const preview = await this.previewTemplate({
      templateId: request.templateId,
      input: request.input,
      renderOptions: request.renderOptions,
    })
    const job = await this.printByArtifact({
      printerId: request.printerId,
      printerName: request.printerName,
      artifactId: preview.artifact.id,
    })
    return { preview, job }
  }

  async printCanvas(
    request: PrintCanvasRequest
  ): Promise<{ preview: PreviewResult; job: PrintJob }> {
    this.ensureServerSidePrintEnabled()
    const preview = await this.previewCanvas({
      canvas: request.canvas,
      renderOptions: request.renderOptions,
    })
    const job = await this.printByArtifact({
      printerId: request.printerId,
      printerName: request.printerName,
      artifactId: preview.artifact.id,
    })
    return { preview, job }
  }

  async printSafeTextLabel(
    printerId: string,
    request: SafeTextLabelInput,
    printerName?: string
  ): Promise<{ preview: PreviewResult; job: PrintJob }> {
    this.ensureServerSidePrintEnabled()
    const preview = await this.previewSafeTextLabel(request)
    const job = await this.printByArtifact({
      printerId,
      printerName,
      artifactId: preview.artifact.id,
    })
    return { preview, job }
  }
}
