import { defineConfig } from "@playwright/test"

const externalBaseURL = process.env.TUCKMARK_E2E_BASE_URL
const previewPort = Number(process.env.TUCKMARK_E2E_PORT ?? "4173")
const previewBaseURL = `http://127.0.0.1:${previewPort}`

export default defineConfig({
  testDir: "./tests",
  testIgnore: /sync\.spec\.ts/,
  timeout: 60_000,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: externalBaseURL ?? previewBaseURL,
  },
  webServer: externalBaseURL
    ? undefined
    : {
        command: `TUCKMARK_BUILD_REF=e499426 bun run build:pages && bun ../../scripts/serve-pages-preview.ts --root dist --base / --port ${previewPort}`,
        url: `${previewBaseURL}/`,
        timeout: 120_000,
        reuseExistingServer: false,
      },
})
