import initDetongerWasm, {
  encodePngJobMessages,
  initSync as initDetongerWasmSync,
} from "./wasm/pkg/detonger_wasm.js"

type BrowserEncoderOptions = {
  threshold: number
  xOffsetDots: number
  printWidthDots: number
  paperType: "continuous" | "gap"
}

type RasterImage = {
  data: Uint8ClampedArray
  width: number
  height: number
}

let detongerInitPromise: Promise<unknown> | undefined

async function ensureDetongerWasmReady(): Promise<void> {
  if (!detongerInitPromise) {
    detongerInitPromise = (
      typeof document === "undefined"
        ? (async () => {
            const { readFile } = await import("node:fs/promises")
            const wasmBytes = await readFile(
              new URL("./wasm/pkg/detonger_wasm_bg.wasm", import.meta.url)
            )
            initDetongerWasmSync(wasmBytes)
          })()
        : initDetongerWasm()
    ).catch((error) => {
      detongerInitPromise = undefined
      throw error
    })
  }
  await detongerInitPromise
}

async function decodePngInNode(pngBytes: Uint8Array): Promise<RasterImage> {
  const moduleName = "pngjs"
  const { PNG } = await import(/* @vite-ignore */ moduleName)
  const png = PNG.sync.read(Buffer.from(pngBytes))
  return {
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength),
    width: png.width,
    height: png.height,
  }
}

async function decodePngInBrowser(pngBytes: Uint8Array): Promise<RasterImage> {
  const blob = new Blob([new Uint8Array(pngBytes)], { type: "image/png" })
  const blobUrl = URL.createObjectURL(blob)

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image()
      nextImage.onload = () => resolve(nextImage)
      nextImage.onerror = () => reject(new Error("Failed to decode browser PNG preview."))
      nextImage.src = blobUrl
    })

    const canvas = document.createElement("canvas")
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext("2d")
    if (!context) {
      throw new Error("Current browser cannot create a 2D canvas.")
    }

    context.drawImage(image, 0, 0)
    const imageData = context.getImageData(0, 0, image.width, image.height)
    return {
      data: new Uint8ClampedArray(imageData.data),
      width: image.width,
      height: image.height,
    }
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

async function decodePng(pngBytes: Uint8Array): Promise<RasterImage> {
  if (typeof document !== "undefined") {
    return decodePngInBrowser(pngBytes)
  }
  return decodePngInNode(pngBytes)
}

function shiftImageDataToPrinterWidth(
  imageData: RasterImage,
  printerWidth: number,
  xOffsetDots: number
): RasterImage {
  const dx = Number(xOffsetDots ?? 0)
  if (!Number.isFinite(dx) || dx === 0) {
    return imageData
  }

  const width = Number(printerWidth)
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error(`Invalid printer width: ${printerWidth}`)
  }

  const dst = new Uint8ClampedArray(width * imageData.height * 4)
  dst.fill(255)

  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = x - dx
      if (sourceX < 0 || sourceX >= imageData.width) {
        continue
      }
      const sourceIndex = (imageData.width * y + sourceX) << 2
      const targetIndex = (width * y + x) << 2
      dst[targetIndex] = imageData.data[sourceIndex] ?? 255
      dst[targetIndex + 1] = imageData.data[sourceIndex + 1] ?? 255
      dst[targetIndex + 2] = imageData.data[sourceIndex + 2] ?? 255
      dst[targetIndex + 3] = imageData.data[sourceIndex + 3] ?? 255
    }
  }

  return {
    data: dst,
    width,
    height: imageData.height,
  }
}

async function encodeRasterToPngBytes(image: RasterImage): Promise<Uint8Array> {
  if (typeof document === "undefined") {
    const { PNG } = await import("pngjs")
    return PNG.sync.write({
      width: image.width,
      height: image.height,
      data: Buffer.from(image.data),
    })
  }

  const canvas = document.createElement("canvas")
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext("2d")
  if (!context) {
    throw new Error("Current browser cannot create a 2D canvas.")
  }

  context.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0
  )
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png")
  })
  if (!blob) {
    throw new Error("Browser failed to encode PNG bytes.")
  }
  return new Uint8Array(await blob.arrayBuffer())
}

export async function encodeBrowserPngMessages(
  pngBytes: Uint8Array,
  options: BrowserEncoderOptions
): Promise<Uint8Array[]> {
  await ensureDetongerWasmReady()

  const shiftedImage = shiftImageDataToPrinterWidth(
    await decodePng(pngBytes),
    options.printWidthDots,
    options.xOffsetDots
  )
  const normalizedPngBytes = await encodeRasterToPngBytes(shiftedImage)
  const messages = encodePngJobMessages(normalizedPngBytes, {
    threshold: options.threshold,
    xOffsetDots: 0,
    printWidthDots: options.printWidthDots,
    paperType: options.paperType,
  })

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("detonger-wasm returned no packets")
  }

  return messages.map((message, index) => {
    if (!(message instanceof Uint8Array)) {
      throw new Error(`unexpected detonger-wasm packet type at index ${index}`)
    }
    return message
  })
}
