import { Check } from "lucide-react"
import * as React from "react"

import { type CanvasDimension, formatCanvasDimension } from "../../lib/canvas-dimensions.js"
import { cn } from "../../lib/utils.js"
import { Input } from "../ui/input.js"
import { Label } from "../ui/label.js"
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover.js"

type DimensionPickerProps = {
  disabled?: boolean
  options: CanvasDimension[]
  value: CanvasDimension
  variant?: "panel" | "inline"
  warning?: string | null
  onCommit: (dimension: CanvasDimension) => void
}

const MAX_VISIBLE_OPTIONS = 20

function isPositiveIntegerText(value: string): boolean {
  return /^[1-9]\d*$/.test(value.trim())
}

function parsePositiveInteger(value: string): number | null {
  if (!isPositiveIntegerText(value)) {
    return null
  }
  return Number(value.trim())
}

function matchesPrefix(candidate: number, query: string): boolean {
  const normalized = query.trim()
  return normalized.length === 0 || String(candidate).startsWith(normalized)
}

function DimensionPicker({
  disabled = false,
  onCommit,
  options,
  value,
  variant = "panel",
  warning,
}: DimensionPickerProps) {
  const [widthText, setWidthText] = React.useState(String(value.width))
  const [heightText, setHeightText] = React.useState(String(value.height))
  const [open, setOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [contentWidth, setContentWidth] = React.useState<number | null>(null)
  const anchorRef = React.useRef<HTMLFieldSetElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const listboxId = React.useId()
  const widthInputId = React.useId()
  const heightInputId = React.useId()
  React.useEffect(() => {
    setWidthText(String(value.width))
    setHeightText(String(value.height))
    setError(null)
  }, [value.height, value.width])

  React.useEffect(() => {
    if (!anchorRef.current) {
      return
    }
    const updateWidth = () => {
      setContentWidth(anchorRef.current?.getBoundingClientRect().width ?? null)
    }
    updateWidth()
    if (typeof ResizeObserver === "undefined") {
      return
    }
    const observer = new ResizeObserver(updateWidth)
    observer.observe(anchorRef.current)
    return () => observer.disconnect()
  }, [])

  const filteredOptions = React.useMemo(
    () =>
      options
        .filter(
          (option) =>
            matchesPrefix(option.width, widthText) && matchesPrefix(option.height, heightText)
        )
        .slice(0, MAX_VISIBLE_OPTIONS),
    [heightText, options, widthText]
  )

  React.useEffect(() => {
    if (!open) {
      return
    }
    setActiveIndex(filteredOptions.length > 0 ? 0 : -1)
  }, [filteredOptions.length, open])

  const commitTexts = React.useCallback(
    (nextWidthText = widthText, nextHeightText = heightText) => {
      const width = parsePositiveInteger(nextWidthText)
      const height = parsePositiveInteger(nextHeightText)
      if (!width || !height) {
        setError("宽高必须是正整数毫米。")
        return false
      }

      setError(null)
      if (width !== value.width || height !== value.height) {
        onCommit({ width, height })
      }
      return true
    },
    [heightText, onCommit, value.height, value.width, widthText]
  )

  const selectOption = React.useCallback(
    (option: CanvasDimension) => {
      const nextWidthText = String(option.width)
      const nextHeightText = String(option.height)
      setWidthText(nextWidthText)
      setHeightText(nextHeightText)
      setError(null)
      onCommit(option)
      setOpen(false)
    },
    [onCommit]
  )

  React.useEffect(() => {
    if (!open || disabled) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Node &&
        (anchorRef.current?.contains(target) || contentRef.current?.contains(target))
      ) {
        return
      }
      commitTexts()
      setOpen(false)
    }

    document.addEventListener("pointerdown", handlePointerDown, true)
    return () => document.removeEventListener("pointerdown", handlePointerDown, true)
  }, [commitTexts, disabled, open])

  const closeIfFocusLeaves = React.useCallback(() => {
    window.requestAnimationFrame(() => {
      const activeElement = document.activeElement
      if (
        activeElement instanceof Node &&
        (anchorRef.current?.contains(activeElement) || contentRef.current?.contains(activeElement))
      ) {
        return
      }
      commitTexts()
      setOpen(false)
    })
  }, [commitTexts])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setOpen(true)
        setActiveIndex((current) =>
          filteredOptions.length === 0
            ? -1
            : current < 0
              ? 0
              : (current + 1) % filteredOptions.length
        )
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setOpen(true)
        setActiveIndex((current) =>
          filteredOptions.length === 0
            ? -1
            : current < 0
              ? filteredOptions.length - 1
              : (current - 1 + filteredOptions.length) % filteredOptions.length
        )
        return
      }
      if (event.key === "Enter") {
        event.preventDefault()
        if (open && activeIndex >= 0 && filteredOptions[activeIndex]) {
          selectOption(filteredOptions[activeIndex])
          return
        }
        if (commitTexts()) {
          setOpen(false)
        }
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setWidthText(String(value.width))
        setHeightText(String(value.height))
        setError(null)
        setOpen(false)
      }
    },
    [activeIndex, commitTexts, filteredOptions, open, selectOption, value.height, value.width]
  )

  const currentLabel = formatCanvasDimension(value)
  const status = error ?? warning
  const compact = variant === "inline"

  return (
    <div className={cn("grid", compact ? "w-max gap-1" : "gap-2")}>
      {compact ? null : (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={widthInputId}>标签尺寸</Label>
          <span className="text-[11px] leading-none text-muted-foreground">{currentLabel}</span>
        </div>
      )}
      <Popover open={open && !disabled} onOpenChange={setOpen} modal={false}>
        <PopoverAnchor asChild>
          <fieldset
            ref={anchorRef}
            aria-label="标签尺寸"
            className={cn(
              "grid items-center gap-2",
              compact
                ? "grid-cols-[3.75rem_auto_3.75rem_auto]"
                : "grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
            )}
            onMouseEnter={() => {
              if (!disabled) {
                setOpen(true)
              }
            }}
          >
            <Input
              id={widthInputId}
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-expanded={open && !disabled}
              aria-label="标签宽度"
              disabled={disabled}
              inputMode="numeric"
              pattern="[0-9]*"
              value={widthText}
              density="compact"
              size="lg"
              className={cn(
                "text-right tabular-nums",
                error && "border-destructive/70 focus-visible:border-destructive"
              )}
              onFocus={() => setOpen(true)}
              onBlur={closeIfFocusLeaves}
              onChange={(event) => {
                setWidthText(event.currentTarget.value)
                setError(null)
                setOpen(true)
              }}
              onKeyDown={handleKeyDown}
            />
            <span className="justify-self-center text-xs font-medium text-muted-foreground">×</span>
            <Input
              id={heightInputId}
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-expanded={open && !disabled}
              aria-label="标签高度"
              disabled={disabled}
              inputMode="numeric"
              pattern="[0-9]*"
              value={heightText}
              density="compact"
              size="lg"
              className={cn(
                "text-right tabular-nums",
                error && "border-destructive/70 focus-visible:border-destructive"
              )}
              onFocus={() => setOpen(true)}
              onBlur={closeIfFocusLeaves}
              onChange={(event) => {
                setHeightText(event.currentTarget.value)
                setError(null)
                setOpen(true)
              }}
              onKeyDown={handleKeyDown}
            />
            {compact ? (
              <span className="justify-self-start text-xs font-semibold text-muted-foreground">
                mm
              </span>
            ) : null}
          </fieldset>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="max-h-56 overflow-hidden rounded-[14px] p-1"
          style={contentWidth ? { width: contentWidth } : undefined}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div ref={contentRef} id={listboxId} role="listbox" className="max-h-52 overflow-y-auto">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option, index) => {
                const selected = option.width === value.width && option.height === value.height
                return (
                  <button
                    key={`${option.width}x${option.height}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={cn(
                      "flex w-full items-center justify-between rounded-[10px] px-3 py-1.5 text-left text-xs leading-5 outline-none transition-colors",
                      index === activeIndex || selected
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground hover:bg-accent/60"
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectOption(option)}
                  >
                    <span>{formatCanvasDimension(option)}</span>
                    {selected ? <Check className="size-3.5 shrink-0" /> : null}
                  </button>
                )
              })
            ) : (
              <div className="px-2 py-1.5 text-xs leading-5 text-muted-foreground">
                没有匹配尺寸。
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {status ? (
        <p
          className={cn(
            compact ? "text-[11px] leading-4" : "text-xs leading-5",
            error ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {status}
        </p>
      ) : null}
    </div>
  )
}

export { DimensionPicker }
