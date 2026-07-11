import { getElementSelectionBounds } from "./canvas-editor-model.js"
import type { CanvasDraftDocument } from "./types.js"

export type CanvasSnapBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type CanvasSnapTargetKind = "element" | "canvas" | "grid"

export type CanvasSnapGuide = {
  axis: "x" | "y"
  coordinate: number
  kind: Exclude<CanvasSnapTargetKind, "grid">
}

export type CanvasSnapResult = {
  deltaX: number
  deltaY: number
  guides: CanvasSnapGuide[]
}

export type CanvasSnapContext = {
  draft: CanvasDraftDocument
  movingIds: Iterable<string>
  displayScale: number
  enabled: boolean
  gridSize: number
}

export type CanvasSnapEdges = {
  x?: Array<"left" | "right">
  y?: Array<"top" | "bottom">
}

export type CanvasTransformBox = CanvasSnapBounds & {
  rotation: number
}

type CanvasSnapCandidate = {
  coordinate: number
  kind: CanvasSnapTargetKind
  index: number
}

type AxisSnapResult = {
  delta: number
  guide: CanvasSnapGuide | null
}

const SNAP_TOLERANCE_PIXELS = 8
const GRID_TOLERANCE_RATIO = 0.4
const TIE_TOLERANCE_PIXELS = 0.5
const TARGET_PRIORITY: Record<CanvasSnapTargetKind, number> = {
  element: 0,
  canvas: 1,
  grid: 2,
}

function getAxisCandidates(context: CanvasSnapContext, axis: "x" | "y") {
  const movingIds = new Set(context.movingIds)
  const canvasEdge = axis === "x" ? context.draft.width : context.draft.height
  const candidates: CanvasSnapCandidate[] = [
    { coordinate: 0, kind: "canvas", index: 0 },
    { coordinate: canvasEdge, kind: "canvas", index: 1 },
  ]

  context.draft.elements.forEach((element, index) => {
    if (!element.meta.visible || movingIds.has(element.id)) {
      return
    }
    const bounds = getElementSelectionBounds(element)
    const start = axis === "x" ? bounds.x : bounds.y
    const end = start + (axis === "x" ? bounds.width : bounds.height)
    candidates.push(
      { coordinate: start, kind: "element", index: index * 2 },
      { coordinate: end, kind: "element", index: index * 2 + 1 }
    )
  })

  return candidates
}

function getAxisEdges(bounds: CanvasSnapBounds, axis: "x" | "y", requestedEdges: CanvasSnapEdges) {
  if (axis === "x") {
    const edges = requestedEdges.x ?? ["left", "right"]
    return edges.map((edge, index) => ({
      coordinate: edge === "left" ? bounds.x : bounds.x + bounds.width,
      index,
    }))
  }

  const edges = requestedEdges.y ?? ["top", "bottom"]
  return edges.map((edge, index) => ({
    coordinate: edge === "top" ? bounds.y : bounds.y + bounds.height,
    index,
  }))
}

function getTolerancePixels(kind: CanvasSnapTargetKind, context: CanvasSnapContext) {
  if (kind !== "grid") {
    return SNAP_TOLERANCE_PIXELS
  }
  return Math.min(
    SNAP_TOLERANCE_PIXELS,
    Math.max(0, context.gridSize * context.displayScale * GRID_TOLERANCE_RATIO)
  )
}

function isBetterCandidate(
  candidate: CanvasSnapCandidate & { distancePixels: number; edgeIndex: number },
  current: (CanvasSnapCandidate & { distancePixels: number; edgeIndex: number }) | null
) {
  if (!current) {
    return true
  }
  if (candidate.distancePixels < current.distancePixels - TIE_TOLERANCE_PIXELS) {
    return true
  }
  if (Math.abs(candidate.distancePixels - current.distancePixels) > TIE_TOLERANCE_PIXELS) {
    return false
  }
  const candidatePriority = TARGET_PRIORITY[candidate.kind]
  const currentPriority = TARGET_PRIORITY[current.kind]
  if (candidatePriority !== currentPriority) {
    return candidatePriority < currentPriority
  }
  if (candidate.edgeIndex !== current.edgeIndex) {
    return candidate.edgeIndex < current.edgeIndex
  }
  return candidate.index < current.index
}

function resolveAxisSnap(
  context: CanvasSnapContext,
  bounds: CanvasSnapBounds,
  axis: "x" | "y",
  requestedEdges: CanvasSnapEdges
): AxisSnapResult {
  if (!context.enabled || context.displayScale <= 0 || context.gridSize <= 0) {
    return { delta: 0, guide: null }
  }

  const candidates = getAxisCandidates(context, axis)
  const edges = getAxisEdges(bounds, axis, requestedEdges)
  let best: (CanvasSnapCandidate & { distancePixels: number; edgeIndex: number }) | null = null

  for (const edge of edges) {
    const gridCoordinate = Math.round(edge.coordinate / context.gridSize) * context.gridSize
    const possibleCandidates = [
      ...candidates,
      {
        coordinate: gridCoordinate,
        kind: "grid" as const,
        index: 0,
      },
    ]

    for (const candidate of possibleCandidates) {
      const distancePixels = Math.abs(candidate.coordinate - edge.coordinate) * context.displayScale
      if (distancePixels > getTolerancePixels(candidate.kind, context)) {
        continue
      }
      const resolved = { ...candidate, distancePixels, edgeIndex: edge.index }
      if (isBetterCandidate(resolved, best)) {
        best = resolved
      }
    }
  }

  if (!best) {
    return { delta: 0, guide: null }
  }

  const snappedEdge = edges[best.edgeIndex]
  if (!snappedEdge) {
    return { delta: 0, guide: null }
  }

  return {
    delta: best.coordinate - snappedEdge.coordinate,
    guide:
      best.kind === "grid"
        ? null
        : {
            axis,
            coordinate: best.coordinate,
            kind: best.kind,
          },
  }
}

export function resolveCanvasSnap(
  context: CanvasSnapContext,
  bounds: CanvasSnapBounds,
  edges: CanvasSnapEdges = {}
): CanvasSnapResult {
  const x = resolveAxisSnap(context, bounds, "x", edges)
  const y = resolveAxisSnap(context, bounds, "y", edges)
  return {
    deltaX: x.delta,
    deltaY: y.delta,
    guides: [x.guide, y.guide].filter((guide): guide is CanvasSnapGuide => guide !== null),
  }
}

export function translateCanvasSnapBounds(
  bounds: CanvasSnapBounds,
  deltaX: number,
  deltaY: number
): CanvasSnapBounds {
  return {
    ...bounds,
    x: bounds.x + deltaX,
    y: bounds.y + deltaY,
  }
}

export function getTransformerSnapEdges(anchor: string | null): CanvasSnapEdges | null {
  switch (anchor) {
    case "top-left":
      return { x: ["left"], y: ["top"] }
    case "top-center":
      return { y: ["top"] }
    case "top-right":
      return { x: ["right"], y: ["top"] }
    case "middle-right":
      return { x: ["right"] }
    case "bottom-right":
      return { x: ["right"], y: ["bottom"] }
    case "bottom-center":
      return { y: ["bottom"] }
    case "bottom-left":
      return { x: ["left"], y: ["bottom"] }
    case "middle-left":
      return { x: ["left"] }
    default:
      return null
  }
}

export function resolveTransformerSnap(
  context: CanvasSnapContext,
  box: CanvasTransformBox,
  anchor: string | null,
  options?: { preserveAspectRatio?: boolean }
): { box: CanvasTransformBox; guides: CanvasSnapGuide[] } {
  const edges = getTransformerSnapEdges(anchor)
  if (!edges) {
    return { box, guides: [] }
  }

  const snap = resolveCanvasSnap(context, box, edges)
  const nextBox = { ...box }

  if (
    options?.preserveAspectRatio &&
    edges.x?.length &&
    edges.y?.length &&
    box.width > 0 &&
    box.height > 0
  ) {
    const xDistance = Math.abs(snap.deltaX) * context.displayScale
    const yDistance = Math.abs(snap.deltaY) * context.displayScale
    const useX = xDistance > 0 && (yDistance === 0 || xDistance <= yDistance)
    const aspectRatio = box.width / box.height

    if (useX) {
      const width = edges.x.includes("left") ? box.width - snap.deltaX : box.width + snap.deltaX
      const height = width / aspectRatio
      nextBox.width = width
      nextBox.height = height
      if (edges.x.includes("left")) {
        nextBox.x = box.x + snap.deltaX
      }
      if (edges.y.includes("top")) {
        nextBox.y = box.y + box.height - height
      }
      return {
        box: nextBox,
        guides: snap.guides.filter((guide) => guide.axis === "x"),
      }
    }

    if (yDistance > 0) {
      const height = edges.y.includes("top") ? box.height - snap.deltaY : box.height + snap.deltaY
      const width = height * aspectRatio
      nextBox.width = width
      nextBox.height = height
      if (edges.y.includes("top")) {
        nextBox.y = box.y + snap.deltaY
      }
      if (edges.x.includes("left")) {
        nextBox.x = box.x + box.width - width
      }
      return {
        box: nextBox,
        guides: snap.guides.filter((guide) => guide.axis === "y"),
      }
    }
  }

  if (edges.x?.includes("left")) {
    nextBox.x += snap.deltaX
    nextBox.width -= snap.deltaX
  } else if (edges.x?.includes("right")) {
    nextBox.width += snap.deltaX
  }

  if (edges.y?.includes("top")) {
    nextBox.y += snap.deltaY
    nextBox.height -= snap.deltaY
  } else if (edges.y?.includes("bottom")) {
    nextBox.height += snap.deltaY
  }

  return { box: nextBox, guides: snap.guides }
}
