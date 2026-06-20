import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  type ArtifactPackets,
  type BatchPreviewRequest,
  type DirectCanvasPreviewRequest,
  directCanvasSchema,
  type PreviewRequest,
  type PrintBatchRequest,
  type PrintByArtifactRequest,
  type PrintByTemplateRequest,
  type PrintCanvasRequest,
  type SafeTextLabelInput,
  safeTextLabelSchema,
  TuckmarkService,
} from "@tuckmark/core"
import cors from "cors"
import express from "express"
import { z } from "zod"

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

function sendError(res: express.Response, error: unknown): void {
  const message = error instanceof Error ? error.message : "Unknown error"
  res.status(400).json({ status: "error", error: message })
}

export function createApp(service: ServerService = new TuckmarkService()): express.Express {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: "10mb" }))

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", name: "tuckmark" })
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
      res.sendFile(path.join(staticWebRoot, "index.html"))
    } catch (error) {
      next(error)
    }
  })

  return app
}

export function startServer(
  service: ServerService = new TuckmarkService(),
  port = Number(process.env.PORT ?? 5210)
) {
  const app = createApp(service)
  return app.listen(port, () => {
    console.log(`tuckmark server listening on http://localhost:${port}`)
  })
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
