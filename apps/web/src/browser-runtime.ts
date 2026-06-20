import { presetTemplateData } from "../../../packages/core/src/preset-template-data.js"
import { buildSvg, wrapText } from "../../../packages/core/src/svg-renderer.js"
import type { TemplateDefinition } from "../../../packages/core/src/types.js"
import type {
  ArtifactData,
  ArtifactPackets,
  PreviewArtifact,
  RenderOptions,
  Template,
} from "./types.js"

type StoredArtifact = {
  artifact: PreviewArtifact
  data: ArtifactData
}

type LpapiPacket = {
  getAllBytes(): Uint8Array
}

type LpapiPrintPackage = {
  print(input: Record<string, unknown>): LpapiPacket[]
}

type LpapiModule = {
  PrintPackage: new () => LpapiPrintPackage
}

const DB_NAME = "tuckmark-browser-runtime"
const DB_VERSION = 1
const STORE_NAME = "artifacts"
const CONTINUOUS_ROW_DENSITY_THRESHOLD = 320
const CONTINUOUS_TARGET_DARK_BITS = 220
const CONTINUOUS_MIN_RUN_LENGTH = 64
const CONTINUOUS_EDGE_PRESERVE_DOTS = 12

let lpapiModulePromise: Promise<LpapiModule> | undefined

function createArtifactId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `artifact-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function estimateCharsPerLine(fontSize: number, width?: number): number {
  if (!width) {
    return 100
  }
  return Math.max(4, Math.floor(width / (fontSize * 0.6)))
}

function renderSafeTextSvg(
  text: string,
  renderOptions: RenderOptions
): { svg: string; width: number; height: number } {
  const width = renderOptions.printWidthDots
  const lineHeight = 34
  const horizontalPadding = 16
  const verticalPadding = 16
  const normalized = text.trimEnd() || "Tuckmark"
  const maxChars = Math.max(8, estimateCharsPerLine(24, width - horizontalPadding * 2))
  const lines = wrapText(normalized, maxChars, 4)
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
    svg: buildSvg(width, height, elements, {}),
    width,
    height,
  }
}

export function buildSafeTextBrowserSvgForTest(
  text: string,
  renderOptions: RenderOptions
): string {
  return renderSafeTextSvg(text, renderOptions).svg
}

function normalizeTemplateInput(
  template: TemplateDefinition,
  input: Record<string, string>
): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const field of template.fields) {
    const raw = input[field.key] ?? field.defaultValue ?? ""
    const value = raw.trim()
    if (field.required && value.length === 0) {
      throw new Error(`Missing required field: ${field.key}`)
    }
    resolved[field.key] = raw
  }
  for (const [key, value] of Object.entries(input)) {
    if (!(key in resolved)) {
      resolved[key] = value
    }
  }
  return resolved
}

function ensureGlobalsForLpapiBle(): void {
  if (!globalThis.window) {
    ;(globalThis as typeof globalThis & { window: Window & typeof globalThis }).window =
      globalThis as unknown as Window & typeof globalThis
  }
  if (!globalThis.navigator) {
    ;(globalThis as typeof globalThis & { navigator: Navigator }).navigator = {
      userAgent: "browser",
    } as Navigator
  }
  if (!globalThis.window.navigator) {
    ;(globalThis.window as typeof globalThis.window & { navigator: Navigator }).navigator =
      globalThis.navigator as Navigator
  }
}

async function loadLpapiModule(): Promise<LpapiModule> {
  if (!lpapiModulePromise) {
    ensureGlobalsForLpapiBle()
    lpapiModulePromise = import("lpapi-ble/lib/index.esm.js") as Promise<LpapiModule>
  }
  return lpapiModulePromise
}

async function svgToImageData(svg: string, width: number, height: number): Promise<ImageData> {
  if (typeof document === "undefined") {
    throw new Error("浏览器渲染只支持在 DOM 环境中运行。")
  }

  const img = new Image()
  img.decoding = "async"
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error("SVG preview failed to decode in browser runtime."))
    img.src = svgUrl
  })

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) {
    throw new Error("当前浏览器无法创建 2D canvas。")
  }

  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, width, height)
  context.drawImage(img, 0, 0, width, height)
  return context.getImageData(0, 0, width, height)
}

function pixelIsBlack(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  threshold: number
): boolean {
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
): void {
  const idx = (width * y + x) << 2
  const value = isBlack ? 0 : 255
  data[idx] = value
  data[idx + 1] = value
  data[idx + 2] = value
  data[idx + 3] = 255
}

function normalizeContinuousPaperImageData(
  imageData: ImageData,
  renderOptions: RenderOptions
): ImageData {
  if (renderOptions.paperType !== "continuous") {
    return imageData
  }

  const next = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height
  )

  for (let y = 0; y < next.height; y += 1) {
    const row = Array.from({ length: next.width }, (_, x) =>
      pixelIsBlack(next.data, next.width, x, y, renderOptions.threshold)
    )
    let darkBits = row.reduce((sum, bit) => sum + Number(bit), 0)
    if (darkBits <= CONTINUOUS_ROW_DENSITY_THRESHOLD) {
      continue
    }

    const protectedDots = new Array<boolean>(next.width).fill(false)
    let runStart = -1
    for (let x = 0; x <= next.width; x += 1) {
      const black = x < next.width ? row[x] : false
      if (black && runStart < 0) {
        runStart = x
        continue
      }
      if (black || runStart < 0) {
        continue
      }

      const runEnd = x - 1
      const runLength = runEnd - runStart + 1
      if (runLength >= CONTINUOUS_MIN_RUN_LENGTH) {
        const interiorStart = runStart + CONTINUOUS_EDGE_PRESERVE_DOTS
        const interiorEnd = runEnd - CONTINUOUS_EDGE_PRESERVE_DOTS

        for (let i = 0; i < CONTINUOUS_EDGE_PRESERVE_DOTS && runStart + i <= runEnd; i += 1) {
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

    if (darkBits > CONTINUOUS_TARGET_DARK_BITS) {
      for (let x = 0; x < next.width && darkBits > CONTINUOUS_TARGET_DARK_BITS; x += 1) {
        if (!row[x] || protectedDots[x] || (x + y) % 2 === 0) {
          continue
        }
        row[x] = false
        darkBits -= 1
      }
    }

    for (let x = 0; x < next.width; x += 1) {
      setMonoPixel(next.data, next.width, x, y, row[x] ?? false)
    }
  }

  return next
}

function toPngDataUrl(imageData: ImageData): string {
  if (typeof document === "undefined") {
    throw new Error("浏览器渲染只支持在 DOM 环境中运行。")
  }

  const canvas = document.createElement("canvas")
  canvas.width = imageData.width
  canvas.height = imageData.height
  const context = canvas.getContext("2d")
  if (!context) {
    throw new Error("当前浏览器无法创建 2D canvas。")
  }
  context.putImageData(imageData, 0, 0)
  return canvas.toDataURL("image/png")
}

function shiftImageDataToPrinterWidth(
  imageData: { data: Uint8ClampedArray; width: number; height: number },
  printerWidth: number,
  xOffsetDots: number
): { data: Uint8ClampedArray; width: number; height: number } {
  const dx = Number(xOffsetDots ?? 0)
  if (!Number.isFinite(dx) || dx === 0) {
    return imageData
  }

  const width = Number(printerWidth)
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error(`Invalid printerWidth for x-offset: ${printerWidth}`)
  }

  const dst = new Uint8ClampedArray(width * imageData.height * 4)
  dst.fill(255)

  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = x - dx
      if (sx < 0 || sx >= imageData.width) {
        continue
      }
      const sIdx = (imageData.width * y + sx) << 2
      const dIdx = (width * y + x) << 2
      dst[dIdx] = imageData.data[sIdx] ?? 255
      dst[dIdx + 1] = imageData.data[sIdx + 1] ?? 255
      dst[dIdx + 2] = imageData.data[sIdx + 2] ?? 255
      dst[dIdx + 3] = imageData.data[sIdx + 3] ?? 255
    }
  }

  return { data: dst, width, height: imageData.height }
}

async function encodePackets(
  imageData: ImageData,
  renderOptions: PreviewArtifact["renderOptions"]
): Promise<ArtifactPackets> {
  const { PrintPackage } = await loadLpapiModule()
  const pp = new PrintPackage()
  const shifted = shiftImageDataToPrinterWidth(
    {
      data: imageData.data,
      width: imageData.width,
      height: imageData.height,
    },
    renderOptions.printWidthDots,
    renderOptions.xOffsetDots
  )

  const buffers = pp.print({
    printerDPI: 203,
    printerWidth: renderOptions.printWidthDots,
    hardwareFlags: 0,
    softwareFlags: 0x0010,
    softwareVersion: "",
    deviceName: "P2",
    deviceVersion: "",
    printable: 0,
    isPrPageKey: -1,
    imageData: shifted,
    threshold: renderOptions.threshold,
    orientation: 0,
    pageKey: 1,
    pageNo: 1,
    PageCount: 1,
    gapType: renderOptions.paperType === "continuous" ? 0 : 2,
    enableSuperBitmap: true,
  })

  if (!buffers || buffers.length === 0) {
    throw new Error("lpapi-ble returned no packets")
  }

  const packets = buffers.map((buffer) => {
    const bytes = buffer.getAllBytes()
    let binary = ""
    for (const value of bytes) {
      binary += String.fromCharCode(value)
    }
    return btoa(binary)
  })

  const totalBytes = buffers.reduce((sum, buffer) => sum + buffer.getAllBytes().byteLength, 0)
  return {
    artifactId: "",
    packets,
    packetCount: packets.length,
    totalBytes,
  }
}

class MemoryArtifactStore {
  private readonly items = new Map<string, StoredArtifact>()

  async read(artifactId: string): Promise<StoredArtifact> {
    const item = this.items.get(artifactId)
    if (!item) {
      throw new Error(`Unknown artifact: ${artifactId}`)
    }
    return item
  }

  async write(item: StoredArtifact): Promise<void> {
    this.items.set(item.artifact.id, item)
  }
}

class IndexedDbArtifactStore {
  private dbPromise: Promise<IDBDatabase> | null = null

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)
        request.onupgradeneeded = () => {
          request.result.createObjectStore(STORE_NAME, { keyPath: "artifact.id" })
        }
        request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"))
        request.onsuccess = () => resolve(request.result)
      })
    }
    return this.dbPromise
  }

  async read(artifactId: string): Promise<StoredArtifact> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly")
      const request = tx.objectStore(STORE_NAME).get(artifactId)
      request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"))
      request.onsuccess = () => {
        if (!request.result) {
          reject(new Error(`Unknown artifact: ${artifactId}`))
          return
        }
        resolve(request.result as StoredArtifact)
      }
    })
  }

  async write(item: StoredArtifact): Promise<void> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const request = tx.objectStore(STORE_NAME).put(item)
      request.onerror = () => reject(request.error ?? new Error("IndexedDB write failed"))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"))
    })
  }
}

let artifactStorePromise:
  | Promise<{
      read(artifactId: string): Promise<StoredArtifact>
      write(item: StoredArtifact): Promise<void>
    }>
  | undefined

async function resolveArtifactStore() {
  if (!artifactStorePromise) {
    artifactStorePromise = (async () => {
      if (typeof indexedDB === "undefined") {
        return new MemoryArtifactStore()
      }
      try {
        const store = new IndexedDbArtifactStore()
        await store.write({
          artifact: {
            id: "__ping__",
            name: "__ping__",
            createdAt: new Date(0).toISOString(),
            width: 1,
            height: 1,
            renderOptions: {
              printWidthDots: 384,
              previewScale: 4,
              paperType: "gap",
              threshold: 150,
              xOffsetDots: 0,
            },
          },
          data: {
            preview: { kind: "data-url", dataUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" },
            packets: {
              artifactId: "__ping__",
              packets: ["AA=="],
              packetCount: 1,
              totalBytes: 1,
            },
          },
        })
        try {
          const db = await indexedDB.open(DB_NAME, DB_VERSION)
          db.result.close()
        } catch {}
        return store
      } catch {
        return new MemoryArtifactStore()
      }
    })()
  }
  return artifactStorePromise
}

function toTemplateSurface(template: TemplateDefinition): Template {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    fields: template.fields.map((field) => ({
      key: field.key,
      label: field.label,
      required: field.required,
      multiline: field.multiline,
      defaultValue: field.defaultValue,
    })),
  }
}

export function listBrowserRuntimeTemplates(): Template[] {
  return presetTemplateData.map(toTemplateSurface)
}

function getTemplateById(templateId: string): TemplateDefinition {
  const template = presetTemplateData.find((item) => item.id === templateId)
  if (!template) {
    throw new Error(`Unknown template: ${templateId}`)
  }
  return template
}

async function persistArtifact(
  artifact: PreviewArtifact,
  data: ArtifactData
): Promise<StoredArtifact> {
  const store = await resolveArtifactStore()
  const entry = { artifact, data }
  await store.write(entry)
  return entry
}

export async function readBrowserArtifact(artifactId: string): Promise<StoredArtifact> {
  const store = await resolveArtifactStore()
  return store.read(artifactId)
}

export async function previewTemplateInBrowser(input: {
  templateId: string
  input: Record<string, string>
  renderOptions: RenderOptions
}): Promise<{ artifact: PreviewArtifact }> {
  const template = getTemplateById(input.templateId)
  const normalizedInput = normalizeTemplateInput(template, input.input)
  const renderOptions = {
    printWidthDots: 384,
    previewScale: 4,
    paperType: input.renderOptions.paperType,
    threshold: input.renderOptions.threshold,
    xOffsetDots: input.renderOptions.xOffsetDots,
  }
  const svg = buildSvg(template.width, template.height, template.elements, normalizedInput)
  const normalizedImage = normalizeContinuousPaperImageData(
    await svgToImageData(svg, template.width, template.height),
    input.renderOptions
  )
  const artifact: PreviewArtifact = {
    id: createArtifactId(),
    name: template.name,
    templateId: template.id,
    createdAt: new Date().toISOString(),
    width: template.width,
    height: template.height,
    renderOptions,
  }
  const packets = await encodePackets(normalizedImage, artifact.renderOptions)
  packets.artifactId = artifact.id
  await persistArtifact(artifact, {
    preview: {
      kind: "data-url",
      dataUrl: toPngDataUrl(normalizedImage),
    },
    packets,
  })
  return { artifact }
}

export async function previewSafeTextInBrowser(input: {
  text: string
  title: string
  renderOptions: RenderOptions
}): Promise<{ artifact: PreviewArtifact }> {
  const renderOptions = {
    printWidthDots: input.renderOptions.printWidthDots,
    previewScale: 4,
    paperType: "continuous" as const,
    threshold: input.renderOptions.threshold,
    xOffsetDots: input.renderOptions.xOffsetDots,
  }
  const { svg, width, height } = renderSafeTextSvg(input.text, renderOptions)
  const normalizedImage = normalizeContinuousPaperImageData(
    await svgToImageData(svg, width, height),
    renderOptions
  )
  const artifact: PreviewArtifact = {
    id: createArtifactId(),
    name: input.title,
    templateId: "safe-text-label",
    createdAt: new Date().toISOString(),
    width,
    height,
    renderOptions,
  }
  const packets = await encodePackets(normalizedImage, artifact.renderOptions)
  packets.artifactId = artifact.id
  await persistArtifact(artifact, {
    preview: {
      kind: "data-url",
      dataUrl: toPngDataUrl(normalizedImage),
    },
    packets,
  })
  return { artifact }
}
