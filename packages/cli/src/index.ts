#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import path from "node:path"

import {
  compileUserTemplatePackageToCanvas,
  parseUserTemplatePackage,
  type RenderOptions,
  resolveUserTemplatePackageRenderOptions,
  TuckmarkService,
} from "@tuckmark/core"
import { z } from "zod"

import {
  adjustInventoryMaterialInDirectory,
  archiveInventoryMaterialInDirectory,
  archiveSharedUserTemplate,
  createInventoryAdjustmentInput,
  deleteInventoryMaterialFromDirectory,
  deleteSharedUserTemplate,
  getSavedCliDataDir,
  importSharedUserTemplatePackage,
  listInventoryAdjustmentsFromDirectory,
  listInventoryMaterialsFromDirectory,
  listSharedUserTemplates,
  readInventoryMaterialFromDirectory,
  readSharedUserTemplateDetail,
  renameSharedUserTemplate,
  resolveCliDataDir,
  resolveInventoryPrintSource,
  restoreInventoryMaterialInDirectory,
  restoreSharedUserTemplate,
  saveInventoryMaterialToDirectory,
  setSavedCliDataDir,
} from "./shared-data-directory.js"

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

const inventoryLabelBindingSchema = z.array(
  z.object({
    id: z.string().min(1),
    templateSource: z.enum(["system", "user-template"]),
    templateId: z.string().min(1),
    templateName: z.string().min(1),
    printQuantity: z.number().int().positive(),
    fieldOverrides: z.record(z.string(), z.string()).default({}),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
)

async function main(): Promise<void> {
  switch (command) {
    case "help":
      printHelp()
      break
    case "templates":
      console.log(JSON.stringify(await service.listTemplates(), null, 2))
      break
    case "template":
      await handleTemplateCommand(argv.slice(1))
      break
    case "inventory":
      await handleInventoryCommand(argv.slice(1))
      break
    case "config":
      await handleConfigCommand(argv.slice(1))
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
    [
      "tuckmark commands:",
      "  tuckmark templates",
      "  tuckmark template list [--data-dir <dir>]",
      "  tuckmark template show --id <id> [--data-dir <dir>]",
      "  tuckmark template import --file <path> [--id <id>] [--name <name>] [--description <text>] [--data-dir <dir>]",
      "  tuckmark template rename --id <id> --name <name> [--data-dir <dir>]",
      "  tuckmark template archive --id <id> [--data-dir <dir>]",
      "  tuckmark template restore --id <id> [--data-dir <dir>]",
      "  tuckmark template delete --id <id> [--data-dir <dir>]",
      "  tuckmark inventory list [--query <text>] [--all] [--data-dir <dir>]",
      "  tuckmark inventory show --id <id> [--data-dir <dir>]",
      "  tuckmark inventory create --full-name <name> [--base-name <name>] [--variant-name <name>] [--package-name <name>] [--description <text>] [--matrix-code <code>] [--packaging-remark <text>] [--bindings <json>] [--data-dir <dir>]",
      "  tuckmark inventory update --id <id> [--full-name <name>] [--base-name <name>] [--variant-name <name>] [--package-name <name>] [--description <text>] [--matrix-code <code>] [--packaging-remark <text>] [--bindings <json>] [--data-dir <dir>]",
      "  tuckmark inventory archive --id <id> [--data-dir <dir>]",
      "  tuckmark inventory restore --id <id> [--data-dir <dir>]",
      "  tuckmark inventory delete --id <id> [--data-dir <dir>]",
      "  tuckmark inventory adjust --id <id> --kind <in|out|correction> [--quantity <n>] [--target-quantity <n>] [--note <text>] [--actor <name>] [--data-dir <dir>]",
      "  tuckmark inventory print --id <id> --binding <bindingId> --printer <printerId> [--printer-name <name>] [--quantity <n>] [--render-options <json>] [--data-dir <dir>]",
      "  tuckmark config get-data-dir",
      "  tuckmark config set-data-dir --path <dir>",
      "  tuckmark printers",
      "  tuckmark probe --printer <id> [--printer-name <name>]",
      "  tuckmark preview --template <id> --input <json> [--render-options <json>]",
      "  tuckmark preview --canvas <json> [--render-options <json>]",
      "  tuckmark preview --safe-text <json> [--render-options <json>]",
      "  tuckmark batch-preview --template <id> --csv <path> [--render-options <json>]",
      "  tuckmark print --printer <id> [--printer-name <name>] --artifact <id>",
      "  tuckmark print --printer <id> [--printer-name <name>] --artifacts <json-array>",
      "  tuckmark print --printer <id> [--printer-name <name>] --safe-text <json> [--render-options <json>]",
      "  tuckmark print --printer <id> [--printer-name <name>] --template <id> --input <json> [--render-options <json>]",
      "  tuckmark template-package validate --file <path>",
      "  tuckmark template-package preview --file <path> [--input <json>] [--render-options <json>]",
      "  tuckmark template-package packets --file <path> [--input <json>] [--render-options <json>]",
      "  tuckmark template-package print --printer <id> [--printer-name <name>] --file <path> [--input <json>] [--render-options <json>]",
    ].join("\n")
  )
}

function parseFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) {
    return undefined
  }
  return args[index + 1]
}

function requireFlag(args: string[], name: string): string {
  const value = parseFlag(args, name)
  if (!value) {
    throw new Error(`Missing required flag: ${name}`)
  }
  return value
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name)
}

function parseIntegerFlag(args: string[], name: string): number | undefined {
  const raw = parseFlag(args, name)
  if (raw === undefined) {
    return undefined
  }
  const parsed = Number(raw)
  if (!Number.isInteger(parsed)) {
    throw new Error(`Flag ${name} must be an integer.`)
  }
  return parsed
}

function parseJsonFlag<T>(args: string[], name: string, schema: z.ZodType<T>): T | undefined {
  const raw = parseFlag(args, name)
  if (!raw) {
    return undefined
  }
  return schema.parse(JSON.parse(raw))
}

function parseRenderOptions(args: string[]): Partial<RenderOptions> | undefined {
  return parseJsonFlag(args, "--render-options", renderOptionsSchema.partial()) as
    | Partial<RenderOptions>
    | undefined
}

function parseDataDirFlag(args: string[]): string | undefined {
  return parseFlag(args, "--data-dir")
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
  const templateId = requireFlag(args, "--template")
  const csvPath = requireFlag(args, "--csv")
  const csvText = await readFile(path.resolve(csvPath), "utf8")
  const result = await service.previewBatch({
    templateId,
    csvText,
    renderOptions: parseRenderOptions(args),
  })
  console.log(JSON.stringify(result, null, 2))
}

async function handleProbe(args: string[]): Promise<void> {
  const printerId = requireFlag(args, "--printer")
  const printerName = parseFlag(args, "--printer-name")
  console.log(JSON.stringify(await service.probePrinter(printerId, printerName), null, 2))
}

async function handlePrint(args: string[]): Promise<void> {
  const printerId = requireFlag(args, "--printer")
  const printerName = parseFlag(args, "--printer-name")
  const artifactId = parseFlag(args, "--artifact")
  const artifactIdsArg = parseFlag(args, "--artifacts")
  const templateId = parseFlag(args, "--template")
  const safeTextArg = parseFlag(args, "--safe-text")
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
  throw new Error("print requires --artifact, --artifacts, --safe-text, or --template")
}

async function readTemplatePackageFromArgs(args: string[]) {
  const filePath = requireFlag(args, "--file")
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
    case "preview":
      console.log(JSON.stringify(await previewTemplatePackage(rest), null, 2))
      return
    case "packets": {
      const preview = await previewTemplatePackage(rest)
      const packets = await service.getArtifactPackets(preview.artifact.id)
      console.log(JSON.stringify({ preview, packets }, null, 2))
      return
    }
    case "print": {
      const printerId = requireFlag(rest, "--printer")
      const printerName = parseFlag(rest, "--printer-name")
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

async function handleConfigCommand(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "help"
  const rest = args.slice(1)
  switch (subcommand) {
    case "get-data-dir": {
      const dataDir = await getSavedCliDataDir()
      console.log(
        JSON.stringify(
          {
            configured: Boolean(dataDir),
            dataDir,
          },
          null,
          2
        )
      )
      return
    }
    case "set-data-dir": {
      const saved = await setSavedCliDataDir(requireFlag(rest, "--path"))
      console.log(
        JSON.stringify(
          {
            ok: true,
            dataDir: saved,
          },
          null,
          2
        )
      )
      return
    }
    default:
      throw new Error("config supports get-data-dir and set-data-dir.")
  }
}

async function handleTemplateCommand(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "help"
  const rest = args.slice(1)
  const dataDir = await resolveCliDataDir(parseDataDirFlag(rest))

  switch (subcommand) {
    case "list": {
      const requestedSource = parseFlag(rest, "--source") ?? "all"
      const source = requestedSource === "shared" ? "user" : requestedSource
      const includeArchived = hasFlag(rest, "--all")
      const systemTemplates = source === "user" ? [] : await service.listTemplates()
      const userTemplates =
        source === "system"
          ? []
          : await listSharedUserTemplates({
              dataDir,
              includeArchived,
            })
      console.log(
        JSON.stringify(
          {
            dataDir,
            templates: [
              ...systemTemplates.map((template) => ({
                source: "system",
                id: template.id,
                name: template.name,
                description: template.description,
                fields: template.fields.map((field) => field.key),
              })),
              ...userTemplates.map((template) => ({
                source: "user-template",
                id: template.id,
                name: template.name,
                description: template.description,
                archivedAt: template.archivedAt ?? null,
                fields: template.fields.map((field) => field.key),
                updatedAt: template.updatedAt,
              })),
            ],
          },
          null,
          2
        )
      )
      return
    }
    case "show": {
      const templateId = requireFlag(rest, "--id")
      const systemTemplate = (await service.listTemplates()).find(
        (template) => template.id === templateId
      )
      if (systemTemplate) {
        console.log(
          JSON.stringify(
            {
              source: "system",
              template: systemTemplate,
            },
            null,
            2
          )
        )
        return
      }
      const detail = await readSharedUserTemplateDetail(dataDir, templateId)
      if (!detail) {
        throw new Error(`Template ${templateId} was not found.`)
      }
      console.log(
        JSON.stringify(
          {
            source: "user-template",
            template: detail.template,
            workingCopyUpdatedAt: detail.workingCopy?.updatedAt ?? null,
            savedVersions: detail.savedVersions.map((version) => ({
              id: version.id,
              version: version.version,
              kind: version.kind,
              createdAt: version.createdAt,
              label: version.label,
            })),
            autosaves: detail.autosaves.map((version) => ({
              id: version.id,
              version: version.version,
              createdAt: version.createdAt,
              label: version.label,
            })),
          },
          null,
          2
        )
      )
      return
    }
    case "import": {
      const templatePackage = await readTemplatePackageFromArgs(rest)
      const imported = await importSharedUserTemplatePackage({
        dataDir,
        templatePackage,
        ...(parseFlag(rest, "--id") ? { templateId: requireFlag(rest, "--id") } : {}),
        ...(parseFlag(rest, "--name") ? { name: requireFlag(rest, "--name") } : {}),
        ...(parseFlag(rest, "--description")
          ? { description: requireFlag(rest, "--description") }
          : {}),
      })
      console.log(JSON.stringify({ dataDir, imported }, null, 2))
      return
    }
    case "rename": {
      const renamed = await renameSharedUserTemplate({
        dataDir,
        templateId: requireFlag(rest, "--id"),
        name: requireFlag(rest, "--name"),
      })
      console.log(JSON.stringify({ dataDir, template: renamed }, null, 2))
      return
    }
    case "archive": {
      const archived = await archiveSharedUserTemplate(dataDir, requireFlag(rest, "--id"))
      console.log(JSON.stringify({ dataDir, template: archived }, null, 2))
      return
    }
    case "restore": {
      const restored = await restoreSharedUserTemplate(dataDir, requireFlag(rest, "--id"))
      console.log(JSON.stringify({ dataDir, template: restored }, null, 2))
      return
    }
    case "delete": {
      await deleteSharedUserTemplate(dataDir, requireFlag(rest, "--id"))
      console.log(JSON.stringify({ ok: true, dataDir }, null, 2))
      return
    }
    default:
      throw new Error("template supports list, show, import, rename, archive, restore, and delete.")
  }
}

function parseLabelBindings(args: string[]) {
  const raw = parseFlag(args, "--bindings")
  if (!raw) {
    return undefined
  }
  return inventoryLabelBindingSchema.parse(JSON.parse(raw))
}

async function handleInventoryCommand(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "help"
  const rest = args.slice(1)
  const dataDir = await resolveCliDataDir(parseDataDirFlag(rest))

  switch (subcommand) {
    case "list": {
      const materials = await listInventoryMaterialsFromDirectory({
        dataDir,
        query: parseFlag(rest, "--query") ?? "",
        includeArchived: hasFlag(rest, "--all"),
      })
      console.log(JSON.stringify({ dataDir, materials }, null, 2))
      return
    }
    case "show": {
      const materialId = requireFlag(rest, "--id")
      const material = await readInventoryMaterialFromDirectory(dataDir, materialId)
      if (!material) {
        throw new Error(`Material ${materialId} was not found.`)
      }
      const adjustments = await listInventoryAdjustmentsFromDirectory({
        dataDir,
        materialId,
      })
      console.log(JSON.stringify({ dataDir, material, adjustments }, null, 2))
      return
    }
    case "create": {
      const labelBindings = parseLabelBindings(rest)
      const material = await saveInventoryMaterialToDirectory({
        dataDir,
        material: {
          fullName: requireFlag(rest, "--full-name"),
          ...(parseFlag(rest, "--base-name") ? { baseName: requireFlag(rest, "--base-name") } : {}),
          ...(parseFlag(rest, "--variant-name")
            ? { variantName: requireFlag(rest, "--variant-name") }
            : {}),
          ...(parseFlag(rest, "--package-name")
            ? { packageName: requireFlag(rest, "--package-name") }
            : {}),
          ...(parseFlag(rest, "--description")
            ? { description: requireFlag(rest, "--description") }
            : {}),
          ...(parseFlag(rest, "--matrix-code")
            ? { matrixCode: requireFlag(rest, "--matrix-code") }
            : {}),
          ...(parseFlag(rest, "--packaging-remark")
            ? { packagingRemark: requireFlag(rest, "--packaging-remark") }
            : {}),
          ...(labelBindings ? { labelBindings } : {}),
        },
      })
      console.log(JSON.stringify({ dataDir, material }, null, 2))
      return
    }
    case "update": {
      const materialId = requireFlag(rest, "--id")
      const current = await readInventoryMaterialFromDirectory(dataDir, materialId)
      if (!current) {
        throw new Error(`Material ${materialId} was not found.`)
      }
      const labelBindings = parseLabelBindings(rest)
      const updated = await saveInventoryMaterialToDirectory({
        dataDir,
        material: {
          id: current.id,
          fullName: parseFlag(rest, "--full-name") ?? current.fullName,
          ...(parseFlag(rest, "--base-name") || current.baseName
            ? { baseName: parseFlag(rest, "--base-name") ?? current.baseName ?? "" }
            : {}),
          ...(parseFlag(rest, "--variant-name") || current.variantName
            ? { variantName: parseFlag(rest, "--variant-name") ?? current.variantName ?? "" }
            : {}),
          ...(parseFlag(rest, "--package-name") || current.packageName
            ? { packageName: parseFlag(rest, "--package-name") ?? current.packageName ?? "" }
            : {}),
          description: parseFlag(rest, "--description") ?? current.description,
          ...(parseFlag(rest, "--matrix-code") || current.matrixCode
            ? { matrixCode: parseFlag(rest, "--matrix-code") ?? current.matrixCode ?? "" }
            : {}),
          packagingRemark: parseFlag(rest, "--packaging-remark") ?? current.packagingRemark,
          labelBindings: labelBindings ?? current.labelBindings,
        },
      })
      console.log(JSON.stringify({ dataDir, material: updated }, null, 2))
      return
    }
    case "archive": {
      const material = await archiveInventoryMaterialInDirectory(dataDir, requireFlag(rest, "--id"))
      console.log(JSON.stringify({ dataDir, material }, null, 2))
      return
    }
    case "restore": {
      const material = await restoreInventoryMaterialInDirectory(dataDir, requireFlag(rest, "--id"))
      console.log(JSON.stringify({ dataDir, material }, null, 2))
      return
    }
    case "delete": {
      await deleteInventoryMaterialFromDirectory(dataDir, requireFlag(rest, "--id"))
      console.log(JSON.stringify({ ok: true, dataDir }, null, 2))
      return
    }
    case "adjust": {
      const kind = z.enum(["in", "out", "correction"]).parse(requireFlag(rest, "--kind"))
      const quantity = parseIntegerFlag(rest, "--quantity")
      const targetQuantity = parseIntegerFlag(rest, "--target-quantity")
      const note = parseFlag(rest, "--note")
      const result = await adjustInventoryMaterialInDirectory({
        dataDir,
        materialId: requireFlag(rest, "--id"),
        input: createInventoryAdjustmentInput({
          kind,
          ...(quantity !== undefined ? { quantity } : {}),
          ...(targetQuantity !== undefined ? { targetQuantity } : {}),
          ...(note ? { note } : {}),
          actor: parseFlag(rest, "--actor") ?? "cli",
        }),
      })
      console.log(JSON.stringify({ dataDir, ...result }, null, 2))
      return
    }
    case "print": {
      if (!service.serverSidePrintEnabled) {
        throw new Error(
          "Server-side printer control is disabled. Set TUCKMARK_ENABLE_SERVER_SIDE_PRINT=1 to enable it."
        )
      }
      const printerId = requireFlag(rest, "--printer")
      const printerName = parseFlag(rest, "--printer-name")
      const renderOptions = parseRenderOptions(rest)
      const quantity = parseIntegerFlag(rest, "--quantity")
      const source = await resolveInventoryPrintSource({
        dataDir,
        materialId: requireFlag(rest, "--id"),
        bindingId: requireFlag(rest, "--binding"),
        ...(quantity !== undefined ? { quantity } : {}),
        ...(renderOptions ? { renderOptions } : {}),
      })
      if (source.kind === "system-template") {
        const results = []
        for (let index = 0; index < source.copies; index += 1) {
          results.push(
            await service.printByTemplate({
              printerId,
              printerName,
              templateId: source.templateId,
              input: source.input,
              renderOptions: source.renderOptions,
            })
          )
        }
        console.log(
          JSON.stringify({ dataDir, source, result: results[results.length - 1], results }, null, 2)
        )
        return
      }
      const results = []
      for (let index = 0; index < source.copies; index += 1) {
        results.push(
          await service.printCanvas({
            printerId,
            printerName,
            canvas: source.canvas,
            renderOptions: source.renderOptions,
          })
        )
      }
      console.log(
        JSON.stringify(
          {
            dataDir,
            source: { kind: source.kind, copies: source.copies },
            result: results[results.length - 1],
            results,
          },
          null,
          2
        )
      )
      return
    }
    default:
      throw new Error(
        "inventory supports list, show, create, update, archive, restore, delete, adjust, and print."
      )
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
