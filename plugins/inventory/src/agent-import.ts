import { z } from "zod"

export const agentImportTemplateFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean().default(false),
  multiline: z.boolean().default(false),
})
export type AgentImportTemplateField = z.infer<typeof agentImportTemplateFieldSchema>

export const agentImportRecommendedUseSchema = z.string().trim().min(1)

export const agentImportTemplateSchema = z
  .object({
    source: z.enum(["system", "user-template"]),
    id: z.string().min(1),
    name: z.string().min(1),
    fields: z.array(agentImportTemplateFieldSchema).default([]),
    recommendedUse: agentImportRecommendedUseSchema.optional(),
  })
  .strict()
export type AgentImportTemplate = z.infer<typeof agentImportTemplateSchema>

export const agentImportMaterialSchema = z.object({
  fullName: z.string().min(1),
  baseName: z.string().optional(),
  variantName: z.string().optional(),
  packageName: z.string().optional(),
  description: z.string().default(""),
  deviceDetails: z.string().default(""),
  matrixCode: z.string().optional(),
  packagingRemark: z.string().default(""),
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

export const agentImportProposalSchema = z
  .object({
    schema: z.literal("tuckmark.agent-import.v1"),
    sourceNote: z.string().default(""),
    items: z.array(agentImportItemSchema).min(1),
  })
  .superRefine((value, context) => {
    const itemIds = new Set<string>()
    for (const [index, item] of value.items.entries()) {
      if (itemIds.has(item.id)) {
        context.addIssue({
          code: "custom",
          message: "Agent import item IDs must be unique.",
          path: ["items", index, "id"],
        })
      }
      itemIds.add(item.id)
    }
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
