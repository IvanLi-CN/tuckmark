import { Check, ChevronDown } from "lucide-react"
import * as React from "react"

import { cn } from "../../lib/utils.js"
import { Input } from "./input.js"
import { Popover, PopoverAnchor, PopoverContent } from "./popover.js"

type ComboboxOption = {
  label: string
  value: string
}

type ComboboxProps = Omit<
  React.ComponentProps<typeof Input>,
  "onChange" | "onKeyDown" | "onBlur" | "onFocus" | "value"
> & {
  emptyText?: string
  onValueChange: (value: string) => void
  onValueCommit?: (value: string) => void
  options: ComboboxOption[]
  popoverClassName?: string
  value: string
}

function Combobox({
  className,
  disabled,
  emptyText = "没有匹配字段",
  onValueChange,
  onValueCommit,
  options,
  popoverClassName,
  value,
  ...props
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const [contentWidth, setContentWidth] = React.useState<number | null>(null)
  const anchorRef = React.useRef<HTMLDivElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const listboxId = React.useId()
  const normalizedQuery = value.trim().toLowerCase()

  const normalizedOptions = React.useMemo(() => {
    const seen = new Set<string>()
    return options.filter((option) => {
      const normalizedLabel = option.label.trim().toLowerCase()
      if (!normalizedLabel || seen.has(normalizedLabel)) {
        return false
      }
      seen.add(normalizedLabel)
      return true
    })
  }, [options])

  const filteredOptions = React.useMemo(() => {
    if (!normalizedQuery) {
      return normalizedOptions
    }
    return normalizedOptions.filter((option) =>
      option.label.trim().toLowerCase().includes(normalizedQuery)
    )
  }, [normalizedOptions, normalizedQuery])

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
    const observer = new ResizeObserver(() => updateWidth())
    observer.observe(anchorRef.current)
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    if (!open) {
      setActiveIndex(-1)
      return
    }
    if (filteredOptions.length === 0) {
      setActiveIndex(-1)
      return
    }
    const exactMatchIndex = filteredOptions.findIndex(
      (option) => option.label.trim().toLowerCase() === normalizedQuery
    )
    setActiveIndex(exactMatchIndex >= 0 ? exactMatchIndex : 0)
  }, [filteredOptions, normalizedQuery, open])

  const commitValue = React.useCallback(
    (nextValue: string) => {
      onValueCommit?.(nextValue)
    },
    [onValueCommit]
  )

  const handleSelect = React.useCallback(
    (option: ComboboxOption) => {
      onValueChange(option.label)
      commitValue(option.value)
      setOpen(false)
    },
    [commitValue, onValueChange]
  )

  const handleBlur = React.useCallback(() => {
    window.requestAnimationFrame(() => {
      const activeElement = document.activeElement
      if (
        activeElement instanceof Node &&
        (anchorRef.current?.contains(activeElement) || contentRef.current?.contains(activeElement))
      ) {
        return
      }
      commitValue(value)
      setOpen(false)
    })
  }, [commitValue, value])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setOpen(true)
        setActiveIndex((current) => {
          if (filteredOptions.length === 0) {
            return -1
          }
          return current < 0 ? 0 : (current + 1) % filteredOptions.length
        })
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setOpen(true)
        setActiveIndex((current) => {
          if (filteredOptions.length === 0) {
            return -1
          }
          return current < 0
            ? filteredOptions.length - 1
            : (current - 1 + filteredOptions.length) % filteredOptions.length
        })
        return
      }
      if (event.key === "Enter") {
        event.preventDefault()
        if (open && activeIndex >= 0 && filteredOptions[activeIndex]) {
          handleSelect(filteredOptions[activeIndex])
          return
        }
        commitValue(value)
        setOpen(false)
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setOpen(false)
      }
    },
    [activeIndex, commitValue, filteredOptions, handleSelect, open, value]
  )

  return (
    <Popover open={open && !disabled} onOpenChange={setOpen} modal={false}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className="relative">
          <Input
            {...props}
            role="combobox"
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={open && !disabled}
            className={cn("w-full pr-7", className)}
            disabled={disabled}
            value={value}
            onFocus={() => {
              if (!disabled) {
                setOpen(true)
              }
            }}
            onChange={(event) => {
              onValueChange(event.currentTarget.value)
              if (!disabled) {
                setOpen(true)
              }
            }}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            tabIndex={disabled ? -1 : 0}
            aria-label={open ? "收起字段建议" : "展开字段建议"}
            className={cn(
              "absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-50",
              disabled && "pointer-events-none"
            )}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setOpen((current) => !current)}
          >
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={6}
        className={cn("max-h-48 overflow-hidden p-1", popoverClassName)}
        style={contentWidth ? { width: contentWidth } : undefined}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div ref={contentRef} id={listboxId} role="listbox" className="max-h-46 overflow-y-auto">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, index) => {
              const selected = option.label.trim().toLowerCase() === value.trim().toLowerCase()
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    "flex w-full items-center justify-between rounded-[8px] px-2 py-1.5 text-left text-[11px] leading-4 outline-none transition-colors",
                    index === activeIndex || selected
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground hover:bg-accent/60"
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleSelect(option)}
                >
                  <span className="truncate">{option.label}</span>
                  {selected ? <Check className="size-3.5 shrink-0" /> : null}
                </button>
              )
            })
          ) : (
            <div className="px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
              {emptyText}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export type { ComboboxOption }
export { Combobox }
