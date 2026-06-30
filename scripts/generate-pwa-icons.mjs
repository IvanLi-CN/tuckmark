import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import zlib from "node:zlib"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const outputDir = path.join(repoRoot, "apps", "web", "public", "pwa")

function lerp(left, right, amount) {
  return Math.round(left + (right - left) * amount)
}

function setPixel(png, x, y, color) {
  const idx = (png.width * y + x) << 2
  png.data[idx] = color[0]
  png.data[idx + 1] = color[1]
  png.data[idx + 2] = color[2]
  png.data[idx + 3] = color[3]
}

function drawRoundedRect(png, x, y, width, height, radius, colorFor) {
  const right = x + width
  const bottom = y + height
  for (let py = y; py < bottom; py += 1) {
    for (let px = x; px < right; px += 1) {
      const cx = px < x + radius ? x + radius : px >= right - radius ? right - radius - 1 : px
      const cy = py < y + radius ? y + radius : py >= bottom - radius ? bottom - radius - 1 : py
      const dx = px - cx
      const dy = py - cy
      if (dx * dx + dy * dy > radius * radius) {
        continue
      }
      setPixel(png, px, py, colorFor(px, py))
    }
  }
}

function drawBlockLetterT(png, size) {
  const ink = [109, 65, 32, 255]
  const topX = Math.round(size * 0.29)
  const topY = Math.round(size * 0.31)
  const topW = Math.round(size * 0.42)
  const topH = Math.round(size * 0.11)
  const stemX = Math.round(size * 0.445)
  const stemY = topY
  const stemW = Math.round(size * 0.11)
  const stemH = Math.round(size * 0.4)

  drawRoundedRect(png, topX, topY, topW, topH, Math.round(size * 0.025), () => ink)
  drawRoundedRect(png, stemX, stemY, stemW, stemH, Math.round(size * 0.025), () => ink)
}

function createIcon(size) {
  const png = { width: size, height: size, data: Buffer.alloc(size * size * 4) }
  const bg = [248, 243, 235, 255]
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      setPixel(png, x, y, bg)
    }
  }

  const inset = Math.round(size * 0.11)
  const rectSize = size - inset * 2
  const radius = Math.round(size * 0.22)
  const top = [245, 217, 195, 255]
  const bottom = [221, 181, 140, 255]
  drawRoundedRect(png, inset, inset, rectSize, rectSize, radius, (_x, y) => {
    const amount = (y - inset) / rectSize
    return [
      lerp(top[0], bottom[0], amount),
      lerp(top[1], bottom[1], amount),
      lerp(top[2], bottom[2], amount),
      255,
    ]
  })

  const gloss = [255, 255, 255, 68]
  const centerX = Math.round(size * 0.32)
  const centerY = Math.round(size * 0.28)
  const glossRadius = Math.round(size * 0.22)
  for (let y = inset; y < size - inset; y += 1) {
    for (let x = inset; x < size - inset; x += 1) {
      const dx = x - centerX
      const dy = y - centerY
      if (dx * dx + dy * dy < glossRadius * glossRadius) {
        const idx = (png.width * y + x) << 2
        png.data[idx] = lerp(png.data[idx], gloss[0], 0.32)
        png.data[idx + 1] = lerp(png.data[idx + 1], gloss[1], 0.32)
        png.data[idx + 2] = lerp(png.data[idx + 2], gloss[2], 0.32)
      }
    }
  }

  drawBlockLetterT(png, size)
  return encodePng(png)
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function createChunk(type, data) {
  const typeBuffer = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, checksum])
}

function encodePng(png) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(png.width, 0)
  ihdr.writeUInt32BE(png.height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const rowLength = png.width * 4
  const raw = Buffer.alloc((rowLength + 1) * png.height)
  for (let y = 0; y < png.height; y += 1) {
    const rawOffset = y * (rowLength + 1)
    raw[rawOffset] = 0
    png.data.copy(raw, rawOffset + 1, y * rowLength, (y + 1) * rowLength)
  }

  return Buffer.concat([
    signature,
    createChunk("IHDR", ihdr),
    createChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    createChunk("IEND", Buffer.alloc(0)),
  ])
}

fs.mkdirSync(outputDir, { recursive: true })
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(outputDir, `tuckmark-icon-${size}.png`), createIcon(size))
}
