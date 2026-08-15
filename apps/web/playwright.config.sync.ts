import path from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig } from "@playwright/test"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "../..")
const syncRoot = path.join(repoRoot, "work", "playwright-sync")
const syncPort = Number(process.env.TUCKMARK_SYNC_E2E_PORT ?? "4210")
const syncInstance = process.env.TUCKMARK_DEVD_INSTANCE ?? `sync-${syncPort}-${process.pid}`
const syncBaseURL = `http://127.0.0.1:${syncPort}`
const browserChannel = process.env.TUCKMARK_E2E_BROWSER_CHANNEL === "chrome" ? "chrome" : undefined

export default defineConfig({
  testDir: "./tests",
  testMatch: /sync\.spec\.ts/,
  timeout: 90_000,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: syncBaseURL,
    channel: browserChannel,
  },
  webServer: {
    command: [
      "rm -rf work/playwright-sync",
      "mkdir -p work/playwright-sync",
      "bun run build",
      "cd work/playwright-sync",
      `PORT=${syncPort} TUCKMARK_WEB_DIST=../../apps/web/dist node ../../packages/server/dist/entry.js`,
    ].join(" && "),
    url: `${syncBaseURL}/health`,
    timeout: 240_000,
    reuseExistingServer: false,
    cwd: repoRoot,
    env: {
      TUCKMARK_ENABLE_SERVER_SIDE_PRINT: "0",
      TUCKMARK_DATA_DIR: syncRoot,
      TUCKMARK_DEVD_INSTANCE: syncInstance,
      HOME: process.env.HOME ?? "",
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
    },
  },
  metadata: {
    syncRoot,
  },
})
