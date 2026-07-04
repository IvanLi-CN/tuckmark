import type { CanvasDocumentPreset } from "../types.js"
import { canvasDotsToMillimeters, canvasMillimetersToDots } from "./canvas-units.js"

export type CanvasDimension = {
  width: number
  height: number
}

export type RecentCanvasDimension = CanvasDimension & {
  usedAt: string
}

const STORAGE_KEY = "tuckmark.canvas-dimensions.v2"
const MAX_STORED_DIMENSIONS = 100

function emptyState(): RecentCanvasDimension[] {
  return []
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value > 0
}

function dimensionKey(dimension: CanvasDimension): string {
  return `${dimension.width}x${dimension.height}`
}

function normalizeDimensions(value: unknown): RecentCanvasDimension[] {
  if (!Array.isArray(value)) {
    return emptyState()
  }

  const seen = new Set<string>()
  return value.flatMap((item) => {
    const candidate = item as Partial<RecentCanvasDimension>
    if (!isPositiveInteger(candidate.width) || !isPositiveInteger(candidate.height)) {
      return []
    }
    const key = dimensionKey({ width: candidate.width, height: candidate.height })
    if (seen.has(key)) {
      return []
    }
    seen.add(key)
    return [
      {
        width: candidate.width,
        height: candidate.height,
        usedAt:
          typeof candidate.usedAt === "string" && candidate.usedAt.trim()
            ? candidate.usedAt
            : new Date(0).toISOString(),
      },
    ]
  })
}

function writeRecentCanvasDimensions(next: RecentCanvasDimension[]): RecentCanvasDimension[] {
  if (!canUseStorage()) {
    return next
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function loadRecentCanvasDimensions(): RecentCanvasDimension[] {
  if (!canUseStorage()) {
    return emptyState()
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return emptyState()
    }
    return normalizeDimensions(JSON.parse(raw))
      .sort((left, right) => right.usedAt.localeCompare(left.usedAt))
      .slice(0, MAX_STORED_DIMENSIONS)
  } catch {
    return emptyState()
  }
}

export function recordRecentCanvasDimension(dimension: CanvasDimension): RecentCanvasDimension[] {
  if (!isPositiveInteger(dimension.width) || !isPositiveInteger(dimension.height)) {
    return loadRecentCanvasDimensions()
  }

  const current = loadRecentCanvasDimensions()
  const nextEntry: RecentCanvasDimension = {
    width: dimension.width,
    height: dimension.height,
    usedAt: new Date().toISOString(),
  }
  const next = [
    nextEntry,
    ...current.filter((item) => dimensionKey(item) !== dimensionKey(nextEntry)),
  ].slice(0, MAX_STORED_DIMENSIONS)
  return writeRecentCanvasDimensions(next)
}

export function clearRecentCanvasDimensions(): RecentCanvasDimension[] {
  const next = emptyState()
  return writeRecentCanvasDimensions(next)
}

export function buildCanvasDimensionOptions(
  recentDimensions: RecentCanvasDimension[],
  presets: CanvasDocumentPreset[]
): CanvasDimension[] {
  const options: CanvasDimension[] = []
  const seen = new Set<string>()
  const add = (dimension: CanvasDimension) => {
    if (!isPositiveInteger(dimension.width) || !isPositiveInteger(dimension.height)) {
      return
    }
    const key = dimensionKey(dimension)
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    options.push({ width: dimension.width, height: dimension.height })
  }

  for (const dimension of recentDimensions) {
    add(dimension)
  }
  for (const preset of presets) {
    add({ width: preset.width, height: preset.height })
  }

  return options
}

export function formatCanvasDimension(dimension: CanvasDimension): string {
  return `${dimension.width} × ${dimension.height} mm`
}

export function getCanvasDimensionCapabilityMessage(
  dimension: CanvasDimension,
  targetWidth: number | null | undefined
): string | null {
  return getCanvasDotsCapabilityMessage(canvasMillimetersToDots(dimension.width), targetWidth)
}

export function getCanvasDotsCapabilityMessage(
  canvasWidthDots: number,
  targetWidthDots: number | null | undefined
): string | null {
  if (!targetWidthDots || canvasWidthDots <= targetWidthDots) {
    return null
  }
  return `当前画布宽度 ${canvasDotsToMillimeters(canvasWidthDots)} mm 超过打印目标宽度 ${canvasDotsToMillimeters(targetWidthDots)} mm。请换用支持该宽度的打印机，或调整画布/输出宽度后再打印。`
}
