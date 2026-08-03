import { configDefaults, defineConfig } from "vitest/config"

import { withWorkspaceCoreAlias } from "../../scripts/vitest.workspace-alias.js"

const workspaceConfig = withWorkspaceCoreAlias()

export default defineConfig({
  ...workspaceConfig,
  test: {
    ...workspaceConfig.test,
    exclude: [...configDefaults.exclude, "dist/**"],
  },
})
