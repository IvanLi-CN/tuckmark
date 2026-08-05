import fs from "node:fs/promises"
import { createServer as createHttpServer, type Server as HttpServer } from "node:http"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  type ArtifactPackets,
  assertServerSidePrintRuntimeReady,
  type BatchPreviewRequest,
  type CanvasDraftRecord,
  compileCanvasDraftToDirectCanvas,
  type DirectCanvasPreviewRequest,
  directCanvasSchema,
  type PreviewRequest,
  type PrintBatchRequest,
  type PrintByArtifactRequest,
  type PrintByTemplateRequest,
  type PrintCanvasRequest,
  parseSyncState,
  type RecentPrintRecord,
  type SafeTextLabelInput,
  type SyncState,
  safeTextLabelSchema,
  syncRecordSchema,
  syncStateSchema,
  type TemplateUsageRecord,
  TuckmarkService,
} from "@tuckmark/core"
import {
  agentImportItemSchema,
  agentImportProposalSchema,
  agentImportTemplateSchema,
  buildInventoryTemplateInput,
} from "@tuckmark/inventory"
import { isIpcSocket, listenIpc, resolveRequiredInstance } from "@tuckmark/ipc"
import cors from "cors"
import express from "express"
import { z } from "zod"
import { AgentImportService } from "./agent-import-service.js"
import {
  DevdDataConflictError,
  DevdDataNotFoundError,
  DevdDataService,
  DevdDataUnavailableError,
} from "./devd-data-service.js"

export interface ServerService {
  listTemplates(): Promise<Awaited<ReturnType<TuckmarkService["listTemplates"]>>>
  listPrinters(): Promise<Awaited<ReturnType<TuckmarkService["listPrinters"]>>>
  probePrinter(
    printerId: string,
    printerName?: string
  ): Promise<Awaited<ReturnType<TuckmarkService["probePrinter"]>>>
  listArtifacts(): Promise<Awaited<ReturnType<TuckmarkService["listArtifacts"]>>>
  getArtifact(artifactId: string): Promise<Awaited<ReturnType<TuckmarkService["getArtifact"]>>>
  getArtifactPackets(artifactId: string): Promise<ArtifactPackets>
  getSyncState(): Promise<SyncState>
  mergeSyncState(next: SyncState): Promise<SyncState>
  upsertTemplateUsageRecord(record: TemplateUsageRecord): Promise<SyncState>
  upsertRecentPrintRecord(record: RecentPrintRecord): Promise<SyncState>
  upsertCanvasDraftRecord(record: CanvasDraftRecord): Promise<SyncState>
  previewTemplate(
    request: PreviewRequest
  ): Promise<Awaited<ReturnType<TuckmarkService["previewTemplate"]>>>
  previewCanvas(
    request: DirectCanvasPreviewRequest
  ): Promise<Awaited<ReturnType<TuckmarkService["previewCanvas"]>>>
  previewBatch(
    request: BatchPreviewRequest
  ): Promise<Awaited<ReturnType<TuckmarkService["previewBatch"]>>>
  previewSafeTextLabel(
    request: SafeTextLabelInput
  ): Promise<Awaited<ReturnType<TuckmarkService["previewSafeTextLabel"]>>>
  printByArtifact(
    request: PrintByArtifactRequest
  ): Promise<Awaited<ReturnType<TuckmarkService["printByArtifact"]>>>
  printBatch(
    request: PrintBatchRequest
  ): Promise<Awaited<ReturnType<TuckmarkService["printBatch"]>>>
  printByTemplate(
    request: PrintByTemplateRequest
  ): Promise<Awaited<ReturnType<TuckmarkService["printByTemplate"]>>>
  printCanvas(
    request: PrintCanvasRequest
  ): Promise<Awaited<ReturnType<TuckmarkService["printCanvas"]>>>
  printSafeTextLabel(
    printerId: string,
    request: SafeTextLabelInput,
    printerName?: string
  ): Promise<Awaited<ReturnType<TuckmarkService["printSafeTextLabel"]>>>
}

const previewOptionsSchema = z.object({
  printWidthDots: z.number().int().positive().optional(),
  threshold: z.number().int().min(0).max(255).optional(),
  xOffsetDots: z.number().int().optional(),
  paperType: z.enum(["continuous", "gap"]).optional(),
  previewScale: z.number().int().min(1).max(16).optional(),
})

const previewTemplateSchema = z.object({
  templateId: z.string(),
  input: z.record(z.string(), z.string()),
  renderOptions: previewOptionsSchema.optional(),
})

const previewCanvasSchema = z.object({
  canvas: directCanvasSchema,
  renderOptions: previewOptionsSchema.optional(),
})

const batchPreviewSchema = z.object({
  templateId: z.string(),
  csvText: z.string().min(1),
  renderOptions: previewOptionsSchema.optional(),
})

const printByArtifactSchema = z.object({
  printerId: z.string(),
  printerName: z.string().min(1).optional(),
  artifactId: z.string(),
})

const probePrinterSchema = z.object({
  printerId: z.string(),
  printerName: z.string().min(1).optional(),
})

const printBatchSchema = z.object({
  printerId: z.string(),
  printerName: z.string().min(1).optional(),
  artifactIds: z.array(z.string()).min(1),
})

const printByTemplateSchema = z.object({
  printerId: z.string(),
  printerName: z.string().min(1).optional(),
  templateId: z.string(),
  input: z.record(z.string(), z.string()),
  renderOptions: previewOptionsSchema.optional(),
})

const printCanvasSchema = z.object({
  printerId: z.string(),
  printerName: z.string().min(1).optional(),
  canvas: directCanvasSchema,
  renderOptions: previewOptionsSchema.optional(),
})

const printSafeTextLabelSchema = z.object({
  printerId: z.string(),
  printerName: z.string().min(1).optional(),
  text: z.string().min(1),
  title: z.string().optional(),
  renderOptions: previewOptionsSchema.optional(),
})

const inventoryPrintBindingSchema = z.object({
  expectedRevision: z.number().int().min(0),
  args: z.object({
    materialId: z.string().min(1),
    bindingId: z.string().min(1),
    printerId: z.string().min(1),
    printerName: z.string().min(1).optional(),
    quantity: z.number().int().positive().optional(),
    renderOptions: previewOptionsSchema.optional(),
  }),
})

const syncStateRequestSchema = syncStateSchema
const templateUsageRecordRequestSchema = syncRecordSchema.refine(
  (value) => value.kind === "template_usage",
  "Expected template_usage record"
)
const recentPrintRecordRequestSchema = syncRecordSchema.refine(
  (value) => value.kind === "recent_print",
  "Expected recent_print record"
)
const canvasDraftRecordRequestSchema = syncRecordSchema.refine(
  (value) => value.kind === "canvas_draft",
  "Expected canvas_draft record"
)

const createAgentImportSessionSchema = z.object({
  sessionId: z.string().min(24).max(200),
  secret: z.string().min(32).max(1000),
  proposal: agentImportProposalSchema,
})

const updateAgentImportItemSchema = z.object({
  expectedRevision: z.number().int().min(0),
  item: agentImportItemSchema,
})

const requestAgentImportTemplateSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    template: agentImportTemplateSchema,
  })
  .strict()

const fulfillAgentImportTemplateSchema = z.object({
  expectedRevision: z.number().int().min(0),
  input: z.record(z.string(), z.string()),
})

function sendError(res: express.Response, error: unknown): void {
  const message = error instanceof Error ? error.message : "Unknown error"
  res.status(400).json({ status: "error", error: message })
}

export type CreateAppOptions = {
  agentImportService?: AgentImportService | null
  clientAddress?: (request: express.Request) => string | undefined
  devdDataService?: DevdDataService | null
}

function requireDevdDataService(service: DevdDataService | null): DevdDataService {
  if (!service) {
    throw new DevdDataUnavailableError(
      "DEVD data access requires TUCKMARK_DATA_DIR in server-http mode."
    )
  }
  return service
}

function sendDataError(res: express.Response, error: unknown): void {
  if (error instanceof DevdDataConflictError) {
    res.status(409).json({
      status: "error",
      code: error.code,
      expectedRevision: error.expectedRevision,
      actualRevision: error.actualRevision,
      error: error.message,
    })
    return
  }
  if (error instanceof DevdDataNotFoundError) {
    res.status(404).json({ status: "error", code: error.code, error: error.message })
    return
  }
  if (error instanceof DevdDataUnavailableError) {
    res.status(503).json({ status: "error", code: error.code, error: error.message })
    return
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({ status: "error", code: "validation_error", error: error.message })
    return
  }
  sendError(res, error)
}

const runtimeDataCommandSchema = z.enum([
  "save-template",
  "update-template-metadata",
  "rename-template",
  "archive-template",
  "restore-template",
  "purge-template",
  "save-autosave",
  "replace-working-copy",
  "clear-working-copy",
  "clear-template-autosaves",
  "save-settings",
  "replace-snapshot",
])

const inventoryDataCommandSchema = z.enum([
  "save-material",
  "archive-material",
  "restore-material",
  "delete-material",
  "apply-adjustment",
])

const dataMutationSchema = z.object({
  expectedRevision: z.number().int().min(0),
  args: z.record(z.string(), z.unknown()).default({}),
})

const archiveImportSchema = z.object({
  expectedRevision: z.number().int().min(0),
  archiveHash: z.string().regex(/^[a-f0-9]{64}$/),
  mode: z.enum(["merge", "replace"]),
  archive: z.unknown(),
})

function requireAgentImportService(service: AgentImportService | null): AgentImportService {
  if (!service) {
    throw new Error(
      "Agent import requires a server-managed data directory. Set TUCKMARK_DATA_DIR and use server-http."
    )
  }
  return service
}

function requireAgentImportKey(req: express.Request): string {
  const key = req.header("x-tuckmark-agent-import-key")?.trim()
  if (!key) {
    throw new Error("Missing agent import session key.")
  }
  return key
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "")
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost"
}

function isLoopbackClientAddress(address: string | undefined): boolean {
  if (!address) return false
  const normalized = address.toLowerCase().replace(/^::ffff:/u, "")
  return normalized === "::1" || /^127(?:\.\d{1,3}){3}$/u.test(normalized)
}

export function createApp(
  service: ServerService = new TuckmarkService(),
  options: CreateAppOptions = {}
): express.Express {
  const app = express()
  const devdDataService = options.devdDataService ?? DevdDataService.fromEnvironment()
  const agentImportService =
    options.agentImportService ?? AgentImportService.fromEnvironment(devdDataService ?? undefined)
  const clientAddress = options.clientAddress ?? ((request) => request.socket.remoteAddress)
  app.use(cors())
  app.use(express.json({ limit: "10mb" }))

  const requireLocalAppOrigin: express.RequestHandler = (req, res, next) => {
    if (isIpcSocket(req.socket)) {
      next()
      return
    }
    if (!isLoopbackClientAddress(clientAddress(req))) {
      res.status(403).json({ status: "error", error: "DEVD only accepts loopback requests." })
      return
    }
    if (!isLoopbackHostname(req.hostname)) {
      res.status(403).json({ status: "error", error: "DEVD only accepts loopback requests." })
      return
    }
    const origin = req.header("origin")
    if (!origin) return next()
    try {
      const originUrl = new URL(origin)
      if (originUrl.host === req.header("host") || isLoopbackHostname(originUrl.hostname)) {
        return next()
      }
    } catch {
      // Invalid origins are rejected below.
    }
    res.status(403).json({ status: "error", error: "Cross-origin DEVD access is forbidden." })
  }
  app.use("/api/data", requireLocalAppOrigin)
  app.use("/api/agent-import", requireLocalAppOrigin)

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", name: "tuckmark" })
  })

  app.get("/api/data/status", async (_req, res) => {
    try {
      res.json(await requireDevdDataService(devdDataService).status())
    } catch (error) {
      sendDataError(res, error)
    }
  })

  app.get("/api/data/runtime/snapshot", async (_req, res) => {
    try {
      res.json(await requireDevdDataService(devdDataService).readRuntimeSnapshot())
    } catch (error) {
      sendDataError(res, error)
    }
  })

  app.post("/api/data/runtime/:command", async (req, res) => {
    try {
      const command = runtimeDataCommandSchema.parse(req.params.command)
      const payload = dataMutationSchema.parse(req.body)
      res.json(
        await requireDevdDataService(devdDataService).mutateRuntime({
          command,
          expectedRevision: payload.expectedRevision,
          args: payload.args,
        })
      )
    } catch (error) {
      sendDataError(res, error)
    }
  })

  app.get("/api/data/inventory/materials", async (req, res) => {
    try {
      const service = requireDevdDataService(devdDataService)
      const query = typeof req.query.query === "string" ? req.query.query : ""
      const includeArchived = req.query.includeArchived === "true"
      res.json(await service.readMaterials(query, includeArchived))
    } catch (error) {
      sendDataError(res, error)
    }
  })

  app.get("/api/data/inventory/adjustments", async (req, res) => {
    try {
      const service = requireDevdDataService(devdDataService)
      const materialId = typeof req.query.materialId === "string" ? req.query.materialId : undefined
      res.json(await service.readAdjustments(materialId))
    } catch (error) {
      sendDataError(res, error)
    }
  })

  app.post("/api/data/inventory/print-binding", async (req, res) => {
    try {
      const payload = inventoryPrintBindingSchema.parse(req.body)
      const data = requireDevdDataService(devdDataService)
      const snapshot = await data.readInventoryPrintSnapshot()
      const { revision } = snapshot
      if (revision !== payload.expectedRevision)
        throw new DevdDataConflictError(payload.expectedRevision, revision)
      const { materials, runtime } = snapshot.data
      const material = materials.find((entry) => entry.id === payload.args.materialId)
      if (!material) throw new DevdDataNotFoundError("Material was not found.")
      if (material.archivedAt) throw new Error("Cannot print labels for an archived material.")
      const binding = material.labelBindings.find((entry) => entry.id === payload.args.bindingId)
      if (!binding) throw new DevdDataNotFoundError("Template binding was not found.")
      const copies = payload.args.quantity ?? binding.printQuantity
      const input = {
        ...buildInventoryTemplateInput(material, binding),
        currentQuantity: String(material.currentQuantity),
      }
      const jobs = []
      for (let index = 0; index < copies; index += 1) {
        if (binding.templateSource === "system") {
          jobs.push(
            await service.printByTemplate({
              printerId: payload.args.printerId,
              ...(payload.args.printerName ? { printerName: payload.args.printerName } : {}),
              templateId: binding.templateId,
              input,
              ...(payload.args.renderOptions ? { renderOptions: payload.args.renderOptions } : {}),
            })
          )
          continue
        }
        const working = runtime.workingCopies.find(
          (entry: any) => entry.sourceKey === `user:${binding.templateId}`
        )
        const version = runtime.versions.find(
          (entry: any) =>
            entry.id ===
            runtime.templates.find((item: any) => item.id === binding.templateId)?.currentVersionId
        )
        const document = working?.draft ?? version?.document
        if (!document) throw new DevdDataNotFoundError("User template document was not found.")
        jobs.push(
          await service.printCanvas({
            printerId: payload.args.printerId,
            ...(payload.args.printerName ? { printerName: payload.args.printerName } : {}),
            canvas: compileCanvasDraftToDirectCanvas(document, input),
            ...(payload.args.renderOptions ? { renderOptions: payload.args.renderOptions } : {}),
          })
        )
      }
      res.json({ revision, data: { material, binding, copies, jobs } })
    } catch (error) {
      sendDataError(res, error)
    }
  })

  app.post("/api/data/inventory/:command", async (req, res) => {
    try {
      const command = inventoryDataCommandSchema.parse(req.params.command)
      const payload = dataMutationSchema.parse(req.body)
      res.json(
        await requireDevdDataService(devdDataService).mutateInventory({
          command,
          expectedRevision: payload.expectedRevision,
          args: payload.args,
        })
      )
    } catch (error) {
      sendDataError(res, error)
    }
  })

  app.get("/api/data/events", async (req, res) => {
    try {
      const service = requireDevdDataService(devdDataService)
      res.status(200)
      res.set({
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream",
      })
      res.flushHeaders()
      res.write("retry: 3000\n\n")
      const unsubscribe = service.subscribe((event) => {
        res.write(`id: ${event.revision}\n`)
        res.write("event: data-revision\n")
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      })
      const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15_000)
      req.on("close", () => {
        clearInterval(heartbeat)
        unsubscribe()
      })
    } catch (error) {
      sendDataError(res, error)
    }
  })

  app.get("/api/data/archive", async (_req, res) => {
    try {
      res.json(await requireDevdDataService(devdDataService).readArchive())
    } catch (error) {
      sendDataError(res, error)
    }
  })

  app.post("/api/data/archive/inspect", async (req, res) => {
    try {
      res.json({ data: await requireDevdDataService(devdDataService).inspectArchive(req.body) })
    } catch (error) {
      sendDataError(res, error)
    }
  })

  app.post("/api/data/archive/import", async (req, res) => {
    try {
      const payload = archiveImportSchema.parse(req.body)
      res.json(await requireDevdDataService(devdDataService).importArchive(payload))
    } catch (error) {
      sendDataError(res, error)
    }
  })

  app.post("/api/data/backups", async (req, res) => {
    try {
      const expectedRevision = z
        .object({ expectedRevision: z.number().int().min(0) })
        .parse(req.body).expectedRevision
      res.json(await requireDevdDataService(devdDataService).createBackup(expectedRevision))
    } catch (error) {
      sendDataError(res, error)
    }
  })

  app.get("/api/templates", async (_req, res) => {
    try {
      res.json({ templates: await service.listTemplates() })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get("/api/printers", async (_req, res) => {
    try {
      res.json({ printers: await service.listPrinters() })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post("/api/printers/probe", async (req, res) => {
    try {
      const payload = probePrinterSchema.parse(req.body)
      res.json(await service.probePrinter(payload.printerId, payload.printerName))
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get("/api/artifacts", async (_req, res) => {
    try {
      res.json({ artifacts: await service.listArtifacts() })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get("/api/artifacts/:artifactId", async (req, res) => {
    try {
      res.json({ artifact: await service.getArtifact(req.params.artifactId) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get("/api/artifacts/:artifactId/png", async (req, res) => {
    try {
      const artifact = await service.getArtifact(req.params.artifactId)
      const png = await fs.readFile(artifact.pngPath)
      res.type("png").send(png)
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get("/api/artifacts/:artifactId/packets", async (req, res) => {
    try {
      res.json(await service.getArtifactPackets(req.params.artifactId))
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get("/api/artifacts/:artifactId/svg", async (req, res) => {
    try {
      const artifact = await service.getArtifact(req.params.artifactId)
      const svg = await fs.readFile(artifact.svgPath, "utf8")
      res.type("image/svg+xml").send(svg)
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get("/api/sync/state", async (_req, res) => {
    try {
      res.json({ state: await service.getSyncState() })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post("/api/sync/state", async (req, res) => {
    try {
      const payload = syncStateRequestSchema.parse(req.body)
      res.json({ state: await service.mergeSyncState(parseSyncState(payload)) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post("/api/sync/template-usage", async (req, res) => {
    try {
      const payload = templateUsageRecordRequestSchema.parse(req.body) as TemplateUsageRecord
      res.json({ state: await service.upsertTemplateUsageRecord(payload) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post("/api/sync/recent-print", async (req, res) => {
    try {
      const payload = recentPrintRecordRequestSchema.parse(req.body) as RecentPrintRecord
      res.json({ state: await service.upsertRecentPrintRecord(payload) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post("/api/sync/canvas-draft", async (req, res) => {
    try {
      const payload = canvasDraftRecordRequestSchema.parse(req.body) as CanvasDraftRecord
      res.json({ state: await service.upsertCanvasDraftRecord(payload) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post("/api/preview/template", async (req, res) => {
    try {
      const payload = previewTemplateSchema.parse(req.body)
      res.json(await service.previewTemplate(payload))
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post("/api/preview/canvas", async (req, res) => {
    try {
      const payload = previewCanvasSchema.parse(req.body)
      res.json(await service.previewCanvas(payload))
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post("/api/preview/batch", async (req, res) => {
    try {
      const payload = batchPreviewSchema.parse(req.body)
      res.json(await service.previewBatch(payload))
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post("/api/print/artifact", async (req, res) => {
    try {
      const payload = printByArtifactSchema.parse(req.body)
      res.json(await service.printByArtifact(payload))
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post("/api/print/batch", async (req, res) => {
    try {
      const payload = printBatchSchema.parse(req.body)
      res.json(await service.printBatch(payload))
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post("/api/print/template", async (req, res) => {
    try {
      const payload = printByTemplateSchema.parse(req.body)
      res.json(await service.printByTemplate(payload))
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post("/api/print/canvas", async (req, res) => {
    try {
      const payload = printCanvasSchema.parse(req.body)
      res.json(await service.printCanvas(payload))
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post("/api/preview/safe-text", async (req, res) => {
    try {
      const parsed = safeTextLabelSchema.parse(req.body)
      const payload = {
        ...parsed,
        title: parsed.title ?? "Safe Text Label",
      }
      res.json(await service.previewSafeTextLabel(payload))
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post("/api/print/safe-text", async (req, res) => {
    try {
      const payload = printSafeTextLabelSchema.parse(req.body)
      const { printerId, title, printerName, ...request } = payload
      res.json(
        await service.printSafeTextLabel(
          printerId,
          {
            ...request,
            title: title ?? "Safe Text Label",
          },
          printerName
        )
      )
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get("/api/agent-import/catalog", async (_req, res) => {
    try {
      res.json(await requireAgentImportService(agentImportService).catalog())
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get("/api/agent-import/inventory", async (req, res) => {
    try {
      const query = typeof req.query.query === "string" ? req.query.query : undefined
      res.json({
        materials: await requireAgentImportService(agentImportService).listInventory(query),
      })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post("/api/agent-import/sessions", (req, res) => {
    try {
      const payload = createAgentImportSessionSchema.parse(req.body)
      res.status(201).json({
        session: requireAgentImportService(agentImportService).createSession(payload),
      })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get("/api/agent-import/sessions/:sessionId", (req, res) => {
    try {
      res.json({
        session: requireAgentImportService(agentImportService).getSession(
          req.params.sessionId,
          requireAgentImportKey(req)
        ),
      })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get("/api/agent-import/sessions/:sessionId/events", (req, res) => {
    try {
      res.json({
        events: requireAgentImportService(agentImportService).listEvents(
          req.params.sessionId,
          requireAgentImportKey(req)
        ),
      })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get("/api/agent-import/sessions/:sessionId/restock-targets", async (req, res) => {
    try {
      res.json({
        targets: await requireAgentImportService(agentImportService).resolveRestockTargets(
          req.params.sessionId,
          requireAgentImportKey(req)
        ),
      })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.put("/api/agent-import/sessions/:sessionId/items/:itemId", (req, res) => {
    try {
      const payload = updateAgentImportItemSchema.parse(req.body)
      res.json({
        session: requireAgentImportService(agentImportService).updateItem({
          sessionId: req.params.sessionId,
          secret: requireAgentImportKey(req),
          itemId: req.params.itemId,
          ...payload,
        }),
      })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post(
    "/api/agent-import/sessions/:sessionId/items/:itemId/template-input",
    async (req, res) => {
      try {
        const payload = requestAgentImportTemplateSchema.parse(req.body)
        res.json({
          session: await requireAgentImportService(agentImportService).requestTemplateInput({
            sessionId: req.params.sessionId,
            secret: requireAgentImportKey(req),
            itemId: req.params.itemId,
            ...payload,
          }),
        })
      } catch (error) {
        sendError(res, error)
      }
    }
  )

  app.post("/api/agent-import/sessions/:sessionId/events/:eventId/fulfill", (req, res) => {
    try {
      const payload = fulfillAgentImportTemplateSchema.parse(req.body)
      res.json({
        session: requireAgentImportService(agentImportService).fulfillTemplateInput({
          sessionId: req.params.sessionId,
          secret: requireAgentImportKey(req),
          eventId: req.params.eventId,
          ...payload,
        }),
      })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post("/api/agent-import/sessions/:sessionId/confirm", async (req, res) => {
    try {
      res.json({
        session: await requireAgentImportService(agentImportService).confirm(
          req.params.sessionId,
          requireAgentImportKey(req)
        ),
      })
    } catch (error) {
      sendError(res, error)
    }
  })

  const staticWebRoot = process.env.TUCKMARK_WEB_DIST
    ? path.resolve(process.env.TUCKMARK_WEB_DIST)
    : path.resolve(process.cwd(), "../../apps/web/dist")

  app.use(express.static(staticWebRoot, { index: false }))
  app.get(/^(?!\/api\/|\/health$).*/, async (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/health") {
      next()
      return
    }

    try {
      res.sendFile("index.html", { root: staticWebRoot })
    } catch (error) {
      next(error)
    }
  })

  return app
}

export function startServer(
  service: ServerService = new TuckmarkService(),
  port = Number(process.env.PORT ?? 5210),
  host = process.env.TUCKMARK_SERVER_HOST?.trim() || "127.0.0.1"
) {
  assertServerSidePrintRuntimeReady()
  const instance = resolveRequiredInstance()
  const app = createApp(service)
  const httpServer = createHttpServer(app)
  const ipcServer = createHttpServer(app)
  let httpClosing = false
  const closeHttpServer = httpServer.close.bind(httpServer)
  httpServer.close = ((callback?: (error?: Error) => void) => {
    httpClosing = true
    if (ipcServer.listening) ipcServer.close()
    if (!httpServer.listening) {
      callback?.()
      return httpServer
    }
    return closeHttpServer(callback)
  }) as typeof httpServer.close
  ;(httpServer as HttpServer & { ipcServer?: HttpServer }).ipcServer = ipcServer
  void listenIpc(ipcServer, instance)
    .then((endpoint) => {
      if (httpClosing) {
        if (ipcServer.listening) ipcServer.close()
        return
      }
      console.log(`tuckmark DEVD IPC listening on ${endpoint.address}`)
      if (httpClosing) return
      httpServer.listen(port, host, () => {
        console.log(`tuckmark server listening on http://${host}:${port}`)
      })
    })
    .catch((error) => {
      if (httpClosing) return
      console.error(
        `tuckmark DEVD IPC failed: ${error instanceof Error ? error.message : String(error)}`
      )
      if (ipcServer.listening) ipcServer.close()
      process.exitCode = 1
      if (httpServer.listenerCount("error") > 0) {
        httpServer.emit("error", error)
      }
    })
  return httpServer
}

function isMainModule(metaUrl: string): boolean {
  const entry = process.argv[1]
  if (!entry) {
    return false
  }
  return metaUrl === pathToFileURL(entry).href
}

if (isMainModule(import.meta.url)) {
  startServer()
}
