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

export function millimetersToDotsAtDensity(millimeters: number, dotsPerMillimeter: number): number {
  return Math.round(millimeters * dotsPerMillimeter)
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

function scaleDraftElementGeometryToDots(
  element: CanvasDraftElement,
  dotsPerMillimeter: number
): CanvasDraftElement {
  switch (element.kind) {
    case "text":
      return {
        ...element,
        x: millimetersToDotsAtDensity(element.x, dotsPerMillimeter),
        y: millimetersToDotsAtDensity(element.y, dotsPerMillimeter),
        width: millimetersToDotsAtDensity(element.width, dotsPerMillimeter),
        height: millimetersToDotsAtDensity(element.height, dotsPerMillimeter),
        fontSize: millimetersToDotsAtDensity(element.fontSize, dotsPerMillimeter),
      }
    case "rect":
      return {
        ...element,
        x: millimetersToDotsAtDensity(element.x, dotsPerMillimeter),
        y: millimetersToDotsAtDensity(element.y, dotsPerMillimeter),
        width: millimetersToDotsAtDensity(element.width, dotsPerMillimeter),
        height: millimetersToDotsAtDensity(element.height, dotsPerMillimeter),
        strokeWidth: millimetersToDotsAtDensity(element.strokeWidth, dotsPerMillimeter),
        radius: millimetersToDotsAtDensity(element.radius, dotsPerMillimeter),
      }
    case "circle":
      return {
        ...element,
        x: millimetersToDotsAtDensity(element.x, dotsPerMillimeter),
        y: millimetersToDotsAtDensity(element.y, dotsPerMillimeter),
        size: millimetersToDotsAtDensity(element.size, dotsPerMillimeter),
        strokeWidth: millimetersToDotsAtDensity(element.strokeWidth, dotsPerMillimeter),
      }
    case "triangle":
      return {
        ...element,
        x: millimetersToDotsAtDensity(element.x, dotsPerMillimeter),
        y: millimetersToDotsAtDensity(element.y, dotsPerMillimeter),
        width: millimetersToDotsAtDensity(element.width, dotsPerMillimeter),
        height: millimetersToDotsAtDensity(element.height, dotsPerMillimeter),
        strokeWidth: millimetersToDotsAtDensity(element.strokeWidth, dotsPerMillimeter),
      }
    case "line":
      return {
        ...element,
        x: millimetersToDotsAtDensity(element.x, dotsPerMillimeter),
        y: millimetersToDotsAtDensity(element.y, dotsPerMillimeter),
        x2: millimetersToDotsAtDensity(element.x2, dotsPerMillimeter),
        y2: millimetersToDotsAtDensity(element.y2, dotsPerMillimeter),
        strokeWidth: millimetersToDotsAtDensity(element.strokeWidth, dotsPerMillimeter),
      }
    case "barcode":
      return {
        ...element,
        x: millimetersToDotsAtDensity(element.x, dotsPerMillimeter),
        y: millimetersToDotsAtDensity(element.y, dotsPerMillimeter),
        width: millimetersToDotsAtDensity(element.width, dotsPerMillimeter),
        height: millimetersToDotsAtDensity(element.height, dotsPerMillimeter),
      }
    case "qr":
    case "datamatrix":
      return {
        ...element,
        x: millimetersToDotsAtDensity(element.x, dotsPerMillimeter),
        y: millimetersToDotsAtDensity(element.y, dotsPerMillimeter),
        size: millimetersToDotsAtDensity(element.size, dotsPerMillimeter),
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

function canonicalizeCanvasDraftDocument(document: CanvasDraftDocument): CanvasDraftDocument {
  const hasDescription = Object.getOwnPropertyDescriptor(document, "description") !== undefined
  const hasRecommendedUse =
    Object.getOwnPropertyDescriptor(document, "recommendedUse") !== undefined
  return {
    version: document.version,
    unit: "mm",
    id: document.id,
    presetId: document.presetId,
    name: document.name,
    ...(hasDescription ? { description: document.description } : {}),
    source: document.source,
    ...(document.templateId ? { templateId: document.templateId } : {}),
    ...(document.baseVersionId ? { baseVersionId: document.baseVersionId } : {}),
    ...(document.lastSavedAt ? { lastSavedAt: document.lastSavedAt } : {}),
    width: document.width,
    height: document.height,
    ...(document.renderOptions ? { renderOptions: document.renderOptions } : {}),
    ...(document.tags ? { tags: document.tags } : {}),
    ...(hasRecommendedUse ? { recommendedUse: document.recommendedUse } : {}),
    fields: document.fields,
    elements: document.elements,
    editor: document.editor,
  }
}

export function canvasDraftDocumentFromDots(document: CanvasDraftDocument): CanvasDraftDocument {
  const scale = 1 / CANVAS_DOTS_PER_MILLIMETER
  return canonicalizeCanvasDraftDocument({
    ...document,
    unit: "mm",
    width: scaleValue(document.width, scale),
    height: scaleValue(document.height, scale),
    elements: document.elements.map((element) => scaleDraftElementGeometry(element, scale)),
  })
}

export function normalizeCanvasDraftDocumentUnits(
  document: CanvasDraftDocument
): CanvasDraftDocument {
  return document.unit === "mm"
    ? canonicalizeCanvasDraftDocument(document)
    : canvasDraftDocumentFromDots(document)
}

export function canvasDraftDocumentToDots(document: CanvasDraftDocument): CanvasDraftDocument {
  return canvasDraftDocumentToDotsAtDensity(document, CANVAS_DOTS_PER_MILLIMETER)
}

export function canvasDraftDocumentToDotsAtDensity(
  document: CanvasDraftDocument,
  dotsPerMillimeter: number
): CanvasDraftDocument {
  const normalized = normalizeCanvasDraftDocumentUnits(document)
  return {
    ...normalized,
    width: millimetersToDotsAtDensity(normalized.width, dotsPerMillimeter),
    height: millimetersToDotsAtDensity(normalized.height, dotsPerMillimeter),
    elements: normalized.elements.map((element) =>
      scaleDraftElementGeometryToDots(element, dotsPerMillimeter)
    ),
  }
}
