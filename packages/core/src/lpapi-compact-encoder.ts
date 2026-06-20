import fs from "node:fs"
import path from "node:path"

import { PNG } from "pngjs"

import type { PreviewArtifact } from "./types.js"

function loadPng(filePath: string): PNG {
  const buf = fs.readFileSync(filePath)
  return PNG.sync.read(buf)
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

  const src = imageData
  const dst = new Uint8ClampedArray(width * src.height * 4)
  dst.fill(255)

  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = x - dx
      if (sx < 0 || sx >= src.width) {
        continue
      }
      const sIdx = (src.width * y + sx) << 2
      const dIdx = (width * y + x) << 2
      dst[dIdx] = src.data[sIdx] ?? 255
      dst[dIdx + 1] = src.data[sIdx + 1] ?? 255
      dst[dIdx + 2] = src.data[sIdx + 2] ?? 255
      dst[dIdx + 3] = src.data[sIdx + 3] ?? 255
    }
  }

  return { data: dst, width, height: src.height }
}

function ensureGlobalsForLpapiBle(): void {
  if (!globalThis.window) {
    ;(globalThis as unknown as { window: typeof globalThis }).window = globalThis
  }
  if (!globalThis.navigator) {
    ;(globalThis as unknown as { navigator: { userAgent: string } }).navigator = {
      userAgent: "node",
    }
  }
  if (!globalThis.window.navigator) {
    ;(globalThis.window as unknown as { navigator: Navigator }).navigator =
      globalThis.navigator as Navigator
  }
}

function normalizeGapType(paperType: PreviewArtifact["renderOptions"]["paperType"]): number {
  return paperType === "continuous" ? 0 : 2
}

type LpapiPacket = {
  getAllBytes(): Uint8Array
}

type LpapiPackageBuffer = {
  getBytes(command: number): Uint8Array
}

type LpapiPrintPackage = {
  print(input: Record<string, unknown>): LpapiPacket[]
}

type LpapiModule = {
  DzCommand: {
    CMD_PAGE_END: number
    CMD_PAGE_PRINT: number
  }
  PackageBuffer: LpapiPackageBuffer
  PrintPackage: new () => LpapiPrintPackage
}

let lpapiModulePromise: Promise<LpapiModule> | undefined

type PrinterHistoryRecord = {
  mPrinterDPI?: number
  printerDPI?: number
  mPrintWidth?: number
  mPrinterWidth?: number
  printerWidth?: number
  mHardwareFlags?: number
  hardwareFlags?: number
  mSoftwareFlags?: number
  softwareFlags?: number
  mSoftwareVersion?: string
  softwareVersion?: string
  mDeviceName?: string
  deviceName?: string
  mHardwareVersion?: string
  deviceVersion?: string
  manufacturer?: string
  mPaperWidth?: number
  mPrinterLocateArea?: number
  mSeriesName?: string
  mDevIntName?: string
  mBatteryCount?: number
  mPeripheralFlags?: number
  mPrintDarkness?: number
  mPrintSpeed?: number
  mGapType?: number
  mGapLength?: number
  motorMode?: number
  mMotorMode?: number
  mAutoPowerOffMins?: number
  mPrinterStatus?: number
  printable?: number
  mSupportedMotorModes?: number[]
}

async function loadLpapiModule(): Promise<LpapiModule> {
  if (!lpapiModulePromise) {
    ensureGlobalsForLpapiBle()
    lpapiModulePromise = import("lpapi-ble/lib/index.esm.js") as Promise<LpapiModule>
  }
  return lpapiModulePromise
}

function defaultPrinterInfo(printWidthDots: number) {
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

function loadPrinterHistory(): PrinterHistoryRecord | undefined {
  const historyPath = process.env.TUCKMARK_PRINTER_HISTORY_PATH
  if (!historyPath) {
    return undefined
  }
  try {
    const raw = fs.readFileSync(historyPath, "utf8")
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return undefined
    }
    return parsed[0] as PrinterHistoryRecord
  } catch {
    return undefined
  }
}

function buildPrinterInfo(printWidthDots: number) {
  const history = loadPrinterHistory()
  if (!history) {
    return defaultPrinterInfo(printWidthDots)
  }

  return {
    printerDPI: Number(history.mPrinterDPI ?? history.printerDPI ?? 203),
    printerWidth: Number(
      history.mPrintWidth ?? history.mPrinterWidth ?? history.printerWidth ?? printWidthDots
    ),
    hardwareFlags: Number(history.mHardwareFlags ?? history.hardwareFlags ?? 0),
    softwareFlags: Number(history.mSoftwareFlags ?? history.softwareFlags ?? 0x0010),
    softwareVersion: String(history.mSoftwareVersion ?? history.softwareVersion ?? ""),
    deviceName: String(history.mDeviceName ?? history.deviceName ?? "P2"),
    deviceVersion: String(history.mHardwareVersion ?? history.deviceVersion ?? ""),
    manufacturer: String(history.manufacturer ?? ""),
    paperWidth: Number(history.mPaperWidth ?? 0) || undefined,
    printerLocateArea: Number(history.mPrinterLocateArea ?? 0) || undefined,
    seriesName: String(history.mSeriesName ?? "") || undefined,
    devIntName: String(history.mDevIntName ?? "") || undefined,
    batteryCount: Number(history.mBatteryCount ?? 0) || undefined,
    peripheralFlags: Number(history.mPeripheralFlags ?? 0) || undefined,
    printDarkness: Number(history.mPrintDarkness ?? 0) || undefined,
    printSpeed: Number(history.mPrintSpeed ?? 0) || undefined,
    gapType: Number(history.mGapType ?? 0) || undefined,
    gapLength: Number(history.mGapLength ?? 0) ? Number(history.mGapLength) / 100 : undefined,
    motorMode: Number(history.motorMode ?? history.mMotorMode ?? 0) || undefined,
    autoPowerOffMins: Number(history.mAutoPowerOffMins ?? 0) || undefined,
    printable: Number(history.mPrinterStatus ?? history.printable ?? 0),
    isPrPageKey: -1,
  }
}

export async function encodeArtifactWithLpapiCompact(artifact: PreviewArtifact): Promise<{
  blobPath: string
  packetsJsonPath: string
  totalBytes: number
  packetCount: number
  packets: string[]
}> {
  const png = loadPng(artifact.pngPath)
  const rawImageData = {
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength),
    width: png.width,
    height: png.height,
  }

  const printerInfo = buildPrinterInfo(artifact.renderOptions.printWidthDots)
  const imageData = shiftImageDataToPrinterWidth(
    rawImageData,
    printerInfo.printerWidth,
    artifact.renderOptions.xOffsetDots
  )

  const { PrintPackage } = await loadLpapiModule()
  const pp = new PrintPackage()
  const buffers = pp.print({
    ...printerInfo,
    imageData,
    threshold: artifact.renderOptions.threshold,
    orientation: 0,
    pageKey: 1,
    pageNo: 1,
    PageCount: 1,
    gapType: normalizeGapType(artifact.renderOptions.paperType),
    enableSuperBitmap: true,
  })

  if (!buffers || buffers.length === 0) {
    throw new Error("lpapi-ble returned no packets")
  }

  const packets = buffers.map((buffer) => Buffer.from(buffer.getAllBytes()).toString("base64"))
  const blob = Buffer.concat(buffers.map((buffer) => Buffer.from(buffer.getAllBytes())))
  const totalBytes = packets.reduce((sum, packet) => sum + Buffer.from(packet, "base64").length, 0)

  const blobPath = path.join(path.dirname(artifact.pngPath), `${artifact.id}.bin`)
  const packetsJsonPath = path.join(path.dirname(artifact.pngPath), `${artifact.id}.packets.json`)

  const payload = {
    meta: {
      png: artifact.pngPath,
      size: `${png.width}x${png.height}`,
      threshold: artifact.renderOptions.threshold,
      printerDpi: printerInfo.printerDPI,
      printerWidth: printerInfo.printerWidth,
      enableSuperBitmap: true,
      packets: packets.length,
      totalBytes,
    },
    packets,
  }

  fs.writeFileSync(blobPath, blob)
  fs.writeFileSync(packetsJsonPath, JSON.stringify(payload, null, 2) + "\n", "utf8")
  return {
    blobPath,
    packetsJsonPath,
    totalBytes,
    packetCount: packets.length,
    packets,
  }
}
