import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { listenIpc } from "@tuckmark/ipc"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { DevdConfigService } from "../../server/src/devd-config.js"
import { DevdDataService } from "../../server/src/devd-data-service.js"
import { createApp } from "../../server/src/index.js"
import { deriveAgentImportWebUrl } from "./agent-import-url.js"

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

async function runCliOn(instance: string, args: string[], env: Record<string, string> = {}) {
  return runCliWithEnv([...args, "--instance", instance], env)
}

async function withDevd<T>(
  dataDir: string,
  callback: (instance: string) => Promise<T>,
  env: Record<string, string> = {}
): Promise<T> {
  const instance = `test-${Math.random().toString(36).slice(2, 10)}`
  const configDir = `${dataDir}-config`
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key])
    process.env[key] = value
  }
  const configService = new DevdConfigService({
    env: { TUCKMARK_DATA_DIR: dataDir },
    documentsDir: path.join(path.dirname(dataDir), "Documents"),
    configDir,
  })
  configService.resolveStartupDataDirectory()
  const server = createServer(
    createApp(undefined, {
      devdConfigService: configService,
      devdDataService: new DevdDataService(dataDir),
    })
  )
  await listenIpc(server, instance)
  try {
    return await callback(instance)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(configDir, { recursive: true, force: true })
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

async function runCliAllowFailure(args: string[]) {
  return await runCliWithEnvAllowFailure(args, {})
}

async function runCliWithEnvAllowFailure(args: string[], env: Record<string, string>) {
  try {
    return await runCliWithEnv(args, env)
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
  let runtimeDir: string
  let previousRuntimeDir: string | undefined

  beforeAll(async () => {
    runtimeDir = await mkdtemp(path.join(os.tmpdir(), "tuckmark-cli-ipc-runtime-"))
    previousRuntimeDir = process.env.XDG_RUNTIME_DIR
    process.env.XDG_RUNTIME_DIR = runtimeDir
    await execFileAsync("bun", ["run", "--filter", "@tuckmark/core", "build"], {
      cwd: repoRoot,
    })
  }, 90_000)

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
    )
  })

  afterAll(async () => {
    if (previousRuntimeDir === undefined) delete process.env.XDG_RUNTIME_DIR
    else process.env.XDG_RUNTIME_DIR = previousRuntimeDir
    await rm(runtimeDir, { recursive: true, force: true })
  })

  it("loads", () => {
    expect(true).toBe(true)
  })

  it("gets and sets the DEVD data directory through named IPC", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "tuckmark-cli-config-data-"))
    const nextDir = await mkdtemp(path.join(os.tmpdir(), "tuckmark-cli-config-next-"))
    tempDirs.push(dataDir, nextDir)

    await withDevd(dataDir, async (instance) => {
      const current = JSON.parse((await runCliOn(instance, ["config", "get-data-dir"])).stdout) as {
        activeDataDir: string
        activeSource: string
      }
      expect(current).toMatchObject({ activeDataDir: dataDir, activeSource: "environment" })

      const updated = JSON.parse(
        (await runCliOn(instance, ["config", "set-data-dir", "--path", nextDir])).stdout
      ) as { activeDataDir: string; savedDataDir: string; restartRequired: boolean }
      expect(updated).toMatchObject({
        activeDataDir: dataDir,
        savedDataDir: nextDir,
        restartRequired: true,
      })
    })
  })

  it("derives the paired Web port for bracketed IPv6 DEVD URLs", () => {
    expect(
      deriveAgentImportWebUrl({
        devdUrl: "http://[::1]:5210",
        serverPort: "5210",
        webPort: "5173",
      })
    ).toBe("http://[::1]:5173")
  })

  it("uses the DEVD agent-import API without printing the session secret", {
    timeout: 20_000,
  }, async () => {
    const workingDir = await mkdtemp(path.join(os.tmpdir(), "tuckmark-cli-agent-import-"))
    tempDirs.push(workingDir)
    const proposalPath = path.join(workingDir, "mock-proposal.json")
    const credentialPath = path.join(workingDir, "session.json")
    await writeFile(
      proposalPath,
      JSON.stringify({
        schema: "tuckmark.agent-import.v1",
        sourceNote: "mock order",
        items: [
          {
            id: "mock-new-item",
            kind: "new",
            selected: true,
            quantity: 3,
            material: {
              fullName: "Mock capacitor",
              description: "mock data only",
              packagingRemark: "reel",
            },
            sourceNote: "mock order row",
            template: {
              source: "system",
              id: "cable-tag",
              name: "Cable Tag",
              fields: [],
              recommendedUse: "electronics",
            },
            templateAlternatives: [],
            templateInput: {},
            revision: 0,
            pendingTemplateEventId: null,
          },
        ],
      })
    )

    let eventsAvailable = true
    const received: {
      createBody?: { sessionId: string; secret: string }
      fulfillHeader?: string | undefined
      fulfillBody?: { expectedRevision: number; input: Record<string, string> }
    } = {}
    const server = createServer(async (request, response) => {
      const body = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = []
        request.on("data", (chunk: Buffer) => chunks.push(chunk))
        request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
        request.on("error", reject)
      })
      response.setHeader("content-type", "application/json")
      if (request.method === "POST" && request.url === "/api/agent-import/sessions") {
        received.createBody = JSON.parse(body) as { sessionId: string; secret: string }
        response.end(
          JSON.stringify({
            session: {
              id: received.createBody.sessionId,
              expiresAt: "2026-07-30T12:00:00.000Z",
            },
          })
        )
        return
      }
      if (request.method === "GET" && request.url === "/api/agent-import/catalog") {
        response.end(
          JSON.stringify({
            templates: [
              {
                source: "system",
                id: "cable-tag",
                name: "Cable Tag",
                fields: [],
                recommendedUse: "electronics",
              },
            ],
          })
        )
        return
      }
      if (request.method === "GET" && request.url?.endsWith("/events")) {
        response.end(
          JSON.stringify({
            events: eventsAvailable
              ? [
                  {
                    id: "mock-event",
                    type: "template-input-requested",
                    itemId: "mock-new-item",
                    revision: 1,
                    template: {
                      source: "system",
                      id: "cable-tag",
                      name: "Cable Tag",
                      fields: [{ key: "name", label: "Name", required: true, multiline: false }],
                      recommendedUse: "electronics",
                    },
                    createdAt: "2026-07-30T11:00:00.000Z",
                    status: "open",
                  },
                ]
              : [],
          })
        )
        return
      }
      if (request.method === "POST" && request.url?.endsWith("/events/mock-event/fulfill")) {
        received.fulfillHeader = request.headers["x-tuckmark-agent-import-key"] as
          | string
          | undefined
        received.fulfillBody = JSON.parse(body) as {
          expectedRevision: number
          input: Record<string, string>
        }
        response.end(JSON.stringify({ session: { state: "open" } }))
        return
      }
      response.statusCode = 404
      response.end(JSON.stringify({ error: "mock endpoint not found" }))
    })
    const instance = `agent-test-${Math.random().toString(36).slice(2, 8)}`
    await listenIpc(server, instance)

    try {
      const create = await runCliWithEnv(
        [
          "agent-import",
          "create",
          "--file",
          proposalPath,
          "--credential-file",
          credentialPath,
          "--instance",
          instance,
          "--no-open",
        ],
        { TUCKMARK_WEB_PORT: "5173" }
      )
      const created = JSON.parse(create.stdout) as {
        sessionId: string
        opened: boolean
        confirmationOrigin: string
      }
      const credential = JSON.parse(await readFile(credentialPath, "utf8")) as {
        secret: string
        sessionId: string
        webUrl?: string
      }

      expect(created.opened).toBe(false)
      expect(created.sessionId).toBe(credential.sessionId)
      expect(created.confirmationOrigin).toBe("http://127.0.0.1:5173")
      expect(credential.webUrl).toBe("http://127.0.0.1:5173")
      expect(received.createBody?.secret).toBe(credential.secret)
      expect(create.stdout).not.toContain(credential.secret)

      const catalog = JSON.parse(
        (await runCli(["agent-import", "catalog", "--instance", instance])).stdout
      ) as { templates: Array<{ recommendedUse?: string }> }
      expect(catalog.templates[0]?.recommendedUse).toBe("electronics")

      const waiting = JSON.parse(
        (
          await runCli([
            "agent-import",
            "wait",
            "--session",
            created.sessionId,
            "--credential-file",
            credentialPath,
            "--instance",
            instance,
            "--timeout-ms",
            "0",
          ])
        ).stdout
      ) as { events: Array<{ id: string }> }
      expect(waiting.events[0]?.id).toBe("mock-event")

      eventsAvailable = false
      const timedOut = JSON.parse(
        (
          await runCli([
            "agent-import",
            "wait",
            "--session",
            created.sessionId,
            "--credential-file",
            credentialPath,
            "--instance",
            instance,
            "--timeout-ms",
            "100",
          ])
        ).stdout
      ) as { sessionId: string; events: unknown[]; waiting: boolean }
      expect(timedOut).toEqual({
        sessionId: created.sessionId,
        events: [],
        waiting: true,
      })

      await runCli([
        "agent-import",
        "fulfill",
        "--session",
        created.sessionId,
        "--credential-file",
        credentialPath,
        "--event",
        "mock-event",
        "--revision",
        "1",
        "--input",
        '{"name":"Mock capacitor"}',
        "--instance",
        instance,
      ])
      expect(received.fulfillHeader).toBe(credential.secret)
      expect(received.fulfillBody).toEqual({
        expectedRevision: 1,
        input: { name: "Mock capacitor" },
      })
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
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
    await withDevd(dataDir, async (instance) => {
      const importResult = JSON.parse(
        (await runCliOn(instance, ["template", "import", "--file", fixturePath])).stdout
      ) as { imported: { template: { id: string; name: string } } }
      expect(importResult.imported.template).toMatchObject({
        id: "component-bin-sot23",
        name: "Component Bin SOT-23",
      })

      const updated = await runCliOn(instance, [
        "template",
        "update",
        "--id",
        "component-bin-sot23",
        "--recommended-use",
        "",
      ])
      expect(updated.stdout).toContain('"template"')

      const showResult = JSON.parse(
        (await runCliOn(instance, ["template", "show", "--id", "component-bin-sot23"])).stdout
      ) as {
        source: string
        template: { id: string; recommendedUse?: string }
        savedVersions: Array<{ version: number }>
      }
      expect(showResult.source).toBe("user-template")
      expect(showResult.template.id).toBe("component-bin-sot23")
      expect(showResult.template.recommendedUse).toBeUndefined()
      expect(showResult.savedVersions[0]?.version).toBe(1)
    })
  })

  it("rejects legacy data-directory flags without touching the directory", {
    timeout: 20_000,
  }, async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "tuckmark-cli-devd-owned-"))
    tempDirs.push(dataDir)

    const result = await runCliWithEnvAllowFailure(
      ["inventory", "create", "--full-name", "Mock protected material", "--data-dir", dataDir],
      {}
    )

    expect(result).toMatchObject({ failed: true, code: 1 })
    expect(result.stderr).toContain("Direct data-directory and HTTP DEVD access were removed")
    await expect(
      readFile(path.join(dataDir, "inventory", "materials", "inventory-material.json"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" })

    const readResult = await runCliWithEnvAllowFailure(
      ["inventory", "list", "--data-dir", dataDir],
      {}
    )
    expect(readResult).toMatchObject({ failed: true, code: 1 })
    expect(readResult.stderr).toContain("Direct data-directory and HTTP DEVD access were removed")
  })

  it("creates, adjusts, and prints inventory from the shared directory", {
    timeout: 45_000,
  }, async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "tuckmark-cli-inventory-"))
    tempDirs.push(dataDir)
    await withDevd(
      dataDir,
      async (instance) => {
        await runCliOn(instance, ["template", "import", "--file", fixturePath])
        const created = JSON.parse(
          (
            await runCliOn(instance, [
              "inventory",
              "create",
              "--full-name",
              "TPS62933DRLR",
              "--device-details",
              "- 输入范围：4.5V 至 28V\n- 输出：3.3V",
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
            ])
          ).stdout
        ) as { material: { id: string; currentQuantity: number } }
        expect(created.material.currentQuantity).toBe(0)

        const adjusted = JSON.parse(
          (
            await runCliOn(instance, [
              "inventory",
              "adjust",
              "--id",
              created.material.id,
              "--kind",
              "in",
              "--quantity",
              "48",
            ])
          ).stdout
        ) as {
          result: { material: { currentQuantity: number }; adjustment: { quantityAfter: number } }
        }
        expect(adjusted.result.material.currentQuantity).toBe(48)
        expect(adjusted.result.adjustment.quantityAfter).toBe(48)

        const printResult = JSON.parse(
          (
            await runCliOn(
              instance,
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
              ],
              { TUCKMARK_ENABLE_SERVER_SIDE_PRINT: "1" }
            )
          ).stdout
        ) as { result: { jobs: unknown[] } }
        expect(printResult.result.jobs).toHaveLength(2)
      },
      { TUCKMARK_ENABLE_SERVER_SIDE_PRINT: "1" }
    )
  })

  it("rejects inventory adjustments without their operation-specific quantity", {
    timeout: 20_000,
  }, async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "tuckmark-cli-inventory-adjustment-"))
    tempDirs.push(dataDir)
    await withDevd(dataDir, async (instance) => {
      const created = JSON.parse(
        (await runCliOn(instance, ["inventory", "create", "--full-name", "ADJUSTMENT-TEST"])).stdout
      ) as { material: { id: string } }

      const missingQuantity = await runCliWithEnvAllowFailure(
        [
          "inventory",
          "adjust",
          "--id",
          created.material.id,
          "--kind",
          "in",
          "--instance",
          instance,
        ],
        {}
      )
      expect(missingQuantity.stderr).toContain("require a positive --quantity")

      const missingTarget = await runCliWithEnvAllowFailure(
        [
          "inventory",
          "adjust",
          "--id",
          created.material.id,
          "--kind",
          "correction",
          "--instance",
          instance,
        ],
        {}
      )
      expect(missingTarget.stderr).toContain("require a non-negative --target-quantity")

      const shown = JSON.parse(
        (await runCliOn(instance, ["inventory", "show", "--id", created.material.id])).stdout
      ) as { material: { currentQuantity: number }; adjustments: unknown[] }
      expect(shown.material.currentQuantity).toBe(0)
      expect(shown.adjustments).toHaveLength(0)
    })
  })

  it("recovers an interrupted inventory adjustment before listing materials", {
    timeout: 20_000,
  }, async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "tuckmark-cli-inventory-journal-"))
    tempDirs.push(dataDir)
    await withDevd(dataDir, async (instance) => {
      const created = JSON.parse(
        (await runCliOn(instance, ["inventory", "create", "--full-name", "JOURNAL-TEST"])).stdout
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
      await mkdir(path.join(dataDir, ".tuckmark", "transactions"), { recursive: true })
      await writeFile(
        path.join(dataDir, ".tuckmark", "transactions", "2-pending.json"),
        `${JSON.stringify({
          schema: "tuckmark.devd-data-transaction.v1",
          revision: 2,
          writes: [
            {
              relativePath: `inventory/materials/${created.material.id}.json`,
              value: { ...material, currentQuantity: 6, updatedAt: "2026-07-27T09:00:00.000Z" },
            },
            { relativePath: `inventory/adjustments/${adjustment.id}.json`, value: adjustment },
          ],
          deletes: [],
          event: { revision: 2, domains: ["inventory"], reason: "recovery" },
        })}\n`
      )

      const listed = JSON.parse((await runCliOn(instance, ["inventory", "list"])).stdout) as {
        materials: Array<{ currentQuantity: number }>
      }
      const shown = JSON.parse(
        (await runCliOn(instance, ["inventory", "show", "--id", created.material.id])).stdout
      ) as { adjustments: Array<{ id: string }> }

      expect(listed.materials[0]?.currentQuantity).toBe(6)
      expect(shown.adjustments).toEqual([expect.objectContaining({ id: adjustment.id })])
    })
  })

  it("blocks archived inventory materials from adjust and print commands", {
    timeout: 20_000,
  }, async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "tuckmark-cli-inventory-archived-"))
    tempDirs.push(dataDir)
    await withDevd(dataDir, async (instance) => {
      const created = JSON.parse(
        (
          await runCliOn(instance, [
            "inventory",
            "create",
            "--full-name",
            "TPS62933DRLR",
            "--bindings",
            JSON.stringify([
              {
                id: "binding-user-template",
                templateSource: "system",
                templateId: "cable-tag",
                templateName: "Cable Tag",
                printQuantity: 1,
                fieldOverrides: {},
                createdAt: "2026-07-20T09:00:00.000Z",
                updatedAt: "2026-07-20T09:00:00.000Z",
              },
            ]),
          ])
        ).stdout
      ) as { material: { id: string } }

      await runCliOn(instance, ["inventory", "archive", "--id", created.material.id])

      const adjustFailure = await runCliWithEnvAllowFailure(
        [
          "inventory",
          "adjust",
          "--id",
          created.material.id,
          "--kind",
          "in",
          "--quantity",
          "1",
          "--instance",
          instance,
        ],
        {}
      )
      expect(adjustFailure.stderr).toContain("已归档物料不能调整库存，请先恢复。")

      const archivedPrintFailure = await runCliWithEnvAllowFailure(
        [
          "inventory",
          "print",
          "--id",
          created.material.id,
          "--binding",
          "binding-user-template",
          "--printer",
          "mock-printer",
          "--instance",
          instance,
        ],
        { TUCKMARK_ENABLE_SERVER_SIDE_PRINT: "1" }
      )
      expect(archivedPrintFailure.stderr).toContain("Cannot print labels for an archived material.")
    })
  })
})
