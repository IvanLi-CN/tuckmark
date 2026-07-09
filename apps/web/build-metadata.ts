import rootPackageJson from "../../package.json" with { type: "json" }

import {
  normalizeBuildRef,
  normalizeRuntimeBuildMetadata,
  normalizeVersionTag,
  type RuntimeBuildMetadata,
} from "./src/version-metadata.js"

const DEFAULT_REPOSITORY_URL = "https://github.com/IvanLi-CN/tuckmark"
const DEFAULT_RIGHTS_URL = "https://ivanli.cc/"

export function resolveBuildRef(env: Record<string, string | undefined>): string {
  return normalizeBuildRef(env.TUCKMARK_BUILD_REF || env.GITHUB_SHA || "")
}

export function resolveAppVersion(env: Record<string, string | undefined>): string {
  const explicitVersion = normalizeVersionTag(
    env.TUCKMARK_APP_VERSION || (env.GITHUB_REF_TYPE === "tag" ? env.GITHUB_REF_NAME : "")
  )
  if (explicitVersion) {
    return explicitVersion
  }
  return resolveBuildRef(env) ? "" : rootPackageJson.version
}

export function resolveRuntimeBuildMetadata(
  env: Record<string, string | undefined>
): RuntimeBuildMetadata {
  return normalizeRuntimeBuildMetadata({
    appVersion: resolveAppVersion(env),
    buildRef: resolveBuildRef(env),
  })
}

export function createRuntimeBuildMetadataSource(metadata: RuntimeBuildMetadata): string {
  return `${JSON.stringify(metadata, null, 2)}\n`
}

export function resolveRepositoryUrl(env: Record<string, string | undefined>): string {
  return env.TUCKMARK_REPOSITORY_URL || DEFAULT_REPOSITORY_URL
}

export function resolveRightsUrl(env: Record<string, string | undefined>): string {
  return env.TUCKMARK_RIGHTS_URL || DEFAULT_RIGHTS_URL
}
