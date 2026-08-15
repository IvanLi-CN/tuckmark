#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

const ROOT_FILES = [
  ".env.example",
  ".env.local.example",
  ".gitignore",
  ".gitmodules",
  "BRAND.md",
  "CONTEXT.md",
  "DESIGN.md",
  "PRODUCT.md",
  "README.md",
  "biome.json",
  "bun.lock",
  "commitlint.config.cjs",
  "lefthook.yml",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
]

export const BUNDLE_EXCLUDES = ["node_modules", "*/node_modules", "*/node_modules/*"]

export const RUNTIME_BUNDLE_PATHS = [
  ...ROOT_FILES,
  "apps",
  "detonger",
  "docs",
  "packages",
  "plugins",
  "scripts",
  "skills",
  "tools",
]

export const CLI_BUNDLE_PATHS = [
  ...ROOT_FILES,
  "detonger",
  "packages/cli",
  "packages/core",
  "packages/ipc",
  "plugins/inventory",
  "skills",
  "tools",
]

async function assertPathsExist(repoRoot, entries) {
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(repoRoot, entry)
      try {
        await stat(entryPath)
      } catch (error) {
        throw new Error(`release bundle input is missing: ${entry}`, { cause: error })
      }
    })
  )
}

function createArchive({ repoRoot, outputPath, entries }) {
  const args = ["-czf", outputPath]
  for (const pattern of BUNDLE_EXCLUDES) {
    args.push(`--exclude=${pattern}`)
  }
  args.push(...entries)
  execFileSync("tar", args, { cwd: repoRoot, stdio: "inherit" })
}

export async function buildReleaseBundles({ repoRoot = process.cwd(), outputDir }) {
  const resolvedRoot = path.resolve(repoRoot)
  const resolvedOutputDir = path.resolve(
    outputDir ?? path.join(resolvedRoot, "work/release/bundles")
  )
  await mkdir(resolvedOutputDir, { recursive: true })
  await Promise.all([
    assertPathsExist(resolvedRoot, RUNTIME_BUNDLE_PATHS),
    assertPathsExist(resolvedRoot, CLI_BUNDLE_PATHS),
  ])

  const runtimeBundle = path.join(resolvedOutputDir, "tuckmark-runtime-bundle.tgz")
  const cliBundle = path.join(resolvedOutputDir, "tuckmark-cli-bundle.tgz")
  createArchive({
    repoRoot: resolvedRoot,
    outputPath: runtimeBundle,
    entries: RUNTIME_BUNDLE_PATHS,
  })
  createArchive({ repoRoot: resolvedRoot, outputPath: cliBundle, entries: CLI_BUNDLE_PATHS })
  return { runtimeBundle, cliBundle }
}

async function main() {
  const result = await buildReleaseBundles({ outputDir: process.argv[2] })
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
