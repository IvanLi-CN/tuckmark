import { Check, Grid2X2 } from "lucide-react"
import * as React from "react"
import {
  CANVAS_GRID_SIZES,
  type CanvasGridSize,
  formatCanvasGridSize,
} from "../../lib/canvas-grid.js"
import { cn } from "../../lib/utils.js"
import { Button } from "../ui/button.js"
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover.js"

const LONG_PRESS_DELAY_MS = 500
const LONG_PRESS_MOVE_TOLERANCE = 8

export type GridSizeMenuProps = {
  disabled?: boolean
  gridEnabled: boolean
  value: CanvasGridSize
  onChange: (value: CanvasGridSize) => void
  onToggle: () => void
}

function GridSizeMenu({
  disabled = false,
  gridEnabled,
  onChange,
  onToggle,
  value,
}: GridSizeMenuProps) {
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

  const openMenu = React.useCallback(() => {
    setOpen(true)
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
        openMenu()
      }, LONG_PRESS_DELAY_MS)
    },
    [clearLongPress, disabled, openMenu]
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
        openMenu()
      }
    },
    [disabled, openMenu]
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex">
          <Button
            size="sm"
            variant={gridEnabled ? "default" : "outline"}
            aria-label="网格"
            aria-expanded={open}
            aria-haspopup="menu"
            aria-pressed={gridEnabled}
            disabled={disabled}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            onPointerCancel={handlePointerFinish}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerFinish}
          >
            <Grid2X2 className="size-4" />
            网格
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
          <legend className="tm-canvas-grid-size-menu__heading">网格尺寸</legend>
          {CANVAS_GRID_SIZES.map((size) => {
            const selected = size === value
            return (
              <button
                key={size}
                type="button"
                className={cn(
                  "tm-canvas-grid-size-menu__option",
                  selected && "tm-canvas-grid-size-menu__option--selected"
                )}
                aria-pressed={selected}
                onClick={() => {
                  onChange(size)
                  setOpen(false)
                }}
              >
                <span>{formatCanvasGridSize(size)}</span>
                <Check className={cn("size-4", !selected && "invisible")} aria-hidden="true" />
              </button>
            )
          })}
        </fieldset>
      </PopoverContent>
    </Popover>
  )
}

export { GridSizeMenu }
