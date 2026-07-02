import { defineConfig } from "vitest/config"

import { withWorkspaceCoreAlias } from "../../scripts/vitest.workspace-alias.js"

export default defineConfig(
  withWorkspaceCoreAlias({
    test: {
      hookTimeout: 30_000,
      testTimeout: 30_000,
    },
  })
)
