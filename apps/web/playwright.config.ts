import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  testIgnore: /sync\.spec\.ts/,
  timeout: 60_000,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
  },
  webServer: {
    command:
      "TUCKMARK_BUILD_REF=e499426 bun run build:pages && bun ../../scripts/serve-pages-preview.ts --root dist --base / --port 4173",
    url: "http://127.0.0.1:4173/",
    timeout: 120_000,
    reuseExistingServer: false,
  },
})
