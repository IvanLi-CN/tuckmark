#!/usr/bin/env bun

import { existsSync } from "node:fs"
import { extname } from "node:path"

const mode = process.argv[2]

if (mode !== "lint" && mode !== "check" && mode !== "write") {
  console.error("Usage: bun scripts/run-biome.ts <lint|check|write>")
  process.exit(1)
}

const biomeArgs = mode === "lint" ? ["lint"] : mode === "write" ? ["check", "--write"] : ["check"]

const supportedExtensions = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
])

const listFiles = Bun.spawnSync({
  cmd: ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  stdout: "pipe",
  stderr: "inherit",
})

if (listFiles.exitCode !== 0) {
  process.exit(listFiles.exitCode)
}

const decoder = new TextDecoder()
const files = decoder
  .decode(listFiles.stdout)
  .split("\0")
  .filter(Boolean)
  .filter((file) => existsSync(file))
  .filter((file) => supportedExtensions.has(extname(file)))

if (files.length === 0) {
  console.error("No Biome-supported files found in git-tracked or untracked workspace state.")
  process.exit(1)
}

const biome = Bun.spawn({
  cmd: ["biome", ...biomeArgs, ...files],
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
})

process.exit(await biome.exited)
