import { describe, expect, it } from "vitest"

import {
  compileUserTemplatePackageToCanvas,
  parseUserTemplatePackage,
} from "../src/user-template-package.ts"

const componentPackage = {
  schema: "tuckmark.user-template-package.v1",
  id: "sot23-diode-bin",
  name: "SOT-23 Diode Bin",
  description: "Small component drawer label.",
  canvas: { width: 192, height: 96 },
  fields: [
    { key: "value", label: "Value", defaultValue: "40V 3A" },
    { key: "package", label: "Package", defaultValue: "SOT-23" },
  ],
  elements: [
    {
      kind: "rect",
      x: 2,
      y: 2,
      width: 188,
      height: 92,
      strokeWidth: 2,
      fill: "white",
      stroke: "#111111",
      radius: 8,
      rotation: 0,
    },
    {
      kind: "text",
      key: "value",
      x: 12,
      y: 38,
      width: 168,
      fontSize: 26,
      fontWeight: "bold",
      align: "center",
      maxLines: 1,
      rotation: 0,
    },
    {
      kind: "text",
      key: "package",
      x: 12,
      y: 68,
      width: 168,
      fontSize: 14,
      fontWeight: "normal",
      align: "center",
      maxLines: 1,
      rotation: 0,
    },
  ],
  sampleInput: { value: "60V 3A", package: "SMAF" },
  renderOptions: { paperType: "gap", printWidthDots: 384 },
}

describe("UserTemplatePackage", () => {
  it("parses and compiles fixed-element user template packages to printable canvases", () => {
    const parsed = parseUserTemplatePackage(componentPackage)
    const canvas = compileUserTemplatePackageToCanvas(parsed)

    expect(canvas).toMatchObject({
      id: "sot23-diode-bin",
      name: "SOT-23 Diode Bin",
      width: 192,
      height: 96,
    })
    expect(canvas.elements[1]).toMatchObject({ kind: "text", value: "60V 3A" })
  })

  it("lets field input override bindable element literal defaults", () => {
    const parsed = parseUserTemplatePackage({
      ...componentPackage,
      elements: [
        {
          kind: "text",
          key: "value",
          value: "OLD",
          x: 12,
          y: 38,
          width: 168,
          fontSize: 26,
          fontWeight: "bold",
          align: "center",
          maxLines: 1,
          rotation: 0,
        },
      ],
    })
    const canvas = compileUserTemplatePackageToCanvas(parsed, { value: "ESP32" })

    expect(canvas.elements[0]).toMatchObject({ kind: "text", value: "ESP32" })
  })

  it("merges partial field input over sample input before falling back to defaults", () => {
    const parsed = parseUserTemplatePackage(componentPackage)
    const canvas = compileUserTemplatePackageToCanvas(parsed, { value: "ESP32-C3" })

    expect(canvas.elements[1]).toMatchObject({ kind: "text", value: "ESP32-C3" })
    expect(canvas.elements[2]).toMatchObject({ kind: "text", value: "SMAF" })
  })

  it("rejects packages wider than the current printer capability default", () => {
    expect(() =>
      parseUserTemplatePackage({
        ...componentPackage,
        canvas: { width: 512, height: 96 },
      })
    ).toThrow()
  })

  it("rejects packages wider than their configured render print width", () => {
    expect(() =>
      parseUserTemplatePackage({
        ...componentPackage,
        canvas: { width: 384, height: 96 },
        renderOptions: { printWidthDots: 192 },
      })
    ).toThrow(/exceeds render print width/)
  })

  it("rejects rotated elements that exceed the canvas bounds", () => {
    expect(() =>
      parseUserTemplatePackage({
        ...componentPackage,
        elements: [
          {
            kind: "rect",
            x: 0,
            y: 20,
            width: 10,
            height: 80,
            strokeWidth: 2,
            fill: "white",
            stroke: "#111111",
            radius: 0,
            rotation: 90,
          },
        ],
      })
    ).toThrow(/rotated canvas bounds/)
  })

  it("rejects bindable elements that reference unknown fields", () => {
    expect(() =>
      parseUserTemplatePackage({
        ...componentPackage,
        elements: [
          {
            kind: "text",
            key: "missing",
            x: 0,
            y: 20,
            fontSize: 16,
            fontWeight: "normal",
            align: "left",
            rotation: 0,
          },
        ],
      })
    ).toThrow(/unknown field/)
  })
})
