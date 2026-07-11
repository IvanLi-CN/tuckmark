import { describe, expect, it } from "vitest"

import {
  createDraftFromPreset,
  getElementSelectionBounds,
  getPresetById,
} from "./canvas-editor-model.js"
import {
  getTransformerSnapEdges,
  resolveCanvasSnap,
  resolveTransformerSnap,
} from "./canvas-snap.js"
import type { CanvasDraftElement } from "./types.js"

function rect(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options?: { visible?: boolean; locked?: boolean; rotation?: number }
): Extract<CanvasDraftElement, { kind: "rect" }> {
  return {
    id,
    kind: "rect",
    x,
    y,
    width,
    height,
    strokeWidth: 0.25,
    fill: "none",
    stroke: "#111111",
    radius: 0,
    rotation: options?.rotation ?? 0,
    meta: {
      name: id,
      visible: options?.visible ?? true,
      locked: options?.locked ?? false,
    },
  }
}

function draftWith(elements: CanvasDraftElement[]) {
  const draft = createDraftFromPreset(getPresetById("ops-tag"))
  draft.width = 100
  draft.height = 60
  draft.elements = elements
  return draft
}

describe("canvas magnetic snapping", () => {
  it("uses an element edge over an equally close grid target and returns a guide", () => {
    const draft = draftWith([
      rect("moving", 29.5, 12, 10, 8),
      rect("reference", 40, 20, 8, 8, { locked: true }),
    ])

    const result = resolveCanvasSnap(
      {
        draft,
        movingIds: ["moving"],
        displayScale: 8,
        enabled: true,
        gridSize: 1,
      },
      { x: 29.5, y: 12, width: 10, height: 8 }
    )

    expect(result.deltaX).toBeCloseTo(0.5)
    expect(result.guides).toContainEqual({ axis: "x", coordinate: 40, kind: "element" })
  })

  it("uses a canvas edge over an equally close grid target and keeps axes independent", () => {
    const draft = draftWith([rect("moving", 0.5, 18.25, 10, 8)])

    const result = resolveCanvasSnap(
      {
        draft,
        movingIds: ["moving"],
        displayScale: 8,
        enabled: true,
        gridSize: 1,
      },
      { x: 0.5, y: 18.25, width: 10, height: 8 }
    )

    expect(result.deltaX).toBeCloseTo(-0.5)
    expect(result.deltaY).toBeCloseTo(-0.25)
    expect(result.guides).toContainEqual({ axis: "x", coordinate: 0, kind: "canvas" })
  })

  it("narrows only grid tolerance at low zoom so a free adjustment zone remains", () => {
    const draft = draftWith([rect("moving", 10.5, 18, 10, 8)])

    const result = resolveCanvasSnap(
      {
        draft,
        movingIds: ["moving"],
        displayScale: 3.6,
        enabled: true,
        gridSize: 1,
      },
      { x: 10.5, y: 18, width: 10, height: 8 }
    )

    expect(result.deltaX).toBe(0)
    expect(result.guides).toHaveLength(0)
  })

  it("keeps snapping disabled without returning guides", () => {
    const draft = draftWith([rect("moving", 29.5, 12, 10, 8), rect("reference", 40, 20, 8, 8)])

    expect(
      resolveCanvasSnap(
        {
          draft,
          movingIds: ["moving"],
          displayScale: 8,
          enabled: false,
          gridSize: 1,
        },
        { x: 29.5, y: 12, width: 10, height: 8 }
      )
    ).toEqual({ deltaX: 0, deltaY: 0, guides: [] })
  })

  it("uses a locked rotated element's visible bounds as an alignment target", () => {
    const reference = rect("reference", 40, 20, 8, 16, { locked: true, rotation: 30 })
    const referenceBounds = getElementSelectionBounds(reference)
    const draft = draftWith([rect("moving", referenceBounds.x - 10.2, 10, 10, 8), reference])

    const result = resolveCanvasSnap(
      {
        draft,
        movingIds: ["moving"],
        displayScale: 8,
        enabled: true,
        gridSize: 1,
      },
      { x: referenceBounds.x - 10.2, y: 10, width: 10, height: 8 }
    )

    expect(result.guides).toContainEqual({
      axis: "x",
      coordinate: referenceBounds.x,
      kind: "element",
    })
  })

  it("snaps only active transformer edges while keeping opposite edges fixed", () => {
    const draft = draftWith([rect("moving", 30.5, 20.5, 10, 8), rect("reference", 30, 20, 8, 8)])
    const result = resolveTransformerSnap(
      {
        draft,
        movingIds: ["moving"],
        displayScale: 8,
        enabled: true,
        gridSize: 1,
      },
      { x: 30.5, y: 20.5, width: 10, height: 8, rotation: 0 },
      "top-left"
    )

    expect(result.box).toMatchObject({ x: 30, y: 20, width: 10.5, height: 8.5 })
    expect(result.guides).toEqual(
      expect.arrayContaining([
        { axis: "x", coordinate: 30, kind: "element" },
        { axis: "y", coordinate: 20, kind: "element" },
      ])
    )
  })

  it("keeps proportional corner resize geometry when one magnetic axis wins", () => {
    const draft = draftWith([rect("moving", 30.25, 20.5, 10, 10), rect("reference", 30, 20, 8, 8)])
    const result = resolveTransformerSnap(
      {
        draft,
        movingIds: ["moving"],
        displayScale: 8,
        enabled: true,
        gridSize: 1,
      },
      { x: 30.25, y: 20.5, width: 10, height: 10, rotation: 0 },
      "top-left",
      { preserveAspectRatio: true }
    )

    expect(result.box).toMatchObject({ x: 30, y: 20.25, width: 10.25, height: 10.25 })
    expect(result.guides).toEqual([{ axis: "x", coordinate: 30, kind: "element" }])
  })

  it("does not assign snap edges to the rotation handle", () => {
    expect(getTransformerSnapEdges("rotater")).toBeNull()
  })
})
