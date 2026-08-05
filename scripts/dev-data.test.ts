import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  findPreparedDevelopmentData,
  prepareDevelopmentData,
  resolveDevelopmentDataDirectory,
  resolveDevelopmentInstance,
} from "./dev-data.js"

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((item) => rm(item, { recursive: true, force: true })))
})

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-dev-data-test-"))
  cleanup.push(root)
  const source = path.join(root, "source")
  const tempDir = path.join(root, "tmp")
  const cwd = path.join(root, "worktree")
  await mkdir(path.join(source, "templates", "mock", "versions"), { recursive: true })
  await mkdir(path.join(source, "inventory", "materials"), { recursive: true })
  await mkdir(path.join(source, "backups", "manual"), { recursive: true })
  await mkdir(path.join(source, ".tuckmark"), { recursive: true })
  await writeFile(path.join(source, "templates", "mock", "template.json"), "{}", "utf8")
  await writeFile(path.join(source, "templates", "mock", "versions", "v1.json"), "{}", "utf8")
  await writeFile(path.join(source, "inventory", "materials", "m1.json"), "{}", "utf8")
  await writeFile(path.join(source, "backups", "manual", "backup.zip"), "excluded", "utf8")
  await writeFile(path.join(source, ".tuckmark", "devd-live.lock"), "excluded", "utf8")
  await writeFile(
    path.join(source, "manifest.json"),
    JSON.stringify({
      schema: "tuckmark.data-dir-manifest.v1",
      counts: { templates: 1, versions: 1, workingCopies: 0, materials: 1, adjustments: 0 },
    }),
    "utf8"
  )
  return { root, source, tempDir, cwd }
}

describe("development data preparation", () => {
  it("derives stable per-worktree paths and instance names", async () => {
    const { cwd, tempDir } = await createFixture()
    expect(resolveDevelopmentDataDirectory(cwd, tempDir)).toContain("tuckmark-devd-dev")
    expect(resolveDevelopmentInstance(cwd)).toMatch(/^dev-[a-f0-9]{8}$/)
    expect(resolveDevelopmentInstance(cwd)).toBe(resolveDevelopmentInstance(cwd))
    expect(resolveDevelopmentInstance(path.join(process.cwd(), "packages"))).toBe(
      resolveDevelopmentInstance(process.cwd())
    )
  })

  it("copies only business data and reuses a valid prepared copy", async () => {
    const { source, tempDir, cwd } = await createFixture()
    const prepared = await prepareDevelopmentData({ explicitSource: source, tempDir, cwd })
    expect(prepared.status).toBe("prepared")
    expect(await findPreparedDevelopmentData({ tempDir, cwd })).toBe(prepared.dataDir)
    await expect(
      readFile(path.join(prepared.dataDir, "backups", "manual", "backup.zip"))
    ).rejects.toMatchObject({ code: "ENOENT" })
    await expect(
      readFile(path.join(prepared.dataDir, ".tuckmark", "devd-live.lock"))
    ).rejects.toMatchObject({ code: "ENOENT" })

    expect((await prepareDevelopmentData({ explicitSource: source, tempDir, cwd })).status).toBe(
      "skipped"
    )
  })

  it("requires refresh for an invalid prepared copy and rebuilds it atomically", async () => {
    const { source, tempDir, cwd } = await createFixture()
    const target = resolveDevelopmentDataDirectory(cwd, tempDir)
    await mkdir(target, { recursive: true })
    await writeFile(path.join(target, "invalid.txt"), "invalid", "utf8")

    await expect(prepareDevelopmentData({ explicitSource: source, tempDir, cwd })).rejects.toThrow(
      /--refresh/
    )
    const refreshed = await prepareDevelopmentData({
      explicitSource: source,
      tempDir,
      cwd,
      refresh: true,
    })
    expect(refreshed.status).toBe("prepared")
    expect(await findPreparedDevelopmentData({ tempDir, cwd })).toBe(target)
  })
})
