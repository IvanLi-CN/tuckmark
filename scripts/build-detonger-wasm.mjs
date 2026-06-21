import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "..")
const outDir = path.join(repoRoot, "apps/web/src/wasm/pkg")
const wasmCrateDir = path.join(repoRoot, "detonger/crates/detonger-wasm")
const args = process.argv.slice(2)
const profileFlag = args.includes("--release") ? "--release" : "--dev"

try {
  fs.rmSync(outDir, { recursive: true, force: true })
  execFileSync(
    "wasm-pack",
    [
      "build",
      wasmCrateDir,
      "--target",
      "web",
      "--out-dir",
      outDir,
      "--out-name",
      "detonger_wasm",
      profileFlag,
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
    }
  )
} catch (error) {
  const nodeError = error
  if (
    nodeError &&
    typeof nodeError === "object" &&
    "code" in nodeError &&
    nodeError.code === "ENOENT"
  ) {
    console.error("wasm-pack is required to build apps/web/src/wasm/pkg.")
  }
  throw error
}
