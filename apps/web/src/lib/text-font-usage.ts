import {
  resolveTextFontFamily,
  type TextFontFamily,
  type TextFontPickerFamily,
  textFontPickerFamilies,
} from "../../../../packages/core/src/web.js"

export type TextFontUsageEntry = {
  id: TextFontPickerFamily
  lastUsedAt: string | null
  totalUsedMs: number
}

export type TextFontUsageState = {
  fonts: Record<TextFontPickerFamily, TextFontUsageEntry>
}

const STORAGE_KEY = "tuckmark.text-font-usage.v1"
const RECENT_COUNT = 3
const LONGEST_COUNT = 5
const COMMON_COUNT = 5

const listeners = new Set<() => void>()
let volatileState = createEmptyState()

function createEmptyState(): TextFontUsageState {
  return {
    fonts: Object.fromEntries(
      textFontPickerFamilies.map((fontFamily) => [
        fontFamily,
        {
          id: fontFamily,
          lastUsedAt: null,
          totalUsedMs: 0,
        } satisfies TextFontUsageEntry,
      ])
    ) as Record<TextFontPickerFamily, TextFontUsageEntry>,
  }
}

function canUseStorage() {
  if (typeof window === "undefined") {
    return false
  }

  try {
    return typeof window.localStorage !== "undefined"
  } catch {
    return false
  }
}

function normalizeState(input: Partial<TextFontUsageState> | null | undefined): TextFontUsageState {
  const base = createEmptyState()
  if (!input?.fonts) {
    return base
  }

  for (const fontFamily of textFontPickerFamilies) {
    const entry = input.fonts[fontFamily]
    if (!entry) {
      continue
    }
    base.fonts[fontFamily] = {
      id: fontFamily,
      lastUsedAt: typeof entry.lastUsedAt === "string" ? entry.lastUsedAt : null,
      totalUsedMs:
        typeof entry.totalUsedMs === "number" && Number.isFinite(entry.totalUsedMs)
          ? Math.max(0, entry.totalUsedMs)
          : 0,
    }
  }

  return base
}

function emitChange() {
  for (const listener of listeners) {
    listener()
  }
}

function writeState(next: TextFontUsageState): TextFontUsageState {
  volatileState = normalizeState(next)
  if (canUseStorage()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(volatileState))
  }
  emitChange()
  return volatileState
}

export function loadTextFontUsageState(): TextFontUsageState {
  if (!canUseStorage()) {
    return volatileState
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return volatileState
    }
    volatileState = normalizeState(JSON.parse(raw) as Partial<TextFontUsageState>)
    return volatileState
  } catch {
    return volatileState
  }
}

export function persistTextFontUsageState(next: TextFontUsageState): TextFontUsageState {
  return writeState(normalizeState(next))
}

export function clearTextFontUsageState(): TextFontUsageState {
  const next = createEmptyState()
  volatileState = next
  if (canUseStorage()) {
    window.localStorage.removeItem(STORAGE_KEY)
  }
  emitChange()
  return next
}

export function subscribeTextFontUsage(listener: () => void): () => void {
  listeners.add(listener)

  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      listener()
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage)
  }

  return () => {
    listeners.delete(listener)
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage)
    }
  }
}

export function recordTextFontRecentUse(
  fontFamily: TextFontFamily,
  usedAt = new Date()
): TextFontUsageState {
  const resolvedFontFamily = resolveTextFontFamily(fontFamily)
  const current = loadTextFontUsageState()
  current.fonts[resolvedFontFamily] = {
    ...current.fonts[resolvedFontFamily],
    lastUsedAt: usedAt.toISOString(),
  }
  return writeState(current)
}

export function recordTextFontUsageDuration(
  fontFamily: TextFontFamily,
  durationMs: number,
  endedAt = new Date()
): TextFontUsageState {
  const resolvedFontFamily = resolveTextFontFamily(fontFamily)
  const clampedDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
  const current = loadTextFontUsageState()
  current.fonts[resolvedFontFamily] = {
    ...current.fonts[resolvedFontFamily],
    lastUsedAt: endedAt.toISOString(),
    totalUsedMs: current.fonts[resolvedFontFamily].totalUsedMs + clampedDuration,
  }
  return writeState(current)
}

function compareByRecentUse(a: TextFontUsageEntry, b: TextFontUsageEntry): number {
  const aTime = a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0
  const bTime = b.lastUsedAt ? Date.parse(b.lastUsedAt) : 0
  return bTime - aTime
}

export function getCommonTextFontFamilies(state: TextFontUsageState): TextFontPickerFamily[] {
  const entries = Object.values(state.fonts)
  const recent = entries
    .filter((entry) => entry.lastUsedAt)
    .sort(compareByRecentUse)
    .slice(0, RECENT_COUNT)
  const longest = entries
    .filter((entry) => entry.totalUsedMs > 0)
    .sort((left, right) => right.totalUsedMs - left.totalUsedMs || compareByRecentUse(left, right))
    .slice(0, LONGEST_COUNT)

  const deduped = new Map<TextFontPickerFamily, TextFontUsageEntry>()
  for (const entry of [...recent, ...longest]) {
    deduped.set(entry.id, entry)
  }

  return Array.from(deduped.values())
    .sort(compareByRecentUse)
    .slice(0, COMMON_COUNT)
    .map((entry) => entry.id)
}
