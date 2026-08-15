import { existsSync } from "node:fs"
import path from "node:path"

export function resolveBundledDetongerPath(executablePath: string = process.execPath): string {
  const helperName = process.platform === "win32" ? "tuckmark-detonger.exe" : "tuckmark-detonger"
  return path.resolve(path.dirname(executablePath), "../libexec/tuckmark", helperName)
}

export function resolveBundledPreviewEncoderPath(
  executablePath: string = process.execPath
): string {
  const helperName =
    process.platform === "win32"
      ? "tuckmark-detonger-preview-encoder.exe"
      : "tuckmark-detonger-preview-encoder"
  return path.resolve(path.dirname(executablePath), "../libexec/tuckmark", helperName)
}

export function resolveBundledPreviewEncoderCommand(detongerCommand: string): string | undefined {
  if (detongerCommand === "cargo") return undefined
  const expectedDetongerName =
    process.platform === "win32" ? "tuckmark-detonger.exe" : "tuckmark-detonger"
  if (path.basename(detongerCommand) !== expectedDetongerName) return undefined
  const helperName =
    process.platform === "win32"
      ? "tuckmark-detonger-preview-encoder.exe"
      : "tuckmark-detonger-preview-encoder"
  const helper = path.join(path.dirname(detongerCommand), helperName)
  return existsSync(helper) ? helper : undefined
}

export function resolveBundledDetongerCommand(
  env: NodeJS.ProcessEnv = process.env,
  executablePath: string = process.execPath
): string {
  const configured = env.TUCKMARK_DETONGER_COMMAND?.trim()
  if (configured) return configured

  const bundledHelper = resolveBundledDetongerPath(executablePath)
  return existsSync(bundledHelper) ? bundledHelper : "cargo"
}
