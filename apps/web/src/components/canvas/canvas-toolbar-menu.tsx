import { Check } from "lucide-react"
import * as React from "react"
import { cn } from "../../lib/utils.js"
import { Button } from "../ui/button.js"
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover.js"

const LONG_PRESS_DELAY_MS = 500
const LONG_PRESS_MOVE_TOLERANCE = 8

export type CanvasToolbarMenuOption<Value extends string | number> = {
  value: Value
  label: string
}

export type CanvasToolbarMenuProps<Value extends string | number> = {
  ariaLabel: string
  buttonLabel: string
  disabled?: boolean
  icon: React.ReactNode
  menuLabel: string
  options: readonly CanvasToolbarMenuOption<Value>[]
  pressed: boolean
  value: Value
  onChange: (value: Value) => void
  onToggle: () => void
}

function CanvasToolbarMenu<Value extends string | number>({
  ariaLabel,
  buttonLabel,
  disabled = false,
  icon,
  menuLabel,
  onChange,
  onToggle,
  options,
  pressed,
  value,
}: CanvasToolbarMenuProps<Value>) {
  const [open, setOpen] = React.useState(false)
  const longPressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerRef = React.useRef<{
    id: number
    originX: number
    originY: number
    triggered: boolean
  } | null>(null)
  const suppressClickRef = React.useRef(false)

  const clearLongPress = React.useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const cancelPointerLongPress = React.useCallback(
    (pointerId?: number) => {
      const pointer = pointerRef.current
      if (!pointer || (pointerId !== undefined && pointer.id !== pointerId)) {
        return
      }
      clearLongPress()
      pointerRef.current = null
    },
    [clearLongPress]
  )

  React.useEffect(
    () => () => {
      clearLongPress()
    },
    [clearLongPress]
  )

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (
        disabled ||
        event.button !== 0 ||
        (event.pointerType !== "touch" && event.pointerType !== "pen")
      ) {
        return
      }

      clearLongPress()
      pointerRef.current = {
        id: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        triggered: false,
      }
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Pointer capture is unavailable in some test DOMs.
      }
      longPressTimerRef.current = setTimeout(() => {
        const pointer = pointerRef.current
        if (!pointer || pointer.id !== event.pointerId) {
          return
        }
        pointer.triggered = true
        suppressClickRef.current = true
        setOpen(true)
      }, LONG_PRESS_DELAY_MS)
    },
    [clearLongPress, disabled]
  )

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const pointer = pointerRef.current
      if (!pointer || pointer.id !== event.pointerId || pointer.triggered) {
        return
      }
      const movedX = event.clientX - pointer.originX
      const movedY = event.clientY - pointer.originY
      if (Math.hypot(movedX, movedY) > LONG_PRESS_MOVE_TOLERANCE) {
        cancelPointerLongPress(event.pointerId)
      }
    },
    [cancelPointerLongPress]
  )

  const handlePointerFinish = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const pointer = pointerRef.current
      if (!pointer || pointer.id !== event.pointerId) {
        return
      }
      clearLongPress()
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // Pointer capture is unavailable in some test DOMs.
      }
      pointerRef.current = null
    },
    [clearLongPress]
  )

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false
        event.preventDefault()
        return
      }
      onToggle()
      setOpen(false)
    },
    [onToggle]
  )

  const handleContextMenu = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      if (!disabled) {
        setOpen(true)
      }
    },
    [disabled]
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex">
          <Button
            size="sm"
            variant={pressed ? "default" : "outline"}
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-haspopup="menu"
            aria-pressed={pressed}
            disabled={disabled}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            onPointerCancel={handlePointerFinish}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerFinish}
          >
            {icon}
            {buttonLabel}
          </Button>
        </span>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="tm-canvas-grid-size-menu w-48 p-1.5"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <fieldset className="tm-canvas-grid-size-menu__options">
          <legend className="tm-canvas-grid-size-menu__heading">{menuLabel}</legend>
          {options.map((option) => {
            const selected = option.value === value
            return (
              <button
                key={String(option.value)}
                type="button"
                className={cn(
                  "tm-canvas-grid-size-menu__option",
                  selected && "tm-canvas-grid-size-menu__option--selected"
                )}
                aria-pressed={selected}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                <span>{option.label}</span>
                <Check className={cn("size-4", !selected && "invisible")} aria-hidden="true" />
              </button>
            )
          })}
        </fieldset>
      </PopoverContent>
    </Popover>
  )
}

export { CanvasToolbarMenu }
