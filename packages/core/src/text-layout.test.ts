import { describe, expect, it } from "vitest"

import { getTextNaturalHeight, resolveTextLayout } from "./text-layout.js"

describe("text layout", () => {
  it("uses configurable line height for visible text block height", () => {
    expect(getTextNaturalHeight(10, 2, 1.5)).toBe(25)
  })

  it("scales visible text block to the container when vertical stretch is enabled", () => {
    const layout = resolveTextLayout({
      text: "A\nB",
      fontSize: 10,
      width: 80,
      height: 40,
      lineHeight: 1.5,
      stretchY: true,
    })

    expect(layout.naturalHeight).toBe(25)
    expect(layout.renderHeight).toBe(30)
    expect(layout.contentY).toBe(0)
    expect(layout.scaleY).toBeCloseTo(1.6)
    expect(layout.baselineOffsetY).toBeCloseTo(8.2)
    expect(layout.textOffsetY).toBeCloseTo(-1.8)
  })

  it("aligns the natural text bbox inside the element container", () => {
    const layout = resolveTextLayout({
      text: "AB\nC",
      fontSize: 10,
      width: 80,
      height: 40,
      lineHeight: 1.5,
      align: "right",
      verticalAlign: "bottom",
    })

    expect(layout.naturalWidth).toBeCloseTo(14.4)
    expect(layout.naturalHeight).toBe(25)
    expect(layout.contentWidth).toBeCloseTo(14.4)
    expect(layout.contentHeight).toBe(25)
    expect(layout.contentX).toBeCloseTo(65.6)
    expect(layout.contentY).toBe(15)
  })

  it("centers the natural text bbox without resizing text", () => {
    const layout = resolveTextLayout({
      text: "AB",
      fontSize: 10,
      width: 80,
      height: 40,
      align: "center",
      verticalAlign: "middle",
    })

    expect(layout.contentX).toBeCloseTo(32.8)
    expect(layout.contentY).toBe(15)
    expect(layout.scaleX).toBe(1)
    expect(layout.scaleY).toBe(1)
  })

  it("keeps latin text on one line when its visual width fits", () => {
    const layout = resolveTextLayout({
      text: "Koha ACC",
      fontSize: 3.5,
      width: 21.25,
      height: 7.7,
      lineHeight: 1.2,
    })

    expect(layout.lines).toEqual(["Koha ACC"])
  })

  it("wraps latin text by estimated visual width when the container is narrow", () => {
    const layout = resolveTextLayout({
      text: "Koha ACC",
      fontSize: 3.5,
      width: 10,
      height: 7.7,
      lineHeight: 1.2,
    })

    expect(layout.lines).toEqual(["Koha", "ACC"])
  })

  it("breaks long tokens when automatic wrapping is enabled", () => {
    const layout = resolveTextLayout({
      text: "KohaACC",
      fontSize: 3.5,
      width: 10,
      height: 12,
      lineHeight: 1.2,
      autoWrap: true,
    })

    expect(layout.lines).toEqual(["Koha", "ACC"])
  })

  it("keeps explicit lines unwrapped when automatic wrapping is disabled", () => {
    const layout = resolveTextLayout({
      text: "Koha ACC",
      fontSize: 3.5,
      width: 10,
      height: 7.7,
      lineHeight: 1.2,
      autoWrap: false,
    })

    expect(layout.lines).toEqual(["Koha ACC"])
    expect(layout.naturalWidth).toBeGreaterThan(10)
  })

  it("adds character spacing for justified horizontal text", () => {
    const layout = resolveTextLayout({
      text: "AB",
      fontSize: 10,
      width: 80,
      height: 20,
      align: "justify",
    })

    expect(layout.contentX).toBe(0)
    expect(layout.contentWidth).toBe(80)
    expect(layout.lineLayouts[0]?.letterSpacing).toBeCloseTo(65.6)
  })

  it("does not double-scale justified text when horizontal stretch is enabled", () => {
    const layout = resolveTextLayout({
      text: "AB",
      fontSize: 10,
      width: 80,
      height: 20,
      align: "justify",
      stretchX: true,
    })

    expect(layout.contentWidth).toBe(80)
    expect(layout.scaleX).toBe(1)
  })

  it("lays out vertical text as top-to-bottom glyph columns", () => {
    const layout = resolveTextLayout({
      text: "ABCD",
      fontSize: 10,
      width: 40,
      height: 25,
      lineHeight: 1.2,
      verticalText: true,
      autoWrap: true,
    })

    expect(layout.verticalText).toBe(true)
    expect(layout.lines).toEqual(["AB", "CD"])
    expect(layout.glyphs).toEqual([
      { text: "A", x: 5, y: 0 },
      { text: "B", x: 5, y: 12 },
      { text: "C", x: 17, y: 0 },
      { text: "D", x: 17, y: 12 },
    ])
    expect(layout.naturalWidth).toBe(22)
    expect(layout.naturalHeight).toBe(22)
  })
})
