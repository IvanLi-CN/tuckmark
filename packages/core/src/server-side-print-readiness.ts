import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(moduleDir, "../../..")
const defaultDetongerRepoRoot = path.resolve(moduleDir, "../../../detonger")
const defaultPreviewEncoderManifestPath = path.resolve(
  moduleDir,
  "../../../tools/detonger-preview-encoder/Cargo.toml"
)

export function isServerSidePrintEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.TUCKMARK_ENABLE_SERVER_SIDE_PRINT?.trim()
  return raw !== "0" && raw?.toLowerCase() !== "false"
}

export function assertServerSidePrintRuntimeReady(env: NodeJS.ProcessEnv = process.env): void {
  if (!isServerSidePrintEnabled(env)) {
    return
  }

  const command = env.TUCKMARK_DETONGER_COMMAND?.trim() || "cargo"
  const packetEncoder = env.TUCKMARK_DETONGER_PACKET_ENCODER?.trim().toLowerCase() || "rust"

  const resolvedRepoRoot = path.resolve(
    repoRoot,
    env.TUCKMARK_DETONGER_REPO_ROOT ?? defaultDetongerRepoRoot
  )
  const manifestPath = defaultPreviewEncoderManifestPath

  const messageBase =
    "Service-api print path is enabled, but detonger runtime is not ready. Disable TUCKMARK_ENABLE_SERVER_SIDE_PRINT=0 or initialize the detonger workspace."

  const manifestDir = path.dirname(manifestPath)
  if (
    !path.isAbsolute(resolvedRepoRoot) ||
    !path.isAbsolute(manifestPath) ||
    !path.isAbsolute(manifestDir)
  ) {
    throw new Error(`${messageBase} Invalid detonger/runtime path configuration.`)
  }

  if (!fs.existsSync(resolvedRepoRoot)) {
    throw new Error(`${messageBase} Missing detonger repo root: ${resolvedRepoRoot}`)
  }
  if (!fs.existsSync(path.join(resolvedRepoRoot, "Cargo.toml"))) {
    throw new Error(`${messageBase} Missing detonger Cargo.toml at ${resolvedRepoRoot}`)
  }

  const requiresPreviewEncoderManifest = command === "cargo" && packetEncoder === "rust"
  if (requiresPreviewEncoderManifest && !fs.existsSync(manifestPath)) {
    throw new Error(`${messageBase} Missing preview encoder manifest: ${manifestPath}`)
  }
}
