import { z } from "zod"

export const agentImportTemplateFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean().default(false),
  multiline: z.boolean().default(false),
})
export type AgentImportTemplateField = z.infer<typeof agentImportTemplateFieldSchema>

export const agentImportRecommendedUseSchema = z.object({
  scope: z.string().min(1),
  weight: z.number().int().min(1).max(100),
})

export const agentImportTemplateSchema = z.object({
  source: z.enum(["system", "user-template"]),
  id: z.string().min(1),
  name: z.string().min(1),
  fields: z.array(agentImportTemplateFieldSchema).default([]),
  recommendedUses: z.array(agentImportRecommendedUseSchema).default([]),
})
export type AgentImportTemplate = z.infer<typeof agentImportTemplateSchema>

const agentImportLocalTemplateDocumentSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    presetId: z.string().min(1),
    name: z.string().min(1),
    width: z.number().positive(),
    height: z.number().positive(),
    fields: z.array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        defaultValue: z.string().default(""),
        sampleValue: z.string().optional(),
        multiline: z.boolean().default(false),
        bindings: z.array(z.string()).default([]),
      })
    ),
    elements: z.array(z.unknown()),
    editor: z.object({
      gridEnabled: z.boolean().default(true),
      snapEnabled: z.boolean().default(true),
    }),
  })
  .passthrough()

/** A browser-local template snapshot supplied only when a user explicitly selects it. */
export const agentImportLocalTemplateSchema = z.object({
  template: agentImportTemplateSchema.refine((template) => template.source === "user-template", {
    message: "Local template snapshots must use the user-template source.",
  }),
  description: z.string().default(""),
  document: agentImportLocalTemplateDocumentSchema,
})
export type AgentImportLocalTemplate = z.infer<typeof agentImportLocalTemplateSchema>

export const agentImportDatasheetSchema = z
  .object({
    title: z.string().min(1).default("Datasheet"),
    url: z
      .string()
      .url()
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
        message: "Datasheet URLs must use HTTP or HTTPS.",
      })
      .optional(),
    source: z.enum(["manufacturer", "authorized-distributor"]).optional(),
    missingReason: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.url || value.missingReason), {
    message: "A datasheet needs a URL or a missing reason.",
  })
export type AgentImportDatasheet = z.infer<typeof agentImportDatasheetSchema>

export const agentImportMaterialSchema = z.object({
  fullName: z.string().min(1),
  baseName: z.string().optional(),
  variantName: z.string().optional(),
  packageName: z.string().optional(),
  description: z.string().default(""),
  matrixCode: z.string().optional(),
  packagingRemark: z.string().default(""),
  datasheets: z.array(agentImportDatasheetSchema).default([]),
})
export type AgentImportMaterial = z.infer<typeof agentImportMaterialSchema>

const agentImportItemBaseSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["new", "restock"]),
  selected: z.boolean().default(true),
  material: agentImportMaterialSchema,
  targetMaterialId: z.string().min(1).optional(),
  targetMaterialUpdatedAt: z.string().min(1).optional(),
  quantity: z.number().int().positive(),
  labelPrintQuantity: z.number().int().positive().optional(),
  sourceNote: z.string().default(""),
  needsAttention: z.string().min(1).optional(),
  template: agentImportTemplateSchema.optional(),
  templateAlternatives: z.array(agentImportTemplateSchema).default([]),
  templateInput: z.record(z.string(), z.string()).default({}),
  revision: z.number().int().min(0).default(0),
  pendingTemplateEventId: z.string().min(1).nullable().default(null),
})

export const agentImportItemSchema = agentImportItemBaseSchema.superRefine((value, context) => {
  if (value.kind === "restock" && !value.targetMaterialId) {
    context.addIssue({
      code: "custom",
      message: "Restock items require targetMaterialId.",
      path: ["targetMaterialId"],
    })
  }
})
export type AgentImportItem = z.infer<typeof agentImportItemSchema>

export const agentImportProposalSchema = z.object({
  schema: z.literal("tuckmark.agent-import.v1"),
  sourceNote: z.string().default(""),
  items: z.array(agentImportItemSchema).min(1),
})
export type AgentImportProposal = z.infer<typeof agentImportProposalSchema>

export const agentImportEventSchema = z.object({
  id: z.string().min(1),
  type: z.literal("template-input-requested"),
  itemId: z.string().min(1),
  revision: z.number().int().min(0),
  template: agentImportTemplateSchema,
  createdAt: z.string().min(1),
  status: z.enum(["open", "fulfilled", "superseded"]),
})
export type AgentImportEvent = z.infer<typeof agentImportEventSchema>

export const agentImportSessionStateSchema = z.enum(["open", "completed", "cancelled"])
export type AgentImportSessionState = z.infer<typeof agentImportSessionStateSchema>

export const agentImportSessionSchema = z.object({
  id: z.string().min(1),
  state: agentImportSessionStateSchema,
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
  proposal: agentImportProposalSchema,
  events: z.array(agentImportEventSchema).default([]),
})
export type AgentImportSession = z.infer<typeof agentImportSessionSchema>

/** Durable write-ahead record used to recover an interrupted agent import. */
export const agentImportTransactionSchema = z.object({
  schema: z.literal("tuckmark.agent-import-transaction.v1"),
  writes: z.array(
    z.object({
      relativePath: z.string().min(1),
      value: z.unknown(),
    })
  ),
})
export type AgentImportTransaction = z.infer<typeof agentImportTransactionSchema>
