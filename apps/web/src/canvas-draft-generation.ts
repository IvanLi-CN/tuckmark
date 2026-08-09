import { isDemoRuntimeMode } from "./runtime-data-mode.js"
import type { CanvasDraftSource } from "./types.js"

const STORAGE_KEY = "tuckmark.canvas-draft-generation.v1"
const DEMO_STORAGE_KEY = "tuckmark.demo.canvas-draft-generation.v1"

let memoryGenerations: Record<string, number> = {}

function getSourceKey(source: CanvasDraftSource): string {
  switch (source.kind) {
    case "scratch":
      return `scratch:${source.presetId}`
    case "preset-template":
      return `preset:${source.presetId}`
    case "user-template":
      return `user:${source.templateId}`
  }
}

function getStorageKey(): string {
  return isDemoRuntimeMode() ? DEMO_STORAGE_KEY : STORAGE_KEY
}

function readGenerations(): Record<string, number> {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return memoryGenerations
  }

  try {
    const raw = window.localStorage.getItem(getStorageKey())
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([, value]) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      )
    ) as Record<string, number>
  } catch {
    return {}
  }
}

function writeGenerations(generations: Record<string, number>): void {
  memoryGenerations = generations
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return
  }
  window.localStorage.setItem(getStorageKey(), JSON.stringify(generations))
}

export class CanvasDraftGenerationChangedError extends Error {
  constructor() {
    super("画布草稿已在其他标签页处理，旧编辑不会恢复。")
    this.name = "CanvasDraftGenerationChangedError"
  }
}

export function getCanvasDraftGeneration(source: CanvasDraftSource): number {
  return readGenerations()[getSourceKey(source)] ?? 0
}

export function assertCanvasDraftGeneration(
  source: CanvasDraftSource,
  expectedGeneration: number | undefined
): void {
  if (expectedGeneration !== undefined && getCanvasDraftGeneration(source) !== expectedGeneration) {
    throw new CanvasDraftGenerationChangedError()
  }
}

export function advanceCanvasDraftGeneration(source: CanvasDraftSource): number {
  const generations = readGenerations()
  const sourceKey = getSourceKey(source)
  const nextGeneration = (generations[sourceKey] ?? 0) + 1
  writeGenerations({ ...generations, [sourceKey]: nextGeneration })
  return nextGeneration
}

export function resetCanvasDraftGenerationsForTest(): void {
  memoryGenerations = {}
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return
  }
  window.localStorage.removeItem(STORAGE_KEY)
  window.localStorage.removeItem(DEMO_STORAGE_KEY)
}
