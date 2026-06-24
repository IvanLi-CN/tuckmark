import type * as React from "react"

import { cn } from "../../lib/utils.js"

type InputDensity = "default" | "compact"
type InputWidthMode = "full" | "content-fit"
type InputSize = "xs" | "sm" | "md" | "lg"

type InputProps = Omit<React.ComponentProps<"input">, "size"> & {
  density?: InputDensity
  size?: InputSize
  widthMode?: InputWidthMode
  minWidthPx?: number
  maxWidthPx?: number
}

function measureContentWidth(value: string) {
  const length = Math.max(Array.from(value).length, 4)
  return 28 + length * 7.25
}

function Input({
  className,
  density = "default",
  maxWidthPx,
  minWidthPx,
  size = "md",
  style,
  type,
  value,
  widthMode = "full",
  ...props
}: InputProps) {
  const normalizedValue = typeof value === "string" ? value : ""
  const widthStyle =
    widthMode === "content-fit"
      ? {
          width: `${Math.min(Math.max(measureContentWidth(normalizedValue), minWidthPx ?? 96), maxWidthPx ?? 224)}px`,
          minWidth: `${minWidthPx ?? 96}px`,
          maxWidth: `${maxWidthPx ?? 224}px`,
        }
      : undefined

  return (
    <input
      type={type}
      className={cn(
        "flex min-w-0 border border-input outline-none file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        density === "default" &&
          cn(
            "w-full bg-background shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring/70",
            size === "xs" && "h-7 rounded-sm px-2 text-xs",
            size === "sm" && "h-8 rounded-md px-2.5 text-sm",
            size === "md" && "h-10 rounded-md px-3 py-2 text-sm",
            size === "lg" && "h-11 rounded-lg px-4 text-base"
          ),
        density === "compact" &&
          cn(
            "border border-border/70 bg-background/95 py-0 leading-none shadow-none transition-colors focus-visible:border-ring/70 focus-visible:ring-0",
            size === "xs" && "h-5 rounded-[6px] px-1.5 text-[11px]",
            size === "sm" && "h-6 rounded-sm px-1.5 text-[11px]",
            size === "md" && "h-7 rounded-sm px-2 text-xs",
            size === "lg" && "h-8 rounded-md px-2.5 text-sm"
          ),
        className
      )}
      style={{ ...widthStyle, ...style }}
      value={value}
      {...props}
    />
  )
}

export { Input }
