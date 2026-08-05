import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { z } from "zod"

const CONFIG_SCHEMA = "tuckmark.devd-config.v1"
const DATA_MANIFEST_SCHEMA = "tuckmark.data-dir-manifest.v1"
const DATA_STATE_SCHEMA = "tuckmark.devd-data-state.v1"
const DATA_OWNER_SCHEMA = "tuckmark.devd-owner.v1"

const configSchema = z.object({
  schema: z.literal(CONFIG_SCHEMA),
  dataDir: z.string().min(1),
})

export type DevdDataDirectorySource = "environment" | "saved" | "default"

export type DevdDataDirectoryStatus = {
  activeDataDir: string
  activeSource: DevdDataDirectorySource
  savedDataDir?: string
  defaultDataDir: string
  configPath: string
  restartRequired: boolean
}

export type DevdConfigOptions = {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  homeDir?: string
  documentsDir?: string
  configDir?: string
}

function expandLinuxHome(value: string, homeDir: string): string {
  return value.replace(/^\$HOME(?=\/|$)/u, homeDir).replace(/^\$\{HOME\}(?=\/|$)/u, homeDir)
}

function resolveWindowsDocuments(homeDir: string): string {
  try {
    const result = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::GetFolderPath('MyDocuments')"],
      { encoding: "utf8", windowsHide: true }
    ).trim()
    if (result) return path.resolve(result)
  } catch {
    // Fall back to the conventional profile path when PowerShell is unavailable.
  }
  return path.join(homeDir, "Documents")
}

function resolveLinuxDocuments(homeDir: string, env: NodeJS.ProcessEnv): string {
  const configHome = env.XDG_CONFIG_HOME?.trim() || path.join(homeDir, ".config")
  try {
    const content = readFileSync(path.join(configHome, "user-dirs.dirs"), "utf8")
    const match = content.match(/^XDG_DOCUMENTS_DIR=(?:"([^"]+)"|'([^']+)'|([^\n]+))$/mu)
    const configured = match?.[1] ?? match?.[2] ?? match?.[3]?.trim()
    if (configured) return path.resolve(expandLinuxHome(configured, homeDir))
  } catch {
    // Missing XDG user-dir configuration uses the conventional fallback.
  }
  return path.join(homeDir, "Documents")
}

export function resolveDefaultDataDirectory(options: DevdConfigOptions = {}): string {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const homeDir = options.homeDir ?? os.homedir()
  const documentsDir =
    options.documentsDir ??
    (platform === "win32"
      ? resolveWindowsDocuments(homeDir)
      : platform === "linux"
        ? resolveLinuxDocuments(homeDir, env)
        : path.join(homeDir, "Documents"))
  return path.join(documentsDir, "Tuckmark")
}

export function resolveDevdConfigPath(options: DevdConfigOptions = {}): string {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const homeDir = options.homeDir ?? os.homedir()
  const root =
    options.configDir ??
    (platform === "darwin"
      ? path.join(homeDir, "Library", "Application Support", "Tuckmark")
      : platform === "win32"
        ? path.join(env.APPDATA?.trim() || path.join(homeDir, "AppData", "Roaming"), "Tuckmark")
        : path.join(env.XDG_CONFIG_HOME?.trim() || path.join(homeDir, ".config"), "tuckmark"))
  return path.join(root, "devd.json")
}

export function resolveConfiguredDataDirectory(
  options: DevdConfigOptions & { explicitDataDir?: string } = {}
): { dataDir: string; source: "explicit" | DevdDataDirectorySource } {
  if (options.explicitDataDir?.trim()) {
    return { dataDir: path.resolve(options.explicitDataDir.trim()), source: "explicit" }
  }
  const envDataDir = (options.env ?? process.env).TUCKMARK_DATA_DIR?.trim()
  if (envDataDir) return { dataDir: path.resolve(envDataDir), source: "environment" }
  const configPath = resolveDevdConfigPath(options)
  if (existsSync(configPath)) {
    const config = configSchema.parse(readJson(configPath))
    if (!path.isAbsolute(config.dataDir))
      throw new Error("Saved DEVD data directory is not absolute.")
    return { dataDir: path.normalize(config.dataDir), source: "saved" }
  }
  return { dataDir: resolveDefaultDataDirectory(options), source: "default" }
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"))
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporaryPath, filePath)
    if (process.platform !== "win32") chmodSync(filePath, 0o600)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

function isRecognizedDataDirectory(dataDir: string): boolean {
  const entries = readdirSync(dataDir)
  if (entries.length === 0) return true
  const manifestPath = path.join(dataDir, "manifest.json")
  if (existsSync(manifestPath)) {
    return (readJson(manifestPath) as { schema?: unknown }).schema === DATA_MANIFEST_SCHEMA
  }
  const statePath = path.join(dataDir, ".tuckmark", "state.json")
  if (
    existsSync(statePath) &&
    (readJson(statePath) as { schema?: unknown }).schema === DATA_STATE_SCHEMA
  ) {
    return true
  }
  const ownerPath = path.join(dataDir, ".tuckmark", "devd-owner.json")
  return (
    existsSync(ownerPath) &&
    (readJson(ownerPath) as { schema?: unknown }).schema === DATA_OWNER_SCHEMA
  )
}

function prepareDataDirectory(dataDir: string): void {
  if (!path.isAbsolute(dataDir)) throw new Error("DEVD data directory must be an absolute path.")
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  if (!statSync(dataDir).isDirectory()) throw new Error("DEVD data directory must be a directory.")
  if (!isRecognizedDataDirectory(dataDir)) {
    throw new Error(
      "DEVD data directory is non-empty and is not a recognized Tuckmark data directory."
    )
  }
}

export class DevdConfigService {
  readonly configPath: string
  readonly defaultDataDir: string
  private activeDataDir = ""
  private activeSource: DevdDataDirectorySource = "default"

  constructor(private readonly options: DevdConfigOptions = {}) {
    this.configPath = resolveDevdConfigPath(options)
    this.defaultDataDir = resolveDefaultDataDirectory(options)
  }

  resolveStartupDataDirectory(): string {
    const envDataDir = (this.options.env ?? process.env).TUCKMARK_DATA_DIR
    const saved = this.readSavedDataDirectory()
    const selected = envDataDir?.trim()
      ? { dataDir: path.resolve(envDataDir.trim()), source: "environment" as const }
      : saved
        ? { dataDir: saved, source: "saved" as const }
        : { dataDir: this.defaultDataDir, source: "default" as const }

    prepareDataDirectory(selected.dataDir)
    if (selected.source === "default") this.persistDataDirectory(selected.dataDir)
    this.activeDataDir = selected.dataDir
    this.activeSource = selected.source
    return selected.dataDir
  }

  status(): DevdDataDirectoryStatus {
    if (!this.activeDataDir) throw new Error("DEVD configuration has not been initialized.")
    const savedDataDir = this.readSavedDataDirectory()
    return {
      activeDataDir: this.activeDataDir,
      activeSource: this.activeSource,
      ...(savedDataDir ? { savedDataDir } : {}),
      defaultDataDir: this.defaultDataDir,
      configPath: this.configPath,
      restartRequired: Boolean(savedDataDir && savedDataDir !== this.activeDataDir),
    }
  }

  saveDataDirectory(dataDir: string): DevdDataDirectoryStatus {
    if (!path.isAbsolute(dataDir)) throw new Error("DEVD data directory must be an absolute path.")
    const resolved = path.normalize(dataDir)
    prepareDataDirectory(resolved)
    this.persistDataDirectory(resolved)
    return this.status()
  }

  private readSavedDataDirectory(): string | undefined {
    if (!existsSync(this.configPath)) return undefined
    const config = configSchema.parse(readJson(this.configPath))
    if (!path.isAbsolute(config.dataDir))
      throw new Error("Saved DEVD data directory is not absolute.")
    return path.normalize(config.dataDir)
  }

  private persistDataDirectory(dataDir: string): void {
    writeJsonAtomic(this.configPath, { schema: CONFIG_SCHEMA, dataDir })
  }
}
