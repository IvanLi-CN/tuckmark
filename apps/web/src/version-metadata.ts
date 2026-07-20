export type FooterVersionMetadata = {
  visibleLabel: string | null
  tooltipLabel: string | null
  ariaLabel: string | null
  linkHref: string | null
}

export type RuntimeBuildMetadata = {
  appVersion: string
  buildRef: string
}

type GitHubRepositoryCoordinates = {
  owner: string
  repo: string
}

const OCTORILL_ORIGIN = "https://octo-rill.ivanli.cc"

export function normalizeVersionTag(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? ""
  if (!trimmed) {
    return ""
  }
  return trimmed.replace(/^v(?=\d+\.\d+\.\d+)/, "")
}

export function normalizeBuildRef(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? ""
  if (!trimmed) {
    return ""
  }
  if (/^[0-9a-f]{8,40}$/i.test(trimmed)) {
    return trimmed.slice(0, 7).toLowerCase()
  }
  return trimmed
}

export function normalizeRuntimeBuildMetadata({
  appVersion,
  buildRef,
}: {
  appVersion?: string | null
  buildRef?: string | null
}): RuntimeBuildMetadata {
  return {
    appVersion: normalizeVersionTag(appVersion),
    buildRef: normalizeBuildRef(buildRef),
  }
}

export function hasBuildMetadataMismatch(
  current: {
    appVersion?: string | null
    buildRef?: string | null
  },
  next: {
    appVersion?: string | null
    buildRef?: string | null
  }
): boolean {
  const normalizedCurrent = normalizeRuntimeBuildMetadata(current)
  const normalizedNext = normalizeRuntimeBuildMetadata(next)

  const buildRefChanged =
    (normalizedCurrent.buildRef || normalizedNext.buildRef) &&
    normalizedCurrent.buildRef !== normalizedNext.buildRef
  if (buildRefChanged) {
    return true
  }

  return Boolean(
    (normalizedCurrent.appVersion || normalizedNext.appVersion) &&
      normalizedCurrent.appVersion !== normalizedNext.appVersion
  )
}

export function resolveGitHubRepositoryCoordinates(
  repositoryUrl: string | null | undefined
): GitHubRepositoryCoordinates | null {
  const trimmed = repositoryUrl?.trim() ?? ""
  if (!trimmed) {
    return null
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  const protocol = url.protocol.toLowerCase()
  const hostname = url.hostname.toLowerCase()
  if (!["http:", "https:"].includes(protocol) || !["github.com", "www.github.com"].includes(hostname)) {
    return null
  }

  const pathSegments = url.pathname.split("/").filter(Boolean)
  if (pathSegments.length !== 2) {
    return null
  }

  const [owner, repoSegment] = pathSegments
  const repo = repoSegment.replace(/\.git$/i, "")
  if (!owner || !repo) {
    return null
  }

  return { owner, repo }
}

export function buildOctoRillReleaseUrl({
  repositoryUrl,
  tag,
}: {
  repositoryUrl?: string | null
  tag?: string | null
}): string | null {
  const repositoryCoordinates = resolveGitHubRepositoryCoordinates(repositoryUrl)
  const normalizedTag = normalizeVersionTag(tag)
  if (!repositoryCoordinates || !normalizedTag) {
    return null
  }

  const releaseTag = `v${normalizedTag}`
  const url = new URL(
    `/${encodeURIComponent(repositoryCoordinates.owner)}/${encodeURIComponent(repositoryCoordinates.repo)}/releases`,
    OCTORILL_ORIGIN
  )
  const highlightedTag = `tag:${releaseTag}`
  url.searchParams.append("highlight", highlightedTag)
  url.searchParams.set("highlight_active", highlightedTag)
  return url.toString()
}

export function resolveFooterVersionMetadata({
  appVersion,
  buildRef,
  repositoryUrl,
}: {
  appVersion?: string | null
  buildRef?: string | null
  repositoryUrl?: string | null
}): FooterVersionMetadata {
  const normalizedMetadata = normalizeRuntimeBuildMetadata({ appVersion, buildRef })
  const normalizedVersion = normalizedMetadata.appVersion
  const normalizedBuildRef = normalizedMetadata.buildRef
  const versionLabel = normalizedVersion ? `v${normalizedVersion}` : null
  const buildLabel = normalizedBuildRef ? `build ${normalizedBuildRef}` : null

  if (versionLabel && buildLabel) {
    return {
      visibleLabel: versionLabel,
      tooltipLabel: buildLabel,
      ariaLabel: `${versionLabel}, ${buildLabel}`,
      linkHref: buildOctoRillReleaseUrl({ repositoryUrl, tag: normalizedVersion }),
    }
  }

  const visibleLabel = versionLabel || buildLabel
  return {
    visibleLabel,
    tooltipLabel: null,
    ariaLabel: visibleLabel,
    linkHref: null,
  }
}
