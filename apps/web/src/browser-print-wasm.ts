import { PrintPackage } from "lpapi-ble/lib/index.esm.js"

type BrowserEncoderOptions = {
  threshold: number
  xOffsetDots: number
  printWidthDots: number
  paperType: "continuous" | "gap"
}

function ensureBrowserGlobals(): void {
  const scopedGlobal = globalThis as typeof globalThis & {
    window?: Window & typeof globalThis
    navigator?: Navigator
  }

  if (!scopedGlobal.window) {
    scopedGlobal.window = scopedGlobal as unknown as Window & typeof globalThis
  }

  if (!scopedGlobal.navigator) {
    scopedGlobal.navigator = { userAgent: "browser-static" } as Navigator
  }
}

type RasterImage = {
  data: Uint8ClampedArray
  width: number
  height: number
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
  const normalizedBytes = new Uint8Array(pngBytes)
  const blob = new Blob([normalizedBytes], { type: "image/png" })
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
  imageData: { data: Uint8ClampedArray; width: number; height: number },
  printerWidth: number,
  xOffsetDots: number
) {
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

function normalizeGapType(paperType: BrowserEncoderOptions["paperType"]): number {
  return paperType === "continuous" ? 0 : 2
}

function buildPrinterInfo(printWidthDots: number) {
  return {
    printerDPI: 203,
    printerWidth: printWidthDots,
    hardwareFlags: 0,
    softwareFlags: 0x0010,
    softwareVersion: "",
    deviceName: "P2",
    deviceVersion: "",
    printable: 0,
    isPrPageKey: -1,
  }
}

export async function encodeBrowserPngMessages(
  pngBytes: Uint8Array,
  options: BrowserEncoderOptions
): Promise<Uint8Array[]> {
  ensureBrowserGlobals()

  const png = await decodePng(pngBytes)
  const printerInfo = buildPrinterInfo(options.printWidthDots)
  const imageData = shiftImageDataToPrinterWidth(
    {
      data: png.data,
      width: png.width,
      height: png.height,
    },
    printerInfo.printerWidth,
    options.xOffsetDots
  )

  const printPackage = new PrintPackage()
  const buffers = printPackage.print({
    ...printerInfo,
    imageData,
    threshold: options.threshold,
    orientation: 0,
    pageKey: 1,
    pageNo: 1,
    PageCount: 1,
    gapType: normalizeGapType(options.paperType),
    enableSuperBitmap: true,
  })

  if (!buffers || buffers.length === 0) {
    throw new Error("lpapi-ble returned no packets")
  }

  return buffers.map((buffer, index) => {
    const packet = buffer.getAllBytes()
    if (!(packet instanceof Uint8Array)) {
      throw new Error(`unexpected packet type at index ${index}`)
    }
    return packet
  })
}
