import { randomUUID } from "node:crypto"

import { Resvg } from "@resvg/resvg-js"
import { PNG } from "pngjs"

import { buildSvg, wrapText } from "./svg-renderer.js"
import type {
  DirectCanvasDefinition,
  PreviewArtifact,
  PreviewSource,
  RenderOptions,
  SafeTextLabelInput,
  TemplateDefinition,
  TemplateElement,
} from "./types.js"
import { renderOptionsSchema, safeTextLabelSchema } from "./types.js"

const continuousSafetyRowDensityThreshold = 320
const continuousSafetyTargetDarkBits = 220
const continuousSafetyMinRunLength = 64
const continuousSafetyEdgePreserveDots = 12

type RenderInput = Record<string, string>

function estimateCharsPerLine(fontSize: number, width?: number): number {
  if (!width) {
    return 100
  }
  return Math.max(4, Math.floor(width / (fontSize * 0.6)))
}

function renderSvgToPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "original",
    },
  })
  return Buffer.from(resvg.render().asPng())
}

function pixelIsBlack(png: PNG, x: number, y: number, threshold: number): boolean {
  const idx = (png.width * y + x) << 2
  const r = png.data[idx] ?? 255
  const g = png.data[idx + 1] ?? 255
  const b = png.data[idx + 2] ?? 255
  const a = png.data[idx + 3] ?? 255
  const lum = (r * 77 + g * 150 + b * 29) >> 8
  const composited = (lum * a + 255 * (255 - a)) / 255
  return composited < threshold
}

function setMonoPixel(png: PNG, x: number, y: number, isBlack: boolean): void {
  const idx = (png.width * y + x) << 2
  const value = isBlack ? 0 : 255
  png.data[idx] = value
  png.data[idx + 1] = value
  png.data[idx + 2] = value
  png.data[idx + 3] = 255
}

function normalizeContinuousPaperPng(pngBuffer: Buffer, renderOptions: RenderOptions): Buffer {
  if (renderOptions.paperType !== "continuous") {
    return pngBuffer
  }

  const png = PNG.sync.read(pngBuffer)
  let mutated = false

  for (let y = 0; y < png.height; y += 1) {
    const row = Array.from({ length: png.width }, (_, x) =>
      pixelIsBlack(png, x, y, renderOptions.threshold)
    )
    let darkBits = row.reduce((sum, bit) => sum + Number(bit), 0)
    if (darkBits <= continuousSafetyRowDensityThreshold) {
      continue
    }

    const protectedDots = new Array<boolean>(png.width).fill(false)
    let runStart = -1
    for (let x = 0; x <= png.width; x += 1) {
      const black = x < png.width ? row[x] : false
      if (black && runStart < 0) {
        runStart = x
        continue
      }
      if (black || runStart < 0) {
        continue
      }

      const runEnd = x - 1
      const runLength = runEnd - runStart + 1
      if (runLength >= continuousSafetyMinRunLength) {
        const interiorStart = runStart + continuousSafetyEdgePreserveDots
        const interiorEnd = runEnd - continuousSafetyEdgePreserveDots

        for (let i = 0; i < continuousSafetyEdgePreserveDots && runStart + i <= runEnd; i += 1) {
          protectedDots[runStart + i] = true
          protectedDots[runEnd - i] = true
        }

        for (let px = interiorStart; px <= interiorEnd; px += 1) {
          if (!row[px] || (px - interiorStart) % 2 === 0) {
            continue
          }
          row[px] = false
          darkBits -= 1
          mutated = true
        }
      }

      runStart = -1
    }

    if (darkBits > continuousSafetyTargetDarkBits) {
      for (let x = 0; x < png.width && darkBits > continuousSafetyTargetDarkBits; x += 1) {
        if (!row[x] || protectedDots[x] || (x + y) % 2 === 0) {
          continue
        }
        row[x] = false
        darkBits -= 1
        mutated = true
      }
    }

    for (let x = 0; x < png.width; x += 1) {
      setMonoPixel(png, x, y, row[x] ?? false)
    }
  }

  return mutated
    ? Buffer.from((PNG.sync as unknown as { write(image: PNG): Uint8Array }).write(png))
    : pngBuffer
}

function createPreviewArtifactBase(params: {
  source: PreviewSource
  name: string
  templateId?: string
  batchIndex?: number
  renderOptions: RenderOptions
  input: RenderInput
  width: number
  height: number
}): PreviewArtifact {
  const base: PreviewArtifact = {
    id: randomUUID(),
    source: params.source,
    name: params.name,
    createdAt: new Date().toISOString(),
    renderOptions: params.renderOptions,
    input: params.input,
    pngPath: "",
    bitmapPath: "",
    svgPath: "",
    width: params.width,
    height: params.height,
  }

  if (params.templateId) {
    base.templateId = params.templateId
  }
  if (params.batchIndex !== undefined) {
    base.batchIndex = params.batchIndex
  }

  return base
}

function thresholdPngToBitmap(png: Buffer, width: number, height: number): Buffer {
  const header = Buffer.from(`BITMAP:${width}x${height}\n`, "utf8")
  return Buffer.concat([header, png])
}

export function renderTemplateToPreview(
  template: TemplateDefinition,
  input: RenderInput,
  options?: unknown,
  batchIndex?: number
): { artifact: PreviewArtifact; png: Buffer; bitmap: Buffer; svg: string } {
  const renderOptions = renderOptionsSchema.parse(options ?? {})
  const svg = buildSvg(template.width, template.height, template.elements, input)
  const png = normalizeContinuousPaperPng(renderSvgToPng(svg), renderOptions)
  const bitmap = thresholdPngToBitmap(png, template.width, template.height)
  const artifactArgs: Parameters<typeof createPreviewArtifactBase>[0] = {
    source: batchIndex === undefined ? "template" : "batch_row",
    name: template.name,
    templateId: template.id,
    renderOptions,
    input,
    width: template.width,
    height: template.height,
  }
  if (batchIndex !== undefined) {
    artifactArgs.batchIndex = batchIndex
  }
  const artifact = createPreviewArtifactBase(artifactArgs)

  return { artifact, png, bitmap, svg }
}

export function renderCanvasToPreview(
  canvas: DirectCanvasDefinition,
  options?: unknown
): { artifact: PreviewArtifact; png: Buffer; bitmap: Buffer; svg: string } {
  const renderOptions = renderOptionsSchema.parse(options ?? {})
  const svg = buildSvg(canvas.width, canvas.height, canvas.elements, {})
  const png = normalizeContinuousPaperPng(renderSvgToPng(svg), renderOptions)
  const bitmap = thresholdPngToBitmap(png, canvas.width, canvas.height)
  const artifact = createPreviewArtifactBase({
    source: "canvas",
    name: canvas.name,
    renderOptions,
    input: {},
    width: canvas.width,
    height: canvas.height,
  })

  return { artifact, png, bitmap, svg }
}

export function renderSafeTextLabelPreview(request: SafeTextLabelInput): {
  artifact: PreviewArtifact
  png: Buffer
  bitmap: Buffer
  svg: string
} {
  const parsedRequest = {
    ...request,
    renderOptions: {
      ...request.renderOptions,
      paperType: "continuous" as const,
    },
  }
  const normalizedRequest = safeTextLabelSchema.parse(parsedRequest)
  const renderOptions = renderOptionsSchema.parse(normalizedRequest.renderOptions)
  const width = renderOptions.printWidthDots
  const lineHeight = 34
  const horizontalPadding = 16
  const verticalPadding = 16
  const text = normalizedRequest.text.trimEnd() || "Tuckmark"
  const maxChars = Math.max(8, estimateCharsPerLine(24, width - horizontalPadding * 2))
  const lines = wrapText(text, maxChars, 4)
  const height = Math.max(64, verticalPadding * 2 + lines.length * lineHeight)

  const elements: TemplateElement[] = lines.map((line, index) => ({
    kind: "text",
    key: `line-${index + 1}`,
    value: line,
    x: horizontalPadding,
    y: verticalPadding + 24 + index * lineHeight,
    width: width - horizontalPadding * 2,
    fontSize: 24,
    fontWeight: "normal",
    align: "left",
    maxLines: 1,
    rotation: 0,
  }))

  const svg = buildSvg(width, height, elements, {})
  const png = normalizeContinuousPaperPng(renderSvgToPng(svg), renderOptions)
  const bitmap = thresholdPngToBitmap(png, width, height)
  const artifact = createPreviewArtifactBase({
    source: "safe_text",
    name: normalizedRequest.title,
    templateId: "safe-text-label",
    renderOptions,
    input: { text },
    width,
    height,
  })

  return { artifact, png, bitmap, svg }
}
