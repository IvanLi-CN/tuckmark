import type { TemplateElement } from "./types.js"

type RenderInput = Record<string, string>

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

  return lines
    .map((line, index) => {
      const y = element.y + index * (element.fontSize + 4)
      return `<text x="${x}" y="${y}" font-size="${element.fontSize}" font-weight="${element.fontWeight}" text-anchor="${anchor}" font-family="ui-sans-serif, system-ui, sans-serif" fill="#111111">${line}</text>`
    })
    .join("")
}

function renderElement(element: TemplateElement, input: RenderInput): string {
  switch (element.kind) {
    case "text":
      return renderTextElement(element, input)
    case "rect":
      return `<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="${element.radius}" ry="${element.radius}" fill="${element.fill}" stroke="${element.stroke}" stroke-width="${element.strokeWidth}" />`
    case "line":
      return `<line x1="${element.x1}" y1="${element.y1}" x2="${element.x2}" y2="${element.y2}" stroke="${element.stroke}" stroke-width="${element.strokeWidth}" />`
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
