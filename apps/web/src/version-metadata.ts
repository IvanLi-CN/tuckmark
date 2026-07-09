export type FooterVersionMetadata = {
  visibleLabel: string | null
  tooltipLabel: string | null
  ariaLabel: string | null
}

export type RuntimeBuildMetadata = {
  appVersion: string
  buildRef: string
}

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

export function resolveFooterVersionMetadata({
  appVersion,
  buildRef,
}: {
  appVersion?: string | null
  buildRef?: string | null
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
    }
  }

  const visibleLabel = versionLabel || buildLabel
  return {
    visibleLabel,
    tooltipLabel: null,
    ariaLabel: visibleLabel,
  }
}
