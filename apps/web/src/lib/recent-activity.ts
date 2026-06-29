export type RecentTemplateEntry = {
  id: string
  name: string
  description: string
  usedAt: string
}

export type RecentPrintEntry = {
  id: string
  title: string
  kind: "template" | "canvas" | "safe_text"
  printedAt: string
  printerName: string
}

export type RecentActivityState = {
  templates: RecentTemplateEntry[]
  prints: RecentPrintEntry[]
}

const STORAGE_KEY = "tuckmark.recent-activity.v1"
const MAX_ITEMS = 6

function emptyState(): RecentActivityState {
  return {
    templates: [],
    prints: [],
  }
}

export function emptyRecentActivityState(): RecentActivityState {
  return emptyState()
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false
    }
    seen.add(item.id)
    return true
  })
}

export function loadRecentActivity(): RecentActivityState {
  if (!canUseStorage()) {
    return emptyState()
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return emptyState()
    }

    const parsed = JSON.parse(raw) as Partial<RecentActivityState>
    return {
      templates: Array.isArray(parsed.templates) ? parsed.templates.slice(0, MAX_ITEMS) : [],
      prints: Array.isArray(parsed.prints) ? parsed.prints.slice(0, MAX_ITEMS) : [],
    }
  } catch {
    return emptyState()
  }
}

function writeRecentActivity(next: RecentActivityState): RecentActivityState {
  if (!canUseStorage()) {
    return next
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function persistRecentActivity(next: RecentActivityState): RecentActivityState {
  return writeRecentActivity(next)
}

export function clearRecentActivity(): RecentActivityState {
  const next = emptyState()
  return writeRecentActivity(next)
}

export function recordRecentTemplate(
  entry: Omit<RecentTemplateEntry, "usedAt">
): RecentActivityState {
  const current = loadRecentActivity()
  const next = {
    ...current,
    templates: dedupeById([
      {
        ...entry,
        usedAt: new Date().toISOString(),
      },
      ...current.templates,
    ]).slice(0, MAX_ITEMS),
  }
  return writeRecentActivity(next)
}

export function recordRecentPrint(entry: Omit<RecentPrintEntry, "printedAt">): RecentActivityState {
  const current = loadRecentActivity()
  const next = {
    ...current,
    prints: dedupeById([
      {
        ...entry,
        printedAt: new Date().toISOString(),
      },
      ...current.prints,
    ]).slice(0, MAX_ITEMS),
  }
  return writeRecentActivity(next)
}
