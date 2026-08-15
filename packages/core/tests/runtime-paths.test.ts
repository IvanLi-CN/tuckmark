import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  resolveBundledDetongerCommand,
  resolveBundledDetongerPath,
  resolveBundledPreviewEncoderCommand,
} from "../src/runtime-paths.ts"

const cleanupPaths: string[] = []
const executableExtension = process.platform === "win32" ? ".exe" : ""

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((item) => rm(item, { recursive: true, force: true }))
  )
})

describe("bundled detonger paths", () => {
  it("uses the helper next to a released executable before falling back to cargo", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-runtime-paths-"))
    cleanupPaths.push(root)
    const executablePath = path.join(root, "bin", `tuckmark${executableExtension}`)
    const helperPath = resolveBundledDetongerPath(executablePath)
    const previewEncoderPath = path.join(
      path.dirname(helperPath),
      `tuckmark-detonger-preview-encoder${executableExtension}`
    )

    await mkdir(path.dirname(helperPath), { recursive: true })
    await writeFile(helperPath, "helper", "utf8")
    await writeFile(previewEncoderPath, "preview helper", "utf8")

    expect(resolveBundledDetongerCommand({}, executablePath)).toBe(helperPath)
    expect(resolveBundledPreviewEncoderCommand(helperPath)).toBe(previewEncoderPath)
  })

  it("preserves an explicit diagnostic override and only falls back to cargo without a helper", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-runtime-paths-"))
    cleanupPaths.push(root)
    const executablePath = path.join(root, "bin", `tuckmark${executableExtension}`)

    expect(resolveBundledDetongerCommand({}, executablePath)).toBe("cargo")
    expect(
      resolveBundledDetongerCommand(
        { TUCKMARK_DETONGER_COMMAND: "/diagnostic/detonger" },
        executablePath
      )
    ).toBe("/diagnostic/detonger")
  })
})
