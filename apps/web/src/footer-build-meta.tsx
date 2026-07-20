import { Tag } from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip.js"
import { resolveFooterVersionMetadata } from "./version-metadata.js"

export function FooterBuildMeta({
  appVersion,
  buildRef,
  repositoryUrl,
}: {
  appVersion: string
  buildRef: string
  repositoryUrl: string
}) {
  const metadata = resolveFooterVersionMetadata({ appVersion, buildRef, repositoryUrl })
  if (!metadata.visibleLabel) {
    return null
  }

  const metaContent = (
    <>
      <Tag className="size-3.5" aria-hidden="true" />
      <span className="tm-footer__meta-copy">{metadata.visibleLabel}</span>
    </>
  )

  const metaNode = metadata.linkHref ? (
    <a
      className="tm-footer__link tm-footer__meta"
      href={metadata.linkHref}
      target="_blank"
      rel="noreferrer"
      data-has-tooltip={metadata.tooltipLabel ? "true" : undefined}
    >
      {metaContent}
    </a>
  ) : (
    <span
      className="tm-footer__meta"
      tabIndex={metadata.tooltipLabel ? 0 : undefined}
      data-has-tooltip={metadata.tooltipLabel ? "true" : undefined}
    >
      {metaContent}
    </span>
  )

  if (!metadata.tooltipLabel) {
    return metaNode
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{metaNode}</TooltipTrigger>
        <TooltipContent>{metadata.tooltipLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
