import type { LucideIcon } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"

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
const tooltipGapPx = 8
const tooltipViewportMarginPx = 8

type TooltipPosition = {
  left: number
  top: number
}

const ActionButton = React.forwardRef<HTMLSpanElement, ActionButtonProps>(function ActionButton(
  {
    name,
    icon: Icon,
    mode = Icon ? "icon-text" : "text",
    size = "sm",
    selected,
    className,
    onPointerEnter,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
    onFocus,
    onBlur,
    "aria-pressed": ariaPressed,
    ...props
  },
  forwardedRef
) {
  const [touchTooltipOpen, setTouchTooltipOpen] = React.useState(false)
  const [hoverTooltipOpen, setHoverTooltipOpen] = React.useState(false)
  const [focusTooltipOpen, setFocusTooltipOpen] = React.useState(false)
  const [tooltipPosition, setTooltipPosition] = React.useState<TooltipPosition | null>(null)
  const [tooltipMounted, setTooltipMounted] = React.useState(false)
  const tooltipId = React.useId()
  const anchorRef = React.useRef<HTMLSpanElement | null>(null)
  const tooltipRef = React.useRef<HTMLDivElement | null>(null)
  const longPressTimer = React.useRef<number | null>(null)
  const showsText = mode !== "icon"
  const showsIcon = mode !== "text" && Icon
  const showsTooltip = mode === "icon"
  const tooltipOpen = showsTooltip && (hoverTooltipOpen || focusTooltipOpen || touchTooltipOpen)
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

  const clearLongPress = React.useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  React.useEffect(() => clearLongPress, [clearLongPress])

  React.useEffect(() => {
    setTooltipMounted(true)
  }, [])

  const updateTooltipPosition = React.useCallback(() => {
    const anchor = anchorRef.current
    const tooltip = tooltipRef.current
    if (!anchor || !tooltip) {
      return
    }

    const anchorRect = anchor.getBoundingClientRect()
    const tooltipRect = tooltip.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const preferredTop = anchorRect.top - tooltipRect.height - tooltipGapPx
    const preferredLeft = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2
    const left = Math.min(
      Math.max(preferredLeft, tooltipViewportMarginPx),
      Math.max(tooltipViewportMarginPx, viewportWidth - tooltipRect.width - tooltipViewportMarginPx)
    )
    const top =
      preferredTop >= tooltipViewportMarginPx ? preferredTop : anchorRect.bottom + tooltipGapPx

    setTooltipPosition({ left, top })
  }, [])

  React.useLayoutEffect(() => {
    if (!tooltipOpen) {
      setTooltipPosition(null)
      return
    }

    updateTooltipPosition()
    window.addEventListener("resize", updateTooltipPosition)
    window.addEventListener("scroll", updateTooltipPosition, true)
    return () => {
      window.removeEventListener("resize", updateTooltipPosition)
      window.removeEventListener("scroll", updateTooltipPosition, true)
    }
  }, [tooltipOpen, updateTooltipPosition])

  const tooltip =
    tooltipMounted && tooltipOpen
      ? createPortal(
          <div
            id={tooltipId}
            ref={tooltipRef}
            className={cn(
              "tm-action-button-tooltip",
              tooltipPosition && "tm-action-button-tooltip--positioned"
            )}
            role="tooltip"
            style={
              tooltipPosition
                ? {
                    left: `${tooltipPosition.left}px`,
                    top: `${tooltipPosition.top}px`,
                  }
                : undefined
            }
          >
            {name}
          </div>,
          document.body
        )
      : null

  return (
    <span
      ref={setAnchorRef}
      className={cn(
        "tm-action-button",
        size === "xs" && "tm-action-button--xs",
        mode === "icon" && "tm-action-button--icon-only"
      )}
    >
      <Button
        {...props}
        aria-label={mode === "icon" ? name : props["aria-label"]}
        aria-pressed={isTab ? ariaPressed : (ariaPressed ?? selected)}
        aria-describedby={tooltipOpen ? tooltipId : props["aria-describedby"]}
        size={mode === "icon" ? "icon" : buttonSize}
        className={cn(
          "tm-action-button__control",
          size === "xs" && "tm-action-button__control--xs",
          selected && "tm-action-button__control--selected",
          className
        )}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") {
            setHoverTooltipOpen(true)
          }
          onPointerEnter?.(event)
        }}
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
          setHoverTooltipOpen(false)
          setTouchTooltipOpen(false)
          onPointerLeave?.(event)
        }}
        onFocus={(event) => {
          setFocusTooltipOpen(true)
          onFocus?.(event)
        }}
        onBlur={(event) => {
          clearLongPress()
          setFocusTooltipOpen(false)
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
      {tooltip}
    </span>
  )
})

ActionButton.displayName = "ActionButton"

export type { ActionButtonMode, ActionButtonProps }
export { ActionButton }
