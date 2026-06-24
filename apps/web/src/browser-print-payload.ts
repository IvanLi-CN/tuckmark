import type {
  ArtifactPackets,
  DirectCanvasDefinition,
  PreviewArtifact,
  RenderOptions,
  SafeTextLabelInput,
} from "../../../packages/core/src/web.js"
import { buildSvg, getTemplateById } from "../../../packages/core/src/web.js"
import { encodeBrowserPngMessages } from "./browser-print-wasm.js"
import type { ArtifactData } from "./types.js"

type BrowserRenderOptions = PreviewArtifact["renderOptions"]

type TemplatePrintSource = {
  kind: "template"
  templateId: string
  rowId?: string
  input: Record<string, string>
  renderOptions: BrowserRenderOptions
}

type SafeTextPrintSource = {
  kind: "safe-text"
  text: string
  title: string
  renderOptions: BrowserRenderOptions
}

type CanvasPrintSource = {
  kind: "canvas"
  canvas: DirectCanvasDefinition
  renderOptions: BrowserRenderOptions
}

export type BrowserPrintSource = TemplatePrintSource | SafeTextPrintSource | CanvasPrintSource

type BrowserPreviewMaterialization = {
  artifact: PreviewArtifact
  dataUrl: string
  source: BrowserPrintSource
}

export type BrowserArtifactMaterialization = {
  artifact: PreviewArtifact
  data: ArtifactData
  source: BrowserPrintSource
}

const DEFAULT_PREVIEW_SCALE = 4
const continuousSafetyRowDensityThreshold = 320
const continuousSafetyTargetDarkBits = 220
const continuousSafetyMinRunLength = 64
const continuousSafetyEdgePreserveDots = 12

function wrapText(text: string, maxCharsPerLine: number, maxLines?: number): string[] {
  const normalized = text.replace(/\r\n/g, "\n").split("\n")
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

function _estimateCharsPerLine(fontSize: number, width?: number): number {
  if (!width) {
    return 100
  }
  return Math.max(4, Math.floor(width / (fontSize * 0.6)))
}

function createSafeTextDefinition(request: SafeTextLabelInput): {
  width: number
  height: number
  elements: DirectCanvasDefinition["elements"]
  input: Record<string, string>
} {
  const width = request.renderOptions?.printWidthDots ?? 384
  const lineHeight = 34
  const horizontalPadding = 16
  const verticalPadding = 16
  const text = request.text.trimEnd() || "Tuckmark"
  const maxChars = Math.max(8, Math.floor((width - horizontalPadding * 2) / (24 * 0.6)))
  const lines = wrapText(text, maxChars, 4)
  const height = Math.max(64, verticalPadding * 2 + lines.length * lineHeight)

  const elements = lines.map((line, index) => ({
    kind: "text" as const,
    key: `line-${index + 1}`,
    value: line,
    x: horizontalPadding,
    y: verticalPadding + 24 + index * lineHeight,
    width: width - horizontalPadding * 2,
    fontSize: 24,
    fontWeight: "normal" as const,
    align: "left" as const,
    maxLines: 1,
  }))

  return {
    width,
    height,
    elements,
    input: { text },
  }
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png")
  })
  if (!blob) {
    throw new Error("浏览器无法导出 PNG 预览。")
  }

  return new Uint8Array(await blob.arrayBuffer())
}

async function drawSvgToPngBytes(
  svg: string,
  width: number,
  height: number,
  threshold: number,
  paperType: RenderOptions["paperType"]
): Promise<Uint8Array> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
  const blobUrl = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image()
      nextImage.onload = () => resolve(nextImage)
      nextImage.onerror = () => reject(new Error("浏览器本地 SVG 预览渲染失败。"))
      nextImage.src = blobUrl
    })

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) {
      throw new Error("当前浏览器无法创建 2D Canvas。")
    }

    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    const imageData = context.getImageData(0, 0, width, height)
    const normalized = normalizeContinuousPaperImageData(imageData, threshold, paperType)
    context.putImageData(normalized, 0, 0)
    return await canvasToPngBytes(canvas)
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

function pixelIsBlack(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  threshold: number
) {
  const idx = (width * y + x) << 2
  const r = data[idx] ?? 255
  const g = data[idx + 1] ?? 255
  const b = data[idx + 2] ?? 255
  const a = data[idx + 3] ?? 255
  const lum = (r * 77 + g * 150 + b * 29) >> 8
  const composited = (lum * a + 255 * (255 - a)) / 255
  return composited < threshold
}

function setMonoPixel(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  isBlack: boolean
) {
  const idx = (width * y + x) << 2
  const value = isBlack ? 0 : 255
  data[idx] = value
  data[idx + 1] = value
  data[idx + 2] = value
  data[idx + 3] = 255
}

function normalizeContinuousPaperImageData(
  imageData: ImageData,
  threshold: number,
  paperType: RenderOptions["paperType"]
): ImageData {
  const width = imageData.width
  const height = imageData.height
  const data = new Uint8ClampedArray(imageData.data)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setMonoPixel(data, width, x, y, pixelIsBlack(data, width, x, y, threshold))
    }
  }

  if (paperType !== "continuous") {
    return new ImageData(data, width, height)
  }

  for (let y = 0; y < height; y += 1) {
    const row = Array.from({ length: width }, (_, x) => pixelIsBlack(data, width, x, y, threshold))
    let darkBits = row.reduce((sum, bit) => sum + Number(bit), 0)
    if (darkBits <= continuousSafetyRowDensityThreshold) {
      continue
    }

    const protectedDots = new Array<boolean>(width).fill(false)
    let runStart = -1
    for (let x = 0; x <= width; x += 1) {
      const black = x < width ? row[x] : false
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
        }
      }

      runStart = -1
    }

    if (darkBits > continuousSafetyTargetDarkBits) {
      for (let x = 0; x < width && darkBits > continuousSafetyTargetDarkBits; x += 1) {
        if (!row[x] || protectedDots[x] || (x + y) % 2 === 0) {
          continue
        }
        row[x] = false
        darkBits -= 1
      }
    }

    for (let x = 0; x < width; x += 1) {
      setMonoPixel(data, width, x, y, row[x] ?? false)
    }
  }

  return new ImageData(data, width, height)
}

function encodePacketBase64(message: Uint8Array): string {
  let binary = ""
  for (const byte of message) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

export async function encodeBrowserPngBytes(
  renderOptions: BrowserRenderOptions,
  pngBytes: Uint8Array
): Promise<ArtifactPackets> {
  const messages = await encodeBrowserPngMessages(pngBytes, renderOptions)
  if (messages.length === 0) {
    throw new Error("detonger-wasm returned no packets")
  }

  const packets = messages.map(encodePacketBase64)
  const totalBytes = messages.reduce((sum, message) => sum + message.byteLength, 0)

  return {
    artifactId: `browser-${crypto.randomUUID()}`,
    packetsJsonPath: "browser://packets",
    packets,
    packetCount: packets.length,
    totalBytes,
  }
}

export async function materializeBrowserPreview(
  source: BrowserPrintSource
): Promise<BrowserPreviewMaterialization> {
  const renderOptions = {
    ...source.renderOptions,
    previewScale: source.renderOptions.previewScale ?? DEFAULT_PREVIEW_SCALE,
  }

  if (source.kind === "template") {
    const template = getTemplateById(source.templateId)
    const svg = buildSvg(template.width, template.height, template.elements, source.input)
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    const artifact: PreviewArtifact = {
      id: `browser-${crypto.randomUUID()}`,
      source: "template",
      name: template.name,
      templateId: template.id,
      createdAt: new Date().toISOString(),
      renderOptions,
      input: source.input,
      pngPath: "browser://preview.png",
      bitmapPath: "browser://preview.bin",
      svgPath: "browser://preview.svg",
      width: template.width,
      height: template.height,
    }

    return { artifact, dataUrl, source }
  }

  if (source.kind === "canvas") {
    const svg = buildSvg(source.canvas.width, source.canvas.height, source.canvas.elements, {})
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    const artifact: PreviewArtifact = {
      id: `browser-${crypto.randomUUID()}`,
      source: "canvas",
      name: source.canvas.name,
      templateId: source.canvas.id,
      createdAt: new Date().toISOString(),
      renderOptions,
      input: {},
      pngPath: "browser://preview.png",
      bitmapPath: "browser://preview.bin",
      svgPath: "browser://preview.svg",
      width: source.canvas.width,
      height: source.canvas.height,
    }

    return { artifact, dataUrl, source }
  }

  const safeText = createSafeTextDefinition({
    text: source.text,
    title: source.title,
    renderOptions,
  })
  const svg = buildSvg(safeText.width, safeText.height, safeText.elements, {})
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  const artifact: PreviewArtifact = {
    id: `browser-${crypto.randomUUID()}`,
    source: "safe_text",
    name: source.title,
    templateId: "safe-text-label",
    createdAt: new Date().toISOString(),
    renderOptions,
    input: safeText.input,
    pngPath: "browser://preview.png",
    bitmapPath: "browser://preview.bin",
    svgPath: "browser://preview.svg",
    width: safeText.width,
    height: safeText.height,
  }

  return { artifact, dataUrl, source }
}

export async function encodeBrowserPrintSource(
  source: BrowserPrintSource
): Promise<ArtifactPackets> {
  const materialized = await materializeBrowserArtifactData(source)

  return materialized.data.packets
}

export async function materializeBrowserArtifactData(
  source: BrowserPrintSource
): Promise<BrowserArtifactMaterialization> {
  const preview = await materializeBrowserPreview(source)
  const svg = decodeURIComponent(preview.dataUrl.split(",", 2)[1] ?? "")
  const pngBytes = await drawSvgToPngBytes(
    svg,
    preview.artifact.width,
    preview.artifact.height,
    preview.artifact.renderOptions.threshold,
    preview.artifact.renderOptions.paperType
  )
  const packets = await encodeBrowserPngBytes(preview.artifact.renderOptions, pngBytes)

  packets.artifactId = preview.artifact.id

  return {
    artifact: preview.artifact,
    data: {
      preview: {
        kind: "data-url",
        dataUrl: preview.dataUrl,
      },
      packets,
    },
    source,
  }
}
