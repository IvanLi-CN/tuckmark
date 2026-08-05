import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  directCanvasSchema,
  safeTextLabelSchema,
  TuckmarkService,
  type TuckmarkService as TuckmarkServiceType,
  userTemplatePackageSchema,
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

/** Deployment-owned template data boundary. It deliberately contains no DEVD address or filesystem API. */
export type McpTemplateDataService = {
  list(args: { includeArchived: boolean }): Promise<unknown>
  get(templateId: string): Promise<unknown>
  createOrUpdatePackage(args: {
    templatePackage: unknown
    expectedRevision: number
  }): Promise<unknown>
  updateMetadata(args: {
    templateId: string
    patch: { name?: string; description?: string; recommendedUse?: string }
    expectedRevision: number
  }): Promise<unknown>
  rename(args: { templateId: string; name: string; expectedRevision: number }): Promise<unknown>
  archive(args: { templateId: string; expectedRevision: number }): Promise<unknown>
  restore(args: { templateId: string; expectedRevision: number }): Promise<unknown>
  delete(args: { templateId: string; expectedRevision: number }): Promise<unknown>
}

const renderOptionsSchema = z.object({
  printWidthDots: z.number().int().positive().optional(),
  threshold: z.number().int().min(0).max(255).optional(),
  xOffsetDots: z.number().int().optional(),
  paperType: z.enum(["continuous", "gap"]).optional(),
  previewScale: z.number().int().min(1).max(16).optional(),
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

function requireTemplateDataService(
  templateDataService: McpTemplateDataService | undefined
): McpTemplateDataService {
  if (!templateDataService) {
    throw new Error("Template management is unavailable: inject the deployment data service.")
  }
  return templateDataService
}

function templateResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: (data ?? {}) as Record<string, unknown>,
  }
}

export function registerServer(
  server: McpServer,
  service: McpService = new TuckmarkService(),
  templateDataService?: McpTemplateDataService
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

  if (templateDataService) {
    server.registerTool(
      "template_list",
      {
        title: "List Managed Templates",
        description: "List user templates from the injected authoritative data service",
        inputSchema: z.object({ includeArchived: z.boolean().default(false) }),
      },
      async ({ includeArchived }) =>
        templateResult(
          await requireTemplateDataService(templateDataService).list({ includeArchived })
        )
    )

    server.registerTool(
      "template_get",
      {
        title: "Get Managed Template",
        description:
          "Get one user template and its current document from the injected data service",
        inputSchema: z.object({ templateId: z.string().min(1) }),
      },
      async ({ templateId }) =>
        templateResult(await requireTemplateDataService(templateDataService).get(templateId))
    )

    server.registerTool(
      "template_create_or_update_package",
      {
        title: "Create or Update Template Package",
        description: "Create or update a complete user template package",
        inputSchema: z.object({
          templatePackage: userTemplatePackageSchema,
          expectedRevision: z.number().int().min(0),
        }),
      },
      async ({ templatePackage, expectedRevision }) =>
        templateResult(
          await requireTemplateDataService(templateDataService).createOrUpdatePackage({
            templatePackage,
            expectedRevision,
          })
        )
    )

    server.registerTool(
      "template_update_metadata",
      {
        title: "Update Template Metadata",
        description: "Patch user template metadata without creating a saved version",
        inputSchema: z.object({
          templateId: z.string().min(1),
          expectedRevision: z.number().int().min(0),
          patch: z
            .object({
              name: z.string().trim().min(1).optional(),
              description: z.string().trim().optional(),
              recommendedUse: z.string().trim().optional(),
            })
            .strict()
            .refine((value) => Object.keys(value).length > 0, "Metadata patch is empty."),
        }),
      },
      async ({ templateId, expectedRevision, patch }) =>
        templateResult(
          await requireTemplateDataService(templateDataService).updateMetadata({
            templateId,
            expectedRevision,
            patch: {
              ...(patch.name !== undefined ? { name: patch.name } : {}),
              ...(patch.description !== undefined ? { description: patch.description } : {}),
              ...(patch.recommendedUse !== undefined
                ? { recommendedUse: patch.recommendedUse }
                : {}),
            },
          })
        )
    )

    for (const [name, title, method] of [
      ["template_rename", "Rename Managed Template", "rename"],
      ["template_archive", "Archive Managed Template", "archive"],
      ["template_restore", "Restore Managed Template", "restore"],
    ] as const) {
      server.registerTool(
        name,
        {
          title,
          description: `${title} through the injected authoritative data service`,
          inputSchema:
            method === "rename"
              ? z.object({
                  templateId: z.string().min(1),
                  name: z.string().trim().min(1),
                  expectedRevision: z.number().int().min(0),
                })
              : z.object({
                  templateId: z.string().min(1),
                  expectedRevision: z.number().int().min(0),
                }),
        },
        async (input) => {
          const data = requireTemplateDataService(templateDataService)
          const result =
            method === "rename"
              ? await data.rename(
                  input as { templateId: string; name: string; expectedRevision: number }
                )
              : await data[method](input as { templateId: string; expectedRevision: number })
          return templateResult(result)
        }
      )
    }

    server.registerTool(
      "template_delete",
      {
        title: "Delete Managed Template",
        description: "Permanently delete a user template after explicit confirmation",
        inputSchema: z.object({
          templateId: z.string().min(1),
          expectedRevision: z.number().int().min(0),
          confirmPermanentDelete: z.literal(true),
        }),
      },
      async ({ templateId, expectedRevision }) =>
        templateResult(
          await requireTemplateDataService(templateDataService).delete({
            templateId,
            expectedRevision,
          })
        )
    )
  }

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

export function createServer(
  service: McpService = new TuckmarkService(),
  templateDataService?: McpTemplateDataService
): McpServer {
  return registerServer(
    new McpServer({ name: "tuckmark", version: "0.1.0" }),
    service,
    templateDataService
  )
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
