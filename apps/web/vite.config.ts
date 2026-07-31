import path from "node:path"
import { fileURLToPath } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import type { HtmlTagDescriptor, Plugin } from "vite"
import { defineConfig, loadEnv } from "vite"
import {
  createRuntimeBuildMetadataSource,
  resolveRepositoryUrl,
  resolveRightsUrl,
  resolveRuntimeBuildMetadata,
} from "./build-metadata.js"
import type { RuntimeBuildMetadata } from "./src/version-metadata.js"

export {
  createRuntimeBuildMetadataSource,
  resolveAppVersion,
  resolveBuildRef,
  resolveRepositoryUrl,
  resolveRightsUrl,
  resolveRuntimeBuildMetadata,
} from "./build-metadata.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PWA_MANIFEST_FILE = "manifest.webmanifest"
const SERVICE_WORKER_FILE = "sw.js"
const VERSION_METADATA_FILE = "version.json"

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
    background_color: "#F6EFE6",
    theme_color: "#9b6a44",
    icons: [
      {
        src: "./pwa/tuckmark-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "./pwa/tuckmark-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "./pwa/tuckmark-icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "./pwa/tuckmark-icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
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
      attrs: {
        rel: "manifest",
        href: "./manifest.webmanifest",
        "data-tuckmark-pwa": "true",
      },
      injectTo: "head",
    },
    {
      tag: "link",
      attrs: {
        rel: "icon",
        type: "image/svg+xml",
        href: "./pwa/tuckmark-favicon.svg",
      },
      injectTo: "head",
    },
    {
      tag: "link",
      attrs: {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "./pwa/tuckmark-favicon-32.png",
      },
      injectTo: "head",
    },
    {
      tag: "link",
      attrs: {
        rel: "icon",
        type: "image/png",
        sizes: "48x48",
        href: "./pwa/tuckmark-favicon-48.png",
      },
      injectTo: "head",
    },
    {
      tag: "link",
      attrs: {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: "./pwa/tuckmark-favicon-16.png",
      },
      injectTo: "head",
    },
    {
      tag: "link",
      attrs: { rel: "icon", type: "image/x-icon", href: "./pwa/favicon.ico" },
      injectTo: "head",
    },
    {
      tag: "link",
      attrs: {
        rel: "apple-touch-icon",
        type: "image/png",
        sizes: "120x120",
        href: "./pwa/tuckmark-apple-touch-icon-120.png",
      },
      injectTo: "head",
    },
    {
      tag: "link",
      attrs: {
        rel: "apple-touch-icon",
        type: "image/png",
        sizes: "152x152",
        href: "./pwa/tuckmark-apple-touch-icon-152.png",
      },
      injectTo: "head",
    },
    {
      tag: "link",
      attrs: {
        rel: "apple-touch-icon",
        type: "image/png",
        sizes: "167x167",
        href: "./pwa/tuckmark-apple-touch-icon-167.png",
      },
      injectTo: "head",
    },
    {
      tag: "link",
      attrs: {
        rel: "apple-touch-icon",
        type: "image/png",
        sizes: "180x180",
        href: "./pwa/tuckmark-apple-touch-icon-180.png",
      },
      injectTo: "head",
    },
  ]
}

export function createServiceWorkerSource({
  assets,
  version,
  versionMetadataFile,
}: {
  assets: PwaAsset[]
  version: string
  versionMetadataFile: string
}): string {
  return `const CACHE_VERSION = ${JSON.stringify(version)}
const APP_CACHE = \`tuckmark-app-\${CACHE_VERSION}\`
const PRECACHE_ASSETS = ${JSON.stringify(assets, null, 2)}
const NAVIGATION_FALLBACK = "./index.html"
const VERSION_METADATA_URL = ${JSON.stringify(`./${versionMetadataFile}`)}
const CACHE_READY_MARKER = "./__tuckmark-cache-ready__"

async function cacheCompleteApp() {
  const cache = await caches.open(APP_CACHE)
  await cache.addAll(PRECACHE_ASSETS.map((asset) => asset.url))
  await cache.put(
    CACHE_READY_MARKER,
    new Response(JSON.stringify({ version: CACHE_VERSION, assetCount: PRECACHE_ASSETS.length }), {
      headers: { "content-type": "application/json" },
    })
  )
}

async function getReadyCache() {
  const cache = await caches.open(APP_CACHE)
  const marker = await cache.match(CACHE_READY_MARKER)
  return marker ? cache : null
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheCompleteApp())
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
  const cache = await getReadyCache()
  const cached = cache ? await cache.match(request, { ignoreSearch: true }) : undefined
  if (cached) {
    return cached
  }
  return fetch(request)
}

async function respondToNavigation(request) {
  const cache = await getReadyCache()
  const cached = cache ? await cache.match(NAVIGATION_FALLBACK) : undefined
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
  const requestUrl = new URL(request.url)
  if (requestUrl.pathname.endsWith(VERSION_METADATA_URL.slice(1))) {
    event.respondWith(fetch(request))
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

function tuckmarkPwaPlugin(
  surface: "server-http" | "browser-static",
  runtimeBuildMetadata: RuntimeBuildMetadata
): Plugin {
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
      const versionMetadataSource = createRuntimeBuildMetadataSource(runtimeBuildMetadata)
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
        {
          tier: "shell",
          url: "./pwa/tuckmark-icon-maskable-192.png",
          revision: "pwa-icon-maskable-192",
        },
        {
          tier: "shell",
          url: "./pwa/tuckmark-icon-maskable-512.png",
          revision: "pwa-icon-maskable-512",
        },
        {
          tier: "shell",
          url: "./pwa/tuckmark-apple-touch-icon-120.png",
          revision: "pwa-apple-touch-icon-120",
        },
        {
          tier: "shell",
          url: "./pwa/tuckmark-apple-touch-icon-152.png",
          revision: "pwa-apple-touch-icon-152",
        },
        {
          tier: "shell",
          url: "./pwa/tuckmark-apple-touch-icon-167.png",
          revision: "pwa-apple-touch-icon-167",
        },
        {
          tier: "shell",
          url: "./pwa/tuckmark-apple-touch-icon-180.png",
          revision: "pwa-apple-touch-icon-180",
        },
        {
          tier: "shell",
          url: "./pwa/tuckmark-favicon.svg",
          revision: "pwa-favicon-svg",
        },
        {
          tier: "shell",
          url: "./pwa/tuckmark-favicon-16.png",
          revision: "pwa-favicon-16",
        },
        {
          tier: "shell",
          url: "./pwa/tuckmark-favicon-32.png",
          revision: "pwa-favicon-32",
        },
        {
          tier: "shell",
          url: "./pwa/tuckmark-favicon-48.png",
          revision: "pwa-favicon-48",
        },
        {
          tier: "shell",
          url: "./pwa/favicon.ico",
          revision: "pwa-favicon-ico",
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
        fileName: VERSION_METADATA_FILE,
        source: versionMetadataSource,
      })
      this.emitFile({
        type: "asset",
        fileName: SERVICE_WORKER_FILE,
        source: createServiceWorkerSource({
          assets: uniqueAssets,
          version,
          versionMetadataFile: VERSION_METADATA_FILE,
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
  const runtimeBuildMetadata = resolveRuntimeBuildMetadata(env)
  const appVersion = runtimeBuildMetadata.appVersion
  const buildRef = runtimeBuildMetadata.buildRef
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
    plugins: [react(), tailwindcss(), tuckmarkPwaPlugin(surface, runtimeBuildMetadata)],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = normalizeServiceWorkerPath(id)
            if (
              normalizedId.includes("/@fontsource/") ||
              normalizedId.includes("/@fontsource-variable/")
            ) {
              if (
                normalizedId.includes("@fontsource-variable/inter/") ||
                normalizedId.includes("@fontsource-variable/noto-sans-sc/") ||
                normalizedId.includes("@fontsource/inter-tight/")
              ) {
                return
              }
              return "feature-fonts"
            }
            if (
              normalizedId.endsWith("/src/runtime-fonts.css") ||
              normalizedId.endsWith("/src/browser-print-payload.ts") ||
              normalizedId.endsWith("/src/browser-print-wasm.ts") ||
              normalizedId.endsWith("/src/user-template-sqlite-worker.ts") ||
              normalizedId.includes("/@sqlite.org/sqlite-wasm/") ||
              normalizedId.includes("/bwip-js/") ||
              normalizedId.includes("/jsbarcode/") ||
              normalizedId.includes("/qrcode/")
            ) {
              return "feature-runtime"
            }
            return
          },
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@tuckmark/inventory": path.resolve(__dirname, "../../plugins/inventory/src/index.ts"),
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
    optimizeDeps: {
      exclude: ["@sqlite.org/sqlite-wasm"],
    },
    test: {
      exclude: ["tests/**"],
      testTimeout: 30000,
    },
  }
})
