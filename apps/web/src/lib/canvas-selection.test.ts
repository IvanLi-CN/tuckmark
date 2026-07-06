import { describe, expect, it } from "vitest"

import {
  type CanvasSelectionBox,
  normalizeSelectionBox,
  projectSelectionBoxToStageRect,
} from "./canvas-selection.js"

describe("canvas marquee projection", () => {
  it("projects a normalized selection box into stage coordinates", () => {
    expect(
      projectSelectionBoxToStageRect(
        { x: 10, y: 6, width: 5, height: 4 },
        { x: 24, y: 16, scale: 1 }
      )
    ).toEqual({
      x: 104,
      y: 64,
      width: 40,
      height: 32,
    })
  })

  it("keeps projection proportional at 344 percent zoom with viewport offsets", () => {
    expect(
      projectSelectionBoxToStageRect(
        { x: 32, y: 11.5, width: 8.5, height: 4.5 },
        { x: -370, y: 36, scale: 3.44 }
      )
    ).toEqual({
      x: 510.64,
      y: 352.48,
      width: 233.92,
      height: 123.84,
    })
  })

  it("normalizes reverse drags before projection", () => {
    const reverseDrag: CanvasSelectionBox = {
      x1: 40.5,
      y1: 16,
      x2: 32,
      y2: 11.5,
      visible: true,
    }

    expect(normalizeSelectionBox(reverseDrag)).toEqual({
      x: 32,
      y: 11.5,
      width: 8.5,
      height: 4.5,
    })
  })
})
