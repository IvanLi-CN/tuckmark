import type { TemplateElement } from "../../../../packages/core/src/web.js"
import type { CanvasDraftDocument, CanvasDraftElement } from "../types.js"

export const CANVAS_DOTS_PER_MILLIMETER = 8

function roundPhysicalUnit(value: number): number {
  return Number(value.toFixed(4))
}

export function canvasDotsToMillimeters(dots: number): number {
  return roundPhysicalUnit(dots / CANVAS_DOTS_PER_MILLIMETER)
}

export function canvasMillimetersToDots(millimeters: number): number {
  return Math.round(millimeters * CANVAS_DOTS_PER_MILLIMETER)
}

function scaleValue(value: number, scale: number): number {
  return roundPhysicalUnit(value * scale)
}

export function scaleDraftElementGeometry(
  element: CanvasDraftElement,
  scale: number
): CanvasDraftElement {
  switch (element.kind) {
    case "text":
      return {
        ...element,
        x: scaleValue(element.x, scale),
        y: scaleValue(element.y, scale),
        width: scaleValue(element.width, scale),
        height: scaleValue(element.height, scale),
        fontSize: scaleValue(element.fontSize, scale),
      }
    case "rect":
      return {
        ...element,
        x: scaleValue(element.x, scale),
        y: scaleValue(element.y, scale),
        width: scaleValue(element.width, scale),
        height: scaleValue(element.height, scale),
        strokeWidth: scaleValue(element.strokeWidth, scale),
        radius: scaleValue(element.radius, scale),
      }
    case "circle":
      return {
        ...element,
        x: scaleValue(element.x, scale),
        y: scaleValue(element.y, scale),
        size: scaleValue(element.size, scale),
        strokeWidth: scaleValue(element.strokeWidth, scale),
      }
    case "triangle":
      return {
        ...element,
        x: scaleValue(element.x, scale),
        y: scaleValue(element.y, scale),
        width: scaleValue(element.width, scale),
        height: scaleValue(element.height, scale),
        strokeWidth: scaleValue(element.strokeWidth, scale),
      }
    case "line":
      return {
        ...element,
        x: scaleValue(element.x, scale),
        y: scaleValue(element.y, scale),
        x2: scaleValue(element.x2, scale),
        y2: scaleValue(element.y2, scale),
        strokeWidth: scaleValue(element.strokeWidth, scale),
      }
    case "barcode":
      return {
        ...element,
        x: scaleValue(element.x, scale),
        y: scaleValue(element.y, scale),
        width: scaleValue(element.width, scale),
        height: scaleValue(element.height, scale),
      }
    case "qr":
    case "datamatrix":
      return {
        ...element,
        x: scaleValue(element.x, scale),
        y: scaleValue(element.y, scale),
        size: scaleValue(element.size, scale),
      }
  }
}

export function scaleTemplateElementGeometry(
  element: TemplateElement,
  scale: number
): TemplateElement {
  switch (element.kind) {
    case "text":
      return {
        ...element,
        x: scaleValue(element.x, scale),
        y: scaleValue(element.y, scale),
        width: element.width === undefined ? undefined : scaleValue(element.width, scale),
        height: element.height === undefined ? undefined : scaleValue(element.height, scale),
        fontSize: scaleValue(element.fontSize, scale),
      }
    case "rect":
      return {
        ...element,
        x: scaleValue(element.x, scale),
        y: scaleValue(element.y, scale),
        width: scaleValue(element.width, scale),
        height: scaleValue(element.height, scale),
        strokeWidth: scaleValue(element.strokeWidth, scale),
        radius: scaleValue(element.radius, scale),
      }
    case "circle":
      return {
        ...element,
        x: scaleValue(element.x, scale),
        y: scaleValue(element.y, scale),
        size: scaleValue(element.size, scale),
        strokeWidth: scaleValue(element.strokeWidth, scale),
      }
    case "triangle":
      return {
        ...element,
        x: scaleValue(element.x, scale),
        y: scaleValue(element.y, scale),
        width: scaleValue(element.width, scale),
        height: scaleValue(element.height, scale),
        strokeWidth: scaleValue(element.strokeWidth, scale),
      }
    case "line":
      return {
        ...element,
        x1: scaleValue(element.x1, scale),
        y1: scaleValue(element.y1, scale),
        x2: scaleValue(element.x2, scale),
        y2: scaleValue(element.y2, scale),
        strokeWidth: scaleValue(element.strokeWidth, scale),
      }
    case "barcode":
      return {
        ...element,
        x: scaleValue(element.x, scale),
        y: scaleValue(element.y, scale),
        width: scaleValue(element.width, scale),
        height: scaleValue(element.height, scale),
      }
    case "qr":
    case "datamatrix":
      return {
        ...element,
        x: scaleValue(element.x, scale),
        y: scaleValue(element.y, scale),
        size: scaleValue(element.size, scale),
      }
  }
}

export function canvasDraftDocumentFromDots(document: CanvasDraftDocument): CanvasDraftDocument {
  const scale = 1 / CANVAS_DOTS_PER_MILLIMETER
  return {
    ...document,
    unit: "mm",
    width: scaleValue(document.width, scale),
    height: scaleValue(document.height, scale),
    elements: document.elements.map((element) => scaleDraftElementGeometry(element, scale)),
  }
}

export function normalizeCanvasDraftDocumentUnits(
  document: CanvasDraftDocument
): CanvasDraftDocument {
  return document.unit === "mm"
    ? { ...document, unit: "mm" }
    : canvasDraftDocumentFromDots(document)
}

export function canvasDraftDocumentToDots(document: CanvasDraftDocument): CanvasDraftDocument {
  const normalized = normalizeCanvasDraftDocumentUnits(document)
  return {
    ...normalized,
    width: canvasMillimetersToDots(normalized.width),
    height: canvasMillimetersToDots(normalized.height),
    elements: normalized.elements.map((element) =>
      scaleDraftElementGeometry(element, CANVAS_DOTS_PER_MILLIMETER)
    ),
  }
}
