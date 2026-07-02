#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import path from "node:path"
import {
  compileUserTemplatePackageToCanvas,
  parseUserTemplatePackage,
  resolveUserTemplatePackageRenderOptions,
  TuckmarkService,
} from "@tuckmark/core"
import { z } from "zod"

const service = new TuckmarkService()

const argv = process.argv.slice(2)
const command = argv[0] ?? "help"

const templateInputSchema = z.object({
  templateId: z.string(),
  input: z.record(z.string(), z.string()),
})

const canvasInputSchema = z.object({
  name: z.string().default("Canvas"),
  width: z.number().positive(),
  height: z.number().positive(),
  text: z.string().default(""),
})

const safeTextSchema = z.object({
  text: z.string().min(1),
  title: z.string().default("Safe Text Label"),
})

const renderOptionsSchema = z.object({
  paperType: z.enum(["continuous", "gap"]).optional(),
  threshold: z.number().int().min(0).max(255).optional(),
  xOffsetDots: z.number().int().optional(),
  printWidthDots: z.number().int().positive().optional(),
  previewScale: z.number().int().min(1).max(16).optional(),
})

async function main(): Promise<void> {
  switch (command) {
    case "help":
      printHelp()
      break
    case "templates":
      console.log(JSON.stringify(await service.listTemplates(), null, 2))
      break
    case "printers":
      console.log(JSON.stringify(await service.listPrinters(), null, 2))
      break
    case "probe":
      await handleProbe(argv.slice(1))
      break
    case "preview":
      await handlePreview(argv.slice(1))
      break
    case "batch-preview":
      await handleBatchPreview(argv.slice(1))
      break
    case "print":
      await handlePrint(argv.slice(1))
      break
    case "template-package":
      await handleTemplatePackage(argv.slice(1))
      break
    default:
      printHelp()
      process.exitCode = 1
  }
}

function printHelp(): void {
  console.log(
    "tuckmark commands:\n  tuckmark templates\n  tuckmark printers\n  tuckmark probe --printer <id> [--printer-name <name>]\n  tuckmark preview --template <id> --input <json> [--render-options <json>]\n  tuckmark preview --canvas <json> [--render-options <json>]\n  tuckmark preview --safe-text <json> [--render-options <json>]\n  tuckmark batch-preview --template <id> --csv <path> [--render-options <json>]\n  tuckmark print --printer <id> [--printer-name <name>] --artifact <id>\n  tuckmark print --printer <id> [--printer-name <name>] --artifacts <json-array>\n  tuckmark print --printer <id> [--printer-name <name>] --safe-text <json> [--render-options <json>]\n  tuckmark print --printer <id> [--printer-name <name>] --template <id> --input <json> [--render-options <json>]" +
      "\n  tuckmark template-package validate --file <path>" +
      "\n  tuckmark template-package preview --file <path> [--input <json>] [--render-options <json>]" +
      "\n  tuckmark template-package packets --file <path> [--input <json>] [--render-options <json>]" +
      "\n  tuckmark template-package print --printer <id> [--printer-name <name>] --file <path> [--input <json>] [--render-options <json>]"
  )
}

function parseFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  return args[index + 1]
}

function parseRenderOptions(args: string[]): z.infer<typeof renderOptionsSchema> | undefined {
  const raw = parseFlag(args, "--render-options")
  if (!raw) {
    return undefined
  }
  return renderOptionsSchema.partial().parse(JSON.parse(raw))
}

async function handlePreview(args: string[]): Promise<void> {
  const templateArg = parseFlag(args, "--template")
  const canvasArg = parseFlag(args, "--canvas")
  const safeTextArg = parseFlag(args, "--safe-text")
  if (templateArg) {
    const inputJson = parseFlag(args, "--input") ?? "{}"
    const payload = templateInputSchema.parse({
      templateId: templateArg,
      input: JSON.parse(inputJson),
    })
    const preview = await service.previewTemplate({
      ...payload,
      renderOptions: parseRenderOptions(args),
    })
    console.log(JSON.stringify(preview, null, 2))
    return
  }
  if (canvasArg) {
    const canvas = canvasInputSchema.parse(JSON.parse(canvasArg))
    const preview = await service.previewCanvas({
      canvas: {
        id: canvas.name,
        name: canvas.name,
        width: canvas.width,
        height: canvas.height,
        elements: [
          {
            kind: "rect",
            x: 6,
            y: 6,
            width: canvas.width - 12,
            height: canvas.height - 12,
            strokeWidth: 2,
            fill: "white",
            stroke: "#111111",
            radius: 8,
            rotation: 0,
          },
          {
            kind: "text",
            key: "body",
            value: canvas.text,
            x: 18,
            y: 48,
            fontSize: 22,
            fontWeight: "normal",
            align: "left",
            width: canvas.width - 36,
            maxLines: 8,
            rotation: 0,
          },
        ],
      },
      renderOptions: parseRenderOptions(args),
    })
    console.log(JSON.stringify(preview, null, 2))
    return
  }
  if (safeTextArg) {
    const payload = safeTextSchema.parse(JSON.parse(safeTextArg))
    const preview = await service.previewSafeTextLabel({
      ...payload,
      renderOptions: parseRenderOptions(args),
    })
    console.log(JSON.stringify(preview, null, 2))
    return
  }
  throw new Error("preview requires --template or --canvas")
}

async function handleBatchPreview(args: string[]): Promise<void> {
  const templateId = parseFlag(args, "--template")
  const csvPath = parseFlag(args, "--csv")
  if (!templateId || !csvPath) throw new Error("batch-preview requires --template and --csv")
  const csvText = await readFile(path.resolve(csvPath), "utf8")
  const result = await service.previewBatch({
    templateId,
    csvText,
    renderOptions: parseRenderOptions(args),
  })
  console.log(JSON.stringify(result, null, 2))
}

async function handleProbe(args: string[]): Promise<void> {
  const printerId = parseFlag(args, "--printer")
  const printerName = parseFlag(args, "--printer-name")
  if (!printerId) throw new Error("probe requires --printer")
  console.log(JSON.stringify(await service.probePrinter(printerId, printerName), null, 2))
}

async function handlePrint(args: string[]): Promise<void> {
  const printerId = parseFlag(args, "--printer")
  const printerName = parseFlag(args, "--printer-name")
  const artifactId = parseFlag(args, "--artifact")
  const artifactIdsArg = parseFlag(args, "--artifacts")
  const templateId = parseFlag(args, "--template")
  const safeTextArg = parseFlag(args, "--safe-text")
  if (!printerId) throw new Error("print requires --printer")
  if (artifactId) {
    console.log(
      JSON.stringify(await service.printByArtifact({ printerId, printerName, artifactId }), null, 2)
    )
    return
  }
  if (artifactIdsArg) {
    const artifactIds = z.array(z.string().min(1)).parse(JSON.parse(artifactIdsArg))
    console.log(
      JSON.stringify(await service.printBatch({ printerId, printerName, artifactIds }), null, 2)
    )
    return
  }
  if (safeTextArg) {
    const payload = safeTextSchema.parse(JSON.parse(safeTextArg))
    console.log(
      JSON.stringify(
        await service.printSafeTextLabel(
          printerId,
          {
            ...payload,
            renderOptions: parseRenderOptions(args),
          },
          printerName
        ),
        null,
        2
      )
    )
    return
  }
  if (templateId) {
    const inputJson = parseFlag(args, "--input") ?? "{}"
    const payload = templateInputSchema.parse({ templateId, input: JSON.parse(inputJson) })
    console.log(
      JSON.stringify(
        await service.printByTemplate({
          printerId,
          printerName,
          ...payload,
          renderOptions: parseRenderOptions(args),
        }),
        null,
        2
      )
    )
    return
  }
  throw new Error("print requires --artifact or --template")
}

async function readTemplatePackageFromArgs(args: string[]) {
  const filePath = parseFlag(args, "--file")
  if (!filePath) throw new Error("template-package requires --file")
  const raw = await readFile(path.resolve(filePath), "utf8")
  return parseUserTemplatePackage(JSON.parse(raw))
}

function parseTemplatePackageInput(args: string[]): Record<string, string> | undefined {
  const raw = parseFlag(args, "--input")
  return raw ? z.record(z.string(), z.string()).parse(JSON.parse(raw)) : undefined
}

async function previewTemplatePackage(args: string[]) {
  const templatePackage = await readTemplatePackageFromArgs(args)
  const input = parseTemplatePackageInput(args) ?? templatePackage.sampleInput
  const renderOptions = {
    ...resolveUserTemplatePackageRenderOptions(templatePackage),
    ...parseRenderOptions(args),
  }
  return service.previewCanvas({
    canvas: compileUserTemplatePackageToCanvas(templatePackage, input),
    renderOptions,
  })
}

async function handleTemplatePackage(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "help"
  const rest = args.slice(1)

  switch (subcommand) {
    case "validate": {
      const templatePackage = await readTemplatePackageFromArgs(rest)
      console.log(
        JSON.stringify(
          {
            ok: true,
            id: templatePackage.id,
            name: templatePackage.name,
            width: templatePackage.canvas.width,
            height: templatePackage.canvas.height,
            fields: templatePackage.fields.map((field) => field.key),
          },
          null,
          2
        )
      )
      return
    }
    case "preview": {
      console.log(JSON.stringify(await previewTemplatePackage(rest), null, 2))
      return
    }
    case "packets": {
      const preview = await previewTemplatePackage(rest)
      const packets = await service.getArtifactPackets(preview.artifact.id)
      console.log(JSON.stringify({ preview, packets }, null, 2))
      return
    }
    case "print": {
      const printerId = parseFlag(rest, "--printer")
      const printerName = parseFlag(rest, "--printer-name")
      if (!printerId) throw new Error("template-package print requires --printer")
      if (!service.serverSidePrintEnabled) {
        throw new Error(
          "Server-side printer control is disabled. Set TUCKMARK_ENABLE_SERVER_SIDE_PRINT=1 to enable it."
        )
      }
      const preview = await previewTemplatePackage(rest)
      const job = await service.printByArtifact({
        printerId,
        printerName,
        artifactId: preview.artifact.id,
      })
      console.log(JSON.stringify({ preview, job }, null, 2))
      return
    }
    default:
      printHelp()
      process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
