// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest"

import {
  clearStoredDraftDocument,
  compileDraftToCanvasDefinition,
  createCanvasElement,
  createDraftFromPreset,
  getPresetById,
  loadStoredDraftDocument,
  persistDraftDocument,
} from "./canvas-editor-model.js"
import type { CanvasDraftElement } from "./types.js"

type CompiledCanvasElement = ReturnType<typeof compileDraftToCanvasDefinition>["elements"][number]
type AnyCanvasElement = CanvasDraftElement | CompiledCanvasElement
type AnyRectElement = Extract<AnyCanvasElement, { kind: "rect" }>
type AnyLineElement = Extract<AnyCanvasElement, { kind: "line" }>

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
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("creates monochrome defaults for printable shapes", () => {
    const rect = createCanvasElement("rect", 0)
    const line = createCanvasElement("line", 1)

    assertRectElement(rect)
    expect(rect.fill).toBe("none")
    expect(rect.stroke).toBe("#111111")
    assertLineElement(line)
    expect(line.stroke).toBe("#111111")
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

    window.localStorage.setItem(`tuckmark:canvas-draft:v1:${preset.id}`, JSON.stringify(draft))

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

  it("persists monochrome drafts and clears preset-scoped storage", () => {
    const preset = getPresetById("shipping-wide")
    const draft = createDraftFromPreset(preset)
    draft.elements = draft.elements.map((element) =>
      withLegacyRectColors(element, "#f7eadf", "#6f4a31")
    )

    persistDraftDocument(draft)
    const stored = window.localStorage.getItem(`tuckmark:canvas-draft:v1:${preset.id}`)
    expect(stored).not.toBeNull()
    expect(stored).toContain('"fill":"none"')
    expect(stored).toContain('"stroke":"#111111"')

    clearStoredDraftDocument(preset.id)
    expect(window.localStorage.getItem(`tuckmark:canvas-draft:v1:${preset.id}`)).toBeNull()
  })
})
