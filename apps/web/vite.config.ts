import path from "node:path"
import { fileURLToPath } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function resolveApiOrigin(env: Record<string, string | undefined>): string {
  if (env.TUCKMARK_API_ORIGIN) {
    return env.TUCKMARK_API_ORIGIN
  }

  const serverPort = env.TUCKMARK_SERVER_PORT ?? "5210"
  return `http://127.0.0.1:${serverPort}`
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const buildTarget = env.TUCKMARK_WEB_BUILD_TARGET ?? "runtime"
  const base = buildTarget === "pages" ? "/tuckmark/" : "/"

  return {
    base,
    plugins: [react(), tailwindcss()],
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
    },
  }
})
