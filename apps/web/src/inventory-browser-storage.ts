import {
  type InventoryDirectorySnapshot,
  inventoryDirectorySnapshotSchema,
  sortInventoryAdjustmentsNewestFirst,
  sortInventoryMaterialsByName,
} from "@tuckmark/inventory"

const INVENTORY_BROWSER_STORAGE_KEY = "tuckmark.inventory-snapshot.v1"

let fallbackSnapshot = createEmptyInventorySnapshot()

function createEmptyInventorySnapshot(): InventoryDirectorySnapshot {
  return {
    materials: [],
    adjustments: [],
  }
}

function normalizeInventorySnapshot(
  snapshot: InventoryDirectorySnapshot
): InventoryDirectorySnapshot {
  const normalized = inventoryDirectorySnapshotSchema.parse(snapshot)
  return {
    materials: [...normalized.materials].sort(sortInventoryMaterialsByName),
    adjustments: [...normalized.adjustments].sort(sortInventoryAdjustmentsNewestFirst),
  }
}

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

export function readBrowserLocalInventorySnapshot(): InventoryDirectorySnapshot {
  if (!canUseLocalStorage()) {
    return fallbackSnapshot
  }
  try {
    const raw = window.localStorage.getItem(INVENTORY_BROWSER_STORAGE_KEY)
    if (!raw) {
      return createEmptyInventorySnapshot()
    }
    return normalizeInventorySnapshot(JSON.parse(raw))
  } catch {
    return createEmptyInventorySnapshot()
  }
}

export function writeBrowserLocalInventorySnapshot(snapshot: InventoryDirectorySnapshot): void {
  const normalized = normalizeInventorySnapshot(snapshot)
  fallbackSnapshot = normalized
  if (!canUseLocalStorage()) {
    return
  }
  window.localStorage.setItem(INVENTORY_BROWSER_STORAGE_KEY, JSON.stringify(normalized))
}
