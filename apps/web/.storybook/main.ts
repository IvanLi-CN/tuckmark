import path from "node:path"
import { fileURLToPath } from "node:url"
import type { StorybookConfig } from "@storybook/react-vite"
import tailwindcss from "@tailwindcss/vite"
import { mergeConfig } from "vite"
import {
  resolveAppVersion,
  resolveBuildRef,
  resolveRepositoryUrl,
  resolveRightsUrl,
} from "../build-metadata.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs"],
  async viteFinal(baseConfig) {
    const storybookEnv = {
      ...process.env,
      GITHUB_SHA: process.env.TUCKMARK_BUILD_REF ? process.env.GITHUB_SHA : undefined,
    }

    return mergeConfig(baseConfig, {
      plugins: [tailwindcss()],
      define: {
        __TUCKMARK_APP_VERSION__: JSON.stringify(resolveAppVersion(storybookEnv)),
        __TUCKMARK_BUILD_REF__: JSON.stringify(resolveBuildRef(storybookEnv)),
        __TUCKMARK_REPOSITORY_URL__: JSON.stringify(resolveRepositoryUrl(storybookEnv)),
        __TUCKMARK_RIGHTS_URL__: JSON.stringify(resolveRightsUrl(storybookEnv)),
      },
      resolve: {
        alias: {
          "@": path.resolve(__dirname, "../src"),
        },
      },
    })
  },
}

export default config
