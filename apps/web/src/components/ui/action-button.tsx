import type { LucideIcon } from "lucide-react"
import * as React from "react"

import { cn } from "../../lib/utils.js"
import { Button, type ButtonProps } from "./button.js"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip.js"

type ActionButtonMode = "icon" | "text" | "icon-text"

type ActionButtonProps = Omit<ButtonProps, "children" | "size"> & {
  name: string
  icon?: LucideIcon
  mode?: ActionButtonMode
  size?: "xs" | "sm" | "default" | "lg"
  selected?: boolean
}

const ActionButton = React.forwardRef<HTMLSpanElement, ActionButtonProps>(function ActionButton(
  {
    name,
    icon: Icon,
    mode = Icon ? "icon-text" : "text",
    size = "sm",
    selected,
    className,
    "aria-pressed": ariaPressed,
    ...props
  },
  forwardedRef
) {
  const anchorRef = React.useRef<HTMLSpanElement | null>(null)
  const showsText = mode !== "icon"
  const showsIcon = mode !== "text" && Icon
  const showsTooltip = mode === "icon"
  const buttonSize = size === "xs" ? "sm" : size
  const isTab = props.role === "tab"

  const setAnchorRef = React.useCallback(
    (node: HTMLSpanElement | null) => {
      anchorRef.current = node
      if (typeof forwardedRef === "function") {
        forwardedRef(node)
      } else if (forwardedRef) {
        forwardedRef.current = node
      }
    },
    [forwardedRef]
  )

  const button = (
    <Button
      {...props}
      aria-label={mode === "icon" ? name : props["aria-label"]}
      aria-pressed={isTab ? ariaPressed : (ariaPressed ?? selected)}
      size={mode === "icon" ? "icon" : buttonSize}
      className={cn(
        "tm-action-button__control",
        size === "xs" && "tm-action-button__control--xs",
        selected && "tm-action-button__control--selected",
        className
      )}
    >
      {showsIcon ? <Icon className="size-4" aria-hidden="true" /> : null}
      {showsText ? <span>{name}</span> : null}
    </Button>
  )

  return (
    <span
      ref={setAnchorRef}
      className={cn(
        "tm-action-button",
        size === "xs" && "tm-action-button--xs",
        mode === "icon" && "tm-action-button--icon-only"
      )}
    >
      {showsTooltip ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>{name}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        button
      )}
    </span>
  )
})

ActionButton.displayName = "ActionButton"

export type { ActionButtonMode, ActionButtonProps }
export { ActionButton }
