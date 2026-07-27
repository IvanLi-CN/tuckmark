import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { resolveInventoryPrintSource } from "./shared-data-directory.js"

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const cliPath = path.join(repoRoot, "packages/cli/src/index.ts")
const cliTsconfigPath = path.join(repoRoot, "packages/cli/tsconfig.typecheck.json")
const fixturePath = path.join(
  repoRoot,
  "packages/core/fixtures/electronics-component-label.package.json"
)
const dataMatrixFixturePath = path.join(
  repoRoot,
  "packages/core/fixtures/data-matrix-rack-tag.package.json"
)

async function runCli(args: string[]) {
  return execFileAsync("bun", ["tsx", "--tsconfig", cliTsconfigPath, cliPath, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      TUCKMARK_MOCK_PRINTERS: "1",
      TUCKMARK_DETONGER_PACKET_ENCODER: "lpapi",
    },
  })
}

async function runCliWithEnv(args: string[], env: Record<string, string>) {
  return execFileAsync("bun", ["tsx", "--tsconfig", cliTsconfigPath, cliPath, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      TUCKMARK_MOCK_PRINTERS: "1",
      TUCKMARK_DETONGER_PACKET_ENCODER: "lpapi",
      ...env,
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
  const tempDirs: string[] = []

  beforeAll(async () => {
    await execFileAsync("bun", ["run", "--filter", "@tuckmark/core", "build"], {
      cwd: repoRoot,
    })
  }, 90_000)

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
    )
  })

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

  it("validates and previews Data Matrix template packages through the shared CLI path", {
    timeout: 20_000,
  }, async () => {
    const validation = JSON.parse(
      (await runCli(["template-package", "validate", "--file", dataMatrixFixturePath])).stdout
    ) as { ok: boolean; id: string }
    expect(validation).toMatchObject({
      ok: true,
      id: "rack-tag-datamatrix",
    })

    const preview = JSON.parse(
      (await runCli(["template-package", "preview", "--file", dataMatrixFixturePath])).stdout
    ) as {
      artifact: { source: string; name: string; width: number; pngPath: string }
    }
    expect(preview.artifact).toMatchObject({
      source: "canvas",
      name: "Rack Tag Data Matrix",
      width: 192,
    })
    expect(preview.artifact.pngPath).toContain("preview.png")
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

  it("imports user templates into the configured data directory", { timeout: 20_000 }, async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "tuckmark-cli-user-template-"))
    tempDirs.push(dataDir)

    const importResult = JSON.parse(
      (await runCli(["template", "import", "--file", fixturePath, "--data-dir", dataDir])).stdout
    ) as {
      imported: { template: { id: string; name: string } }
    }
    expect(importResult.imported.template).toMatchObject({
      id: "component-bin-sot23",
      name: "Component Bin SOT-23",
    })

    const showResult = JSON.parse(
      (await runCli(["template", "show", "--id", "component-bin-sot23", "--data-dir", dataDir]))
        .stdout
    ) as {
      source: string
      template: { id: string }
      savedVersions: Array<{ version: number }>
    }
    expect(showResult.source).toBe("user-template")
    expect(showResult.template.id).toBe("component-bin-sot23")
    expect(showResult.savedVersions[0]?.version).toBe(1)

    const manifest = JSON.parse(await readFile(path.join(dataDir, "manifest.json"), "utf8")) as {
      schema: string
      counts: { templates: number; versions: number; workingCopies: number }
    }
    expect(manifest).toMatchObject({
      schema: "tuckmark.data-dir-manifest.v1",
      counts: {
        templates: 1,
        versions: 1,
        workingCopies: 1,
      },
    })
  })

  it("creates, adjusts, and prints inventory from the shared directory", {
    timeout: 45_000,
  }, async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "tuckmark-cli-inventory-"))
    tempDirs.push(dataDir)

    await runCli(["template", "import", "--file", fixturePath, "--data-dir", dataDir])

    const created = JSON.parse(
      (
        await runCli([
          "inventory",
          "create",
          "--full-name",
          "TPS62933DRLR",
          "--base-name",
          "TPS62933",
          "--variant-name",
          "DRLR",
          "--package-name",
          "SOT-583",
          "--description",
          "同步降压 28V",
          "--matrix-code",
          "P2-Y404125469",
          "--packaging-remark",
          "编带一盘 3000pcs",
          "--bindings",
          JSON.stringify([
            {
              id: "binding-user-template",
              templateSource: "user-template",
              templateId: "component-bin-sot23",
              templateName: "Component Bin SOT-23",
              printQuantity: 1,
              fieldOverrides: {
                model: "TPS62933DRLR",
              },
              createdAt: "2026-07-20T09:00:00.000Z",
              updatedAt: "2026-07-20T09:00:00.000Z",
            },
            {
              id: "binding-system-template",
              templateSource: "system",
              templateId: "cable-tag",
              templateName: "Cable Tag",
              printQuantity: 1,
              fieldOverrides: {},
              createdAt: "2026-07-20T09:00:00.000Z",
              updatedAt: "2026-07-20T09:00:00.000Z",
            },
          ]),
          "--data-dir",
          dataDir,
        ])
      ).stdout
    ) as {
      material: { id: string; currentQuantity: number; labelBindings: Array<{ id: string }> }
    }
    expect(created.material.currentQuantity).toBe(0)
    expect(created.material.labelBindings[0]?.id).toBe("binding-user-template")

    const adjusted = JSON.parse(
      (
        await runCli([
          "inventory",
          "adjust",
          "--id",
          created.material.id,
          "--kind",
          "in",
          "--quantity",
          "48",
          "--note",
          "initial stock",
          "--data-dir",
          dataDir,
        ])
      ).stdout
    ) as {
      material: { currentQuantity: number }
      adjustment: { quantityAfter: number }
    }
    expect(adjusted.material.currentQuantity).toBe(48)
    expect(adjusted.adjustment.quantityAfter).toBe(48)

    const systemPrintSource = await resolveInventoryPrintSource({
      dataDir,
      materialId: created.material.id,
      bindingId: "binding-system-template",
      quantity: 2,
    })
    expect(systemPrintSource).toMatchObject({
      kind: "system-template",
      copies: 2,
      input: {
        quantity: "48",
        currentQuantity: "48",
      },
    })

    const manifest = JSON.parse(await readFile(path.join(dataDir, "manifest.json"), "utf8")) as {
      counts: { materials: number; adjustments: number }
    }
    expect(manifest.counts).toMatchObject({ materials: 1, adjustments: 1 })

    const printResult = JSON.parse(
      (
        await runCliWithEnv(
          [
            "inventory",
            "print",
            "--id",
            created.material.id,
            "--binding",
            "binding-user-template",
            "--printer",
            "mock-printer",
            "--quantity",
            "2",
            "--data-dir",
            dataDir,
          ],
          {
            TUCKMARK_ENABLE_SERVER_SIDE_PRINT: "1",
          }
        )
      ).stdout
    ) as {
      source: { kind: string }
      result: { preview?: { artifact?: { width: number } } }
      results: unknown[]
    }
    expect(printResult.source.kind).toBe("user-template")
    expect(printResult.result.preview?.artifact?.width).toBeGreaterThan(0)
    expect(printResult.results).toHaveLength(2)
  })

  it("rejects inventory adjustments without their operation-specific quantity", {
    timeout: 20_000,
  }, async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "tuckmark-cli-inventory-adjustment-"))
    tempDirs.push(dataDir)
    const created = JSON.parse(
      (
        await runCli([
          "inventory",
          "create",
          "--full-name",
          "ADJUSTMENT-TEST",
          "--data-dir",
          dataDir,
        ])
      ).stdout
    ) as { material: { id: string } }

    const missingQuantity = await runCliAllowFailure([
      "inventory",
      "adjust",
      "--id",
      created.material.id,
      "--kind",
      "in",
      "--data-dir",
      dataDir,
    ])
    expect(missingQuantity.stderr).toContain("require a positive --quantity")

    const missingTarget = await runCliAllowFailure([
      "inventory",
      "adjust",
      "--id",
      created.material.id,
      "--kind",
      "correction",
      "--data-dir",
      dataDir,
    ])
    expect(missingTarget.stderr).toContain("require a non-negative --target-quantity")

    const shown = JSON.parse(
      (await runCli(["inventory", "show", "--id", created.material.id, "--data-dir", dataDir]))
        .stdout
    ) as { material: { currentQuantity: number }; adjustments: unknown[] }
    expect(shown.material.currentQuantity).toBe(0)
    expect(shown.adjustments).toHaveLength(0)
  })

  it("recovers an interrupted inventory adjustment before listing materials", {
    timeout: 20_000,
  }, async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "tuckmark-cli-inventory-journal-"))
    tempDirs.push(dataDir)
    const created = JSON.parse(
      (await runCli(["inventory", "create", "--full-name", "JOURNAL-TEST", "--data-dir", dataDir]))
        .stdout
    ) as { material: { id: string } }
    const material = JSON.parse(
      await readFile(
        path.join(dataDir, "inventory", "materials", `${created.material.id}.json`),
        "utf8"
      )
    ) as Record<string, unknown>
    const adjustment = {
      id: "inventory-adjustment-pending",
      materialId: created.material.id,
      kind: "in",
      quantityDelta: 6,
      targetQuantity: null,
      quantityAfter: 6,
      note: "recovery",
      actor: "cli",
      createdAt: "2026-07-27T09:00:00.000Z",
    }
    await mkdir(path.join(dataDir, "inventory", "transactions"), { recursive: true })
    await writeFile(
      path.join(dataDir, "inventory", "transactions", `${adjustment.id}.json`),
      `${JSON.stringify({
        schema: "tuckmark.inventory-adjustment-transaction.v1",
        material: {
          ...material,
          currentQuantity: 6,
          updatedAt: "2026-07-27T09:00:00.000Z",
        },
        adjustment,
      })}\n`
    )

    const listed = JSON.parse(
      (await runCli(["inventory", "list", "--data-dir", dataDir])).stdout
    ) as { materials: Array<{ currentQuantity: number }> }
    const shown = JSON.parse(
      (await runCli(["inventory", "show", "--id", created.material.id, "--data-dir", dataDir]))
        .stdout
    ) as { adjustments: Array<{ id: string }> }

    expect(listed.materials[0]?.currentQuantity).toBe(6)
    expect(shown.adjustments).toEqual([expect.objectContaining({ id: adjustment.id })])
  })

  it("blocks archived inventory materials from adjust and print commands", {
    timeout: 20_000,
  }, async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "tuckmark-cli-inventory-archived-"))
    tempDirs.push(dataDir)

    await runCli(["template", "import", "--file", fixturePath, "--data-dir", dataDir])

    const created = JSON.parse(
      (
        await runCli([
          "inventory",
          "create",
          "--full-name",
          "TPS62933DRLR",
          "--bindings",
          JSON.stringify([
            {
              id: "binding-user-template",
              templateSource: "user-template",
              templateId: "component-bin-sot23",
              templateName: "Component Bin SOT-23",
              printQuantity: 1,
              fieldOverrides: {},
              createdAt: "2026-07-20T09:00:00.000Z",
              updatedAt: "2026-07-20T09:00:00.000Z",
            },
          ]),
          "--data-dir",
          dataDir,
        ])
      ).stdout
    ) as {
      material: { id: string }
    }

    await runCli(["inventory", "archive", "--id", created.material.id, "--data-dir", dataDir])

    const adjustFailure = await runCliAllowFailure([
      "inventory",
      "adjust",
      "--id",
      created.material.id,
      "--kind",
      "in",
      "--quantity",
      "1",
      "--data-dir",
      dataDir,
    ])
    expect(adjustFailure).toMatchObject({
      failed: true,
      code: 1,
    })
    expect(adjustFailure.stderr).toContain("已归档物料不能调整库存，请先恢复。")

    const printFailure = await runCliAllowFailure([
      "inventory",
      "print",
      "--id",
      created.material.id,
      "--binding",
      "binding-user-template",
      "--printer",
      "mock-printer",
      "--data-dir",
      dataDir,
    ])
    expect(printFailure).toMatchObject({
      failed: true,
      code: 1,
    })
    expect(printFailure.stderr).toContain("Set TUCKMARK_ENABLE_SERVER_SIDE_PRINT=1 to enable it.")

    const archivedPrintFailure = await runCliWithEnv(
      [
        "inventory",
        "print",
        "--id",
        created.material.id,
        "--binding",
        "binding-user-template",
        "--printer",
        "mock-printer",
        "--data-dir",
        dataDir,
      ],
      {
        TUCKMARK_ENABLE_SERVER_SIDE_PRINT: "1",
      }
    ).then(
      () => ({
        failed: false,
        stderr: "",
      }),
      (error) => ({
        failed: true,
        stderr: (error as Error & { stderr?: string }).stderr ?? "",
      })
    )
    expect(archivedPrintFailure.failed).toBe(true)
    expect(archivedPrintFailure.stderr).toContain("已归档物料不能打印标签，请先恢复。")
  })
})
