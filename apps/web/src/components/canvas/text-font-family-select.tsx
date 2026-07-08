import React from "react"
import {
  getTextFontDefinition,
  getTextFontFamilyStack,
  resolveTextFontFamily,
  type TextFontFamily,
} from "../../../../../packages/core/src/web.js"
import {
  getCommonTextFontFamilies,
  loadTextFontUsageState,
  recordTextFontRecentUse,
  subscribeTextFontUsage,
} from "../../lib/text-font-usage.js"
import { textFontOptions } from "../../lib/text-fonts.js"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
} from "../ui/select.js"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip.js"

type TextFontFamilySelectProps = {
  className?: string
  disabled?: boolean
  id?: string
  onValueChange: (value: TextFontFamily) => void
  value: TextFontFamily
}

export function TextFontFamilySelect({
  className,
  disabled,
  id,
  onValueChange,
  value,
}: TextFontFamilySelectProps) {
  const selectedFont = getTextFontDefinition(value)
  const resolvedValue = resolveTextFontFamily(value)
  const [usageState, setUsageState] = React.useState(() => loadTextFontUsageState())
  const [hoveredFontFamily, setHoveredFontFamily] = React.useState<TextFontFamily | null>(null)

  React.useEffect(() => subscribeTextFontUsage(() => setUsageState(loadTextFontUsageState())), [])

  const commonFontFamilies = React.useMemo(
    () => getCommonTextFontFamilies(usageState),
    [usageState]
  )
  const commonFonts = React.useMemo(
    () => commonFontFamilies.map((fontFamily) => getTextFontDefinition(fontFamily)),
    [commonFontFamilies]
  )
  const commonFontFamilySet = React.useMemo(() => new Set(commonFontFamilies), [commonFontFamilies])
  const remainingFonts = React.useMemo(
    () => textFontOptions.filter((fontDefinition) => !commonFontFamilySet.has(fontDefinition.id)),
    [commonFontFamilySet]
  )

  const renderFontItem = (fontFamily: TextFontFamily) => {
    const fontDefinition = getTextFontDefinition(fontFamily)
    return (
      <Tooltip
        key={fontDefinition.id}
        open={hoveredFontFamily === fontDefinition.id}
        onOpenChange={(open) => {
          if (!open && hoveredFontFamily === fontDefinition.id) {
            setHoveredFontFamily(null)
          }
        }}
      >
        <TooltipTrigger asChild>
          <SelectItem
            value={fontDefinition.id}
            data-font-label={fontDefinition.label}
            data-font-attributes={fontDefinition.attributes.join(" · ")}
            onFocus={() => setHoveredFontFamily(fontDefinition.id)}
            onBlur={() =>
              setHoveredFontFamily((current) => (current === fontDefinition.id ? null : current))
            }
            onPointerMove={() => setHoveredFontFamily(fontDefinition.id)}
            onPointerLeave={() =>
              setHoveredFontFamily((current) => (current === fontDefinition.id ? null : current))
            }
          >
            <div className="flex w-full items-center">
              <span
                className="truncate"
                style={{ fontFamily: getTextFontFamilyStack(fontDefinition.id) }}
              >
                {fontDefinition.label}
              </span>
            </div>
          </SelectItem>
        </TooltipTrigger>
        <TooltipContent forceMount side="right" align="start">
          <div className="grid gap-1">
            <div className="font-medium">{fontDefinition.label}</div>
            <div className="text-[11px] text-muted-foreground">
              {fontDefinition.attributes.join(" · ")}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <TooltipProvider>
      <Select
        disabled={disabled}
        value={resolvedValue}
        onValueChange={(nextValue) => {
          setHoveredFontFamily(null)
          setUsageState(recordTextFontRecentUse(nextValue as TextFontFamily))
          onValueChange(nextValue as TextFontFamily)
        }}
      >
        <SelectTrigger
          id={id}
          className={className}
          style={{ fontFamily: getTextFontFamilyStack(selectedFont.id) }}
        >
          <span
            className="truncate text-left"
            style={{ fontFamily: getTextFontFamilyStack(selectedFont.id) }}
          >
            {selectedFont.label}
          </span>
        </SelectTrigger>
        <SelectContent className="max-h-[22rem]">
          {commonFonts.length > 0 ? (
            <>
              <SelectGroup>
                <SelectLabel>常用字体</SelectLabel>
                {commonFonts.map((fontDefinition) => renderFontItem(fontDefinition.id))}
              </SelectGroup>
              <SelectSeparator />
            </>
          ) : null}
          {remainingFonts.map((fontDefinition) => renderFontItem(fontDefinition.id))}
        </SelectContent>
      </Select>
    </TooltipProvider>
  )
}
