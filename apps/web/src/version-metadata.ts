export type FooterVersionMetadata = {
  visibleLabel: string | null
  tooltipLabel: string | null
  ariaLabel: string | null
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

export function resolveFooterVersionMetadata({
  appVersion,
  buildRef,
}: {
  appVersion?: string | null
  buildRef?: string | null
}): FooterVersionMetadata {
  const normalizedVersion = normalizeVersionTag(appVersion)
  const normalizedBuildRef = normalizeBuildRef(buildRef)
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
