import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "..")
const outDir = path.join(repoRoot, "apps/web/src/wasm/pkg")
const wasmCrateDir = path.join(repoRoot, "detonger/crates/detonger-wasm")
const detongerToolchainFile = path.join(repoRoot, "detonger/rust-toolchain.toml")
const wasmPackRoot = path.join(repoRoot, ".tuckmark/tools/wasm-pack")
const wasmPackBin = path.join(
  wasmPackRoot,
  "bin",
  process.platform === "win32" ? "wasm-pack.exe" : "wasm-pack"
)
const wasmBuildLockPath = path.join(repoRoot, ".tuckmark/tools/.detonger-wasm-build.lock")
const args = process.argv.slice(2)
const profileFlag = args.includes("--release") ? "--release" : "--dev"

function commandExists(command, commandArgs = ["--version"]) {
  try {
    execFileSync(command, commandArgs, {
      stdio: "ignore",
    })
    return true
  } catch {
    return false
  }
}

function ensureWasmPack() {
  if (fs.existsSync(wasmPackBin)) {
    return wasmPackBin
  }
  if (commandExists("wasm-pack")) {
    return "wasm-pack"
  }
  if (!commandExists("cargo", ["--version"])) {
    throw new Error("wasm-pack is unavailable and cargo is not installed.")
  }

  fs.mkdirSync(wasmPackRoot, { recursive: true })
  execFileSync(
    "cargo",
    ["install", "wasm-pack", "--locked", "--version", "0.14.0", "--root", wasmPackRoot],
    {
      cwd: repoRoot,
      stdio: "inherit",
    }
  )

  if (!fs.existsSync(wasmPackBin)) {
    throw new Error(`wasm-pack bootstrap did not produce ${wasmPackBin}.`)
  }

  return wasmPackBin
}

function resolveDetongerToolchain() {
  if (!fs.existsSync(detongerToolchainFile)) {
    return null
  }
  const contents = fs.readFileSync(detongerToolchainFile, "utf8")
  const match = contents.match(/channel\s*=\s*"([^"]+)"/)
  return match?.[1] ?? "stable"
}

function ensureWasmTarget(toolchain) {
  if (!commandExists("rustup", ["--version"])) {
    throw new Error("rustup is required to provision the wasm32 target for detonger-wasm.")
  }

  const installedTargets = execFileSync(
    "rustup",
    ["target", "list", "--installed", "--toolchain", toolchain],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }
  )

  if (installedTargets.split(/\r?\n/).includes("wasm32-unknown-unknown")) {
    return
  }

  execFileSync("rustup", ["target", "add", "wasm32-unknown-unknown", "--toolchain", toolchain], {
    cwd: repoRoot,
    stdio: "inherit",
  })
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function acquireBuildLock() {
  fs.mkdirSync(path.dirname(wasmBuildLockPath), { recursive: true })
  const startedAt = Date.now()
  const timeoutMs = 120000

  while (true) {
    try {
      const fd = fs.openSync(wasmBuildLockPath, "wx")
      fs.writeFileSync(fd, `${process.pid}\n`, "utf8")
      return fd
    } catch (error) {
      const nodeError = error
      if (
        !(
          nodeError &&
          typeof nodeError === "object" &&
          "code" in nodeError &&
          nodeError.code === "EEXIST"
        )
      ) {
        throw error
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for ${wasmBuildLockPath}.`)
      }
      sleep(250)
    }
  }
}

function releaseBuildLock(fd) {
  fs.closeSync(fd)
  fs.rmSync(wasmBuildLockPath, { force: true })
}

let buildLockFd

try {
  if (!fs.existsSync(wasmCrateDir) || !fs.existsSync(detongerToolchainFile)) {
    console.warn("detonger submodule is unavailable; skipping detonger-wasm build.")
    process.exit(0)
  }
  buildLockFd = acquireBuildLock()
  const wasmPackCommand = ensureWasmPack()
  const toolchain = resolveDetongerToolchain()
  if (!toolchain) {
    console.warn("detonger toolchain metadata is unavailable; skipping detonger-wasm build.")
    process.exit(0)
  }
  ensureWasmTarget(toolchain)
  fs.rmSync(outDir, { recursive: true, force: true })
  execFileSync(
    wasmPackCommand,
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
} finally {
  if (typeof buildLockFd === "number") {
    releaseBuildLock(buildLockFd)
  }
}
