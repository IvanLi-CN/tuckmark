import path from "node:path"
import { fileURLToPath } from "node:url"

import type { UserConfig } from "vitest/config"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "..")

export function withWorkspaceCoreAlias(config: UserConfig = {}): UserConfig {
  return {
    ...config,
    resolve: {
      ...(config.resolve ?? {}),
      alias: {
        ...(config.resolve?.alias ?? {}),
        "@tuckmark/core": path.join(repoRoot, "packages/core/src/index.ts"),
      },
    },
  }
}
