import { describe, expect, it } from "vitest"

import { resolveOutputSettings, resolvePositionedPrintFrame } from "./output-settings.js"

describe("resolvePositionedPrintFrame", () => {
  it("centers gap-paper content horizontally without applying Y as bitmap shift", () => {
    expect(
      resolvePositionedPrintFrame(
        {
          paperType: "gap",
          printWidthDots: 384,
          xOffsetDots: 10,
          yOffsetDots: -4,
        },
        144,
        80
      )
    ).toEqual({
      frameWidthDots: 384,
      frameHeightDots: 80,
      contentLeftDots: 130,
      contentTopDots: 0,
    })
  })

  it("ignores positive gap-paper Y offsets for bitmap placement", () => {
    expect(
      resolvePositionedPrintFrame(
        {
          paperType: "gap",
          printWidthDots: 384,
          xOffsetDots: 0,
          yOffsetDots: 12,
        },
        144,
        80
      )
    ).toEqual({
      frameWidthDots: 384,
      frameHeightDots: 80,
      contentLeftDots: 120,
      contentTopDots: 0,
    })
  })

  it("keeps the content anchored when artifact width already matches the print width", () => {
    expect(
      resolvePositionedPrintFrame(
        {
          paperType: "gap",
          printWidthDots: 384,
          xOffsetDots: 0,
          yOffsetDots: 0,
        },
        384,
        96
      )
    ).toEqual({
      frameWidthDots: 384,
      frameHeightDots: 96,
      contentLeftDots: 0,
      contentTopDots: 0,
    })
  })

  it("expands the continuous-paper frame downward for positive Y offsets instead of cropping", () => {
    expect(
      resolvePositionedPrintFrame(
        {
          paperType: "continuous",
          printWidthDots: 384,
          xOffsetDots: 0,
          yOffsetDots: 12,
        },
        160,
        80
      )
    ).toEqual({
      frameWidthDots: 384,
      frameHeightDots: 92,
      contentLeftDots: 112,
      contentTopDots: 12,
    })
  })

  it("expands the continuous-paper frame upward for negative Y offsets instead of cropping", () => {
    expect(
      resolvePositionedPrintFrame(
        {
          paperType: "continuous",
          printWidthDots: 384,
          xOffsetDots: 0,
          yOffsetDots: -12,
        },
        160,
        80
      )
    ).toEqual({
      frameWidthDots: 384,
      frameHeightDots: 92,
      contentLeftDots: 112,
      contentTopDots: 0,
    })
  })
})

describe("resolveOutputSettings", () => {
  it("keeps document-level gap paper type when no draft render options override it", () => {
    const resolved = resolveOutputSettings({
      documentDefaults: {
        paperType: "gap",
        threshold: 150,
      },
      printerModelPresets: {},
      printerDeviceCalibrations: {},
      selectedPrinter: {
        id: "printer-demo-1",
        name: "Studio P2",
        capabilities: {
          dpi: 203,
          printWidthDots: 384,
          supportedPaperTypes: ["continuous", "gap"],
        },
      },
      browserPrinter: null,
    })

    expect(resolved.renderOptions.paperType).toBe("gap")
  })
})
