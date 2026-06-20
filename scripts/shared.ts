import { access, copyFile, mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true })
}

export async function copyMissingFile(sourcePath: string, targetPath: string): Promise<boolean> {
  if (await fileExists(targetPath)) {
    return false
  }

  await ensureDir(path.dirname(targetPath))
  await copyFile(sourcePath, targetPath)
  return true
}

export async function readSyncManifest(
  manifestPath: string
): Promise<Array<{ source: string; target: string }>> {
  const raw = await readFile(manifestPath, "utf8")
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const [source, target] = line.split("->").map((part) => part.trim())
      if (!source || !target) {
        throw new Error(`Invalid worktree sync line: ${line}`)
      }
      return { source, target }
    })
}
