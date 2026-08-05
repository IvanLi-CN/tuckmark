import { describe, expect, it } from "vitest"

import { compileCanvasDraftToDirectCanvas } from "./canvas-draft-render.js"

describe("canvas draft rendering", () => {
  it("keeps legacy drafts without a unit in dot coordinates", () => {
    const canvas = compileCanvasDraftToDirectCanvas(
      {
        id: "legacy",
        name: "Legacy",
        width: 240,
        height: 80,
        elements: [
          {
            id: "label",
            kind: "text",
            x: 8,
            y: 16,
            width: 120,
            height: 24,
            fontSize: 12,
            value: "A1",
          },
        ],
      },
      {}
    )

    expect(canvas.width).toBe(240)
    expect(canvas.height).toBe(80)
    expect(canvas.elements[0]).toMatchObject({ x: 8, y: 16, width: 120, fontSize: 12 })
  })

  it("converts explicit millimetre drafts to dots", () => {
    const canvas = compileCanvasDraftToDirectCanvas(
      {
        id: "metric",
        name: "Metric",
        unit: "mm",
        width: 30,
        height: 10,
        elements: [],
      },
      {}
    )

    expect(canvas.width).toBe(240)
    expect(canvas.height).toBe(80)
  })
})
