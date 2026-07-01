import type { LucideIcon } from "lucide-react"
import * as React from "react"

import { cn } from "../../lib/utils.js"
import { Button, type ButtonProps } from "./button.js"

type ActionButtonMode = "icon" | "text" | "icon-text"

type ActionButtonProps = Omit<ButtonProps, "children" | "size"> & {
  name: string
  icon?: LucideIcon
  mode?: ActionButtonMode
  size?: "xs" | "sm" | "default" | "lg"
  selected?: boolean
}

const longPressDelayMs = 520

function ActionButton({
  name,
  icon: Icon,
  mode = Icon ? "icon-text" : "text",
  size = "sm",
  selected,
  className,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  onBlur,
  "aria-pressed": ariaPressed,
  ...props
}: ActionButtonProps) {
  const [touchTooltipOpen, setTouchTooltipOpen] = React.useState(false)
  const longPressTimer = React.useRef<number | null>(null)
  const showsText = mode !== "icon"
  const showsIcon = mode !== "text" && Icon
  const buttonSize = size === "xs" ? "sm" : size

  const clearLongPress = React.useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  React.useEffect(() => clearLongPress, [clearLongPress])

  return (
    <span
      className={cn(
        "tm-action-button",
        touchTooltipOpen && "tm-action-button--tooltip-open",
        size === "xs" && "tm-action-button--xs",
        mode === "icon" && "tm-action-button--icon-only"
      )}
      data-tooltip={name}
    >
      <Button
        {...props}
        aria-label={mode === "icon" ? name : props["aria-label"]}
        aria-pressed={ariaPressed ?? selected}
        size={mode === "icon" ? "icon" : buttonSize}
        className={cn(
          "tm-action-button__control",
          size === "xs" && "tm-action-button__control--xs",
          selected && "tm-action-button__control--selected",
          className
        )}
        onPointerDown={(event) => {
          if (event.pointerType === "touch") {
            clearLongPress()
            longPressTimer.current = window.setTimeout(() => {
              setTouchTooltipOpen(true)
            }, longPressDelayMs)
          }
          onPointerDown?.(event)
        }}
        onPointerUp={(event) => {
          clearLongPress()
          onPointerUp?.(event)
        }}
        onPointerCancel={(event) => {
          clearLongPress()
          setTouchTooltipOpen(false)
          onPointerCancel?.(event)
        }}
        onPointerLeave={(event) => {
          clearLongPress()
          onPointerLeave?.(event)
        }}
        onBlur={(event) => {
          clearLongPress()
          setTouchTooltipOpen(false)
          onBlur?.(event)
        }}
        onClick={(event) => {
          setTouchTooltipOpen(false)
          props.onClick?.(event)
        }}
      >
        {showsIcon ? <Icon className="size-4" aria-hidden="true" /> : null}
        {showsText ? <span>{name}</span> : null}
      </Button>
    </span>
  )
}

function ActionButtonGroup({ children, className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("tm-action-button-group", className)} {...props}>
      {children}
    </div>
  )
}

export type { ActionButtonMode, ActionButtonProps }
export { ActionButton, ActionButtonGroup }
