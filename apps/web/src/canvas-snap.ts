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

export type CanvasSnapAxisSource = "min" | "center" | "max"

export type CanvasSnapSources = {
  x?: CanvasSnapAxisSource[]
  y?: CanvasSnapAxisSource[]
}

export type CanvasTransformBox = CanvasSnapBounds & {
  rotation: number
}

export type CanvasSnapTargetScope = "bounds" | "direct-handle"

export type CanvasSnapRequest = {
  sources?: CanvasSnapSources
  targetScope?: CanvasSnapTargetScope
}

type CanvasSnapTargetFeature = "edge" | "center" | "corner"

type CanvasSnapCandidate = {
  coordinate: number
  kind: CanvasSnapTargetKind
  feature: CanvasSnapTargetFeature
  index: number
}

type AxisSnapResult = {
  delta: number
  guide: CanvasSnapGuide | null
}

const SNAP_TOLERANCE_PIXELS = 8
const GRID_TOLERANCE_RATIO = 0.4
const TIE_TOLERANCE_PIXELS = 0.5
const DEFAULT_BOUND_SOURCES: Record<"x" | "y", CanvasSnapAxisSource[]> = {
  x: ["min", "max"],
  y: ["min", "max"],
}
const TARGET_PRIORITY: Record<CanvasSnapTargetKind, number> = {
  element: 0,
  canvas: 1,
  grid: 2,
}

function pushAxisCandidates(
  candidates: CanvasSnapCandidate[],
  axis: "x" | "y",
  bounds: CanvasSnapBounds,
  kind: Exclude<CanvasSnapTargetKind, "grid">,
  nextIndex: number,
  targetScope: CanvasSnapTargetScope
) {
  const min = axis === "x" ? bounds.x : bounds.y
  const span = axis === "x" ? bounds.width : bounds.height
  const max = min + span
  candidates.push(
    { coordinate: min, kind, feature: "edge", index: nextIndex },
    { coordinate: max, kind, feature: "edge", index: nextIndex + 1 }
  )
  if (targetScope !== "direct-handle") {
    return nextIndex + 2
  }
  candidates.push(
    { coordinate: min + span / 2, kind, feature: "center", index: nextIndex + 2 },
    { coordinate: min, kind, feature: "corner", index: nextIndex + 3 },
    { coordinate: max, kind, feature: "corner", index: nextIndex + 4 }
  )
  return nextIndex + 5
}

function getAxisCandidates(
  context: CanvasSnapContext,
  axis: "x" | "y",
  targetScope: CanvasSnapTargetScope
) {
  const movingIds = new Set(context.movingIds)
  const candidates: CanvasSnapCandidate[] = []
  let nextIndex = 0
  nextIndex = pushAxisCandidates(
    candidates,
    axis,
    {
      x: 0,
      y: 0,
      width: context.draft.width,
      height: context.draft.height,
    },
    "canvas",
    nextIndex,
    targetScope
  )

  context.draft.elements.forEach((element) => {
    if (!element.meta.visible || movingIds.has(element.id)) {
      return
    }
    const bounds = getElementSelectionBounds(element)
    nextIndex = pushAxisCandidates(candidates, axis, bounds, "element", nextIndex, targetScope)
  })

  return candidates
}

function getSourceCoordinate(
  bounds: CanvasSnapBounds,
  axis: "x" | "y",
  source: CanvasSnapAxisSource
) {
  const min = axis === "x" ? bounds.x : bounds.y
  const span = axis === "x" ? bounds.width : bounds.height
  if (source === "center") {
    return min + span / 2
  }
  return source === "min" ? min : min + span
}

function getAxisSources(
  bounds: CanvasSnapBounds,
  axis: "x" | "y",
  sources: CanvasSnapSources,
  explicitSources: boolean
) {
  const requestedSources = sources[axis] ?? (explicitSources ? [] : DEFAULT_BOUND_SOURCES[axis])
  return requestedSources.map((source, index) => ({
    coordinate: getSourceCoordinate(bounds, axis, source),
    index,
    source,
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
  request: CanvasSnapRequest,
  explicitSources: boolean
): AxisSnapResult {
  if (!context.enabled || context.displayScale <= 0 || context.gridSize <= 0) {
    return { delta: 0, guide: null }
  }

  const targetScope = request.targetScope ?? "bounds"
  const candidates = getAxisCandidates(context, axis, targetScope)
  const sources = getAxisSources(bounds, axis, request.sources ?? {}, explicitSources)
  if (sources.length === 0) {
    return { delta: 0, guide: null }
  }
  let best: (CanvasSnapCandidate & { distancePixels: number; edgeIndex: number }) | null = null

  for (const source of sources) {
    const gridCoordinate = Math.round(source.coordinate / context.gridSize) * context.gridSize
    const possibleCandidates = [
      ...candidates,
      {
        coordinate: gridCoordinate,
        kind: "grid" as const,
        feature: "edge" as const,
        index: 0,
      },
    ]

    for (const candidate of possibleCandidates) {
      const distancePixels =
        Math.abs(candidate.coordinate - source.coordinate) * context.displayScale
      if (distancePixels > getTolerancePixels(candidate.kind, context)) {
        continue
      }
      const resolved = { ...candidate, distancePixels, edgeIndex: source.index }
      if (isBetterCandidate(resolved, best)) {
        best = resolved
      }
    }
  }

  if (!best) {
    return { delta: 0, guide: null }
  }

  const snappedSource = sources[best.edgeIndex]
  if (!snappedSource) {
    return { delta: 0, guide: null }
  }

  return {
    delta: best.coordinate - snappedSource.coordinate,
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
  request: CanvasSnapRequest = {}
): CanvasSnapResult {
  const explicitSources = Boolean(request.sources)
  const x = resolveAxisSnap(context, bounds, "x", request, explicitSources)
  const y = resolveAxisSnap(context, bounds, "y", request, explicitSources)
  return {
    deltaX: x.delta,
    deltaY: y.delta,
    guides: [x.guide, y.guide].filter((guide): guide is CanvasSnapGuide => guide !== null),
  }
}

export function resolveDirectHandleSnap(
  context: CanvasSnapContext,
  bounds: CanvasSnapBounds,
  sources: CanvasSnapSources
): CanvasSnapResult {
  return resolveCanvasSnap(context, bounds, {
    sources,
    targetScope: "direct-handle",
  })
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

export function getTransformerSnapSources(anchor: string | null): CanvasSnapSources | null {
  switch (anchor) {
    case "top-left":
      return { x: ["min"], y: ["min"] }
    case "top-center":
      return { y: ["min"] }
    case "top-right":
      return { x: ["max"], y: ["min"] }
    case "middle-right":
      return { x: ["max"] }
    case "bottom-right":
      return { x: ["max"], y: ["max"] }
    case "bottom-center":
      return { y: ["max"] }
    case "bottom-left":
      return { x: ["min"], y: ["max"] }
    case "middle-left":
      return { x: ["min"] }
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
  const sources = getTransformerSnapSources(anchor)
  if (!sources) {
    return { box, guides: [] }
  }

  const snap = resolveDirectHandleSnap(context, box, sources)
  const nextBox = { ...box }

  if (
    options?.preserveAspectRatio &&
    sources.x?.length &&
    sources.y?.length &&
    box.width > 0 &&
    box.height > 0
  ) {
    const xDistance = Math.abs(snap.deltaX) * context.displayScale
    const yDistance = Math.abs(snap.deltaY) * context.displayScale
    const useX = xDistance > 0 && (yDistance === 0 || xDistance <= yDistance)
    const aspectRatio = box.width / box.height

    if (useX) {
      const width = sources.x.includes("min") ? box.width - snap.deltaX : box.width + snap.deltaX
      const height = width / aspectRatio
      nextBox.width = width
      nextBox.height = height
      if (sources.x.includes("min")) {
        nextBox.x = box.x + snap.deltaX
      }
      if (sources.y.includes("min")) {
        nextBox.y = box.y + box.height - height
      }
      return {
        box: nextBox,
        guides: snap.guides.filter((guide) => guide.axis === "x"),
      }
    }

    if (yDistance > 0) {
      const height = sources.y.includes("min")
        ? box.height - snap.deltaY
        : box.height + snap.deltaY
      const width = height * aspectRatio
      nextBox.width = width
      nextBox.height = height
      if (sources.y.includes("min")) {
        nextBox.y = box.y + snap.deltaY
      }
      if (sources.x.includes("min")) {
        nextBox.x = box.x + box.width - width
      }
      return {
        box: nextBox,
        guides: snap.guides.filter((guide) => guide.axis === "y"),
      }
    }
  }

  if (sources.x?.includes("min")) {
    nextBox.x += snap.deltaX
    nextBox.width -= snap.deltaX
  } else if (sources.x?.includes("max")) {
    nextBox.width += snap.deltaX
  }

  if (sources.y?.includes("min")) {
    nextBox.y += snap.deltaY
    nextBox.height -= snap.deltaY
  } else if (sources.y?.includes("max")) {
    nextBox.height += snap.deltaY
  }

  return { box: nextBox, guides: snap.guides }
}
