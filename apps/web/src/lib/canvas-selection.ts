import { CANVAS_DOTS_PER_MILLIMETER } from "./canvas-units.js"

export type CanvasSelectionBox = {
  x1: number
  y1: number
  x2: number
  y2: number
  visible: boolean
}

export type CanvasRect = {
  x: number
  y: number
  width: number
  height: number
}

export type CanvasProjectionViewport = {
  x: number
  y: number
  scale: number
}

export function normalizeSelectionBox(box: CanvasSelectionBox): CanvasRect {
  const x = Math.min(box.x1, box.x2)
  const y = Math.min(box.y1, box.y2)
  const width = Math.abs(box.x2 - box.x1)
  const height = Math.abs(box.y2 - box.y1)
  return { x, y, width, height }
}

export function projectSelectionBoxToStageRect(
  box: CanvasRect,
  viewport: CanvasProjectionViewport
): CanvasRect {
  const scale = viewport.scale * CANVAS_DOTS_PER_MILLIMETER
  return {
    x: viewport.x + box.x * scale,
    y: viewport.y + box.y * scale,
    width: box.width * scale,
    height: box.height * scale,
  }
}
