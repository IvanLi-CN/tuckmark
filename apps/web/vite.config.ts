import path from "node:path"
import { fileURLToPath } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import type { HtmlTagDescriptor, Plugin } from "vite"
import { defineConfig, loadEnv } from "vite"
import {
  resolveAppVersion,
  resolveBuildRef,
  resolveRepositoryUrl,
  resolveRightsUrl,
} from "./build-metadata.js"

export {
  resolveAppVersion,
  resolveBuildRef,
  resolveRepositoryUrl,
  resolveRightsUrl,
} from "./build-metadata.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PWA_MANIFEST_FILE = "manifest.webmanifest"
const SERVICE_WORKER_FILE = "sw.js"

type PwaManifestIcon = {
  src: string
  sizes: string
  type: string
  purpose?: string
}

type PwaManifest = {
  name: string
  short_name: string
  description: string
  start_url: string
  scope: string
  display: "standalone"
  background_color: string
  theme_color: string
  icons: PwaManifestIcon[]
}

type PwaAsset = {
  url: string
  revision: string
}

function normalizeServiceWorkerPath(value: string): string {
  return value.replace(/\\/g, "/")
}

function toServiceWorkerUrl(fileName: string): string {
  return `./${normalizeServiceWorkerPath(fileName)}`
}

export function hashPwaString(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(16)
}

function hashAssetSource(source: string | Uint8Array): string {
  if (typeof source === "string") {
    return hashPwaString(source)
  }
  let hash = 2166136261
  for (const byte of source) {
    hash ^= byte
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(16)
}

export function createPwaManifest(): PwaManifest {
  return {
    name: "Tuckmark Web",
    short_name: "Tuckmark",
    description: "Label printing for people and agents.",
    start_url: "./",
    scope: "./",
    display: "standalone",
    background_color: "#f8f3eb",
    theme_color: "#9b6a44",
    icons: [
      {
        src: "./pwa/tuckmark-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: "./pwa/tuckmark-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
  }
}

export function createPwaHtmlTags(): HtmlTagDescriptor[] {
  return [
    {
      tag: "meta",
      attrs: { name: "theme-color", content: "#9b6a44" },
      injectTo: "head",
    },
    {
      tag: "meta",
      attrs: { name: "description", content: "Label printing for people and agents." },
      injectTo: "head",
    },
    {
      tag: "link",
      attrs: { rel: "manifest", href: "./manifest.webmanifest" },
      injectTo: "head",
    },
    {
      tag: "link",
      attrs: {
        rel: "icon",
        type: "image/png",
        sizes: "192x192",
        href: "./pwa/tuckmark-icon-192.png",
      },
      injectTo: "head",
    },
    {
      tag: "link",
      attrs: { rel: "apple-touch-icon", href: "./pwa/tuckmark-icon-192.png" },
      injectTo: "head",
    },
  ]
}

export function createServiceWorkerSource({
  assets,
  version,
}: {
  assets: PwaAsset[]
  version: string
}): string {
  return `const CACHE_VERSION = ${JSON.stringify(version)}
const APP_CACHE = \`tuckmark-app-\${CACHE_VERSION}\`
const PRECACHE_ASSETS = ${JSON.stringify(assets, null, 2)}
const PRECACHE_URLS = PRECACHE_ASSETS.map((asset) => asset.url)
const NAVIGATION_FALLBACK = "./index.html"

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("tuckmark-app-") && key !== APP_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting()
  }
})

async function respondFromCacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true })
  if (cached) {
    return cached
  }
  return fetch(request)
}

async function respondToNavigation(request) {
  const cached = await caches.match(NAVIGATION_FALLBACK)
  if (cached) {
    return cached
  }
  try {
    return await fetch(request)
  } catch {
    throw new Error("Tuckmark offline navigation fallback is not cached.")
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") {
    return
  }
  if (request.mode === "navigate") {
    event.respondWith(respondToNavigation(request))
    return
  }
  event.respondWith(respondFromCacheFirst(request))
})
`
}

function tuckmarkPwaPlugin(surface: "server-http" | "browser-static"): Plugin {
  return {
    name: "tuckmark-pwa",
    apply: "build",
    transformIndexHtml() {
      if (surface !== "browser-static") {
        return
      }
      return createPwaHtmlTags()
    },
    generateBundle(_options, bundle) {
      if (surface !== "browser-static") {
        return
      }

      const manifestSource = JSON.stringify(createPwaManifest(), null, 2)
      const assets: PwaAsset[] = [
        {
          url: "./",
          revision: "app-shell",
        },
        {
          url: "./404.html",
          revision: "spa-fallback",
        },
        {
          url: "./index.html",
          revision: "app-shell",
        },
        {
          url: "./pwa/tuckmark-icon-192.png",
          revision: "pwa-icon-192",
        },
        {
          url: "./pwa/tuckmark-icon-512.png",
          revision: "pwa-icon-512",
        },
      ]

      for (const [fileName, item] of Object.entries(bundle)) {
        if (fileName === SERVICE_WORKER_FILE) {
          continue
        }
        if (item.type !== "asset" && item.type !== "chunk") {
          continue
        }
        assets.push({
          url: toServiceWorkerUrl(fileName),
          revision: item.type === "chunk" ? hashPwaString(item.code) : hashAssetSource(item.source),
        })
      }

      assets.push({
        url: `./${PWA_MANIFEST_FILE}`,
        revision: manifestSource,
      })

      const uniqueAssets = Array.from(new Map(assets.map((asset) => [asset.url, asset])).values())
        .filter((asset) => asset.url !== `./${SERVICE_WORKER_FILE}`)
        .sort((left, right) => left.url.localeCompare(right.url))
      const version = String(
        uniqueAssets.reduce((hash, asset) => {
          const input = `${asset.url}:${asset.revision}`
          let nextHash = hash
          for (let index = 0; index < input.length; index += 1) {
            nextHash = (nextHash * 31 + input.charCodeAt(index)) >>> 0
          }
          return nextHash
        }, 2166136261)
      )

      this.emitFile({
        type: "asset",
        fileName: PWA_MANIFEST_FILE,
        source: manifestSource,
      })
      this.emitFile({
        type: "asset",
        fileName: SERVICE_WORKER_FILE,
        source: createServiceWorkerSource({
          assets: uniqueAssets,
          version,
        }),
      })
    },
  }
}

export function resolveApiOrigin(env: Record<string, string | undefined>): string {
  if (env.TUCKMARK_API_ORIGIN) {
    return env.TUCKMARK_API_ORIGIN
  }

  const serverPort = env.TUCKMARK_SERVER_PORT ?? "5210"
  return `http://127.0.0.1:${serverPort}`
}

export function resolveBuildSurface(
  env: Record<string, string | undefined>
): "server-http" | "browser-static" {
  return env.TUCKMARK_WEB_SURFACE === "browser-static" ? "browser-static" : "server-http"
}

export function resolveServeBase(
  env: Record<string, string | undefined>,
  command: "serve" | "build"
): string {
  if (command === "serve") {
    return "/"
  }
  return resolveBuildSurface(env) === "browser-static" ? "./" : "/"
}

export function resolvePublicBase(
  env: Record<string, string | undefined>,
  command: "serve" | "build" = "build"
): string {
  return resolveServeBase(env, command)
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const surface = resolveBuildSurface(env)
  const appVersion = resolveAppVersion(env)
  const buildRef = resolveBuildRef(env)
  const repositoryUrl = resolveRepositoryUrl(env)
  const rightsUrl = resolveRightsUrl(env)

  return {
    base: resolvePublicBase(env, command),
    define: {
      __TUCKMARK_APP_VERSION__: JSON.stringify(appVersion),
      __TUCKMARK_BUILD_REF__: JSON.stringify(buildRef),
      __TUCKMARK_REPOSITORY_URL__: JSON.stringify(repositoryUrl),
      __TUCKMARK_RIGHTS_URL__: JSON.stringify(rightsUrl),
      __TUCKMARK_WEB_SURFACE__: JSON.stringify(surface),
      "import.meta.env.TUCKMARK_API_ORIGIN": JSON.stringify(env.TUCKMARK_API_ORIGIN ?? ""),
      "import.meta.env.TUCKMARK_SERVER_PORT": JSON.stringify(env.TUCKMARK_SERVER_PORT ?? ""),
      "import.meta.env.TUCKMARK_WEB_PORT": JSON.stringify(env.TUCKMARK_WEB_PORT ?? ""),
      "import.meta.env.TUCKMARK_WEB_BASE_PATH": JSON.stringify(env.TUCKMARK_WEB_BASE_PATH ?? ""),
      "import.meta.env.TUCKMARK_ENABLE_BROWSER_DIRECT_PRINT": JSON.stringify(
        env.TUCKMARK_ENABLE_BROWSER_DIRECT_PRINT ?? ""
      ),
      "import.meta.env.TUCKMARK_ENABLE_SERVER_SIDE_PRINT": JSON.stringify(
        env.TUCKMARK_ENABLE_SERVER_SIDE_PRINT ?? ""
      ),
    },
    plugins: [react(), tailwindcss(), tuckmarkPwaPlugin(surface)],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: Number(env.TUCKMARK_WEB_PORT ?? 5173),
      proxy: {
        "/api": {
          target: resolveApiOrigin(env),
          changeOrigin: true,
        },
      },
    },
    test: {
      exclude: ["tests/**"],
      testTimeout: 30000,
    },
  }
})
