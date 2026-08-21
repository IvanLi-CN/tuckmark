import path from "node:path"

type BunEmbeddedFiles = ReadonlyArray<Blob & { name: string }>

export const EMBEDDED_WEB_CONTROL_PATHS = new Set([
  "/sw.js",
  "/manifest.webmanifest",
  "/version.json",
])

function resolveEmbeddedFiles(): BunEmbeddedFiles {
  const runtime = globalThis as typeof globalThis & {
    Bun?: { embeddedFiles?: BunEmbeddedFiles }
  }
  return runtime.Bun?.embeddedFiles ?? []
}

export function resolveEmbeddedWebAssets(): Map<string, Blob> {
  const assets = new Map<string, Blob>()
  const marker = "apps/web/dist/"
  for (const file of resolveEmbeddedFiles()) {
    const normalizedName = file.name.replaceAll("\\", "/")
    const offset = normalizedName.lastIndexOf(marker)
    if (offset === -1) continue
    assets.set(`/${normalizedName.slice(offset + marker.length)}`, file)
  }
  return assets
}

function requestAssetPath(requestPath: string): string | undefined {
  try {
    const decoded = decodeURIComponent(requestPath)
    if (decoded.includes("\\") || decoded.split("/").includes("..")) return undefined
    return decoded === "/" ? "/index.html" : decoded
  } catch {
    return undefined
  }
}

export async function serveEmbeddedWebAsset(
  requestPath: string,
  res: { type: (value: string) => unknown; send: (value: Buffer) => unknown },
  assets: Map<string, Blob>
): Promise<boolean> {
  const requestedPath = requestAssetPath(requestPath)
  if (!requestedPath) return false
  const asset = assets.get(requestedPath)
  if (!asset) return false
  res.type(path.extname(requestedPath))
  res.send(Buffer.from(await asset.arrayBuffer()))
  return true
}

export async function serveEmbeddedWebIndex(
  res: { type: (value: string) => unknown; send: (value: Buffer) => unknown },
  assets: Map<string, Blob>
): Promise<boolean> {
  const indexAsset = assets.get("/index.html")
  if (!indexAsset) return false
  res.type("html")
  res.send(Buffer.from(await indexAsset.arrayBuffer()))
  return true
}
