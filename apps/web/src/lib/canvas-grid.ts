export const CANVAS_GRID_SIZES = [1, 2, 2.5, 5, 10] as const

export type CanvasGridSize = (typeof CANVAS_GRID_SIZES)[number]

export const DEFAULT_CANVAS_GRID_SIZE: CanvasGridSize = 1

export function isCanvasGridSize(value: unknown): value is CanvasGridSize {
  return typeof value === "number" && CANVAS_GRID_SIZES.some((size) => size === value)
}

export function normalizeCanvasGridSize(value: unknown): CanvasGridSize {
  return isCanvasGridSize(value) ? value : DEFAULT_CANVAS_GRID_SIZE
}

export function formatCanvasGridSize(value: CanvasGridSize): string {
  return `${value}mm`
}
