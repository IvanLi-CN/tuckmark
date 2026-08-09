import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
export type DevdConfigOptions = { explicitDataDir?: string; dataDir?: string }

function resolveConfiguredDataDirectory(options: DevdConfigOptions) {
  const dataDir = options.explicitDataDir || options.dataDir || process.env.TUCKMARK_DATA_DIR
  if (!dataDir) throw new Error("Set TUCKMARK_DATA_DIR or pass an explicit source directory.")
  return { dataDir: path.resolve(dataDir) }
}

const COPY_SCHEMA = "tuckmark.dev-data-copy.v1"
const DATA_SCHEMA = "tuckmark.data-dir-manifest.v1"
const BUSINESS_ENTRIES = ["settings", "templates", "drafts", "inventory"] as const

type DataCounts = {
  templates: number
  versions: number
  workingCopies: number
  materials: number
  adjustments: number
}

function parseManifest(value: unknown): { counts: DataCounts } {
  const record = value as { schema?: unknown; counts?: Record<string, unknown> }
  if (record?.schema !== DATA_SCHEMA || !record.counts) {
    throw new Error("Development data source has an invalid Tuckmark manifest.")
  }
  const keys: Array<keyof DataCounts> = [
    "templates",
    "versions",
    "workingCopies",
    "materials",
    "adjustments",
  ]
  const counts = Object.fromEntries(
    keys.map((key) => {
      const count = record.counts?.[key]
      if (!Number.isInteger(count) || Number(count) < 0) {
        throw new Error(`Development data manifest has an invalid ${key} count.`)
      }
      return [key, Number(count)]
    })
  ) as DataCounts
  return { counts }
}

function parseMarker(value: unknown): { sourceDataDir: string } {
  const record = value as { schema?: unknown; sourceDataDir?: unknown; preparedAt?: unknown }
  if (
    record?.schema !== COPY_SCHEMA ||
    typeof record.sourceDataDir !== "string" ||
    !record.sourceDataDir ||
    typeof record.preparedAt !== "string" ||
    !record.preparedAt
  ) {
    throw new Error("Development data copy marker is invalid.")
  }
  return { sourceDataDir: record.sourceDataDir }
}

export type PrepareDevelopmentDataOptions = DevdConfigOptions & {
  cwd?: string
  explicitSource?: string
  refresh?: boolean
  tempDir?: string
}

export function resolveRepositoryIdentity(cwd = process.cwd()): { hash: string; root: string } {
  let root = path.resolve(cwd)
  try {
    root = path.resolve(
      execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: root,
        encoding: "utf8",
      }).trim()
    )
  } catch {
    // Non-repository test fixtures use their explicit absolute path.
  }
  return { root, hash: createHash("sha256").update(root).digest("hex").slice(0, 8) }
}

export function resolveDevelopmentDataDirectory(
  cwd = process.cwd(),
  tempDir = os.tmpdir()
): string {
  const { hash } = resolveRepositoryIdentity(cwd)
  return path.join(tempDir, "tuckmark-devd-dev", hash, "data")
}

export function resolveDevelopmentInstance(cwd = process.cwd()): string {
  return `dev-${resolveRepositoryIdentity(cwd).hash}`
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

async function countJsonFiles(
  root: string,
  matcher: (relativePath: string) => boolean
): Promise<number> {
  if (!(await exists(root))) return 0
  let count = 0
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.isFile()) {
        const relative = path.relative(root, absolute).split(path.sep).join("/")
        if (matcher(relative)) count += 1
      }
    }
  }
  await visit(root)
  return count
}

async function validateCopiedData(dataDir: string): Promise<void> {
  const manifest = parseManifest(
    JSON.parse(await readFile(path.join(dataDir, "manifest.json"), "utf8"))
  )
  const counts = {
    templates: await countJsonFiles(path.join(dataDir, "templates"), (item) =>
      item.endsWith("/template.json")
    ),
    versions: await countJsonFiles(
      path.join(dataDir, "templates"),
      (item) => item.includes("/versions/") && item.endsWith(".json")
    ),
    workingCopies:
      (await countJsonFiles(path.join(dataDir, "templates"), (item) =>
        item.endsWith("/working-copy.json")
      )) + (await countJsonFiles(path.join(dataDir, "drafts"), (item) => item.endsWith(".json"))),
    materials: await countJsonFiles(path.join(dataDir, "inventory", "materials"), (item) =>
      item.endsWith(".json")
    ),
    adjustments: await countJsonFiles(path.join(dataDir, "inventory", "adjustments"), (item) =>
      item.endsWith(".json")
    ),
  }
  if (JSON.stringify(counts) !== JSON.stringify(manifest.counts)) {
    throw new Error("Development data copy does not match the source manifest counts.")
  }
}

async function readPreparedMarker(dataDir: string) {
  return parseMarker(
    JSON.parse(await readFile(path.join(dataDir, ".tuckmark-dev-copy.json"), "utf8"))
  )
}

export async function findPreparedDevelopmentData(
  options: Pick<PrepareDevelopmentDataOptions, "cwd" | "tempDir"> = {}
): Promise<string | undefined> {
  const target = resolveDevelopmentDataDirectory(options.cwd, options.tempDir)
  try {
    await readPreparedMarker(target)
    await validateCopiedData(target)
    return target
  } catch {
    return undefined
  }
}

export async function prepareDevelopmentData(options: PrepareDevelopmentDataOptions = {}) {
  const source = resolveConfiguredDataDirectory({
    ...options,
    explicitDataDir: options.explicitSource,
  }).dataDir
  const target = resolveDevelopmentDataDirectory(options.cwd, options.tempDir)

  if (await exists(target)) {
    try {
      const marker = await readPreparedMarker(target)
      await validateCopiedData(target)
      if (!options.refresh && path.resolve(marker.sourceDataDir) === path.resolve(source)) {
        return { status: "skipped" as const, sourceDataDir: source, dataDir: target }
      }
      if (!options.refresh) {
        throw new Error(
          "Prepared development data is stale or belongs to another source; rerun with --refresh."
        )
      }
    } catch (error) {
      if (!options.refresh) {
        throw new Error(
          `Prepared development data is invalid; rerun with --refresh. ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }

  const parent = path.dirname(target)
  await mkdir(parent, { recursive: true })
  const staging = await mkdtemp(path.join(parent, "data.staging-"))
  const previous = path.join(parent, `data.previous-${randomUUID()}`)
  let movedPrevious = false
  try {
    const manifestBefore = await readFile(path.join(source, "manifest.json"), "utf8")
    for (const entry of BUSINESS_ENTRIES) {
      const sourcePath = path.join(source, entry)
      if (await exists(sourcePath))
        await cp(sourcePath, path.join(staging, entry), { recursive: true })
    }
    const manifestAfter = await readFile(path.join(source, "manifest.json"), "utf8")
    if (manifestBefore !== manifestAfter) {
      throw new Error("Source data changed while the development copy was being prepared; retry.")
    }
    await writeFile(path.join(staging, "manifest.json"), manifestAfter, "utf8")
    await writeFile(
      path.join(staging, ".tuckmark-dev-copy.json"),
      `${JSON.stringify({ schema: COPY_SCHEMA, sourceDataDir: source, preparedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8"
    )
    await validateCopiedData(staging)

    if (await exists(target)) {
      await rename(target, previous)
      movedPrevious = true
    }
    await rename(staging, target)
    if (movedPrevious) await rm(previous, { recursive: true, force: true })
    return { status: "prepared" as const, sourceDataDir: source, dataDir: target }
  } catch (error) {
    if (movedPrevious && !(await exists(target))) await rename(previous, target)
    throw error
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
