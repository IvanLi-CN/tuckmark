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
}: {
  appVersion: string
  buildRef: string
}) {
  const metadata = resolveFooterVersionMetadata({ appVersion, buildRef })
  if (!metadata.visibleLabel) {
    return null
  }

  const metaNode = (
    <span
      className="tm-footer__meta"
      tabIndex={metadata.tooltipLabel ? 0 : undefined}
    >
      <Tag className="size-3.5" aria-hidden="true" />
      <span className="tm-footer__meta-copy">{metadata.visibleLabel}</span>
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
