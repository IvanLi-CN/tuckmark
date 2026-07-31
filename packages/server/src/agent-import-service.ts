import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import { presetTemplates } from "@tuckmark/core"
import {
  type AgentImportEvent,
  type AgentImportItem,
  type AgentImportLocalTemplate,
  type AgentImportProposal,
  type AgentImportSession,
  type AgentImportTemplate,
  agentImportEventSchema,
  agentImportItemSchema,
  agentImportLocalTemplateSchema,
  agentImportProposalSchema,
  agentImportSessionSchema,
  agentImportTemplateSchema,
  applyInventoryAdjustment,
  ensureInventoryMaterialActive,
  type InventoryAdjustment,
  type InventoryMaterial,
  inventoryMaterialSchema,
} from "@tuckmark/inventory"
import { z } from "zod"

import { DevdDataService } from "./devd-data-service.js"

const SESSION_TTL_MS = 30 * 60 * 1000
const SECRET_BYTES = 32
const sharedTemplateRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  archivedAt: z.string().nullable().optional(),
  currentVersionId: z.string().min(1),
  recommendedUses: z
    .array(
      z.object({
        scope: z.string().min(1),
        weight: z.number().int().min(1).max(100),
      })
    )
    .default([]),
})

const sharedTemplateVersionSchema = z.object({
  document: z.object({
    fields: z
      .array(
        z.object({
          key: z.string().min(1),
          label: z.string().min(1),
          multiline: z.boolean().default(false),
        })
      )
      .default([]),
  }),
})

type ManagedSession = AgentImportSession & {
  secretHash: Buffer
  localTemplates: Map<string, AgentImportLocalTemplate>
}

export type AgentImportCatalog = {
  templates: AgentImportTemplate[]
}

export type AgentImportCreateSessionInput = {
  sessionId: string
  secret: string
  proposal: AgentImportProposal
}

function isoAfter(durationMs: number): string {
  return new Date(Date.now() + durationMs).toISOString()
}

function hashSecret(value: string): Buffer {
  return createHash("sha256").update(value).digest()
}

function assertSessionSecret(session: ManagedSession, secret: string): void {
  const candidate = hashSecret(secret)
  if (
    candidate.length !== session.secretHash.length ||
    !timingSafeEqual(candidate, session.secretHash)
  ) {
    throw new Error("Invalid agent import session key.")
  }
}

function cloneSession(session: ManagedSession): AgentImportSession {
  return agentImportSessionSchema.parse({
    id: session.id,
    state: session.state,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    proposal: session.proposal,
    events: session.events,
  })
}

function safeFilename(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error("Invalid filesystem identifier.")
  }
  return value
}

function templateKey(template: AgentImportTemplate): string {
  return `${template.source}:${template.id}`
}

function ensureRequiredTemplateInput(
  template: AgentImportTemplate,
  input: Record<string, string>
): void {
  const missing = template.fields
    .filter((field) => field.required && !input[field.key]?.trim())
    .map((field) => field.label)
  if (missing.length) {
    throw new Error(`Template input is missing required fields: ${missing.join(", ")}.`)
  }
}

async function listJsonFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(root, entry.name))
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []
    }
    throw error
  }
}

async function listDirectories(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []
    }
    throw error
  }
}

export class AgentImportService {
  private readonly sessions = new Map<string, ManagedSession>()
  private importCommitQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly dataDir: string,
    private readonly dataService = new DevdDataService(dataDir)
  ) {}

  static fromEnvironment(dataService?: DevdDataService): AgentImportService | null {
    const dataDir = process.env.TUCKMARK_DATA_DIR?.trim()
    return dataDir
      ? new AgentImportService(dataDir, dataService ?? new DevdDataService(dataDir))
      : null
  }

  async catalog(): Promise<AgentImportCatalog> {
    return { templates: await this.listTemplates() }
  }

  async listInventory(query?: string): Promise<InventoryMaterial[]> {
    return (await this.dataService.readMaterials(query ?? "", false)).data
  }

  createSession(input: AgentImportCreateSessionInput): AgentImportSession {
    this.cleanupExpiredSessions()
    if (this.sessions.has(input.sessionId)) {
      throw new Error("Agent import session already exists.")
    }
    if (input.secret.length < SECRET_BYTES) {
      throw new Error("Agent import session key is too short.")
    }
    const proposal = agentImportProposalSchema.parse(input.proposal)
    const now = new Date().toISOString()
    const session: ManagedSession = {
      id: input.sessionId,
      state: "open",
      createdAt: now,
      expiresAt: isoAfter(SESSION_TTL_MS),
      proposal,
      events: [],
      secretHash: hashSecret(input.secret),
      localTemplates: new Map(),
    }
    this.sessions.set(session.id, session)
    return cloneSession(session)
  }

  getSession(sessionId: string, secret: string): AgentImportSession {
    return cloneSession(this.requireSession(sessionId, secret))
  }

  listEvents(sessionId: string, secret: string): AgentImportEvent[] {
    const session = this.requireSession(sessionId, secret)
    return session.events.filter((event) => event.status === "open")
  }

  updateItem(args: {
    sessionId: string
    secret: string
    itemId: string
    expectedRevision: number
    item: AgentImportItem
  }): AgentImportSession {
    const session = this.requireOpenSession(args.sessionId, args.secret)
    const index = this.requireItemIndex(session, args.itemId)
    const current = session.proposal.items[index]
    if (!current) {
      throw new Error("Agent import item was not found.")
    }
    if (current.revision !== args.expectedRevision) {
      throw new Error("This import item changed. Refresh before saving it again.")
    }
    const pendingEvent = current.pendingTemplateEventId
      ? session.events.find(
          (event) =>
            event.id === current.pendingTemplateEventId &&
            event.itemId === current.id &&
            event.status === "open"
        )
      : undefined
    if (current.pendingTemplateEventId && !pendingEvent) {
      throw new Error("Template input event is no longer open.")
    }
    const next = agentImportItemSchema.parse({
      ...args.item,
      id: current.id,
      kind: current.kind,
      revision: current.revision + 1,
      template: current.template,
      templateInput: pendingEvent ? current.templateInput : args.item.templateInput,
      pendingTemplateEventId: current.pendingTemplateEventId,
    })
    session.proposal.items[index] = next
    if (pendingEvent) {
      pendingEvent.revision = next.revision
    }
    return cloneSession(session)
  }

  requestTemplateInput(args: {
    sessionId: string
    secret: string
    itemId: string
    expectedRevision: number
    template: AgentImportTemplate
    localTemplate?: AgentImportLocalTemplate
  }): AgentImportSession {
    const session = this.requireOpenSession(args.sessionId, args.secret)
    const index = this.requireItemIndex(session, args.itemId)
    const current = session.proposal.items[index]
    if (!current) {
      throw new Error("Agent import item was not found.")
    }
    if (current.kind !== "new") {
      throw new Error("Only new materials accept an import template change.")
    }
    if (current.revision !== args.expectedRevision) {
      throw new Error("This import item changed. Refresh before changing its template.")
    }
    const template = agentImportTemplateSchema.parse(args.template)
    const localTemplate = args.localTemplate
      ? agentImportLocalTemplateSchema.parse(args.localTemplate)
      : undefined
    if (localTemplate) {
      if (templateKey(localTemplate.template) !== templateKey(template)) {
        throw new Error("Local template snapshot does not match the selected template.")
      }
    }
    for (const event of session.events) {
      if (event.itemId === current.id && event.status === "open") {
        event.status = "superseded"
      }
    }
    if (localTemplate) {
      session.localTemplates.set(templateKey(template), localTemplate)
    }
    const event = agentImportEventSchema.parse({
      id: `agent-import-event-${randomUUID()}`,
      type: "template-input-requested",
      itemId: current.id,
      revision: current.revision + 1,
      template,
      createdAt: new Date().toISOString(),
      status: "open",
    })
    session.proposal.items[index] = agentImportItemSchema.parse({
      ...current,
      template,
      templateInput: {},
      pendingTemplateEventId: event.id,
      revision: event.revision,
    })
    session.events.push(event)
    return cloneSession(session)
  }

  fulfillTemplateInput(args: {
    sessionId: string
    secret: string
    eventId: string
    expectedRevision: number
    input: Record<string, string>
  }): AgentImportSession {
    const session = this.requireOpenSession(args.sessionId, args.secret)
    const event = session.events.find((candidate) => candidate.id === args.eventId)
    if (event?.status !== "open") {
      throw new Error("Template input event is no longer open.")
    }
    if (event.revision !== args.expectedRevision) {
      throw new Error("Template input event revision does not match.")
    }
    const index = this.requireItemIndex(session, event.itemId)
    const current = session.proposal.items[index]
    if (!current) {
      event.status = "superseded"
      throw new Error("Agent import item was not found.")
    }
    if (current.revision !== event.revision || current.pendingTemplateEventId !== event.id) {
      event.status = "superseded"
      throw new Error("Template input event was superseded by a user edit.")
    }
    const input = z.record(z.string(), z.string()).parse(args.input)
    ensureRequiredTemplateInput(event.template, input)
    session.proposal.items[index] = agentImportItemSchema.parse({
      ...current,
      templateInput: input,
      pendingTemplateEventId: null,
      revision: current.revision + 1,
    })
    event.status = "fulfilled"
    return cloneSession(session)
  }

  async confirm(sessionId: string, secret: string): Promise<AgentImportSession> {
    return await this.serializeImportCommit(async () => {
      const session = this.requireOpenSession(sessionId, secret)
      await this.commitProposal(session)
      session.state = "completed"
      return cloneSession(session)
    })
  }

  private requireSession(sessionId: string, secret: string): ManagedSession {
    this.cleanupExpiredSessions()
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error("Agent import session was not found or has expired.")
    }
    assertSessionSecret(session, secret)
    return session
  }

  private requireOpenSession(sessionId: string, secret: string): ManagedSession {
    const session = this.requireSession(sessionId, secret)
    if (session.state !== "open") {
      throw new Error("Agent import session is no longer open.")
    }
    return session
  }

  private requireItemIndex(session: ManagedSession, itemId: string): number {
    const index = session.proposal.items.findIndex((item) => item.id === itemId)
    if (index === -1) {
      throw new Error("Agent import item was not found.")
    }
    return index
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (Date.parse(session.expiresAt) <= now) {
        this.sessions.delete(id)
      }
    }
  }

  private async listTemplates(): Promise<AgentImportTemplate[]> {
    const systemTemplates = presetTemplates.map((template) =>
      agentImportTemplateSchema.parse({
        source: "system",
        id: template.id,
        name: template.name,
        fields: template.fields,
        recommendedUses: template.recommendedUses ?? [],
      })
    )
    const templateIds = await listDirectories(path.join(this.dataDir, "templates"))
    const sharedTemplates = (
      await Promise.all(
        templateIds.map(async (templateId) => {
          const root = path.join(this.dataDir, "templates", safeFilename(templateId))
          try {
            const record = sharedTemplateRecordSchema.parse(
              JSON.parse(await readFile(path.join(root, "template.json"), "utf8"))
            )
            if (record.archivedAt) {
              return null
            }
            const version = sharedTemplateVersionSchema.parse(
              JSON.parse(
                await readFile(
                  path.join(root, "versions", `${safeFilename(record.currentVersionId)}.json`),
                  "utf8"
                )
              )
            )
            return agentImportTemplateSchema.parse({
              source: "user-template",
              id: record.id,
              name: record.name,
              fields: version.document.fields.map((field) => ({
                ...field,
                required: false,
              })),
              recommendedUses: record.recommendedUses,
            })
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              return null
            }
            throw error
          }
        })
      )
    ).filter((template): template is AgentImportTemplate => Boolean(template))
    return [...systemTemplates, ...sharedTemplates]
  }

  private async commitProposal(session: ManagedSession): Promise<void> {
    const proposal = session.proposal
    const expectedRevision = await this.dataService.currentRevision()
    const materials = await this.readAllMaterials()
    const selectedItems = proposal.items.filter((item) => item.selected)
    const catalog = new Map(
      (await this.listTemplates()).map((template) => [templateKey(template), template])
    )
    const writes: Array<{ relativePath: string; value: unknown }> = []
    const persistedLocalTemplates = new Map<string, AgentImportTemplate>()
    const initialMaterialUpdatedAt = new Map(
      materials.map((material) => [material.id, material.updatedAt])
    )
    const now = new Date().toISOString()

    for (const item of selectedItems) {
      if (item.pendingTemplateEventId) {
        throw new Error(`Template input is still pending for ${item.material.fullName}.`)
      }
      let material: InventoryMaterial
      if (item.kind === "new") {
        if (!item.template) {
          throw new Error(`New material ${item.material.fullName} needs a label template.`)
        }
        const localTemplate = session.localTemplates.get(templateKey(item.template))
        const catalogTemplate = catalog.get(templateKey(item.template))
        if (!localTemplate && !catalogTemplate) {
          throw new Error(`Label template ${templateKey(item.template)} was not found.`)
        }
        const selectedTemplate = localTemplate ? item.template : catalogTemplate
        if (!selectedTemplate) throw new Error("Label template was not found.")
        ensureRequiredTemplateInput(selectedTemplate, item.templateInput)
        if (materials.some((candidate) => candidate.fullName === item.material.fullName)) {
          throw new Error(`Material ${item.material.fullName} already exists.`)
        }
        if (
          item.material.matrixCode?.trim() &&
          materials.some((candidate) => candidate.matrixCode === item.material.matrixCode)
        ) {
          throw new Error(
            `Matrix code ${item.material.matrixCode} is already used by another material.`
          )
        }
        const bindingTemplate = await this.persistLocalTemplateIfNeeded({
          template: selectedTemplate,
          localTemplate,
          persistedLocalTemplates,
          writes,
          now,
        })
        material = inventoryMaterialSchema.parse({
          id: `inventory-material-${randomUUID()}`,
          ...item.material,
          currentQuantity: 0,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          labelBindings: [
            {
              id: `inventory-label-binding-${randomUUID()}`,
              templateSource: bindingTemplate.source,
              templateId: bindingTemplate.id,
              templateName: bindingTemplate.name,
              printQuantity: item.labelPrintQuantity ?? 1,
              fieldOverrides: item.templateInput,
              createdAt: now,
              updatedAt: now,
            },
          ],
        })
      } else {
        material =
          materials.find((candidate) => candidate.id === item.targetMaterialId) ??
          (() => {
            throw new Error(`Restock material ${item.targetMaterialId} was not found.`)
          })()
        ensureInventoryMaterialActive(material, "入库")
        if (!item.targetMaterialUpdatedAt) {
          throw new Error(`Restock material ${material.fullName} is missing its session timestamp.`)
        }
        if (initialMaterialUpdatedAt.get(material.id) !== item.targetMaterialUpdatedAt) {
          throw new Error(
            `Restock material ${material.fullName} changed while this session was open.`
          )
        }
      }

      const result = applyInventoryAdjustment({
        material,
        input: {
          kind: "in",
          quantity: item.quantity,
          note: item.sourceNote || proposal.sourceNote,
          actor: "agent-import",
          createdAt: now,
        },
        adjustmentId: `inventory-adjustment-${randomUUID()}`,
      })
      const materialIndex = materials.findIndex((candidate) => candidate.id === result.material.id)
      if (materialIndex === -1) {
        materials.push(result.material)
      } else {
        materials[materialIndex] = result.material
      }
      writes.push({
        relativePath: path.join(
          "inventory",
          "materials",
          `${safeFilename(result.material.id)}.json`
        ),
        value: result.material,
      })
      writes.push({
        relativePath: path.join(
          "inventory",
          "adjustments",
          `${safeFilename(result.adjustment.id)}.json`
        ),
        value: result.adjustment satisfies InventoryAdjustment,
      })
    }

    if (!writes.length) {
      return
    }
    await this.commitWrites(writes, expectedRevision)
  }

  private async persistLocalTemplateIfNeeded(args: {
    template: AgentImportTemplate
    localTemplate: AgentImportLocalTemplate | undefined
    persistedLocalTemplates: Map<string, AgentImportTemplate>
    writes: Array<{ relativePath: string; value: unknown }>
    now: string
  }): Promise<AgentImportTemplate> {
    if (!args.localTemplate) {
      return args.template
    }

    try {
      await readFile(
        path.join(this.dataDir, "templates", safeFilename(args.template.id), "template.json"),
        "utf8"
      )
      return args.template
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
    }

    const sourceKey = templateKey(args.template)
    const existing = args.persistedLocalTemplates.get(sourceKey)
    if (existing) {
      return existing
    }

    const templateId = `user-template-${randomUUID()}`
    const versionId = `user-template-version-${randomUUID()}`
    const document = {
      ...args.localTemplate.document,
      id: `shared-template-${templateId}`,
      name: args.template.name,
      source: { kind: "user-template", templateId },
      templateId,
      baseVersionId: undefined,
      lastSavedAt: args.now,
    }
    const persisted = agentImportTemplateSchema.parse({
      ...args.template,
      id: templateId,
      recommendedUses: [],
    })
    args.writes.push({
      relativePath: path.join("templates", `${safeFilename(templateId)}`, "template.json"),
      value: {
        id: templateId,
        name: args.template.name,
        description: args.localTemplate.description,
        width: document.width,
        height: document.height,
        createdAt: args.now,
        updatedAt: args.now,
        archivedAt: null,
        currentVersionId: versionId,
        fieldOrder: document.fields.map((field) => field.key),
        recommendedUses: [],
      },
    })
    args.writes.push({
      relativePath: path.join(
        "templates",
        `${safeFilename(templateId)}`,
        "versions",
        `${safeFilename(versionId)}.json`
      ),
      value: {
        id: versionId,
        templateId,
        version: 1,
        kind: "saved",
        createdAt: args.now,
        label: "Imported local template",
        document,
      },
    })
    args.persistedLocalTemplates.set(sourceKey, persisted)
    return persisted
  }

  private async readAllMaterials(): Promise<InventoryMaterial[]> {
    const files = await listJsonFiles(path.join(this.dataDir, "inventory", "materials"))
    return await Promise.all(
      files.map(async (filePath) =>
        inventoryMaterialSchema.parse(JSON.parse(await readFile(filePath, "utf8")))
      )
    )
  }

  private async commitWrites(
    writes: Array<{ relativePath: string; value: unknown }>,
    expectedRevision: number
  ): Promise<void> {
    await this.dataService.commitJsonWrites({
      writes,
      domains: ["templates", "inventory"],
      reason: "agent-import-confirmed",
      expectedRevision,
    })
  }

  private async serializeImportCommit<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.importCommitQueue
    let release: (() => void) | undefined
    this.importCommitQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await work()
    } finally {
      release?.()
    }
  }
}
