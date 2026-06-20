import { execFile } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { promisify } from "node:util"

import type { PreviewArtifact } from "./types.js"

const execFileAsync = promisify(execFile)

export async function encodeArtifactWithDetongerRustPreview(
  artifact: PreviewArtifact,
  packetsJsonPath: string,
  options: {
    cargoCommand: string
    repoRoot: string
    helperManifestPath: string
    rowsPerChunk?: number
  }
): Promise<{
  packets: string[]
  totalBytes: number
}> {
  const args = [
    "run",
    "-q",
    "--manifest-path",
    options.helperManifestPath,
    "--",
    "--png",
    artifact.pngPath,
    "--out",
    packetsJsonPath,
    "--width",
    String(artifact.renderOptions.printWidthDots),
    "--threshold",
    String(artifact.renderOptions.threshold),
    "--x-offset",
    String(artifact.renderOptions.xOffsetDots),
    "--paper-type",
    artifact.renderOptions.paperType,
  ]

  if (options.rowsPerChunk !== undefined) {
    args.push("--rows-per-chunk", String(options.rowsPerChunk))
  }

  await execFileAsync(options.cargoCommand, args, {
    cwd: options.repoRoot,
  })

  const raw = await readFile(packetsJsonPath, "utf8")
  const parsed = JSON.parse(raw) as { packets?: unknown }
  if (!Array.isArray(parsed.packets) || parsed.packets.length === 0) {
    throw new Error(`Invalid packets json: ${packetsJsonPath}`)
  }

  const packets = parsed.packets.filter(
    (packet): packet is string => typeof packet === "string" && packet.length > 0
  )
  if (packets.length !== parsed.packets.length) {
    throw new Error(`Invalid packets json payload: ${packetsJsonPath}`)
  }

  await writeFile(
    packetsJsonPath,
    JSON.stringify(
      {
        packets,
      },
      null,
      2
    ) + "\n",
    "utf8"
  )

  const totalBytes = packets.reduce((sum, packet) => sum + Buffer.from(packet, "base64").length, 0)

  return {
    packets,
    totalBytes,
  }
}
