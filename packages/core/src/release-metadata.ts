declare const __TUCKMARK_VERSION__: string | undefined
declare const __TUCKMARK_BUILD_SHA__: string | undefined
declare const __TUCKMARK_TARGET__: string | undefined

export type ReleaseMetadata = {
  version: string
  sha: string
  target: string
}

function buildConstant(value: string | undefined, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

export function resolveReleaseMetadata(): ReleaseMetadata {
  return {
    version: buildConstant(
      typeof __TUCKMARK_VERSION__ === "undefined" ? undefined : __TUCKMARK_VERSION__,
      process.env.TUCKMARK_RELEASE_VERSION?.trim() || "0.1.0-dev"
    ),
    sha: buildConstant(
      typeof __TUCKMARK_BUILD_SHA__ === "undefined" ? undefined : __TUCKMARK_BUILD_SHA__,
      process.env.TUCKMARK_BUILD_SHA?.trim() || "unknown"
    ),
    target: buildConstant(
      typeof __TUCKMARK_TARGET__ === "undefined" ? undefined : __TUCKMARK_TARGET__,
      process.env.TUCKMARK_BUILD_TARGET?.trim() || `${process.platform}-${process.arch}`
    ),
  }
}

export function formatReleaseMetadata(): string {
  const metadata = resolveReleaseMetadata()
  return `${metadata.version} ${metadata.sha} ${metadata.target}`
}
