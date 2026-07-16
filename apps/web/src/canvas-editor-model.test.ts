// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest"

import { DEFAULT_TEXT_FONT_FAMILY, getTextNaturalHeight } from "../../../packages/core/src/web.js"
import {
  bindElementToExistingField,
  buildTemplateFieldsFromDraft,
  clearStoredDraftDocument,
  compileDraftToCanvasDefinition,
  compileDraftToFilledCanvasDefinition,
  createCanvasElement,
  createDraftFromPreset,
  createDraftFromSystemTemplate,
  createDraftFromUserTemplatePackage,
  DEFAULT_CANVAS_TEXT_FONT_SIZE_MILLIMETERS,
  getElementBounds,
  getElementGeometry,
  getElementSelectionBounds,
  getPresetById,
  getSystemTemplateById,
  loadStoredDraftDocument,
  normalizeDraftDocument,
  persistDraftDocument,
  toCanvasPrintSource,
  toggleElementBinding,
} from "./canvas-editor-model.js"
import { CANVAS_DOTS_PER_MILLIMETER } from "./lib/canvas-units.js"
import type { CanvasDraftElement } from "./types.js"

type CompiledCanvasElement = ReturnType<typeof compileDraftToCanvasDefinition>["elements"][number]
type AnyCanvasElement = CanvasDraftElement | CompiledCanvasElement
type AnyRectElement = Extract<AnyCanvasElement, { kind: "rect" }>
type AnyCircleElement = Extract<AnyCanvasElement, { kind: "circle" }>
type AnyTriangleElement = Extract<AnyCanvasElement, { kind: "triangle" }>
type AnyLineElement = Extract<AnyCanvasElement, { kind: "line" }>

function getStorage() {
  const store = new Map<string, string>()
  const memoryStorage: Storage = {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key) {
      return store.get(key) ?? null
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key) {
      store.delete(key)
    },
    setItem(key, value) {
      store.set(key, value)
    },
  }

  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage,
    configurable: true,
    writable: true,
  })
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      value: memoryStorage,
      configurable: true,
      writable: true,
    })
  }
  return memoryStorage
}

function assertRectElement(
  element: AnyCanvasElement | undefined
): asserts element is AnyRectElement {
  expect(element?.kind).toBe("rect")
}

function assertLineElement(
  element: AnyCanvasElement | undefined
): asserts element is AnyLineElement {
  expect(element?.kind).toBe("line")
}

function assertCircleElement(
  element: AnyCanvasElement | undefined
): asserts element is AnyCircleElement {
  expect(element?.kind).toBe("circle")
}

function assertTriangleElement(
  element: AnyCanvasElement | undefined
): asserts element is AnyTriangleElement {
  expect(element?.kind).toBe("triangle")
}

function withLegacyRectColors(
  element: CanvasDraftElement,
  fill: string,
  stroke: string
): CanvasDraftElement {
  if (element.kind !== "rect") {
    return element
  }

  return { ...element, fill, stroke }
}

describe("canvas-editor-model monochrome contract", () => {
  const storage = getStorage()

  beforeEach(() => {
    storage.clear()
  })

  it("creates monochrome defaults for printable shapes", () => {
    const text = createCanvasElement("text", 0)
    const rect = createCanvasElement("rect", 0)
    const circle = createCanvasElement("circle", 1)
    const triangle = createCanvasElement("triangle", 2)
    const line = createCanvasElement("line", 3)

    expect(text).toMatchObject({
      kind: "text",
      fontSize: getTextNaturalHeight(DEFAULT_CANVAS_TEXT_FONT_SIZE_MILLIMETERS, 2),
      fontFamily: DEFAULT_TEXT_FONT_FAMILY,
      lineHeight: 1.2,
      verticalAlign: "top",
      stretchXGrow: false,
      stretchXShrink: true,
      stretchYGrow: false,
      stretchYShrink: false,
      autoWrap: false,
      adaptiveFontSize: true,
      verticalText: false,
    })
    expect(text.kind === "text" ? text.height : 0).toBeGreaterThan(0)
    assertRectElement(rect)
    expect(rect.fill).toBe("none")
    expect(rect.stroke).toBe("#111111")
    expect(rect.radius).toBe(0)
    assertCircleElement(circle)
    expect(circle.fill).toBe("none")
    expect(circle.stroke).toBe("#111111")
    assertTriangleElement(triangle)
    expect(triangle.fill).toBe("none")
    expect(triangle.stroke).toBe("#111111")
    assertLineElement(line)
    expect(line.stroke).toBe("#111111")
  })

  it("compiles the new text design size from millimeters to printable dots", () => {
    const draft = createDraftFromPreset(getPresetById("ops-tag"))
    const text = createCanvasElement("text", 0)
    draft.elements = [text]

    const definition = compileDraftToCanvasDefinition(draft)
    const compiledText = definition.elements[0]

    expect(compiledText).toMatchObject({
      kind: "text",
      fontSize: text.kind === "text" ? text.fontSize * CANVAS_DOTS_PER_MILLIMETER : undefined,
    })
  })

  it("preserves system template text sizes when creating editable canvas drafts", () => {
    const template = getSystemTemplateById("shipping-compact")
    const templateText = template.elements.find((element) => element.kind === "text")
    const draftText = createDraftFromSystemTemplate(template).elements.find(
      (element) => element.kind === "text"
    )

    if (templateText?.kind !== "text" || draftText?.kind !== "text") {
      throw new Error("expected system template text")
    }

    expect(draftText.fontSize).toBe(templateText.fontSize / 8)
  })

  it("compiles circle and triangle geometry to printable dots", () => {
    const draft = createDraftFromPreset(getPresetById("ops-tag"))
    draft.elements = [
      createCanvasElement("circle", 0, {
        x: 2,
        y: 3,
        size: 8,
        strokeWidth: 0.25,
      }),
      createCanvasElement("triangle", 1, {
        x: 12,
        y: 4,
        width: 10,
        height: 7,
        strokeWidth: 0.25,
        rotation: 15,
      }),
    ]

    const definition = compileDraftToCanvasDefinition(draft)
    const circle = definition.elements.find((element) => element.kind === "circle")
    const triangle = definition.elements.find((element) => element.kind === "triangle")

    assertCircleElement(circle)
    expect(circle).toMatchObject({
      x: 16,
      y: 24,
      size: 64,
      strokeWidth: 2,
    })
    assertTriangleElement(triangle)
    expect(triangle).toMatchObject({
      x: 96,
      y: 32,
      width: 80,
      height: 56,
      strokeWidth: 2,
      rotation: 15,
    })
  })

  it("keeps preset-owned rounded rectangles explicit instead of using the new rect default", () => {
    const draft = createDraftFromPreset(getPresetById("ops-tag"))
    const rect = draft.elements.find((element) => element.kind === "rect")

    assertRectElement(rect)
    expect(rect.radius).toBeGreaterThan(0)
  })

  it("normalizes stored drafts back to monochrome when loading", () => {
    const preset = getPresetById("shipping-wide")
    const draft = createDraftFromPreset(preset)
    const legacyLine = createCanvasElement("line", draft.elements.length)
    assertLineElement(legacyLine)
    draft.elements = [
      ...draft.elements.map((element) => withLegacyRectColors(element, "#fffaf4", "#7a5538")),
      { ...legacyLine, stroke: "#433024" },
    ]

    storage.setItem(`tuckmark:canvas-draft:v1:${preset.id}`, JSON.stringify(draft))

    const restored = loadStoredDraftDocument(preset.id)
    expect(restored).not.toBeNull()

    const rect = restored?.elements.find((element) => element.kind === "rect")
    const line = restored?.elements.find((element) => element.kind === "line")

    assertRectElement(rect)
    expect(rect.fill).toBe("none")
    expect(rect.stroke).toBe("#111111")
    assertLineElement(line)
    expect(line.stroke).toBe("#111111")
  })

  it("migrates legacy baseline text into top-left text containers", () => {
    const preset = getPresetById("shipping-wide")
    const draft = createDraftFromPreset(preset)
    const text = draft.elements.find((element) => element.kind === "text")
    if (text?.kind !== "text") {
      throw new Error("expected text element")
    }

    const legacyText = {
      id: text.id,
      kind: text.kind,
      x: text.x,
      y: 18,
      width: text.width,
      fontSize: text.fontSize,
      fontWeight: text.fontWeight,
      align: text.align,
      value: text.value,
      maxLines: text.maxLines,
      rotation: text.rotation,
      meta: text.meta,
      height: undefined,
      fontFamily: undefined,
      verticalAlign: undefined,
      stretchX: undefined,
      stretchY: undefined,
      autoWrap: undefined,
      verticalText: undefined,
    }
    storage.setItem(
      `tuckmark:canvas-draft:v1:${preset.id}`,
      JSON.stringify({
        ...draft,
        elements: [legacyText],
      })
    )

    const restored = loadStoredDraftDocument(preset.id)
    const restoredText = restored?.elements[0]
    expect(restoredText?.kind).toBe("text")
    if (restoredText?.kind === "text") {
      expect(restoredText.y).toBeCloseTo(18 - text.fontSize, 5)
      expect(restoredText.height).toBeGreaterThan(0)
      expect(restoredText.fontFamily).toBe(DEFAULT_TEXT_FONT_FAMILY)
      expect(restoredText.lineHeight).toBe(1.2)
      expect(restoredText.verticalAlign).toBe("top")
      expect(restoredText.stretchXGrow).toBe(false)
      expect(restoredText.stretchXShrink).toBe(false)
      expect(restoredText.stretchYGrow).toBe(false)
      expect(restoredText.stretchYShrink).toBe(false)
      expect(restoredText.autoWrap).toBe(true)
      expect(restoredText.adaptiveFontSize).toBe(false)
      expect(restoredText.verticalText).toBe(false)
    }
  })

  it("maps legacy stretch flags onto grow and shrink flags when restoring text", () => {
    const preset = getPresetById("shipping-wide")
    const draft = createDraftFromPreset(preset)
    const text = draft.elements.find((element) => element.kind === "text")
    if (text?.kind !== "text") {
      throw new Error("expected text element")
    }

    storage.setItem(
      `tuckmark:canvas-draft:v1:${preset.id}`,
      JSON.stringify({
        ...draft,
        elements: [
          {
            id: text.id,
            kind: text.kind,
            x: text.x,
            y: text.y,
            width: text.width,
            height: text.height,
            fontSize: text.fontSize,
            fontFamily: text.fontFamily,
            lineHeight: text.lineHeight,
            fontWeight: text.fontWeight,
            align: text.align,
            verticalAlign: text.verticalAlign,
            autoWrap: text.autoWrap,
            verticalText: text.verticalText,
            value: text.value,
            maxLines: text.maxLines,
            rotation: text.rotation,
            meta: text.meta,
            stretchX: true,
            stretchY: true,
          },
        ],
      })
    )

    const restored = loadStoredDraftDocument(preset.id)
    const restoredText = restored?.elements[0]
    expect(restoredText?.kind).toBe("text")
    if (restoredText?.kind === "text") {
      expect(restoredText.stretchXGrow).toBe(true)
      expect(restoredText.stretchXShrink).toBe(true)
      expect(restoredText.stretchYGrow).toBe(true)
      expect(restoredText.stretchYShrink).toBe(true)
    }
  })

  it("rewrites font size when adaptive text fitting is enabled", () => {
    const draft = createDraftFromPreset(getPresetById("ops-tag"))
    const text = draft.elements.find((element) => element.kind === "text")
    if (text?.kind !== "text") {
      throw new Error("expected text element")
    }

    draft.elements = [
      {
        ...text,
        width: 24,
        height: 10,
        fontSize: 5,
        autoWrap: true,
        adaptiveFontSize: true,
        stretchXGrow: false,
        stretchXShrink: true,
        stretchYGrow: false,
        stretchYShrink: false,
        value: "50VX7R 0402",
      },
    ]

    const compiled = compileDraftToCanvasDefinition(draft)
    const compiledText = compiled.elements[0]
    expect(compiledText?.kind).toBe("text")
    if (compiledText?.kind === "text") {
      expect(compiledText.fontSize).not.toBe(40)
      expect(compiledText.autoWrap).toBe(true)
      expect(compiledText.adaptiveFontSize).toBe(true)
    }
  })

  it("compiles printable canvas output as monochrome even if draft colors drift", () => {
    const draft = createDraftFromPreset(getPresetById("ops-tag"))
    const legacyLine = createCanvasElement("line", draft.elements.length)
    assertLineElement(legacyLine)
    draft.elements = [
      ...draft.elements.map((element) => withLegacyRectColors(element, "#f0d8c1", "#8d5d3f")),
      { ...legacyLine, stroke: "#8d5d3f" },
    ]

    const definition = compileDraftToCanvasDefinition(draft)
    const rect = definition.elements.find((element) => element.kind === "rect")
    const line = definition.elements.find((element) => element.kind === "line")

    assertRectElement(rect)
    expect(rect.fill).toBe("none")
    expect(rect.stroke).toBe("#111111")
    assertLineElement(line)
    expect(line.stroke).toBe("#111111")
  })

  it("imports agent user template packages into bindable canvas drafts", () => {
    const draft = createDraftFromUserTemplatePackage({
      schema: "tuckmark.user-template-package.v1",
      id: "ina219-module-bin",
      name: "INA219 Module Bin",
      description: "Sensor storage label",
      canvas: { width: 192, height: 96 },
      fields: [
        { key: "part", label: "Part", defaultValue: "INA226", multiline: false },
        { key: "bus", label: "Bus", defaultValue: "I2C", multiline: false },
      ],
      elements: [
        {
          kind: "text",
          key: "part",
          x: 10,
          y: 34,
          width: 172,
          fontSize: 24,
          fontWeight: "bold",
          align: "center",
          maxLines: 1,
          rotation: 0,
        },
        {
          kind: "text",
          key: "bus",
          x: 10,
          y: 66,
          width: 172,
          fontSize: 14,
          fontWeight: "normal",
          align: "center",
          maxLines: 1,
          rotation: 0,
        },
      ],
      sampleInput: { part: "INA219", bus: "I2C" },
      renderOptions: { paperType: "gap", printWidthDots: 384 },
      tags: ["electronics"],
    })

    expect(draft.name).toBe("INA219 Module Bin")
    expect(draft.source.kind).toBe("scratch")
    expect(draft.unit).toBe("mm")
    expect(draft.width).toBe(24)
    expect(draft.height).toBe(12)
    expect(draft.renderOptions).toMatchObject({ paperType: "gap", printWidthDots: 384 })
    expect(draft.fields.map((field) => field.key)).toEqual(["part", "bus"])
    expect(draft.fields[0]).toMatchObject({
      key: "part",
      defaultValue: "INA226",
      sampleValue: "INA219",
    })
    expect(draft.elements[0]).toMatchObject({
      kind: "text",
      value: "INA219",
      binding: { fieldKey: "part", kind: "text" },
    })
  })

  it("preserves imported bound element literal fallback values without samples", () => {
    const draft = createDraftFromUserTemplatePackage({
      schema: "tuckmark.user-template-package.v1",
      id: "qr-fallback-label",
      name: "QR Fallback Label",
      description: "QR label",
      canvas: { width: 192, height: 96 },
      fields: [{ key: "url", label: "URL", defaultValue: "", multiline: false }],
      elements: [
        {
          kind: "qr",
          key: "url",
          value: "https://example.test/device/ina219",
          x: 8,
          y: 8,
          size: 72,
          errorCorrectionLevel: "M",
          rotation: 0,
        },
      ],
      sampleInput: {},
      renderOptions: { paperType: "gap", printWidthDots: 384 },
      tags: ["electronics"],
    })

    expect(draft.elements[0]).toMatchObject({
      kind: "qr",
      value: "https://example.test/device/ina219",
      binding: { fieldKey: "url", kind: "qr" },
      x: 1,
      y: 1,
      size: 9,
    })
  })

  it("imports Data Matrix packages into bindable square canvas drafts", () => {
    const draft = createDraftFromUserTemplatePackage({
      schema: "tuckmark.user-template-package.v1",
      id: "rack-tag-dm",
      name: "Rack Tag DM",
      description: "Data Matrix tag",
      canvas: { width: 192, height: 96 },
      fields: [{ key: "asset", label: "Asset", defaultValue: "TM-0001", multiline: false }],
      elements: [
        {
          kind: "datamatrix",
          key: "asset",
          value: "TM-0001",
          x: 8,
          y: 8,
          size: 72,
          rotation: 0,
        },
      ],
      sampleInput: { asset: "TM-0002" },
      renderOptions: { paperType: "gap", printWidthDots: 384 },
      tags: ["ops"],
    })

    expect(draft.elements[0]).toMatchObject({
      kind: "datamatrix",
      value: "TM-0002",
      binding: { fieldKey: "asset", kind: "datamatrix" },
      x: 1,
      y: 1,
      size: 9,
    })
  })

  it("fills bound Data Matrix elements from structured canvas input", () => {
    const draft = createDraftFromUserTemplatePackage({
      schema: "tuckmark.user-template-package.v1",
      id: "rack-tag-dm",
      name: "Rack Tag DM",
      description: "Data Matrix tag",
      canvas: { width: 192, height: 96 },
      fields: [{ key: "asset", label: "Asset", defaultValue: "TM-0001", multiline: false }],
      elements: [
        {
          kind: "datamatrix",
          key: "asset",
          value: "TM-0001",
          x: 8,
          y: 8,
          size: 72,
          rotation: 0,
        },
      ],
      sampleInput: { asset: "TM-0001" },
      renderOptions: { paperType: "gap", printWidthDots: 384 },
      tags: ["ops"],
    })

    const compiled = compileDraftToFilledCanvasDefinition(draft, { asset: "TM-0099" })
    expect(compiled.elements[0]).toMatchObject({
      kind: "datamatrix",
      key: "asset",
      value: "TM-0099",
      x: 8,
      y: 8,
      size: 72,
    })
  })

  it("keeps imported package render options in canvas print sources", () => {
    const draft = createDraftFromUserTemplatePackage({
      schema: "tuckmark.user-template-package.v1",
      id: "continuous-agent-label",
      name: "Continuous Agent Label",
      description: "Continuous label",
      canvas: { width: 192, height: 96 },
      fields: [{ key: "part", label: "Part", defaultValue: "INA219", multiline: false }],
      elements: [
        {
          kind: "text",
          key: "part",
          x: 10,
          y: 34,
          width: 172,
          fontSize: 24,
          fontWeight: "bold",
          align: "center",
          maxLines: 1,
          rotation: 0,
        },
      ],
      sampleInput: { part: "INA219" },
      renderOptions: { paperType: "continuous", threshold: 80, printWidthDots: 192 },
      tags: ["electronics"],
    })

    const source = toCanvasPrintSource(draft, {
      paperType: "gap",
      threshold: 150,
      xOffsetDots: 0,
      printWidthDots: 384,
    })

    expect(source.renderOptions).toMatchObject({
      paperType: "gap",
      threshold: 150,
      printWidthDots: 384,
      previewScale: 4,
    })
  })

  it("stores canvas draft geometry in millimeters and compiles printable output to dots", () => {
    const draft = createDraftFromPreset(getPresetById("shipping-wide"))
    const rect = draft.elements.find((element) => element.kind === "rect")

    expect(draft.unit).toBe("mm")
    expect(draft.width).toBe(48)
    expect(draft.height).toBe(28)
    expect(rect).toMatchObject({
      kind: "rect",
      x: 2.5,
      y: 2.25,
      width: 43,
      height: 23,
    })

    const compiled = compileDraftToCanvasDefinition(draft)
    const compiledRect = compiled.elements.find((element) => element.kind === "rect")

    expect(compiled.width).toBe(384)
    expect(compiled.height).toBe(224)
    expect(compiledRect).toMatchObject({
      kind: "rect",
      x: 20,
      y: 18,
      width: 344,
      height: 184,
    })
  })

  it("compiles text container typography controls into printable canvas output", () => {
    const draft = createDraftFromPreset(getPresetById("ops-tag"))
    const text = draft.elements.find((element) => element.kind === "text")
    if (text?.kind !== "text") {
      throw new Error("expected text element")
    }
    draft.elements = [
      {
        ...text,
        width: 20,
        height: 8,
        fontSize: 3,
        fontFamily: "courier-new",
        lineHeight: 1.5,
        align: "right",
        verticalAlign: "bottom",
        stretchXGrow: true,
        stretchXShrink: true,
        stretchYGrow: true,
        stretchYShrink: true,
        autoWrap: false,
        adaptiveFontSize: false,
        verticalText: true,
      },
    ]

    const definition = compileDraftToCanvasDefinition(draft)
    const compiledText = definition.elements[0]
    expect(compiledText).toMatchObject({
      kind: "text",
      width: 160,
      height: 64,
      fontSize: 24,
      fontFamily: "courier-new",
      lineHeight: 1.5,
      align: "right",
      verticalAlign: "bottom",
      stretchXGrow: true,
      stretchXShrink: true,
      stretchYGrow: true,
      stretchYShrink: true,
      autoWrap: false,
      adaptiveFontSize: false,
      verticalText: true,
    })
  })

  it("persists monochrome drafts and clears preset-scoped storage", () => {
    const preset = getPresetById("shipping-wide")
    const draft = createDraftFromPreset(preset)
    draft.elements = draft.elements.map((element) =>
      withLegacyRectColors(element, "#f7eadf", "#6f4a31")
    )

    persistDraftDocument(draft)
    const stored = storage.getItem(`tuckmark:canvas-draft:v1:${preset.id}`)
    expect(stored).not.toBeNull()
    expect(stored).toContain('"fill":"none"')
    expect(stored).toContain('"stroke":"#111111"')

    clearStoredDraftDocument(preset.id)
    expect(storage.getItem(`tuckmark:canvas-draft:v1:${preset.id}`)).toBeNull()
  })

  it("aligns stage rotation origin with printable bounds center", () => {
    const text = createCanvasElement("text", 0, {
      x: 34,
      y: 90,
      width: 214,
      fontSize: 16,
      fontWeight: "normal",
      value: "Moon St 42\nBrowser City",
      maxLines: 3,
      rotation: 90,
    })
    const rect = createCanvasElement("rect", 1, {
      x: 20,
      y: 18,
      width: 344,
      height: 184,
      rotation: 12,
    })

    const textBounds = getElementBounds(text)
    const textGeometry = getElementGeometry(text)
    expect(textGeometry.stagePosition).toEqual({
      x: textBounds.x + textBounds.width / 2,
      y: textBounds.y + textBounds.height / 2,
    })

    const rectBounds = getElementBounds(rect)
    const rectGeometry = getElementGeometry(rect)
    expect(rectGeometry.stagePosition).toEqual({
      x: rectBounds.x + rectBounds.width / 2,
      y: rectBounds.y + rectBounds.height / 2,
    })
  })

  it("expands selection bounds for rotated stage elements", () => {
    const text = createCanvasElement("text", 0, {
      x: 34,
      y: 90,
      width: 214,
      fontSize: 16,
      fontWeight: "normal",
      value: "Moon St 42\nBrowser City",
      maxLines: 3,
      rotation: 90,
    })

    const bounds = getElementBounds(text)
    const selectionBounds = getElementSelectionBounds(text)

    expect(selectionBounds.x).toBeGreaterThan(bounds.x)
    expect(selectionBounds.y).toBeLessThan(bounds.y)
    expect(selectionBounds.width).toBeCloseTo(bounds.height, 5)
    expect(selectionBounds.height).toBeCloseTo(bounds.width, 5)
  })

  it("expands selection bounds for rotated triangles", () => {
    const triangle = createCanvasElement("triangle", 0, {
      x: 10,
      y: 12,
      width: 30,
      height: 18,
      rotation: 90,
    })

    const bounds = getElementBounds(triangle)
    const selectionBounds = getElementSelectionBounds(triangle)

    expect(selectionBounds.x).toBeGreaterThan(bounds.x)
    expect(selectionBounds.y).toBeLessThan(bounds.y)
    expect(selectionBounds.width).toBeCloseTo(bounds.height, 5)
    expect(selectionBounds.height).toBeCloseTo(bounds.width, 5)
  })

  it("creates bindable fields from system templates while keeping static preset values fixed", () => {
    const template = getSystemTemplateById("shipping-compact")
    const draft = createDraftFromSystemTemplate(template)

    expect(draft.source.kind).toBe("preset-template")
    expect(draft.fields.length).toBeGreaterThan(0)

    const titleElement = draft.elements.find(
      (element) => element.kind === "text" && element.meta.name.includes("标题")
    )
    if (titleElement?.kind === "text") {
      expect(titleElement.binding).toBeUndefined()
    }

    const firstBoundElement = draft.elements.find(
      (element) =>
        (element.kind === "text" || element.kind === "barcode" || element.kind === "qr") &&
        element.binding
    )
    expect(firstBoundElement).toBeDefined()
    expect(draft.fields.some((field) => field.key === firstBoundElement?.binding?.fieldKey)).toBe(
      true
    )
  })

  it("assigns a fallback width to widthless system template text elements when imported", () => {
    const template = getSystemTemplateById("shipping-compact")
    const draft = createDraftFromSystemTemplate(template)

    const recipient = draft.elements.find(
      (element) => element.kind === "text" && element.binding?.fieldKey === "recipient"
    )
    if (recipient?.kind !== "text") {
      throw new Error("expected recipient element")
    }
    expect(recipient.width).toBe(22.5)
  })

  it("seeds system template bound elements from field labels when defaults are absent", () => {
    const template = getSystemTemplateById("cable-tag")
    const draft = createDraftFromSystemTemplate(template)

    const nameText = draft.elements.find(
      (element) => element.kind === "text" && element.binding?.fieldKey === "name"
    )
    const portText = draft.elements.find(
      (element) => element.kind === "text" && element.binding?.fieldKey === "port"
    )
    const locationText = draft.elements.find(
      (element) => element.kind === "text" && element.binding?.fieldKey === "location"
    )
    const nameQr = draft.elements.find(
      (element) => element.kind === "qr" && element.binding?.fieldKey === "name"
    )

    expect(nameText?.kind === "text" ? nameText.value : undefined).toBe("Name")
    expect(portText?.kind === "text" ? portText.value : undefined).toBe("Port")
    expect(locationText?.kind === "text" ? locationText.value : undefined).toBe("Location")
    expect(nameQr?.kind === "qr" ? nameQr.value : undefined).toBe("Name")
    expect(draft.fields.map((field) => [field.key, field.defaultValue])).toEqual(
      expect.arrayContaining([
        ["name", ""],
        ["port", ""],
        ["location", ""],
      ])
    )
    expect(nameText?.kind === "text" ? nameText.width : undefined).toBe(22.5)
    expect(portText?.kind === "text" ? portText.width : undefined).toBe(22.5)
    expect(locationText?.kind === "text" ? locationText.width : undefined).toBe(20)
  })

  it("migrates stored preset-template drafts with empty field defaults back to template labels", () => {
    const template = getSystemTemplateById("cable-tag")
    const draft = createDraftFromSystemTemplate(template)
    const legacyDraft = {
      ...draft,
      fields: draft.fields.map((field) => ({ ...field, defaultValue: "" })),
      elements: draft.elements.map((element) =>
        element.kind === "text" || element.kind === "qr" ? { ...element, value: "" } : element
      ),
    }

    const normalized = normalizeDraftDocument(legacyDraft)
    const nameText = normalized.elements.find(
      (element) => element.kind === "text" && element.binding?.fieldKey === "name"
    )
    const portText = normalized.elements.find(
      (element) => element.kind === "text" && element.binding?.fieldKey === "port"
    )
    const locationText = normalized.elements.find(
      (element) => element.kind === "text" && element.binding?.fieldKey === "location"
    )
    const nameQr = normalized.elements.find(
      (element) => element.kind === "qr" && element.binding?.fieldKey === "name"
    )

    expect(nameText?.kind === "text" ? nameText.value : undefined).toBe("Name")
    expect(portText?.kind === "text" ? portText.value : undefined).toBe("Port")
    expect(locationText?.kind === "text" ? locationText.value : undefined).toBe("Location")
    expect(nameQr?.kind === "qr" ? nameQr.value : undefined).toBe("Name")
    expect(normalized.fields.map((field) => [field.key, field.defaultValue])).toEqual(
      expect.arrayContaining([
        ["name", ""],
        ["port", ""],
        ["location", ""],
      ])
    )
  })

  it("syncs multiple bound elements from the same field input", () => {
    const draft = createDraftFromPreset(getPresetById("shipping-wide"))
    const textElements = draft.elements.filter((element) => element.kind === "text")
    expect(textElements.length).toBeGreaterThanOrEqual(2)
    const [firstTextElement, secondTextElement] = textElements
    const firstTextId = firstTextElement?.id
    const secondTextId = secondTextElement?.id
    if (!firstTextId || !secondTextId) {
      throw new Error("expected at least two text elements in shipping-wide preset")
    }

    let next = toggleElementBinding(draft, firstTextId, true)
    const fieldKey = next.fields[0]?.key
    expect(fieldKey).toBeTruthy()
    if (!fieldKey) {
      throw new Error("expected the first bound field to expose a stable key")
    }
    next = bindElementToExistingField(next, secondTextId, fieldKey)

    const compiled = compileDraftToFilledCanvasDefinition(next, {
      [fieldKey]: "Shared replacement",
    })

    const compiledTexts = compiled.elements.filter((element) => element.kind === "text")
    const matched = compiledTexts.filter((element) => element.value === "Shared replacement")
    expect(matched.length).toBeGreaterThanOrEqual(2)
  })

  it("builds template fields from the draft field registry", () => {
    const draft = createDraftFromPreset(getPresetById("ops-tag"))
    const qrElement = draft.elements.find((element) => element.kind === "qr")
    expect(qrElement).toBeDefined()
    const qrElementId = qrElement?.id
    if (!qrElementId) {
      throw new Error("expected ops-tag preset to include a qr element")
    }

    const bound = toggleElementBinding(draft, qrElementId, true)
    const fields = buildTemplateFieldsFromDraft(bound)

    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({
      required: false,
      key: bound.fields[0]?.key,
      label: bound.fields[0]?.label,
      multiline: bound.fields[0]?.multiline,
      defaultValue: bound.fields[0]?.defaultValue,
    })
  })

  it("drops orphaned bound fields after generic element deletion is normalized", () => {
    const draft = createDraftFromPreset(getPresetById("shipping-wide"))
    const textElement = draft.elements.find((element) => element.kind === "text")
    if (!textElement) {
      throw new Error("expected shipping-wide preset to include a text element")
    }

    const bound = toggleElementBinding(draft, textElement.id, true)
    const deleted = normalizeDraftDocument({
      ...bound,
      elements: bound.elements.filter((element) => element.id !== textElement.id),
    })

    expect(deleted.fields).toHaveLength(0)
  })

  it("rewrites bindings when duplicated elements are normalized", () => {
    const draft = createDraftFromPreset(getPresetById("shipping-wide"))
    const textElement = draft.elements.find((element) => element.kind === "text")
    if (!textElement) {
      throw new Error("expected shipping-wide preset to include a text element")
    }

    const bound = toggleElementBinding(draft, textElement.id, true)
    const fieldKey = bound.fields[0]?.key
    if (!fieldKey) {
      throw new Error("expected bound field key")
    }

    const duplicate = {
      ...textElement,
      id: `${textElement.id}-copy`,
      binding: { fieldKey, kind: "text" as const },
      value: "Different stale value",
    }
    const normalized = normalizeDraftDocument({
      ...bound,
      elements: [...bound.elements, duplicate],
    })

    expect(normalized.fields[0]?.bindings).toEqual(
      expect.arrayContaining([textElement.id, `${textElement.id}-copy`])
    )
    const normalizedDuplicate = normalized.elements.find(
      (element) => element.id === `${textElement.id}-copy`
    )
    expect(normalizedDuplicate?.kind).toBe("text")
    if (normalizedDuplicate?.kind === "text") {
      expect(normalizedDuplicate.value).toBe(normalized.fields[0]?.defaultValue)
    }
  })
})
