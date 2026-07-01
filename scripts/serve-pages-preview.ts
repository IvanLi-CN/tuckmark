#!/usr/bin/env bun

import fs from "node:fs/promises"
import http from "node:http"
import path from "node:path"

function parseFlag(name: string, fallback: string): string {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return fallback
  }

  return process.argv[index + 1] ?? fallback
}

function normalizeBasePath(value: string): string {
  if (!value || value === "/") {
    return "/"
  }

  const trimmed = value.startsWith("/") ? value : `/${value}`
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case ".webmanifest":
      return "application/manifest+json; charset=utf-8"
    case ".css":
      return "text/css; charset=utf-8"
    case ".js":
      return "text/javascript; charset=utf-8"
    case ".json":
      return "application/json; charset=utf-8"
    case ".svg":
      return "image/svg+xml"
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".webp":
      return "image/webp"
    default:
      return "text/html; charset=utf-8"
  }
}

async function sendFile(
  res: http.ServerResponse<http.IncomingMessage>,
  filePath: string,
  statusCode = 200
): Promise<void> {
  const body = await fs.readFile(filePath)
  res.writeHead(statusCode, { "content-type": contentType(filePath) })
  res.end(body)
}

const root = path.resolve(parseFlag("--root", "apps/web/dist"))
const basePath = normalizeBasePath(parseFlag("--base", "/"))
const port = Number.parseInt(parseFlag("--port", "4173"), 10)
const indexPath = path.join(root, "index.html")

function resolveStaticPath(relativePath: string): string | null {
  const normalized = relativePath || "index.html"
  const candidate = path.resolve(root, normalized)
  const relativeToRoot = path.relative(root, candidate)
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return null
  }
  return candidate
}

function requestAcceptsHtml(req: http.IncomingMessage): boolean {
  return req.headers.accept?.includes("text/html") ?? false
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`)
    const pathname = decodeURIComponent(url.pathname)
    const relativePath = pathname.startsWith(basePath)
      ? pathname.slice(basePath.length)
      : pathname.slice(1)

    if (pathname === "/" && basePath !== "/") {
      res.writeHead(302, { location: basePath })
      res.end()
      return
    }

    const staticPath = resolveStaticPath(relativePath)
    if (staticPath) {
      try {
        const assetStat = await fs.stat(staticPath)
        if (assetStat.isFile()) {
          await sendFile(res, staticPath)
          return
        }
      } catch {
        const looksLikeStaticFile = path.extname(relativePath) !== ""
        if (looksLikeStaticFile || !requestAcceptsHtml(req)) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
          res.end("Not Found")
          return
        }
      }
    }

    await sendFile(res, indexPath)
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" })
    res.end(error instanceof Error ? error.message : String(error))
  }
})

server.listen(port, "127.0.0.1", () => {
  console.log(`Pages preview listening on http://127.0.0.1:${port}${basePath}`)
})
