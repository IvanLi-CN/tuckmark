import {
  agentImportTransactionSchema,
  applyInventoryAdjustment,
  ensureInventoryMaterialActive,
  ensureInventoryMaterialDeletionAllowed,
  type InventoryAdjustment,
  type InventoryAdjustmentInput,
  type InventoryMaterial,
  inventoryAdjustmentSchema,
  inventoryAdjustmentTransactionSchema,
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
import { devdDataClient, isServerHttpDataSurface } from "./devd-data-client.js"
import {
  readBrowserLocalInventorySnapshot,
  writeBrowserLocalInventorySnapshot,
} from "./inventory-browser-storage.js"

const INVENTORY_ROOT = "inventory"
const MATERIALS_ROOT = `${INVENTORY_ROOT}/materials`
const ADJUSTMENTS_ROOT = `${INVENTORY_ROOT}/adjustments`
const TRANSACTIONS_ROOT = `${INVENTORY_ROOT}/transactions`
const AGENT_IMPORT_TRANSACTIONS_ROOT = `${INVENTORY_ROOT}/agent-import-transactions`

export type InventoryMaterialSaveArgs = {
  id?: string
  fullName: string
  baseName?: string
  variantName?: string
  packageName?: string
  description?: string
  deviceDetails?: string
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

function isMissingDirectoryError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    (cause as { name?: unknown }).name === "NotFoundError"
  )
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
  } catch (cause) {
    if (isMissingDirectoryError(cause)) {
      return []
    }
    throw cause
  }
}

async function writeJsonFile(
  handle: FileSystemDirectoryHandle,
  path: string,
  value: unknown
): Promise<void> {
  await writeTextFileToDirectoryHandle(handle, path, `${JSON.stringify(value, null, 2)}\n`)
}

async function recoverInventoryAdjustmentTransactions(
  handle: FileSystemDirectoryHandle
): Promise<void> {
  const transactions = await readInventoryEntries(
    handle,
    TRANSACTIONS_ROOT,
    inventoryAdjustmentTransactionSchema.parse
  )
  for (const transaction of transactions) {
    await writeJsonFile(
      handle,
      `${MATERIALS_ROOT}/${transaction.material.id}.json`,
      transaction.material
    )
    await writeJsonFile(
      handle,
      `${ADJUSTMENTS_ROOT}/${transaction.adjustment.id}.json`,
      transaction.adjustment
    )
    const transactionsDirectory = await resolveDirectoryHandleFromDirectoryHandle(
      handle,
      TRANSACTIONS_ROOT
    )
    await removeEntryIfPresentFromDirectoryHandle(
      transactionsDirectory,
      `${transaction.adjustment.id}.json`
    )
  }
}

function ensureAgentImportWritePath(relativePath: string): void {
  const segments = relativePath.split("/")
  if (
    (segments[0] !== "inventory" && segments[0] !== "templates") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Invalid agent import transaction path.")
  }
}

async function recoverAgentImportTransactions(handle: FileSystemDirectoryHandle): Promise<void> {
  let transactionsDirectory: FileSystemDirectoryHandle
  let files: Map<string, string>
  try {
    transactionsDirectory = await resolveDirectoryHandleFromDirectoryHandle(
      handle,
      AGENT_IMPORT_TRANSACTIONS_ROOT
    )
    files = await collectDirectoryFilesFromDirectoryHandle(
      transactionsDirectory,
      AGENT_IMPORT_TRANSACTIONS_ROOT
    )
  } catch (cause) {
    if (isMissingDirectoryError(cause)) {
      return
    }
    throw cause
  }

  for (const [transactionPath, raw] of files) {
    const transaction = agentImportTransactionSchema.parse(JSON.parse(raw))
    for (const write of transaction.writes) {
      ensureAgentImportWritePath(write.relativePath)
      await writeJsonFile(handle, write.relativePath, write.value)
    }
    const filename = transactionPath.split("/").pop()
    if (filename) {
      await removeEntryIfPresentFromDirectoryHandle(transactionsDirectory, filename)
    }
  }
}

async function recoverInventoryTransactions(handle: FileSystemDirectoryHandle): Promise<void> {
  await recoverAgentImportTransactions(handle)
  await recoverInventoryAdjustmentTransactions(handle)
}

async function commitInventoryAdjustmentTransaction(args: {
  handle: FileSystemDirectoryHandle
  material: InventoryMaterial
  adjustment: InventoryAdjustment
}): Promise<void> {
  const transaction = inventoryAdjustmentTransactionSchema.parse({
    schema: "tuckmark.inventory-adjustment-transaction.v1",
    material: args.material,
    adjustment: args.adjustment,
  })
  await writeJsonFile(args.handle, `${TRANSACTIONS_ROOT}/${args.adjustment.id}.json`, transaction)
  await writeJsonFile(
    args.handle,
    `${ADJUSTMENTS_ROOT}/${args.adjustment.id}.json`,
    args.adjustment
  )
  await writeJsonFile(args.handle, `${MATERIALS_ROOT}/${args.material.id}.json`, args.material)
  const transactionsDirectory = await resolveDirectoryHandleFromDirectoryHandle(
    args.handle,
    TRANSACTIONS_ROOT
  )
  await removeEntryIfPresentFromDirectoryHandle(transactionsDirectory, `${args.adjustment.id}.json`)
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
  if (isServerHttpDataSurface()) {
    return await devdDataClient.listMaterials(query, options.includeArchived ?? false)
  }
  const persistence = await resolveInventoryPersistence()
  if (persistence.kind === "data-directory") {
    await recoverInventoryTransactions(persistence.handle)
  }
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
  if (isServerHttpDataSurface()) {
    return await devdDataClient.listAdjustments(materialId)
  }
  const persistence = await resolveInventoryPersistence()
  if (persistence.kind === "data-directory") {
    await recoverInventoryTransactions(persistence.handle)
  }
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
  if (isServerHttpDataSurface()) {
    return await devdDataClient.inventoryCommand<InventoryMaterial>("save-material", args)
  }
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
      ...existing,
      id: args.id ?? createId("inventory-material"),
      fullName: args.fullName.trim(),
      baseName: sanitizeOptionalText(args.baseName),
      variantName: sanitizeOptionalText(args.variantName),
      packageName: sanitizeOptionalText(args.packageName),
      description: args.description?.trim() ?? "",
      deviceDetails: args.deviceDetails?.trim() ?? existing?.deviceDetails ?? "",
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

  await recoverInventoryTransactions(persistence.handle)
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
    ...existing,
    id: args.id ?? createId("inventory-material"),
    fullName: args.fullName.trim(),
    baseName: sanitizeOptionalText(args.baseName),
    variantName: sanitizeOptionalText(args.variantName),
    packageName: sanitizeOptionalText(args.packageName),
    description: args.description?.trim() ?? "",
    deviceDetails: args.deviceDetails?.trim() ?? existing?.deviceDetails ?? "",
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
  if (isServerHttpDataSurface()) {
    return await devdDataClient.inventoryCommand<InventoryMaterial>("archive-material", {
      materialId,
    })
  }
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

  await recoverInventoryTransactions(persistence.handle)
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
  if (isServerHttpDataSurface()) {
    return await devdDataClient.inventoryCommand<InventoryMaterial>("restore-material", {
      materialId,
    })
  }
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

  await recoverInventoryTransactions(persistence.handle)
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
  if (isServerHttpDataSurface()) {
    await devdDataClient.inventoryCommand("delete-material", { materialId })
    return
  }
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

  await recoverInventoryTransactions(persistence.handle)
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
  if (isServerHttpDataSurface()) {
    return await devdDataClient.inventoryCommand("apply-adjustment", args)
  }
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

  await recoverInventoryTransactions(persistence.handle)
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
  await commitInventoryAdjustmentTransaction({
    handle: persistence.handle,
    material: result.material,
    adjustment: result.adjustment,
  })
  return result
}

export async function readInventoryMaterial(materialId: string): Promise<InventoryMaterial | null> {
  const materials = await listInventoryMaterials("", { includeArchived: true })
  return materials.find((material) => material.id === materialId) ?? null
}

export async function getInventoryDataDirectoryReady(): Promise<boolean> {
  if (isServerHttpDataSurface()) {
    try {
      return (await devdDataClient.status()).health === "healthy"
    } catch {
      return false
    }
  }
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
