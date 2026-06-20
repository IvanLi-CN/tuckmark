import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
  },
  webServer: {
    command: "bun run build:pages && bunx vite preview --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/tuckmark/",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
})
