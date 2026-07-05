import path from "node:path"
import { fileURLToPath } from "node:url"
import type { StorybookConfig } from "@storybook/react-vite"
import tailwindcss from "@tailwindcss/vite"
import { mergeConfig } from "vite"
import rootPackageJson from "../../../package.json" with { type: "json" }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPOSITORY_URL = "https://github.com/IvanLi-CN/tuckmark"
const DEFAULT_RIGHTS_URL = "https://ivanli.cc/"

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs"],
  async viteFinal(baseConfig) {
    return mergeConfig(baseConfig, {
      plugins: [tailwindcss()],
      define: {
        __TUCKMARK_APP_VERSION__: JSON.stringify(
          process.env.TUCKMARK_APP_VERSION || rootPackageJson.version
        ),
        __TUCKMARK_REPOSITORY_URL__: JSON.stringify(
          process.env.TUCKMARK_REPOSITORY_URL || DEFAULT_REPOSITORY_URL
        ),
        __TUCKMARK_RIGHTS_URL__: JSON.stringify(
          process.env.TUCKMARK_RIGHTS_URL || DEFAULT_RIGHTS_URL
        ),
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
