export const CANVAS_GRID_SIZES = [1, 2, 5] as const

export type CanvasGridSize = (typeof CANVAS_GRID_SIZES)[number]

export const DEFAULT_CANVAS_GRID_SIZE: CanvasGridSize = 1

export const CANVAS_SNAP_STEPS = [0.25, 0.5, 1] as const

export type CanvasSnapStep = (typeof CANVAS_SNAP_STEPS)[number]

export const DEFAULT_CANVAS_SNAP_STEP: CanvasSnapStep = 1

export function isCanvasGridSize(value: unknown): value is CanvasGridSize {
  return typeof value === "number" && CANVAS_GRID_SIZES.some((size) => size === value)
}

export function normalizeCanvasGridSize(value: unknown): CanvasGridSize {
  return isCanvasGridSize(value) ? value : DEFAULT_CANVAS_GRID_SIZE
}

export function formatCanvasGridSize(value: CanvasGridSize): string {
  return `${value}mm`
}

export function isCanvasSnapStep(value: unknown): value is CanvasSnapStep {
  return typeof value === "number" && CANVAS_SNAP_STEPS.some((step) => step === value)
}

export function normalizeCanvasSnapStep(value: unknown): CanvasSnapStep {
  return isCanvasSnapStep(value) ? value : DEFAULT_CANVAS_SNAP_STEP
}

export function formatCanvasSnapStep(value: CanvasSnapStep): string {
  if (value === 0.25) {
    return "1/4 格"
  }
  if (value === 0.5) {
    return "1/2 格"
  }
  return "1 格"
}
