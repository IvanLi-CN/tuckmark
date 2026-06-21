import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it, vi } from "vitest"

import { encodeArtifactWithDetongerRustPreview } from "../../../packages/core/dist/detonger-preview-encoder.js"
import { renderTemplateToPreview } from "../../../packages/core/dist/renderer.js"
import { getTemplateById } from "../../../packages/core/dist/template-library.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const helperManifestPath = path.join(repoRoot, "tools/detonger-preview-encoder/Cargo.toml")
const tempDirs: string[] = []

vi.mock("./browser-print-wasm.js", async () => {
  const { readFileSync } = await import("node:fs")
  const wasmModule = await import("./wasm/pkg/detonger_wasm.js")
  const wasmBytes = readFileSync(
    fileURLToPath(new URL("./wasm/pkg/detonger_wasm_bg.wasm", import.meta.url))
  )
  await wasmModule.default(wasmBytes)

  return {
    encodeBrowserPngMessages: async (
      pngBytes: Uint8Array,
      options: {
        threshold: number
        xOffsetDots: number
        printWidthDots: number
        paperType: "continuous" | "gap"
      }
    ) =>
      Array.from(wasmModule.encodePngJobMessages(pngBytes, options), (message, index) => {
        if (!(message instanceof Uint8Array)) {
          throw new Error(`unexpected wasm message type at index ${index}`)
        }
        return message
      }),
  }
})

function createTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tuckmark-browser-print-"))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) {
      continue
    }
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("encodeBrowserPngBytes", () => {
  it("matches the validated Rust encoder for gap labels", { timeout: 15000 }, async () => {
    const template = getTemplateById("shipping-compact")
    const rendered = renderTemplateToPreview(
      template,
      {
        recipient: "Ivan Example",
        address: "No. 1 Packet Road\nBrowser City",
        orderId: "TM-230CF680",
        note: "Packet diff",
      },
      {
        paperType: "gap",
        threshold: 150,
        printWidthDots: 384,
        xOffsetDots: 0,
      }
    )
    const tempDir = createTempDir()
    const artifact = {
      ...rendered.artifact,
      pngPath: path.join(tempDir, "shipping-compact.png"),
      bitmapPath: path.join(tempDir, "shipping-compact.bin"),
      svgPath: path.join(tempDir, "shipping-compact.svg"),
    }
    writeFileSync(artifact.pngPath, rendered.png)
    writeFileSync(artifact.bitmapPath, rendered.bitmap)
    writeFileSync(artifact.svgPath, rendered.svg)

    const { encodeBrowserPngBytes } = await import("./browser-print-payload.js")
    const browserPackets = await encodeBrowserPngBytes(
      rendered.artifact.renderOptions,
      new Uint8Array(rendered.png)
    )
    const rustPackets = await encodeArtifactWithDetongerRustPreview(
      artifact,
      path.join(tempDir, "shipping-compact.packets.json"),
      {
        cargoCommand: "cargo",
        repoRoot,
        helperManifestPath,
      }
    )

    expect(browserPackets.packets).toEqual(rustPackets.packets)
    expect(browserPackets.packetCount).toBe(rustPackets.packets.length)
    expect(browserPackets.totalBytes).toBe(rustPackets.totalBytes)
  })

  it("matches the validated Rust encoder for continuous labels", { timeout: 15000 }, async () => {
    const template = getTemplateById("cable-tag")
    const rendered = renderTemplateToPreview(
      template,
      {
        name: "LAN-01",
        port: "Gi1/0/1",
        location: "Rack A",
      },
      {
        paperType: "continuous",
        threshold: 150,
        printWidthDots: 384,
        xOffsetDots: 0,
      }
    )
    const tempDir = createTempDir()
    const artifact = {
      ...rendered.artifact,
      pngPath: path.join(tempDir, "cable-tag.png"),
      bitmapPath: path.join(tempDir, "cable-tag.bin"),
      svgPath: path.join(tempDir, "cable-tag.svg"),
    }
    writeFileSync(artifact.pngPath, rendered.png)
    writeFileSync(artifact.bitmapPath, rendered.bitmap)
    writeFileSync(artifact.svgPath, rendered.svg)

    const { encodeBrowserPngBytes } = await import("./browser-print-payload.js")
    const browserPackets = await encodeBrowserPngBytes(
      rendered.artifact.renderOptions,
      new Uint8Array(rendered.png)
    )
    const rustPackets = await encodeArtifactWithDetongerRustPreview(
      artifact,
      path.join(tempDir, "cable-tag.packets.json"),
      {
        cargoCommand: "cargo",
        repoRoot,
        helperManifestPath,
      }
    )

    expect(browserPackets.packets).toEqual(rustPackets.packets)
    expect(browserPackets.packetCount).toBe(rustPackets.packets.length)
    expect(browserPackets.totalBytes).toBe(rustPackets.totalBytes)
  })
})
