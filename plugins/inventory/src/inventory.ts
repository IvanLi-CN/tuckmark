import { z } from "zod"

const inventoryTemplateSourceKindSchema = z.enum(["system", "user-template"])
export type InventoryTemplateSourceKind = z.infer<typeof inventoryTemplateSourceKindSchema>

export const inventoryFieldValueSchema = z.string().default("")

export const inventoryTemplateBindingSchema = z.object({
  id: z.string().min(1),
  templateSource: inventoryTemplateSourceKindSchema,
  templateId: z.string().min(1),
  templateName: z.string().min(1),
  printQuantity: z.number().int().positive().default(1),
  fieldOverrides: z.record(z.string(), inventoryFieldValueSchema).default({}),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})
export type InventoryTemplateBinding = z.infer<typeof inventoryTemplateBindingSchema>

export const inventoryDatasheetSchema = z
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
export type InventoryDatasheet = z.infer<typeof inventoryDatasheetSchema>

export const inventoryMaterialSchema = z.object({
  id: z.string().min(1),
  fullName: z.string().min(1),
  baseName: z.string().optional(),
  variantName: z.string().optional(),
  packageName: z.string().optional(),
  description: z.string().default(""),
  matrixCode: z.string().optional(),
  packagingRemark: z.string().default(""),
  currentQuantity: z.number().int().min(0).default(0),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  archivedAt: z.string().nullable().optional(),
  labelBindings: z.array(inventoryTemplateBindingSchema).default([]),
  datasheets: z.array(inventoryDatasheetSchema).optional(),
})
export type InventoryMaterial = z.infer<typeof inventoryMaterialSchema>

export const inventoryAdjustmentKindSchema = z.enum(["in", "out", "correction"])
export type InventoryAdjustmentKind = z.infer<typeof inventoryAdjustmentKindSchema>

export const inventoryAdjustmentSchema = z.object({
  id: z.string().min(1),
  materialId: z.string().min(1),
  kind: inventoryAdjustmentKindSchema,
  quantityDelta: z.number().int(),
  targetQuantity: z.number().int().min(0).nullable(),
  quantityAfter: z.number().int().min(0),
  note: z.string().default(""),
  actor: z.string().min(1).default("unknown"),
  createdAt: z.string().min(1),
})
export type InventoryAdjustment = z.infer<typeof inventoryAdjustmentSchema>

export const inventoryAdjustmentTransactionSchema = z.object({
  schema: z.literal("tuckmark.inventory-adjustment-transaction.v1"),
  material: inventoryMaterialSchema,
  adjustment: inventoryAdjustmentSchema,
})
export type InventoryAdjustmentTransaction = z.infer<typeof inventoryAdjustmentTransactionSchema>

export const inventoryDirectorySnapshotSchema = z.object({
  materials: z.array(inventoryMaterialSchema),
  adjustments: z.array(inventoryAdjustmentSchema),
})
export type InventoryDirectorySnapshot = z.infer<typeof inventoryDirectorySnapshotSchema>

export const inventoryAdjustmentInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("in"),
    quantity: z.number().int().positive(),
    note: z.string().default(""),
    actor: z.string().min(1).default("unknown"),
    createdAt: z.string().optional(),
  }),
  z.object({
    kind: z.literal("out"),
    quantity: z.number().int().positive(),
    note: z.string().default(""),
    actor: z.string().min(1).default("unknown"),
    createdAt: z.string().optional(),
  }),
  z.object({
    kind: z.literal("correction"),
    targetQuantity: z.number().int().min(0),
    note: z.string().default(""),
    actor: z.string().min(1).default("unknown"),
    createdAt: z.string().optional(),
  }),
])
export type InventoryAdjustmentInput = z.infer<typeof inventoryAdjustmentInputSchema>

function createTimestamp(value?: string): string {
  return value && value.trim().length > 0 ? value : new Date().toISOString()
}

export function sortInventoryAdjustmentsNewestFirst(
  left: InventoryAdjustment,
  right: InventoryAdjustment
): number {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
}

export function sortInventoryMaterialsByName(
  left: InventoryMaterial,
  right: InventoryMaterial
): number {
  return (
    left.fullName.localeCompare(right.fullName, "en", { sensitivity: "base" }) ||
    left.id.localeCompare(right.id)
  )
}

export function computeMaterialQuantityFromAdjustments(
  adjustments: readonly InventoryAdjustment[]
): number {
  return adjustments.reduce((currentQuantity, adjustment) => {
    if (adjustment.kind === "correction") {
      return adjustment.quantityAfter
    }
    return currentQuantity + adjustment.quantityDelta
  }, 0)
}

export function materialMatchesQuery(material: InventoryMaterial, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return true
  }
  const fields = [
    material.fullName,
    material.baseName ?? "",
    material.variantName ?? "",
    material.packageName ?? "",
    material.description,
    material.matrixCode ?? "",
    material.packagingRemark,
  ]
  return fields.some((field) => field.toLowerCase().includes(normalized))
}

export function buildInventoryMaterialFieldMap(
  material: InventoryMaterial
): Record<string, string> {
  return {
    fullName: material.fullName,
    name: material.fullName,
    model: material.fullName,
    baseName: material.baseName ?? "",
    variantName: material.variantName ?? "",
    packageName: material.packageName ?? "",
    package: material.packageName ?? "",
    description: material.description,
    remark: material.description,
    matrixCode: material.matrixCode ?? "",
    packagingRemark: material.packagingRemark,
    quantity: String(material.currentQuantity),
    currentQuantity: String(material.currentQuantity),
  }
}

export function buildInventoryTemplateInput(
  material: InventoryMaterial,
  binding: InventoryTemplateBinding
): Record<string, string> {
  return {
    ...buildInventoryMaterialFieldMap(material),
    ...binding.fieldOverrides,
  }
}

export function applyInventoryAdjustment(args: {
  material: InventoryMaterial
  input: InventoryAdjustmentInput
  adjustmentId: string
}): {
  material: InventoryMaterial
  adjustment: InventoryAdjustment
} {
  const material = inventoryMaterialSchema.parse(args.material)
  const input = inventoryAdjustmentInputSchema.parse(args.input)
  const createdAt = createTimestamp(input.createdAt)
  let nextQuantity = material.currentQuantity
  let quantityDelta = 0
  let targetQuantity: number | null = null

  switch (input.kind) {
    case "in":
      quantityDelta = input.quantity
      nextQuantity = material.currentQuantity + input.quantity
      break
    case "out":
      quantityDelta = -input.quantity
      nextQuantity = material.currentQuantity - input.quantity
      if (nextQuantity < 0) {
        throw new Error(`库存不足，当前仅剩 ${material.currentQuantity}。`)
      }
      break
    case "correction":
      targetQuantity = input.targetQuantity
      quantityDelta = input.targetQuantity - material.currentQuantity
      nextQuantity = input.targetQuantity
      break
  }

  const adjustment = inventoryAdjustmentSchema.parse({
    id: args.adjustmentId,
    materialId: material.id,
    kind: input.kind,
    quantityDelta,
    targetQuantity,
    quantityAfter: nextQuantity,
    note: input.note,
    actor: input.actor,
    createdAt,
  })

  return {
    material: inventoryMaterialSchema.parse({
      ...material,
      currentQuantity: nextQuantity,
      updatedAt: createdAt,
    }),
    adjustment,
  }
}

export function ensureInventoryMaterialDeletionAllowed(args: {
  material: InventoryMaterial
  adjustments: readonly InventoryAdjustment[]
}): void {
  if (args.adjustments.length > 0) {
    throw new Error("已有库存流水的物料只能归档，不能彻底删除。")
  }
}

export function ensureInventoryMaterialActive(
  material: InventoryMaterial,
  action = "执行此操作"
): void {
  if (material.archivedAt) {
    throw new Error(`已归档物料不能${action}，请先恢复。`)
  }
}
