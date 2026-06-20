import { defineConfig } from "vitest/config"

import { withWorkspaceCoreAlias } from "../../scripts/vitest.workspace-alias.js"

export default defineConfig(withWorkspaceCoreAlias())
