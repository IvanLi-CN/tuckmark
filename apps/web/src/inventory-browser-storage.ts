import {
  type InventoryDirectorySnapshot,
  inventoryDirectorySnapshotSchema,
  sortInventoryAdjustmentsNewestFirst,
  sortInventoryMaterialsByName,
} from "@tuckmark/inventory"
import { isDemoRuntimeMode } from "./runtime-data-mode.js"

const INVENTORY_BROWSER_STORAGE_KEY = "tuckmark.inventory-snapshot.v1"
const DEMO_INVENTORY_BROWSER_STORAGE_KEY = "tuckmark.demo.inventory-snapshot.v1"

let fallbackSnapshot = createEmptyInventorySnapshot()
let demoFallbackSnapshot = createEmptyInventorySnapshot()

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
  if (isDemoRuntimeMode()) {
    if (!canUseLocalStorage()) {
      return demoFallbackSnapshot
    }
    try {
      const raw = window.localStorage.getItem(DEMO_INVENTORY_BROWSER_STORAGE_KEY)
      if (!raw) {
        return demoFallbackSnapshot
      }
      const parsed = normalizeInventorySnapshot(JSON.parse(raw) as InventoryDirectorySnapshot)
      demoFallbackSnapshot = parsed
      return parsed
    } catch {
      return demoFallbackSnapshot
    }
  }
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
  if (isDemoRuntimeMode()) {
    demoFallbackSnapshot = normalized
    if (canUseLocalStorage()) {
      try {
        window.localStorage.setItem(DEMO_INVENTORY_BROWSER_STORAGE_KEY, JSON.stringify(normalized))
      } catch {
        // The demo fallback remains isolated from the runtime inventory snapshot.
      }
    }
    return
  }
  fallbackSnapshot = normalized
  if (!canUseLocalStorage()) {
    return
  }
  window.localStorage.setItem(INVENTORY_BROWSER_STORAGE_KEY, JSON.stringify(normalized))
}
