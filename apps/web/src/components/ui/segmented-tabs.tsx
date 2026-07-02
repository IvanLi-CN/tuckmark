import type { LucideIcon } from "lucide-react"
import * as React from "react"

import { cn } from "../../lib/utils.js"
import { ActionButton, type ActionButtonMode } from "./action-button.js"

type SegmentedTabsItem = {
  value: string
  name: string
  icon?: LucideIcon
  disabled?: boolean
}

type SegmentedTabsProps = Omit<React.ComponentProps<"div">, "onChange"> & {
  ariaLabel: string
  items: SegmentedTabsItem[]
  value: string
  onValueChange: (value: string) => void
  mode?: ActionButtonMode
  size?: "xs" | "sm" | "default" | "lg"
}

type IndicatorStyle = {
  left: number
  width: number
}

function SegmentedTabs({
  ariaLabel,
  items,
  value,
  onValueChange,
  mode = "icon",
  size = "xs",
  className,
  onKeyDown,
  ...props
}: SegmentedTabsProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const itemRefs = React.useRef(new Map<string, HTMLSpanElement>())
  const [indicatorStyle, setIndicatorStyle] = React.useState<IndicatorStyle | null>(null)

  const updateIndicator = React.useCallback(() => {
    const root = rootRef.current
    const selectedItem = itemRefs.current.get(value)
    if (!root || !selectedItem) {
      return
    }

    const rootRect = root.getBoundingClientRect()
    const selectedRect = selectedItem.getBoundingClientRect()
    setIndicatorStyle({
      left: selectedRect.left - rootRect.left,
      width: selectedRect.width,
    })
  }, [value])

  React.useLayoutEffect(() => {
    updateIndicator()

    const root = rootRef.current
    const selectedItem = itemRefs.current.get(value)
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateIndicator) : null

    if (root) {
      resizeObserver?.observe(root)
    }
    if (selectedItem) {
      resizeObserver?.observe(selectedItem)
    }

    window.addEventListener("resize", updateIndicator)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener("resize", updateIndicator)
    }
  }, [updateIndicator, value])

  const setItemRef = React.useCallback(
    (itemValue: string) => (node: HTMLSpanElement | null) => {
      if (node) {
        itemRefs.current.set(itemValue, node)
      } else {
        itemRefs.current.delete(itemValue)
      }

      if (itemValue === value) {
        window.requestAnimationFrame(updateIndicator)
      }
    },
    [updateIndicator, value]
  )

  const focusItem = React.useCallback((itemValue: string) => {
    itemRefs.current.get(itemValue)?.querySelector("button")?.focus()
  }, [])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event)
      if (event.defaultPrevented) {
        return
      }

      const enabledItems = items.filter((item) => !item.disabled)
      const currentIndex = enabledItems.findIndex((item) => item.value === value)
      if (currentIndex === -1 || enabledItems.length === 0) {
        return
      }

      const lastIndex = enabledItems.length - 1
      const nextIndexByKey: Record<string, number> = {
        ArrowLeft: currentIndex === 0 ? lastIndex : currentIndex - 1,
        ArrowUp: currentIndex === 0 ? lastIndex : currentIndex - 1,
        ArrowRight: currentIndex === lastIndex ? 0 : currentIndex + 1,
        ArrowDown: currentIndex === lastIndex ? 0 : currentIndex + 1,
        Home: 0,
        End: lastIndex,
      }
      const nextIndex = nextIndexByKey[event.key]
      const nextItem = typeof nextIndex === "number" ? enabledItems[nextIndex] : undefined
      if (!nextItem || nextItem.value === value) {
        return
      }

      event.preventDefault()
      onValueChange(nextItem.value)
      focusItem(nextItem.value)
    },
    [focusItem, items, onKeyDown, onValueChange, value]
  )

  return (
    <div
      {...props}
      ref={rootRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn("tm-segmented-tabs", indicatorStyle && "tm-segmented-tabs--ready", className)}
    >
      <span
        aria-hidden="true"
        className="tm-segmented-tabs__indicator"
        style={
          indicatorStyle
            ? {
                width: `${indicatorStyle.width}px`,
                transform: `translateX(${indicatorStyle.left}px)`,
              }
            : undefined
        }
      />
      {items.map((item) => {
        const selected = item.value === value
        return (
          <ActionButton
            key={item.value}
            ref={setItemRef(item.value)}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            name={item.name}
            icon={item.icon}
            mode={mode}
            size={size}
            variant="bare"
            className="rounded-[var(--tm-segmented-tabs-indicator-radius)]"
            selected={selected}
            disabled={item.disabled}
            onClick={() => onValueChange(item.value)}
          />
        )
      })}
    </div>
  )
}

export type { SegmentedTabsItem, SegmentedTabsProps }
export { SegmentedTabs }
