import JsBarcode from "jsbarcode"
import QRCode from "qrcode"

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

export function wrapText(text: string, maxCharsPerLine: number, maxLines?: number): string[] {
  const normalized = text.replaceAll("\r\n", "\n").split("\n")
  const lines: string[] = []
  for (const chunk of normalized) {
    if (chunk.length === 0) {
      lines.push("")
      continue
    }
    let current = ""
    for (const token of chunk.split(/\s+/)) {
      const candidate = current ? `${current} ${token}` : token
      if (candidate.length > maxCharsPerLine && current) {
        lines.push(current)
        current = token
      } else {
        current = candidate
      }
    }
    if (current) {
      lines.push(current)
    }
  }
  return maxLines ? lines.slice(0, maxLines) : lines
}

export function estimateCharsPerLine(fontSize: number, width?: number): number {
  if (!width) {
    return 100
  }
  return Math.max(4, Math.floor(width / (fontSize * 0.6)))
}

function renderTextElement(
  element: Extract<TemplateElement, { kind: "text" }>,
  input: RenderInput
): string {
  const resolved = element.value ?? input[element.key] ?? ""
  const escaped = escapeXml(resolved)
  const lines = wrapText(
    escaped,
    estimateCharsPerLine(element.fontSize, element.width),
    element.maxLines
  )

  const anchor = element.align === "center" ? "middle" : element.align === "right" ? "end" : "start"
  const x =
    element.align === "center" && element.width
      ? element.x + element.width / 2
      : element.align === "right" && element.width
        ? element.x + element.width
        : element.x

  const markup = lines
    .map((line, index) => {
      const y = element.y + index * (element.fontSize + 4)
      return `<text x="${x}" y="${y}" font-size="${element.fontSize}" font-weight="${element.fontWeight}" text-anchor="${anchor}" font-family="ui-sans-serif, system-ui, sans-serif" fill="#111111">${line}</text>`
    })
    .join("")

  const width = element.width ?? Math.max(1, estimateCharsPerLine(element.fontSize, element.width))
  const lineHeight = element.fontSize + 4
  const lineCount = Math.max(lines.length, 1)
  const originX = element.x + width / 2
  const originY = element.y + (lineCount * lineHeight - 4) / 2

  return wrapMarkupWithRotation(markup, element.rotation, originX, originY)
}

type ValueBackedElement = Extract<TemplateElement, { kind: "text" | "barcode" | "qr" }>

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
    case "line":
      return `<line x1="${element.x1}" y1="${element.y1}" x2="${element.x2}" y2="${element.y2}" stroke="${element.stroke}" stroke-width="${element.strokeWidth}" />`
    case "barcode":
      return buildBarcodeMarkup(element, input)
    case "qr":
      return buildQrMarkup(element, input)
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
