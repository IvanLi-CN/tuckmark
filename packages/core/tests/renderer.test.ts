import { PNG } from "pngjs"
import { describe, expect, it } from "vitest"

import { renderSafeTextLabelPreview, renderTemplateToPreview } from "../src/renderer.ts"
import { getTemplateById } from "../src/template-library.ts"
import { buildSvg } from "../src/web.ts"

function maxRowDarkBits(pngBuffer: Buffer, threshold = 150): number {
  const png = PNG.sync.read(pngBuffer)
  let max = 0

  for (let y = 0; y < png.height; y += 1) {
    let rowDarkBits = 0
    for (let x = 0; x < png.width; x += 1) {
      const idx = (png.width * y + x) << 2
      const r = png.data[idx] ?? 255
      const g = png.data[idx + 1] ?? 255
      const b = png.data[idx + 2] ?? 255
      const a = png.data[idx + 3] ?? 255
      const lum = (r * 77 + g * 150 + b * 29) >> 8
      const composited = (lum * a + 255 * (255 - a)) / 255
      if (composited < threshold) {
        rowDarkBits += 1
      }
    }
    max = Math.max(max, rowDarkBits)
  }

  return max
}

describe("renderTemplateToPreview continuous safety", () => {
  it("thins dangerous near-solid rows for continuous cable tags", { timeout: 15000 }, () => {
    const template = getTemplateById("cable-tag")
    const input = {
      name: "LAN-01",
      port: "Gi1/0/1",
      location: "Rack A",
    }

    const gap = renderTemplateToPreview(template, input, {
      paperType: "gap",
    })
    const continuous = renderTemplateToPreview(template, input, {
      paperType: "continuous",
    })

    expect(maxRowDarkBits(gap.png)).toBeGreaterThan(320)
    expect(maxRowDarkBits(continuous.png)).toBeLessThanOrEqual(220)
    expect(maxRowDarkBits(continuous.png)).toBeLessThan(maxRowDarkBits(gap.png))
  })

  it("escapes safe text once when generating SVG text nodes", () => {
    const preview = renderSafeTextLabelPreview({
      text: "A & B < C",
      title: "Safe Text Label",
      renderOptions: {
        printWidthDots: 384,
        threshold: 150,
        xOffsetDots: 0,
      },
    })

    expect(preview.svg).toContain("A &amp; B &lt; C")
    expect(preview.svg).not.toContain("&amp;amp;")
    expect(preview.svg).not.toContain("&amp;lt;")
    expect(preview.artifact.source).toBe("safe_text")
  })

  it("rotates multiline text around its rendered box center", () => {
    const svg = buildSvg(
      240,
      120,
      [
        {
          kind: "text",
          key: "body",
          value: "Koha Cat\nBrowser City",
          x: 20,
          y: 40,
          width: 160,
          fontSize: 20,
          fontWeight: "normal",
          align: "left",
          maxLines: 2,
          rotation: 90,
        },
      ],
      {}
    )

    expect(svg).toContain('transform="rotate(90 100 45.6)"')
  })

  it("renders circle and triangle shape elements into SVG", () => {
    const svg = buildSvg(
      120,
      80,
      [
        {
          kind: "circle",
          x: 10,
          y: 12,
          size: 32,
          strokeWidth: 2,
          fill: "none",
          stroke: "#111111",
        },
        {
          kind: "triangle",
          x: 52,
          y: 16,
          width: 40,
          height: 34,
          strokeWidth: 2,
          fill: "none",
          stroke: "#111111",
          rotation: 15,
        },
      ],
      {}
    )

    expect(svg).toContain('<circle cx="26" cy="28" r="16"')
    expect(svg).toContain('<polygon points="72,16 92,50 52,50"')
    expect(svg).toContain('transform="rotate(15 72 33)"')
  })
})
