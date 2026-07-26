import {
  applyInventoryAdjustment,
  ensureInventoryMaterialActive,
  ensureInventoryMaterialDeletionAllowed,
  type InventoryAdjustment,
  type InventoryAdjustmentInput,
  type InventoryMaterial,
  inventoryAdjustmentSchema,
  inventoryMaterialSchema,
  materialMatchesQuery,
  sortInventoryAdjustmentsNewestFirst,
  sortInventoryMaterialsByName,
} from "@tuckmark/inventory"

import {
  collectDirectoryFilesFromDirectoryHandle,
  loadConfiguredDataDirectoryHandle,
  removeEntryIfPresentFromDirectoryHandle,
  resolveDirectoryHandleFromDirectoryHandle,
  writeTextFileToDirectoryHandle,
} from "./data-directory-service.js"
import {
  readBrowserLocalInventorySnapshot,
  writeBrowserLocalInventorySnapshot,
} from "./inventory-browser-storage.js"

const INVENTORY_ROOT = "inventory"
const MATERIALS_ROOT = `${INVENTORY_ROOT}/materials`
const ADJUSTMENTS_ROOT = `${INVENTORY_ROOT}/adjustments`

export type InventoryMaterialSaveArgs = {
  id?: string
  fullName: string
  baseName?: string
  variantName?: string
  packageName?: string
  description?: string
  matrixCode?: string
  packagingRemark?: string
  labelBindings?: InventoryMaterial["labelBindings"]
}

type ListInventoryMaterialsOptions = {
  includeArchived?: boolean
}

type InventoryPersistence =
  | {
      kind: "data-directory"
      handle: FileSystemDirectoryHandle
    }
  | {
      kind: "browser-local"
    }

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function parseInventoryMaterial(input: unknown): InventoryMaterial {
  return inventoryMaterialSchema.parse(input)
}

function parseInventoryAdjustment(input: unknown): InventoryAdjustment {
  return inventoryAdjustmentSchema.parse(input)
}

async function resolveInventoryPersistence(): Promise<InventoryPersistence> {
  const handle = await loadConfiguredDataDirectoryHandle()
  if (!handle) {
    return { kind: "browser-local" }
  }
  try {
    if ((await handle.queryPermission({ mode: "readwrite" })) === "granted") {
      return { kind: "data-directory", handle }
    }
  } catch {
    // Fall through to browser-local persistence.
  }
  return { kind: "browser-local" }
}

async function readInventoryEntries<T>(
  handle: FileSystemDirectoryHandle,
  root: string,
  parser: (input: unknown) => T
): Promise<T[]> {
  try {
    const directory = await resolveDirectoryHandleFromDirectoryHandle(handle, root)
    const files = await collectDirectoryFilesFromDirectoryHandle(directory, root)
    return Array.from(files.values()).map((raw) => parser(JSON.parse(raw)))
  } catch {
    return []
  }
}

async function writeJsonFile(
  handle: FileSystemDirectoryHandle,
  path: string,
  value: unknown
): Promise<void> {
  await writeTextFileToDirectoryHandle(handle, path, `${JSON.stringify(value, null, 2)}\n`)
}

function sanitizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function ensureMaterialUniqueness(
  materials: readonly InventoryMaterial[],
  draft: InventoryMaterial
): void {
  const fullNameCollision = materials.find(
    (material) => material.id !== draft.id && material.fullName === draft.fullName
  )
  if (fullNameCollision) {
    throw new Error(`物料型号 ${draft.fullName} 已存在。`)
  }

  if (draft.matrixCode?.trim()) {
    const matrixCodeCollision = materials.find(
      (material) => material.id !== draft.id && material.matrixCode === draft.matrixCode
    )
    if (matrixCodeCollision) {
      throw new Error(`矩阵码 ${draft.matrixCode} 已被 ${matrixCodeCollision.fullName} 使用。`)
    }
  }
}

export async function listInventoryMaterials(
  query = "",
  options: ListInventoryMaterialsOptions = {}
): Promise<InventoryMaterial[]> {
  const persistence = await resolveInventoryPersistence()
  const materials =
    persistence.kind === "data-directory"
      ? await readInventoryEntries(persistence.handle, MATERIALS_ROOT, parseInventoryMaterial)
      : readBrowserLocalInventorySnapshot().materials
  return materials
    .filter((material) => (options.includeArchived ? true : !material.archivedAt))
    .filter((material) => materialMatchesQuery(material, query))
    .sort(sortInventoryMaterialsByName)
}

export async function listInventoryAdjustments(
  materialId?: string
): Promise<InventoryAdjustment[]> {
  const persistence = await resolveInventoryPersistence()
  const adjustments =
    persistence.kind === "data-directory"
      ? await readInventoryEntries(persistence.handle, ADJUSTMENTS_ROOT, parseInventoryAdjustment)
      : readBrowserLocalInventorySnapshot().adjustments
  return adjustments
    .filter((adjustment) => !materialId || adjustment.materialId === materialId)
    .sort(sortInventoryAdjustmentsNewestFirst)
}

export async function saveInventoryMaterial(
  args: InventoryMaterialSaveArgs
): Promise<InventoryMaterial> {
  const persistence = await resolveInventoryPersistence()
  if (persistence.kind !== "data-directory") {
    const snapshot = readBrowserLocalInventorySnapshot()
    const materials = snapshot.materials
    const existing = args.id
      ? (materials.find((material) => material.id === args.id) ?? null)
      : null
    if (existing) {
      ensureInventoryMaterialActive(existing, "编辑")
    }
    const now = new Date().toISOString()
    const material = inventoryMaterialSchema.parse({
      id: args.id ?? createId("inventory-material"),
      fullName: args.fullName.trim(),
      baseName: sanitizeOptionalText(args.baseName),
      variantName: sanitizeOptionalText(args.variantName),
      packageName: sanitizeOptionalText(args.packageName),
      description: args.description?.trim() ?? "",
      matrixCode: sanitizeOptionalText(args.matrixCode),
      packagingRemark: args.packagingRemark?.trim() ?? "",
      currentQuantity: existing?.currentQuantity ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      archivedAt: existing?.archivedAt ?? null,
      labelBindings: args.labelBindings ?? existing?.labelBindings ?? [],
    })

    ensureMaterialUniqueness(materials, material)
    writeBrowserLocalInventorySnapshot({
      materials: materials.some((entry) => entry.id === material.id)
        ? materials.map((entry) => (entry.id === material.id ? material : entry))
        : [...materials, material],
      adjustments: snapshot.adjustments,
    })
    return material
  }

  const materials = await readInventoryEntries(
    persistence.handle,
    MATERIALS_ROOT,
    parseInventoryMaterial
  )
  const existing = args.id ? (materials.find((material) => material.id === args.id) ?? null) : null
  if (existing) {
    ensureInventoryMaterialActive(existing, "编辑")
  }
  const now = new Date().toISOString()
  const material = inventoryMaterialSchema.parse({
    id: args.id ?? createId("inventory-material"),
    fullName: args.fullName.trim(),
    baseName: sanitizeOptionalText(args.baseName),
    variantName: sanitizeOptionalText(args.variantName),
    packageName: sanitizeOptionalText(args.packageName),
    description: args.description?.trim() ?? "",
    matrixCode: sanitizeOptionalText(args.matrixCode),
    packagingRemark: args.packagingRemark?.trim() ?? "",
    currentQuantity: existing?.currentQuantity ?? 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    archivedAt: existing?.archivedAt ?? null,
    labelBindings: args.labelBindings ?? existing?.labelBindings ?? [],
  })

  ensureMaterialUniqueness(materials, material)
  await writeJsonFile(persistence.handle, `${MATERIALS_ROOT}/${material.id}.json`, material)
  return material
}

export async function archiveInventoryMaterial(materialId: string): Promise<InventoryMaterial> {
  const persistence = await resolveInventoryPersistence()
  if (persistence.kind !== "data-directory") {
    const snapshot = readBrowserLocalInventorySnapshot()
    const materials = snapshot.materials
    const material = materials.find((entry) => entry.id === materialId)
    if (!material) {
      throw new Error("物料不存在。")
    }
    ensureInventoryMaterialActive(material, "归档")
    const archived = inventoryMaterialSchema.parse({
      ...material,
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    writeBrowserLocalInventorySnapshot({
      materials: materials.map((entry) => (entry.id === archived.id ? archived : entry)),
      adjustments: snapshot.adjustments,
    })
    return archived
  }

  const materials = await readInventoryEntries(
    persistence.handle,
    MATERIALS_ROOT,
    parseInventoryMaterial
  )
  const material = materials.find((entry) => entry.id === materialId)
  if (!material) {
    throw new Error("物料不存在。")
  }
  ensureInventoryMaterialActive(material, "归档")
  const archived = inventoryMaterialSchema.parse({
    ...material,
    archivedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  await writeJsonFile(persistence.handle, `${MATERIALS_ROOT}/${archived.id}.json`, archived)
  return archived
}

export async function restoreInventoryMaterial(materialId: string): Promise<InventoryMaterial> {
  const persistence = await resolveInventoryPersistence()
  if (persistence.kind !== "data-directory") {
    const snapshot = readBrowserLocalInventorySnapshot()
    const materials = snapshot.materials
    const archived = materials.find((material) => material.id === materialId)
    if (!archived) {
      throw new Error("物料不存在。")
    }
    const restored = inventoryMaterialSchema.parse({
      ...archived,
      archivedAt: null,
      updatedAt: new Date().toISOString(),
    })
    ensureMaterialUniqueness(materials, restored)
    writeBrowserLocalInventorySnapshot({
      materials: materials.map((entry) => (entry.id === restored.id ? restored : entry)),
      adjustments: snapshot.adjustments,
    })
    return restored
  }

  const materials = await readInventoryEntries(
    persistence.handle,
    MATERIALS_ROOT,
    parseInventoryMaterial
  )
  const archived = materials.find((material) => material.id === materialId)
  if (!archived) {
    throw new Error("物料不存在。")
  }
  const restored = inventoryMaterialSchema.parse({
    ...archived,
    archivedAt: null,
    updatedAt: new Date().toISOString(),
  })
  ensureMaterialUniqueness(materials, restored)
  await writeJsonFile(persistence.handle, `${MATERIALS_ROOT}/${restored.id}.json`, restored)
  return restored
}

export async function deleteInventoryMaterial(materialId: string): Promise<void> {
  const persistence = await resolveInventoryPersistence()
  if (persistence.kind !== "data-directory") {
    const snapshot = readBrowserLocalInventorySnapshot()
    const materials = snapshot.materials
    const material = materials.find((entry) => entry.id === materialId)
    if (!material) {
      throw new Error("物料不存在。")
    }
    const adjustments = snapshot.adjustments.filter((entry) => entry.materialId === materialId)
    ensureInventoryMaterialDeletionAllowed({ material, adjustments })
    writeBrowserLocalInventorySnapshot({
      materials: materials.filter((entry) => entry.id !== materialId),
      adjustments: snapshot.adjustments,
    })
    return
  }

  const materials = await readInventoryEntries(
    persistence.handle,
    MATERIALS_ROOT,
    parseInventoryMaterial
  )
  const material = materials.find((entry) => entry.id === materialId)
  if (!material) {
    throw new Error("物料不存在。")
  }
  const adjustments = await listInventoryAdjustments(materialId)
  ensureInventoryMaterialDeletionAllowed({ material, adjustments })
  const materialsDirectory = await resolveDirectoryHandleFromDirectoryHandle(
    persistence.handle,
    MATERIALS_ROOT
  )
  await removeEntryIfPresentFromDirectoryHandle(materialsDirectory, `${materialId}.json`)
}

export async function applyInventoryMaterialAdjustment(args: {
  materialId: string
  input: InventoryAdjustmentInput
}): Promise<{
  material: InventoryMaterial
  adjustment: InventoryAdjustment
}> {
  const persistence = await resolveInventoryPersistence()
  if (persistence.kind !== "data-directory") {
    const snapshot = readBrowserLocalInventorySnapshot()
    const materials = snapshot.materials
    const material = materials.find((entry) => entry.id === args.materialId)
    if (!material) {
      throw new Error("物料不存在。")
    }
    ensureInventoryMaterialActive(material, "调整库存")
    const result = applyInventoryAdjustment({
      material,
      input: args.input,
      adjustmentId: createId("inventory-adjustment"),
    })
    writeBrowserLocalInventorySnapshot({
      materials: materials.map((entry) =>
        entry.id === result.material.id ? result.material : entry
      ),
      adjustments: [result.adjustment, ...snapshot.adjustments],
    })
    return result
  }

  const materials = await readInventoryEntries(
    persistence.handle,
    MATERIALS_ROOT,
    parseInventoryMaterial
  )
  const material = materials.find((entry) => entry.id === args.materialId)
  if (!material) {
    throw new Error("物料不存在。")
  }
  ensureInventoryMaterialActive(material, "调整库存")
  const result = applyInventoryAdjustment({
    material,
    input: args.input,
    adjustmentId: createId("inventory-adjustment"),
  })
  await writeJsonFile(persistence.handle, `${MATERIALS_ROOT}/${material.id}.json`, result.material)
  await writeJsonFile(
    persistence.handle,
    `${ADJUSTMENTS_ROOT}/${result.adjustment.id}.json`,
    result.adjustment
  )
  return result
}

export async function readInventoryMaterial(materialId: string): Promise<InventoryMaterial | null> {
  const materials = await listInventoryMaterials("", { includeArchived: true })
  return materials.find((material) => material.id === materialId) ?? null
}

export async function getInventoryDataDirectoryReady(): Promise<boolean> {
  const handle = await loadConfiguredDataDirectoryHandle()
  if (!handle) {
    return false
  }
  try {
    return (await handle.queryPermission({ mode: "readwrite" })) === "granted"
  } catch {
    return false
  }
}
