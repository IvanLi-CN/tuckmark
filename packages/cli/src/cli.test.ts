import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { beforeAll, describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const cliPath = path.join(repoRoot, "packages/cli/src/index.ts")
const fixturePath = path.join(
  repoRoot,
  "packages/core/fixtures/electronics-component-label.package.json"
)

async function runCli(args: string[]) {
  return execFileAsync("bun", ["tsx", cliPath, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      TUCKMARK_MOCK_PRINTERS: "1",
      TUCKMARK_DETONGER_PACKET_ENCODER: "lpapi",
    },
  })
}

async function runCliAllowFailure(args: string[]) {
  try {
    return await runCli(args)
  } catch (error) {
    const failure = error as Error & { stderr?: string; stdout?: string; code?: number }
    return {
      failed: true,
      code: failure.code,
      stderr: failure.stderr ?? "",
      stdout: failure.stdout ?? "",
    }
  }
}

describe("cli smoke", () => {
  beforeAll(async () => {
    await execFileAsync("bun", ["run", "--filter", "@tuckmark/core", "build"], {
      cwd: repoRoot,
    })
  }, 90_000)

  it("loads", () => {
    expect(true).toBe(true)
  })

  it("validates user template packages", { timeout: 20_000 }, async () => {
    const { stdout } = await runCli(["template-package", "validate", "--file", fixturePath])
    const result = JSON.parse(stdout) as { ok: boolean; id: string; width: number }

    expect(result).toMatchObject({
      ok: true,
      id: "component-bin-sot23",
      width: 192,
    })
  })

  it("previews user template packages through the canvas artifact seam", {
    timeout: 20_000,
  }, async () => {
    const { stdout } = await runCli(["template-package", "preview", "--file", fixturePath])
    const result = JSON.parse(stdout) as {
      artifact: { source: string; name: string; width: number; pngPath: string }
    }

    expect(result.artifact).toMatchObject({
      source: "canvas",
      name: "Component Bin SOT-23",
      width: 192,
    })
    expect(result.artifact.pngPath).toContain("preview.png")
  })

  it("preserves package render options when CLI overrides one field", {
    timeout: 20_000,
  }, async () => {
    const { stdout } = await runCli([
      "template-package",
      "preview",
      "--file",
      fixturePath,
      "--render-options",
      '{"paperType":"continuous"}',
    ])
    const result = JSON.parse(stdout) as {
      artifact: { renderOptions: { paperType: string; threshold: number } }
    }

    expect(result.artifact.renderOptions).toMatchObject({
      paperType: "continuous",
      threshold: 80,
    })
  })

  it("gates template package printing before preview generation", { timeout: 20_000 }, async () => {
    const result = await runCliAllowFailure([
      "template-package",
      "print",
      "--printer",
      "mock-printer",
      "--file",
      fixturePath,
    ])

    expect(result).toMatchObject({
      failed: true,
      code: 1,
    })
    expect(result.stderr).toContain("TUCKMARK_ENABLE_SERVER_SIDE_PRINT=1")
    expect(result.stdout).not.toContain('"artifact"')
  })
})
