import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  safeTextLabelSchema,
  TuckmarkService,
  type TuckmarkService as TuckmarkServiceType,
} from "@tuckmark/core"
import * as z from "zod/v4"

export type McpService = Pick<
  TuckmarkServiceType,
  | "listPrinters"
  | "probePrinter"
  | "listTemplates"
  | "previewTemplate"
  | "previewBatch"
  | "previewCanvas"
  | "previewSafeTextLabel"
  | "printByArtifact"
  | "printBatch"
  | "printByTemplate"
  | "printCanvas"
  | "printSafeTextLabel"
  | "listArtifacts"
  | "getArtifact"
  | "getArtifactPackets"
>

const renderOptionsSchema = z.object({
  printWidthDots: z.number().int().positive().optional(),
  threshold: z.number().int().min(0).max(255).optional(),
  xOffsetDots: z.number().int().optional(),
  paperType: z.enum(["continuous", "gap"]).optional(),
  previewScale: z.number().int().min(1).max(16).optional(),
})

const directCanvasSchema = z.object({
  id: z.string().default("canvas"),
  name: z.string().default("Canvas"),
  width: z.number().positive(),
  height: z.number().positive(),
  elements: z.array(
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("text"),
        key: z.string().min(1),
        x: z.number(),
        y: z.number(),
        width: z.number().positive().optional(),
        fontSize: z.number().positive(),
        fontWeight: z.enum(["normal", "bold"]).default("normal"),
        align: z.enum(["left", "center", "right"]).default("left"),
        value: z.string().optional(),
        maxLines: z.number().int().positive().optional(),
      }),
      z.object({
        kind: z.literal("rect"),
        x: z.number(),
        y: z.number(),
        width: z.number().positive(),
        height: z.number().positive(),
        strokeWidth: z.number().nonnegative().default(1),
        fill: z.string().default("none"),
        stroke: z.string().default("#111111"),
        radius: z.number().nonnegative().default(0),
      }),
      z.object({
        kind: z.literal("line"),
        x1: z.number(),
        y1: z.number(),
        x2: z.number(),
        y2: z.number(),
        strokeWidth: z.number().positive().default(1),
        stroke: z.string().default("#111111"),
      }),
    ])
  ),
})

function readTemplateVariable(value: string | string[] | undefined, name: string): string {
  if (Array.isArray(value)) {
    const [first] = value
    if (first) {
      return first
    }
  }

  if (typeof value === "string" && value.length > 0) {
    return value
  }

  throw new Error(`Missing resource template variable: ${name}`)
}

export function registerServer(
  server: McpServer,
  service: McpService = new TuckmarkService()
): McpServer {
  server.registerTool(
    "list_printers",
    {
      title: "List Printers",
      description: "List available printers and capabilities",
    },
    async () => {
      const printers = await service.listPrinters()
      return {
        content: [{ type: "text", text: JSON.stringify(printers, null, 2) }],
        structuredContent: { printers },
      }
    }
  )

  server.registerTool(
    "probe_printer",
    {
      title: "Probe Printer",
      description: "Probe BLE discovery and connection without sending print data",
      inputSchema: z.object({
        printerId: z.string(),
        printerName: z.string().min(1).optional(),
      }),
    },
    async ({ printerId, printerName }) => {
      const result = await service.probePrinter(printerId, printerName)
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      }
    }
  )

  server.registerTool(
    "list_templates",
    {
      title: "List Templates",
      description: "List preset templates",
    },
    async () => {
      const templates = await service.listTemplates()
      return {
        content: [{ type: "text", text: JSON.stringify(templates, null, 2) }],
        structuredContent: { templates },
      }
    }
  )

  server.registerTool(
    "preview_template",
    {
      title: "Preview Template",
      description: "Render a template with data into a preview artifact",
      inputSchema: z.object({
        templateId: z.string(),
        input: z.record(z.string(), z.string()),
        renderOptions: renderOptionsSchema.optional(),
      }),
    },
    async ({ templateId, input, renderOptions }) => {
      const preview = await service.previewTemplate({ templateId, input, renderOptions })
      return {
        content: [
          { type: "text", text: JSON.stringify(preview, null, 2) },
          {
            type: "resource_link",
            uri: `tuckmark://artifacts/${preview.artifact.id}`,
            name: preview.artifact.name,
            mimeType: "application/json",
          },
          {
            type: "resource_link",
            uri: `tuckmark://artifacts/${preview.artifact.id}/png`,
            name: `${preview.artifact.name}.png`,
            mimeType: "image/png",
          },
          {
            type: "resource_link",
            uri: `tuckmark://artifacts/${preview.artifact.id}/packets`,
            name: `${preview.artifact.name}.packets.json`,
            mimeType: "application/json",
          },
        ],
        structuredContent: preview,
      }
    }
  )

  server.registerTool(
    "preview_batch",
    {
      title: "Preview Batch",
      description: "Render a CSV-driven batch into preview artifacts",
      inputSchema: z.object({
        templateId: z.string(),
        csvText: z.string().min(1),
        renderOptions: renderOptionsSchema.optional(),
      }),
    },
    async ({ templateId, csvText, renderOptions }) => {
      const batch = await service.previewBatch({ templateId, csvText, renderOptions })
      return {
        content: [
          { type: "text", text: JSON.stringify(batch, null, 2) },
          ...batch.items.map((item) => ({
            type: "resource_link" as const,
            uri: `tuckmark://artifacts/${item.artifact.id}`,
            name: `${item.index + 1}. ${item.artifact.name}`,
            mimeType: "application/json",
          })),
        ],
        structuredContent: batch,
      }
    }
  )

  server.registerTool(
    "preview_canvas",
    {
      title: "Preview Canvas",
      description: "Render a freeform canvas into a preview artifact",
      inputSchema: z.object({
        canvas: directCanvasSchema,
        renderOptions: renderOptionsSchema.optional(),
      }),
    },
    async ({ canvas, renderOptions }) => {
      const preview = await service.previewCanvas({ canvas, renderOptions })
      return {
        content: [
          { type: "text", text: JSON.stringify(preview, null, 2) },
          {
            type: "resource_link",
            uri: `tuckmark://artifacts/${preview.artifact.id}`,
            name: preview.artifact.name,
            mimeType: "application/json",
          },
          {
            type: "resource_link",
            uri: `tuckmark://artifacts/${preview.artifact.id}/png`,
            name: `${preview.artifact.name}.png`,
            mimeType: "image/png",
          },
          {
            type: "resource_link",
            uri: `tuckmark://artifacts/${preview.artifact.id}/packets`,
            name: `${preview.artifact.name}.packets.json`,
            mimeType: "application/json",
          },
        ],
        structuredContent: preview,
      }
    }
  )

  server.registerTool(
    "print_by_artifact",
    {
      title: "Print by Artifact",
      description: "Send an existing render artifact to a printer",
      inputSchema: z.object({
        printerId: z.string(),
        printerName: z.string().min(1).optional(),
        artifactId: z.string(),
      }),
    },
    async ({ printerId, printerName, artifactId }) => {
      const job = await service.printByArtifact({ printerId, printerName, artifactId })
      return {
        content: [{ type: "text", text: JSON.stringify(job, null, 2) }],
        structuredContent: job,
      }
    }
  )

  server.registerTool(
    "print_batch",
    {
      title: "Print Batch",
      description: "Print multiple existing render artifacts in order",
      inputSchema: z.object({
        printerId: z.string(),
        printerName: z.string().min(1).optional(),
        artifactIds: z.array(z.string()).min(1),
      }),
    },
    async ({ printerId, printerName, artifactIds }) => {
      const result = await service.printBatch({ printerId, printerName, artifactIds })
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      }
    }
  )

  server.registerTool(
    "print_template",
    {
      title: "Print Template",
      description: "Render a template with data and print it",
      inputSchema: z.object({
        printerId: z.string(),
        printerName: z.string().min(1).optional(),
        templateId: z.string(),
        input: z.record(z.string(), z.string()),
        renderOptions: renderOptionsSchema.optional(),
      }),
    },
    async ({ printerId, printerName, templateId, input, renderOptions }) => {
      const result = await service.printByTemplate({
        printerId,
        printerName,
        templateId,
        input,
        renderOptions,
      })
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      }
    }
  )

  server.registerTool(
    "print_canvas",
    {
      title: "Print Canvas",
      description: "Render a freeform canvas and print it",
      inputSchema: z.object({
        printerId: z.string(),
        printerName: z.string().min(1).optional(),
        canvas: directCanvasSchema,
        renderOptions: renderOptionsSchema.optional(),
      }),
    },
    async ({ printerId, printerName, canvas, renderOptions }) => {
      const result = await service.printCanvas({ printerId, printerName, canvas, renderOptions })
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      }
    }
  )

  server.registerTool(
    "preview_safe_text",
    {
      title: "Preview Safe Text",
      description: "Render a detonger-validated safe text label preview",
      inputSchema: z.object({
        text: z.string().min(1),
        title: z.string().default("Safe Text Label"),
        renderOptions: renderOptionsSchema.optional(),
      }),
    },
    async ({ text, title, renderOptions }) => {
      const result = await service.previewSafeTextLabel(
        safeTextLabelSchema.parse({ text, title, renderOptions })
      )
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      }
    }
  )

  server.registerTool(
    "print_safe_text",
    {
      title: "Print Safe Text",
      description: "Render and print a detonger-validated safe text label",
      inputSchema: z.object({
        printerId: z.string(),
        printerName: z.string().min(1).optional(),
        text: z.string().min(1),
        title: z.string().default("Safe Text Label"),
        renderOptions: renderOptionsSchema.optional(),
      }),
    },
    async ({ printerId, printerName, text, title, renderOptions }) => {
      const result = await service.printSafeTextLabel(
        printerId,
        safeTextLabelSchema.parse({ text, title, renderOptions }),
        printerName
      )
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      }
    }
  )

  server.registerResource(
    "artifact",
    new ResourceTemplate("tuckmark://artifacts/{artifactId}", {
      list: async () => {
        const artifacts = await service.listArtifacts()
        return {
          resources: artifacts.map((artifact) => ({
            uri: `tuckmark://artifacts/${artifact.id}`,
            name: artifact.name,
            mimeType: "application/json",
          })),
        }
      },
    }),
    {
      title: "Tuckmark Artifact",
      description: "Stored preview artifact",
      mimeType: "application/json",
    },
    async (uri, { artifactId }) => {
      const resolvedArtifactId = readTemplateVariable(artifactId, "artifactId")
      const artifact = await service.getArtifact(resolvedArtifactId)
      return {
        contents: [
          { uri: uri.href, text: JSON.stringify(artifact, null, 2), mimeType: "application/json" },
        ],
      }
    }
  )

  server.registerResource(
    "artifact-packets",
    new ResourceTemplate("tuckmark://artifacts/{artifactId}/packets", {
      list: async () => {
        const artifacts = await service.listArtifacts()
        return {
          resources: artifacts.map((artifact) => ({
            uri: `tuckmark://artifacts/${artifact.id}/packets`,
            name: `${artifact.name}.packets.json`,
            mimeType: "application/json",
          })),
        }
      },
    }),
    {
      title: "Tuckmark Artifact Packets",
      description: "Detonger protocol packets for a rendered artifact",
      mimeType: "application/json",
    },
    async (uri, { artifactId }) => {
      const resolvedArtifactId = readTemplateVariable(artifactId, "artifactId")
      const packets = await service.getArtifactPackets(resolvedArtifactId)
      return {
        contents: [
          { uri: uri.href, text: JSON.stringify(packets, null, 2), mimeType: "application/json" },
        ],
      }
    }
  )

  server.registerResource(
    "artifact-png",
    new ResourceTemplate("tuckmark://artifacts/{artifactId}/png", {
      list: async () => {
        const artifacts = await service.listArtifacts()
        return {
          resources: artifacts.map((artifact) => ({
            uri: `tuckmark://artifacts/${artifact.id}/png`,
            name: `${artifact.name}.png`,
            mimeType: "image/png",
          })),
        }
      },
    }),
    { title: "Tuckmark Preview PNG", description: "PNG preview artifact", mimeType: "image/png" },
    async (uri, { artifactId }) => {
      const resolvedArtifactId = readTemplateVariable(artifactId, "artifactId")
      const artifact = await service.getArtifact(resolvedArtifactId)
      const png = await readFile(artifact.pngPath)
      return {
        contents: [{ uri: uri.href, mimeType: "image/png", blob: png.toString("base64") }],
      }
    }
  )

  return server
}

export function createServer(service: McpService = new TuckmarkService()): McpServer {
  return registerServer(new McpServer({ name: "tuckmark", version: "0.1.0" }), service)
}

async function main(): Promise<void> {
  const server = createServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

function isMainModule(metaUrl: string): boolean {
  const entry = process.argv[1]
  if (!entry) {
    return false
  }
  return metaUrl === pathToFileURL(entry).href
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
