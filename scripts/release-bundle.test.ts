import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import { buildReleaseBundles } from "../.github/scripts/release-bundles.mjs"

const execFileAsync = promisify(execFile)
const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((item) => rm(item, { recursive: true, force: true })))
})

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-release-bundle-test-"))
  cleanup.push(root)
  const requiredFiles = [
    ".env.example",
    ".env.local.example",
    ".gitignore",
    ".gitmodules",
    "BRAND.md",
    "package.json",
    "bun.lock",
    "README.md",
    "PRODUCT.md",
    "DESIGN.md",
    "CONTEXT.md",
    "tsconfig.base.json",
    "detonger/Cargo.toml",
    "detonger/crates/detonger-protocol/Cargo.toml",
    "packages/cli/dist/index.js",
    "packages/core/dist/index.js",
    "packages/ipc/dist/index.js",
    "packages/server/dist/index.js",
    "packages/mcp/dist/index.js",
    "plugins/inventory/dist/index.js",
    "skills/tuckmark-agent-import/SKILL.md",
    "tools/detonger-preview-encoder/Cargo.toml",
    "biome.json",
    "commitlint.config.cjs",
    "lefthook.yml",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
  ]

  for (const relativePath of requiredFiles) {
    const absolutePath = path.join(root, relativePath)
    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, relativePath, "utf8")
  }
  for (const directory of ["apps", "detonger", "docs", "scripts", "skills", "tools"]) {
    await mkdir(path.join(root, directory), { recursive: true })
  }
  await mkdir(path.join(root, "node_modules/.bun"), { recursive: true })
  await writeFile(path.join(root, "node_modules/.bun/should-not-ship.js"), "private", "utf8")
  await mkdir(path.join(root, "packages/cli/node_modules"), { recursive: true })
  await writeFile(
    path.join(root, "packages/cli/node_modules/should-not-ship.js"),
    "private",
    "utf8"
  )
  return root
}

async function archiveEntries(archivePath: string) {
  const { stdout } = await execFileAsync("tar", ["-tzf", archivePath])
  return stdout.split(/\r?\n/).filter(Boolean)
}

describe("release bundles", () => {
  it("include all workspace inputs and omit runner dependencies", async () => {
    const repoRoot = await createFixture()
    const outputDir = path.join(repoRoot, "bundles")
    const result = await buildReleaseBundles({ repoRoot, outputDir })
    const runtimeEntries = await archiveEntries(result.runtimeBundle)
    const cliEntries = await archiveEntries(result.cliBundle)

    expect(runtimeEntries).toContain("plugins/inventory/dist/index.js")
    expect(runtimeEntries).toContain("skills/tuckmark-agent-import/SKILL.md")
    expect(runtimeEntries).toContain("tsconfig.base.json")
    expect(cliEntries).toContain("packages/ipc/dist/index.js")
    expect(cliEntries).toContain("plugins/inventory/dist/index.js")
    expect(cliEntries).toContain("skills/tuckmark-agent-import/SKILL.md")
    expect(cliEntries).toContain("detonger/crates/detonger-protocol/Cargo.toml")
    expect(cliEntries).toContain("tools/detonger-preview-encoder/Cargo.toml")
    expect([...runtimeEntries, ...cliEntries].some((entry) => entry.includes("node_modules"))).toBe(
      false
    )
    await expect(readFile(result.runtimeBundle)).resolves.toBeTruthy()
  })
})
