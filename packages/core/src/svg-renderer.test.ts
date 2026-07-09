import { describe, expect, it } from "vitest"

import { buildSvg } from "./svg-renderer.js"

describe("svg text rendering", () => {
  it("renders text containers with font family and stretch transforms", () => {
    const svg = buildSvg(
      200,
      120,
      [
        {
          kind: "text",
          key: "label",
          x: 10,
          y: 20,
          width: 100,
          height: 40,
          fontSize: 20,
          fontFamily: "courier-new",
          lineHeight: 1.5,
          fontWeight: "bold",
          align: "right",
          verticalAlign: "bottom",
          stretchX: true,
          stretchY: true,
          autoWrap: true,
          value: "A1",
          maxLines: 1,
          rotation: 0,
        },
      ],
      {}
    )

    expect(svg).toContain('font-family="&apos;Courier New&apos;')
    expect(svg).toContain("scale(")
    expect(svg).toContain('overflow="hidden"')
    expect(svg).toContain('text-anchor="start"')
    expect(svg).not.toContain('text-anchor="end"')
    expect(svg).toContain("A1")
  })

  it("preserves legacy baseline positioning when text height is omitted", () => {
    const svg = buildSvg(
      200,
      120,
      [
        {
          kind: "text",
          key: "label",
          x: 10,
          y: 40,
          width: 100,
          fontSize: 20,
          fontWeight: "bold",
          align: "left",
          value: "A1",
          rotation: 0,
        },
      ],
      {}
    )

    expect(svg).toContain('<svg x="10" y="23.6"')
    expect(svg).toContain('<text x="0" y="16.4"')
  })

  it("preserves legacy right-aligned anchors when text width is omitted", () => {
    const svg = buildSvg(
      200,
      120,
      [
        {
          kind: "text",
          key: "label",
          x: 50,
          y: 40,
          fontSize: 20,
          fontWeight: "bold",
          align: "right",
          value: "A1",
          rotation: 0,
        },
      ],
      {}
    )

    expect(svg).toContain('<svg x="24.2" y="23.6"')
    expect(svg).toContain('width="25.8"')
  })

  it("sizes legacy height-less text containers from wrapped lines", () => {
    const svg = buildSvg(
      200,
      120,
      [
        {
          kind: "text",
          key: "label",
          x: 10,
          y: 40,
          width: 40,
          fontSize: 10,
          fontWeight: "normal",
          align: "left",
          value: "Koha Cat Browser City",
          rotation: 0,
        },
      ],
      {}
    )

    expect(svg).toContain('height="46"')
  })

  it("keeps no-wrap text on one clipped line", () => {
    const svg = buildSvg(
      80,
      40,
      [
        {
          kind: "text",
          key: "label",
          x: 0,
          y: 0,
          width: 20,
          height: 10,
          fontSize: 10,
          fontWeight: "bold",
          align: "left",
          stretchX: false,
          stretchY: false,
          autoWrap: false,
          value: "Koha ACC",
          rotation: 0,
        },
      ],
      {}
    )

    expect(svg).toContain('overflow="hidden"')
    expect(svg).toContain("Koha ACC")
    expect(svg.match(/<text/g)?.length).toBe(1)
  })

  it("renders justified text with SVG spacing adjustment", () => {
    const svg = buildSvg(
      80,
      40,
      [
        {
          kind: "text",
          key: "label",
          x: 0,
          y: 0,
          width: 40,
          height: 10,
          fontSize: 10,
          fontWeight: "bold",
          align: "justify",
          stretchX: false,
          stretchY: false,
          autoWrap: false,
          value: "AB",
          rotation: 0,
        },
      ],
      {}
    )

    expect(svg).toContain('textLength="40"')
    expect(svg).toContain('lengthAdjust="spacing"')
  })

  it("renders vertical text as individual clipped glyphs", () => {
    const svg = buildSvg(
      80,
      60,
      [
        {
          kind: "text",
          key: "label",
          x: 0,
          y: 0,
          width: 30,
          height: 25,
          fontSize: 10,
          lineHeight: 1.2,
          fontWeight: "bold",
          align: "left",
          stretchX: false,
          stretchY: false,
          autoWrap: true,
          verticalText: true,
          value: "ABCD",
          rotation: 0,
        },
      ],
      {}
    )

    expect(svg).toContain('overflow="hidden"')
    expect(svg).toContain('text-anchor="middle"')
    expect(svg.match(/<text/g)?.length).toBe(4)
  })

  it("renders Data Matrix elements as square module grids", () => {
    const svg = buildSvg(
      80,
      80,
      [
        {
          kind: "datamatrix",
          key: "asset",
          x: 8,
          y: 8,
          size: 48,
          value: "TM-0001",
          rotation: 0,
        },
      ],
      {}
    )

    expect(svg).toContain('<svg x="8" y="8" width="48" height="48"')
    expect(svg.match(/<rect x="/g)?.length).toBeGreaterThan(10)
  })

  it("throws a stable error when Data Matrix value is empty", () => {
    expect(() =>
      buildSvg(
        80,
        80,
        [
          {
            kind: "datamatrix",
            key: "asset",
            x: 8,
            y: 8,
            size: 48,
            value: "",
            rotation: 0,
          },
        ],
        {}
      )
    ).toThrow(/Data Matrix value is required/)
  })
})
