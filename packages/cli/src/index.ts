#!/usr/bin/env node
import { spawn } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  compileUserTemplatePackageToCanvas,
  parseUserTemplatePackage,
  type RenderOptions,
  resolveUserTemplatePackageRenderOptions,
  TuckmarkService,
} from "@tuckmark/core"
import { agentImportProposalSchema } from "@tuckmark/inventory"
import { resolveRequiredInstance } from "@tuckmark/ipc"
import { z } from "zod"

import { DevdIpcClient } from "./devd-ipc-client.js"
import {
  createDraftFromUserTemplatePackage,
  createInventoryAdjustmentInput,
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
    case "agent-import":
      await handleAgentImportCommand(argv.slice(1))
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
      "  tuckmark template list --instance <name> [--source <all|system|user>] [--all]",
      "  tuckmark template show --id <id> --instance <name>",
      "  tuckmark template import --file <path> --instance <name> [--id <id>] [--name <name>] [--description <text>]",
      "  tuckmark template update --id <id> --instance <name> [--name <name>] [--description <text>] [--recommended-use <text>]",
      "  tuckmark template rename --id <id> --name <name> --instance <name>",
      "  tuckmark template archive --id <id> --instance <name>",
      "  tuckmark template restore --id <id> --instance <name>",
      "  tuckmark template delete --id <id> --instance <name>",
      "  tuckmark inventory list --instance <name> [--query <text>] [--all]",
      "  tuckmark inventory show --id <id> --instance <name>",
      "  tuckmark inventory create --full-name <name> --instance <name> [--bindings <json>]",
      "  tuckmark inventory update --id <id> --instance <name> [--bindings <json>]",
      "  tuckmark inventory archive --id <id> --instance <name>",
      "  tuckmark inventory restore --id <id> --instance <name>",
      "  tuckmark agent-import catalog --instance <name>",
      "  tuckmark agent-import inventory --instance <name> [--query <text>]",
      "  tuckmark agent-import create --file <proposal.json> --instance <name> [--web-url <url>] [--no-open] [--credential-file <path>]",
      "  tuckmark agent-import open --session <id> [--web-url <url>] [--credential-file <path>]",
      "  tuckmark agent-import wait --session <id> --instance <name> [--timeout-ms <ms>] [--credential-file <path>]",
      "  tuckmark agent-import fulfill --session <id> --event <id> --revision <n> --input <json> --instance <name> [--credential-file <path>]",
      "  tuckmark inventory delete --id <id> --instance <name>",
      "  tuckmark inventory adjust --id <id> --instance <name> --kind <in|out|correction> [--quantity <n>] [--target-quantity <n>] [--note <text>] [--actor <name>]",
      "  tuckmark inventory print --id <id> --binding <bindingId> --printer <printerId> --instance <name> [--printer-name <name>] [--quantity <n>] [--render-options <json>]",
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

function rejectLegacyDataAccess(args: string[]): void {
  if (args.includes("--data-dir") || args.includes("--devd-url")) {
    throw new Error(
      "Direct data-directory and HTTP DEVD access were removed. Use --instance or TUCKMARK_DEVD_INSTANCE."
    )
  }
}

function resolveDevdInstance(args: string[], fallback?: string): string {
  rejectLegacyDataAccess(args)
  const instance = parseFlag(args, "--instance")
  return resolveRequiredInstance(instance ? { instance } : fallback ? { instance: fallback } : {})
}

function createDevdClient(args: string[]): DevdIpcClient {
  return new DevdIpcClient(resolveDevdInstance(args))
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
  switch (subcommand) {
    case "get-data-dir":
    case "set-data-dir":
      throw new Error(
        "Data-directory configuration was removed. Start DEVD with a named instance and use --instance or TUCKMARK_DEVD_INSTANCE."
      )
    default:
      throw new Error("config has no mutable data-directory commands.")
  }
}

const agentImportCredentialSchema = z.object({
  sessionId: z.string().min(1),
  secret: z.string().min(32),
  instance: z.string().min(1),
  webUrl: z.string().url().optional(),
  expiresAt: z.string().min(1),
})

type AgentImportCredential = z.infer<typeof agentImportCredentialSchema>

function resolveAgentImportWebUrl(args: string[], fallback?: string): string {
  const raw = parseFlag(args, "--web-url") ?? process.env.TUCKMARK_WEB_URL ?? fallback
  if (raw?.trim()) {
    const parsed = new URL(raw)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Web URL must use http or https.")
    }
    return parsed.toString().replace(/\/$/, "")
  }

  const webPort = process.env.TUCKMARK_WEB_PORT ?? "5173"
  return `http://127.0.0.1:${webPort}`
}

function defaultAgentImportCredentialPath(sessionId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    throw new Error("Invalid agent import session identifier.")
  }
  return path.join(os.homedir(), ".cache", "tuckmark", "agent-import", `${sessionId}.json`)
}

async function writeAgentImportCredential(
  filePath: string,
  credential: AgentImportCredential
): Promise<void> {
  const resolved = path.resolve(filePath)
  await mkdir(path.dirname(resolved), { recursive: true })
  await writeFile(resolved, `${JSON.stringify(credential, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
  if (process.platform !== "win32") {
    await chmod(resolved, 0o600)
  }
}

async function readAgentImportCredential(args: string[]): Promise<AgentImportCredential> {
  const sessionId = requireFlag(args, "--session")
  const filePath =
    parseFlag(args, "--credential-file") ?? defaultAgentImportCredentialPath(sessionId)
  const credential = agentImportCredentialSchema.parse(
    JSON.parse(await readFile(path.resolve(filePath), "utf8"))
  )
  if (credential.sessionId !== sessionId) {
    throw new Error("Agent import credential does not match --session.")
  }
  return credential
}

async function launchConfirmationUrl(url: string): Promise<void> {
  const command =
    process.platform === "darwin"
      ? { executable: "open", args: [url] }
      : process.platform === "win32"
        ? { executable: "cmd", args: ["/c", "start", "", url] }
        : { executable: "xdg-open", args: [url] }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      detached: true,
      stdio: "ignore",
    })
    child.once("error", reject)
    child.once("spawn", () => {
      child.unref()
      resolve()
    })
  })
}

function confirmationUrl(webUrl: string, credential: AgentImportCredential): string {
  return `${webUrl}/agent-import/${encodeURIComponent(credential.sessionId)}#key=${encodeURIComponent(credential.secret)}`
}

async function handleAgentImportCommand(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "help"
  const rest = args.slice(1)
  rejectLegacyDataAccess(rest)

  switch (subcommand) {
    case "catalog": {
      const catalog = await createDevdClient(rest).agentImport("/api/agent-import/catalog", {
        secret: "",
      })
      console.log(JSON.stringify(catalog, null, 2))
      return
    }
    case "inventory": {
      const query = parseFlag(rest, "--query")
      const inventory = await createDevdClient(rest).agentImport(
        `/api/agent-import/inventory${query ? `?query=${encodeURIComponent(query)}` : ""}`,
        { secret: "" }
      )
      console.log(JSON.stringify(inventory, null, 2))
      return
    }
    case "create": {
      const client = createDevdClient(rest)
      const webUrl = resolveAgentImportWebUrl(rest)
      const proposal = agentImportProposalSchema.parse(
        JSON.parse(await readFile(path.resolve(requireFlag(rest, "--file")), "utf8"))
      )
      const sessionId = `agent-import-session-${randomUUID()}`
      const secret = randomBytes(32).toString("base64url")
      const response = await client.agentImport<{
        session: { id: string; expiresAt: string }
      }>("/api/agent-import/sessions", {
        method: "POST",
        body: { sessionId, secret, proposal },
        secret: "",
      })
      const credential = agentImportCredentialSchema.parse({
        sessionId: response.session.id,
        secret,
        instance: client.instance,
        webUrl,
        expiresAt: response.session.expiresAt,
      })
      const credentialFile = path.resolve(
        parseFlag(rest, "--credential-file") ??
          defaultAgentImportCredentialPath(credential.sessionId)
      )
      await writeAgentImportCredential(credentialFile, credential)
      if (!hasFlag(rest, "--no-open")) {
        await launchConfirmationUrl(confirmationUrl(webUrl, credential))
      }
      console.log(
        JSON.stringify(
          {
            sessionId: credential.sessionId,
            expiresAt: credential.expiresAt,
            credentialFile,
            confirmationOrigin: webUrl,
            opened: !hasFlag(rest, "--no-open"),
          },
          null,
          2
        )
      )
      return
    }
    case "open": {
      const credential = await readAgentImportCredential(rest)
      const webUrl = resolveAgentImportWebUrl(rest, credential.webUrl)
      await launchConfirmationUrl(confirmationUrl(webUrl, credential))
      console.log(JSON.stringify({ sessionId: credential.sessionId, opened: true }, null, 2))
      return
    }
    case "wait": {
      const credential = await readAgentImportCredential(rest)
      const client = new DevdIpcClient(resolveDevdInstance(rest, credential.instance))
      const timeoutMs = parseIntegerFlag(rest, "--timeout-ms") ?? 25_000
      if (timeoutMs < 0) {
        throw new Error("--timeout-ms must be zero or greater.")
      }
      const deadline = Date.now() + timeoutMs
      const emit = (events: unknown[]) => {
        console.log(
          JSON.stringify(
            {
              sessionId: credential.sessionId,
              events,
              waiting: events.length === 0,
            },
            null,
            2
          )
        )
      }
      while (true) {
        const result = await client.agentImport<{
          events: unknown[]
        }>(`/api/agent-import/sessions/${encodeURIComponent(credential.sessionId)}/events`, {
          secret: credential.secret,
        })
        if (result.events.length > 0) {
          emit(result.events)
          return
        }
        const remaining = deadline - Date.now()
        if (remaining <= 0) {
          emit([])
          return
        }
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(1_000, remaining)))
      }
      return
    }
    case "fulfill": {
      const credential = await readAgentImportCredential(rest)
      const client = new DevdIpcClient(resolveDevdInstance(rest, credential.instance))
      const input = z.record(z.string(), z.string()).parse(JSON.parse(requireFlag(rest, "--input")))
      const session = await client.agentImport(
        `/api/agent-import/sessions/${encodeURIComponent(credential.sessionId)}/events/${encodeURIComponent(requireFlag(rest, "--event"))}/fulfill`,
        {
          method: "POST",
          secret: credential.secret,
          body: {
            expectedRevision: parseIntegerFlag(rest, "--revision"),
            input,
          },
        }
      )
      console.log(JSON.stringify(session, null, 2))
      return
    }
    default:
      throw new Error("agent-import supports catalog, inventory, create, open, wait, and fulfill.")
  }
}

async function handleTemplateCommand(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "help"
  const rest = args.slice(1)
  const client = createDevdClient(rest)

  switch (subcommand) {
    case "list": {
      rejectLegacyDataAccess(rest)
      const requestedSource = parseFlag(rest, "--source") ?? "all"
      const includeArchived = hasFlag(rest, "--all")
      const snapshot = await client.snapshot()
      const systemTemplates = requestedSource === "user" ? [] : await service.listTemplates()
      const userTemplates =
        requestedSource === "system"
          ? []
          : snapshot.templates
              .filter((template: any) => includeArchived || !template.archivedAt)
              .map((template: any) => {
                const working = snapshot.workingCopies.find(
                  (item: any) => item.sourceKey === `user:${template.id}`
                )
                const version = snapshot.versions.find(
                  (item: any) => item.id === template.currentVersionId
                )
                const document = working?.draft ?? version?.document
                return {
                  source: "user-template",
                  id: template.id,
                  name: template.name,
                  description: template.description,
                  archivedAt: template.archivedAt ?? null,
                  fields: document?.fields?.map((field: any) => field.key) ?? template.fieldOrder,
                  updatedAt: template.updatedAt,
                  ...(template.recommendedUse ? { recommendedUse: template.recommendedUse } : {}),
                }
              })
      console.log(
        JSON.stringify(
          {
            instance: client.instance,
            templates: [
              ...systemTemplates.map((template) => ({
                source: "system",
                id: template.id,
                name: template.name,
                description: template.description,
                fields: template.fields.map((field) => field.key),
              })),
              ...userTemplates,
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
      const snapshot = await client.snapshot()
      const template = snapshot.templates.find((item: any) => item.id === templateId)
      if (!template) {
        throw new Error(`Template ${templateId} was not found.`)
      }
      const working = snapshot.workingCopies.find(
        (item: any) => item.sourceKey === `user:${templateId}`
      )
      const versions = snapshot.versions.filter((item: any) => item.templateId === templateId)
      const document =
        working?.draft ??
        versions.find((item: any) => item.id === template.currentVersionId)?.document
      console.log(
        JSON.stringify(
          {
            source: "user-template",
            template: { ...template, fields: document?.fields ?? template.fieldOrder, document },
            workingCopyUpdatedAt: working?.updatedAt ?? null,
            savedVersions: versions
              .filter((version: any) => version.kind === "saved")
              .map((version: any) => ({
                id: version.id,
                version: version.version,
                kind: version.kind,
                createdAt: version.createdAt,
                label: version.label,
              })),
            autosaves: versions
              .filter((version: any) => version.kind === "autosave")
              .map((version: any) => ({
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
      const templateId = parseFlag(rest, "--id") ?? templatePackage.id
      const name = parseFlag(rest, "--name")
      const description = parseFlag(rest, "--description")
      const document = createDraftFromUserTemplatePackage(templatePackage, {
        templateId,
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
      })
      const imported = await client.runtimeCommand("save-template", {
        templateId,
        name: name ?? templatePackage.name,
        description: description ?? templatePackage.description,
        document,
      })
      console.log(JSON.stringify({ instance: client.instance, imported }, null, 2))
      return
    }
    case "update": {
      const templateId = requireFlag(rest, "--id")
      const patch: Record<string, string> = {}
      for (const [flag, key] of [
        ["--name", "name"],
        ["--description", "description"],
        ["--recommended-use", "recommendedUse"],
      ] as const) {
        const value = parseFlag(rest, flag)
        if (value !== undefined) patch[key] = value
      }
      if (Object.keys(patch).length === 0)
        throw new Error("template update requires a metadata flag.")
      const updated = await client.runtimeCommand("update-template-metadata", { templateId, patch })
      console.log(JSON.stringify({ instance: client.instance, template: updated }, null, 2))
      return
    }
    case "rename": {
      const renamed = await client.runtimeCommand("rename-template", {
        templateId: requireFlag(rest, "--id"),
        name: requireFlag(rest, "--name"),
      })
      console.log(JSON.stringify({ instance: client.instance, template: renamed }, null, 2))
      return
    }
    case "archive": {
      const archived = await client.runtimeCommand("archive-template", {
        templateId: requireFlag(rest, "--id"),
      })
      console.log(JSON.stringify({ instance: client.instance, template: archived }, null, 2))
      return
    }
    case "restore": {
      const restored = await client.runtimeCommand("restore-template", {
        templateId: requireFlag(rest, "--id"),
      })
      console.log(JSON.stringify({ instance: client.instance, template: restored }, null, 2))
      return
    }
    case "delete": {
      const deleted = await client.runtimeCommand("purge-template", {
        templateId: requireFlag(rest, "--id"),
      })
      console.log(JSON.stringify({ ok: true, instance: client.instance, data: deleted }, null, 2))
      return
    }
    default:
      throw new Error(
        "template supports list, show, import, update, rename, archive, restore, and delete."
      )
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
  const client = createDevdClient(rest)

  switch (subcommand) {
    case "list": {
      const materials = await client.listMaterials(
        parseFlag(rest, "--query") ?? "",
        hasFlag(rest, "--all")
      )
      console.log(JSON.stringify({ instance: client.instance, materials }, null, 2))
      return
    }
    case "show": {
      const materialId = requireFlag(rest, "--id")
      const material = (await client.listMaterials("", true)).find(
        (entry: any) => entry.id === materialId
      )
      if (!material) {
        throw new Error(`Material ${materialId} was not found.`)
      }
      const adjustments = await client.listAdjustments(materialId)
      console.log(JSON.stringify({ instance: client.instance, material, adjustments }, null, 2))
      return
    }
    case "create": {
      const labelBindings = parseLabelBindings(rest)
      const material = await client.inventoryCommand("save-material", {
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
        ...(parseFlag(rest, "--device-details")
          ? { deviceDetails: requireFlag(rest, "--device-details") }
          : {}),
        ...(parseFlag(rest, "--matrix-code")
          ? { matrixCode: requireFlag(rest, "--matrix-code") }
          : {}),
        ...(parseFlag(rest, "--packaging-remark")
          ? { packagingRemark: requireFlag(rest, "--packaging-remark") }
          : {}),
        ...(labelBindings ? { labelBindings } : {}),
      })
      console.log(JSON.stringify({ instance: client.instance, material }, null, 2))
      return
    }
    case "update": {
      const materialId = requireFlag(rest, "--id")
      const current = (await client.listMaterials("", true)).find(
        (entry: any) => entry.id === materialId
      )
      if (!current) {
        throw new Error(`Material ${materialId} was not found.`)
      }
      const labelBindings = parseLabelBindings(rest)
      const updated = await client.inventoryCommand("save-material", {
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
        deviceDetails: parseFlag(rest, "--device-details") ?? current.deviceDetails,
        ...(parseFlag(rest, "--matrix-code") || current.matrixCode
          ? { matrixCode: parseFlag(rest, "--matrix-code") ?? current.matrixCode ?? "" }
          : {}),
        packagingRemark: parseFlag(rest, "--packaging-remark") ?? current.packagingRemark,
        labelBindings: labelBindings ?? current.labelBindings,
      })
      console.log(JSON.stringify({ instance: client.instance, material: updated }, null, 2))
      return
    }
    case "archive": {
      const material = await client.inventoryCommand("archive-material", {
        materialId: requireFlag(rest, "--id"),
      })
      console.log(JSON.stringify({ instance: client.instance, material }, null, 2))
      return
    }
    case "restore": {
      const material = await client.inventoryCommand("restore-material", {
        materialId: requireFlag(rest, "--id"),
      })
      console.log(JSON.stringify({ instance: client.instance, material }, null, 2))
      return
    }
    case "delete": {
      await client.inventoryCommand("delete-material", { materialId: requireFlag(rest, "--id") })
      console.log(JSON.stringify({ ok: true, instance: client.instance }, null, 2))
      return
    }
    case "adjust": {
      const kind = z.enum(["in", "out", "correction"]).parse(requireFlag(rest, "--kind"))
      const quantity = parseIntegerFlag(rest, "--quantity")
      const targetQuantity = parseIntegerFlag(rest, "--target-quantity")
      const note = parseFlag(rest, "--note")
      const result = await client.inventoryCommand("apply-adjustment", {
        materialId: requireFlag(rest, "--id"),
        input: createInventoryAdjustmentInput({
          kind,
          ...(quantity !== undefined ? { quantity } : {}),
          ...(targetQuantity !== undefined ? { targetQuantity } : {}),
          ...(note ? { note } : {}),
          actor: parseFlag(rest, "--actor") ?? "cli",
        }),
      })
      console.log(JSON.stringify({ instance: client.instance, result }, null, 2))
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
      const result = await client.printInventoryBinding({
        materialId: requireFlag(rest, "--id"),
        bindingId: requireFlag(rest, "--binding"),
        printerId,
        printerName,
        quantity,
        renderOptions,
      })
      console.log(JSON.stringify({ instance: client.instance, result }, null, 2))
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
