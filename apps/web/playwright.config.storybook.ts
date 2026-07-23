import { defineConfig } from "@playwright/test"

const externalBaseURL = process.env.TUCKMARK_E2E_BASE_URL
const previewPort = Number(process.env.TUCKMARK_E2E_PORT ?? "6007")
const previewBaseURL = `http://127.0.0.1:${previewPort}`

export default defineConfig({
  testDir: "./tests",
  testMatch: /navigation-transition-layout\.spec\.ts/,
  timeout: 60_000,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: externalBaseURL ?? previewBaseURL,
  },
  webServer: externalBaseURL
    ? undefined
    : {
        command: `bun run build:storybook && node ../../scripts/serve-pages-preview.ts --root ../../work/storybook-web --base / --port ${previewPort}`,
        url: `${previewBaseURL}/iframe.html`,
        timeout: 120_000,
        reuseExistingServer: false,
      },
})
