import JsBarcode from "jsbarcode"
import QRCode from "qrcode"

import { encodeDataMatrix } from "./data-matrix.js"
import {
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_VERTICAL_ALIGN,
  estimateTextLineWidth,
  getTextFontFamilyStack,
  getTextNaturalHeight,
  resolveTextLayout,
  wrapTextByWidth,
} from "./text-layout.js"
import type { TemplateElement } from "./types.js"

type RenderInput = Record<string, string>

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/\.?0+$/, "")
}

function wrapMarkupWithRotation(
  markup: string,
  rotation: number | undefined,
  originX: number,
  originY: number
): string {
  if (!rotation) {
    return markup
  }

  return `<g transform="rotate(${formatNumber(rotation)} ${formatNumber(originX)} ${formatNumber(originY)})">${markup}</g>`
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function renderTextElement(
  element: Extract<TemplateElement, { kind: "text" }>,
  input: RenderInput
): string {
  const resolved = element.value ?? input[element.key] ?? ""
  const hasExplicitWidth = element.width !== undefined
  const legacyLines = wrapTextByWidth(
    resolved,
    element.fontSize,
    element.width,
    element.maxLines,
    element.autoWrap ?? true,
    element.fontFamily
  )
  const width =
    element.width ??
    Math.max(
      ...legacyLines.map((line) =>
        estimateTextLineWidth(line, element.fontSize, element.fontFamily)
      ),
      0.0001
    )
  const legacyLineCount = Math.max(
    hasExplicitWidth
      ? wrapTextByWidth(
          resolved,
          element.fontSize,
          width,
          element.maxLines,
          element.autoWrap ?? true,
          element.fontFamily
        ).length
      : legacyLines.length,
    1
  )
  const height =
    element.height ?? getTextNaturalHeight(element.fontSize, legacyLineCount, element.lineHeight)
  const containerX = (() => {
    if (hasExplicitWidth) {
      return element.x
    }
    switch (element.align) {
      case "center":
        return element.x - width / 2
      case "right":
        return element.x - width
      default:
        return element.x
    }
  })()
  const layout =
    element.resolvedLayout ??
    resolveTextLayout({
      text: resolved,
      fontSize: element.fontSize,
      width,
      height,
      lineHeight: element.lineHeight,
      fontFamily: element.fontFamily,
      fontWeight: element.fontWeight,
      align: element.align,
      maxLines: element.maxLines,
      verticalAlign: element.verticalAlign ?? DEFAULT_TEXT_VERTICAL_ALIGN,
      stretchXGrow: element.stretchXGrow,
      stretchXShrink: element.stretchXShrink,
      stretchYGrow: element.stretchYGrow,
      stretchYShrink: element.stretchYShrink,
      stretchX: element.stretchX ?? false,
      stretchY: element.stretchY ?? false,
      autoWrap: element.autoWrap ?? true,
      adaptiveFontSize: element.adaptiveFontSize ?? false,
      verticalText: element.verticalText ?? false,
    })
  const containerY =
    element.height === undefined && !layout.verticalText
      ? element.y - layout.baselineOffsetY
      : element.height === undefined
        ? element.y - layout.resolvedFontSize
        : element.y
  const transform = [
    `translate(${formatNumber(layout.contentX)} ${formatNumber(layout.contentY)})`,
    layout.scaleX !== 1 || layout.scaleY !== 1
      ? `scale(${formatNumber(layout.scaleX)} ${formatNumber(layout.scaleY)})`
      : "",
  ]
    .filter(Boolean)
    .join(" ")
  const fontFamily = escapeXml(
    getTextFontFamilyStack(element.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY)
  )
  const textMarkup = layout.verticalText
    ? layout.glyphs
        .map(
          (glyph) =>
            `<text x="${formatNumber(glyph.x)}" y="${formatNumber(glyph.y + layout.baselineOffsetY)}" font-size="${formatNumber(layout.resolvedFontSize)}" font-weight="${element.fontWeight}" text-anchor="middle" font-family="${fontFamily}" fill="#111111">${escapeXml(glyph.text)}</text>`
        )
        .join("")
    : layout.lineLayouts
        .map((line) => {
          const visualWidth = line.visualWidth ?? line.width
          const widthLockAttrs =
            element.resolvedLayout && visualWidth > 0
              ? ` textLength="${formatNumber(visualWidth)}" lengthAdjust="spacingAndGlyphs"`
              : ""
          const justifyAttrs =
            line.letterSpacing > 0
              ? ` textLength="${formatNumber(width)}" lengthAdjust="spacing"`
              : ""
          return `<text x="${formatNumber(line.x)}" y="${formatNumber(line.y)}" font-size="${formatNumber(layout.resolvedFontSize)}" font-weight="${element.fontWeight}" text-anchor="start" font-family="${fontFamily}" fill="#111111"${justifyAttrs || widthLockAttrs}>${escapeXml(line.text)}</text>`
        })
        .join("")
  const contentMarkup = `<g transform="${transform}">${textMarkup}</g>`
  const markup = `<svg x="${formatNumber(containerX)}" y="${formatNumber(containerY)}" width="${formatNumber(width)}" height="${formatNumber(height)}" overflow="hidden">${contentMarkup}</svg>`

  const originX = containerX + width / 2
  const originY = containerY + height / 2

  return wrapMarkupWithRotation(markup, element.rotation, originX, originY)
}

type ValueBackedElement = Extract<
  TemplateElement,
  { kind: "text" | "barcode" | "qr" | "datamatrix" }
>

function resolveElementValue(element: ValueBackedElement, input: RenderInput): string {
  return (element.value ?? input[element.key] ?? "").trim()
}

function buildBarcodeMarkup(
  element: Extract<TemplateElement, { kind: "barcode" }>,
  input: RenderInput
): string {
  const value = resolveElementValue(element, input)
  if (value.length === 0) {
    throw new Error(`Barcode value is required for key: ${element.key}`)
  }

  try {
    const encoded: {
      encodings?: Array<{
        data: string
        options: {
          width: number
          marginLeft?: number
          marginTop?: number
          height: number
        }
      }>
    } = {}

    JsBarcode(encoded, value, {
      format: element.format,
      displayValue: element.showValue,
      margin: 0,
      background: "#ffffff",
      lineColor: "#111111",
      width: 2,
      height: Math.max(8, Math.round(element.height)),
      fontSize: Math.max(10, Math.round(element.height * 0.18)),
      textMargin: Math.max(2, Math.round(element.height * 0.05)),
    })
    const barcode = encoded.encodings?.[0]
    if (!barcode) {
      throw new Error("JsBarcode returned no encodings")
    }

    const bars: string[] = []
    const marginLeft = barcode.options.marginLeft ?? 0
    const marginTop = barcode.options.marginTop ?? 0
    let cursor = marginLeft

    for (const bit of barcode.data) {
      if (bit === "1") {
        bars.push(
          `<rect x="${cursor}" y="${marginTop}" width="${barcode.options.width}" height="${barcode.options.height}" fill="#111111" />`
        )
      }
      cursor += barcode.options.width
    }

    const viewWidth = cursor + marginLeft
    const viewHeight = barcode.options.height + marginTop * 2
    const markup = `<svg x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" viewBox="0 0 ${viewWidth} ${viewHeight}" preserveAspectRatio="none"><rect width="${viewWidth}" height="${viewHeight}" fill="#ffffff" />${bars.join("")}</svg>`
    return wrapMarkupWithRotation(
      markup,
      element.rotation,
      element.x + element.width / 2,
      element.y + element.height / 2
    )
  } catch (cause) {
    throw new Error(
      `Failed to render CODE128 barcode "${element.key}": ${cause instanceof Error ? cause.message : String(cause)}`
    )
  }
}

function buildQrMarkup(
  element: Extract<TemplateElement, { kind: "qr" }>,
  input: RenderInput
): string {
  const value = resolveElementValue(element, input)
  if (value.length === 0) {
    throw new Error(`QR value is required for key: ${element.key}`)
  }

  try {
    const qr = QRCode.create(value, {
      errorCorrectionLevel: element.errorCorrectionLevel,
    })
    const moduleSize = qr.modules.size
    const modules = qr.modules.data
    const cell = element.size / moduleSize
    const rects: string[] = []

    for (let row = 0; row < moduleSize; row += 1) {
      for (let column = 0; column < moduleSize; column += 1) {
        if (!modules[row * moduleSize + column]) {
          continue
        }
        rects.push(
          `<rect x="${(column * cell).toFixed(4)}" y="${(row * cell).toFixed(4)}" width="${cell.toFixed(4)}" height="${cell.toFixed(4)}" fill="#111111" />`
        )
      }
    }

    const markup = `<svg x="${element.x}" y="${element.y}" width="${element.size}" height="${element.size}" viewBox="0 0 ${element.size} ${element.size}" preserveAspectRatio="none"><rect width="${element.size}" height="${element.size}" fill="#ffffff" />${rects.join("")}</svg>`
    return wrapMarkupWithRotation(
      markup,
      element.rotation,
      element.x + element.size / 2,
      element.y + element.size / 2
    )
  } catch (cause) {
    throw new Error(
      `Failed to render QR "${element.key}": ${cause instanceof Error ? cause.message : String(cause)}`
    )
  }
}

function buildDataMatrixMarkup(
  element: Extract<TemplateElement, { kind: "datamatrix" }>,
  input: RenderInput
): string {
  const value = element.value ?? input[element.key] ?? ""
  if (value.trim().length === 0) {
    throw new Error(`Data Matrix value is required for key: ${element.key}`)
  }

  try {
    const encoding = encodeDataMatrix(value)
    const cell = element.size / encoding.moduleCount
    const rects: string[] = []

    for (let row = 0; row < encoding.moduleCount; row += 1) {
      for (let column = 0; column < encoding.moduleCount; column += 1) {
        if (!encoding.modules[row * encoding.moduleCount + column]) {
          continue
        }
        rects.push(
          `<rect x="${(column * cell).toFixed(4)}" y="${(row * cell).toFixed(4)}" width="${cell.toFixed(4)}" height="${cell.toFixed(4)}" fill="#111111" />`
        )
      }
    }

    const markup = `<svg x="${element.x}" y="${element.y}" width="${element.size}" height="${element.size}" viewBox="0 0 ${element.size} ${element.size}" preserveAspectRatio="none"><rect width="${element.size}" height="${element.size}" fill="#ffffff" />${rects.join("")}</svg>`
    return wrapMarkupWithRotation(
      markup,
      element.rotation,
      element.x + element.size / 2,
      element.y + element.size / 2
    )
  } catch (cause) {
    throw new Error(
      `Failed to render Data Matrix "${element.key}": ${cause instanceof Error ? cause.message : String(cause)}`
    )
  }
}

function renderElement(element: TemplateElement, input: RenderInput): string {
  switch (element.kind) {
    case "text":
      return renderTextElement(element, input)
    case "rect":
      return wrapMarkupWithRotation(
        `<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="${element.radius}" ry="${element.radius}" fill="${element.fill}" stroke="${element.stroke}" stroke-width="${element.strokeWidth}" />`,
        element.rotation,
        element.x + element.width / 2,
        element.y + element.height / 2
      )
    case "circle":
      return `<circle cx="${element.x + element.size / 2}" cy="${element.y + element.size / 2}" r="${element.size / 2}" fill="${element.fill}" stroke="${element.stroke}" stroke-width="${element.strokeWidth}" />`
    case "triangle":
      return wrapMarkupWithRotation(
        `<polygon points="${element.x + element.width / 2},${element.y} ${element.x + element.width},${element.y + element.height} ${element.x},${element.y + element.height}" fill="${element.fill}" stroke="${element.stroke}" stroke-width="${element.strokeWidth}" />`,
        element.rotation,
        element.x + element.width / 2,
        element.y + element.height / 2
      )
    case "line":
      return `<line x1="${element.x1}" y1="${element.y1}" x2="${element.x2}" y2="${element.y2}" stroke="${element.stroke}" stroke-width="${element.strokeWidth}" />`
    case "barcode":
      return buildBarcodeMarkup(element, input)
    case "qr":
      return buildQrMarkup(element, input)
    case "datamatrix":
      return buildDataMatrixMarkup(element, input)
  }
}

export function buildSvg(
  width: number,
  height: number,
  elements: TemplateElement[],
  input: RenderInput
): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="white" />`,
    elements.map((element) => renderElement(element, input)).join(""),
    "</svg>",
  ].join("")
}
