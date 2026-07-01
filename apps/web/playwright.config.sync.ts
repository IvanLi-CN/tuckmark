import path from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig } from "@playwright/test"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "../..")
const syncRoot = path.join(repoRoot, "work", "playwright-sync")

export default defineConfig({
  testDir: "./tests",
  testMatch: /sync\.spec\.ts/,
  timeout: 90_000,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4210",
  },
  webServer: {
    command: [
      "rm -rf work/playwright-sync",
      "mkdir -p work/playwright-sync",
      "bun run build",
      "cd work/playwright-sync",
      "PORT=4210 TUCKMARK_WEB_DIST=../../apps/web/dist node ../../packages/server/dist/index.js",
    ].join(" && "),
    url: "http://127.0.0.1:4210/health",
    timeout: 240_000,
    reuseExistingServer: false,
    cwd: repoRoot,
    env: {
      TUCKMARK_ENABLE_SERVER_SIDE_PRINT: "0",
      HOME: process.env.HOME ?? "",
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
    },
  },
  metadata: {
    syncRoot,
  },
})
