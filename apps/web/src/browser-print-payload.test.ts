import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it } from "vitest"

import { encodeArtifactWithDetongerRustPreview } from "../../../packages/core/src/detonger-preview-encoder.js"
import { renderTemplateToPreview } from "../../../packages/core/src/renderer.js"
import { getTemplateById } from "../../../packages/core/src/template-library.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const helperManifestPath = path.join(repoRoot, "tools/detonger-preview-encoder/Cargo.toml")
const detongerProtocolManifestPath = path.join(
  repoRoot,
  "detonger/crates/detonger-protocol/Cargo.toml"
)
const tempDirs: string[] = []

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
  it("matches the validated Rust encoder for gap labels", { timeout: 30000 }, async () => {
    if (!existsSync(detongerProtocolManifestPath)) {
      return
    }
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
        printerModel: "P2",
        printerDpi: 203,
        paperType: "gap",
        threshold: 150,
        printWidthDots: 384,
        xOffsetDots: 0,
        yOffsetDots: 0,
        printStrengthLevel: 0,
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

  it("matches the validated Rust encoder for continuous labels", { timeout: 30000 }, async () => {
    if (!existsSync(detongerProtocolManifestPath)) {
      return
    }
    const template = getTemplateById("cable-tag")
    const rendered = renderTemplateToPreview(
      template,
      {
        name: "LAN-01",
        port: "Gi1/0/1",
        location: "Rack A",
      },
      {
        printerModel: "P2",
        printerDpi: 203,
        paperType: "continuous",
        threshold: 150,
        printWidthDots: 384,
        xOffsetDots: 0,
        yOffsetDots: 0,
        printStrengthLevel: 0,
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

  it("keeps safe-text previews marked as safe_text artifacts", async () => {
    const { materializeBrowserPreview } = await import("./browser-print-payload.js")
    const preview = await materializeBrowserPreview({
      kind: "safe-text",
      text: "Tuckmark\nPrint OK",
      title: "Safe Text Label",
      renderOptions: {
        printerModel: "P2",
        printerDpi: 203,
        paperType: "continuous",
        threshold: 150,
        printWidthDots: 384,
        xOffsetDots: 0,
        yOffsetDots: 0,
        printStrengthLevel: 0,
        previewScale: 4,
      },
    })

    expect(preview.artifact.source).toBe("safe_text")
    expect(preview.artifact.templateId).toBe("safe-text-label")
  })
})
