import * as React from "react"

import { cn } from "../../lib/utils.js"
import { Input } from "../ui/input.js"
import { Label } from "../ui/label.js"

type InspectorNumberFieldProps = {
  actions?: React.ReactNode
  className?: string
  disabled?: boolean
  id: string
  label: string
  precision?: number
  step?: number
  value: number
  onValueChange: (next: number) => void
}

type DragState = {
  lastValue: number
  moved: boolean
  pointerId: number
  startValue: number
  startX: number
}

const DRAG_PIXELS_PER_STEP = 8

function roundInspectorNumberToPrecision(value: number, precision: number) {
  const multiplier = 10 ** Math.max(0, precision)
  const rounded = Math.round(value * multiplier) / multiplier
  return Object.is(rounded, -0) ? 0 : rounded
}

function roundInspectorNumber(value: number) {
  return roundInspectorNumberToPrecision(value, 1)
}

function formatInspectorNumber(value: number) {
  return roundInspectorNumber(Number.isFinite(value) ? value : 0).toFixed(1)
}

function normalizeInspectorNumber(value: number, precision: number) {
  return roundInspectorNumberToPrecision(Number.isFinite(value) ? value : 0, precision)
}

function InspectorNumberField({
  actions,
  className,
  disabled = false,
  id,
  label,
  onValueChange,
  precision = 1,
  step = 0.1,
  value,
}: InspectorNumberFieldProps) {
  const dragRef = React.useRef<DragState | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const displayValue = normalizeInspectorNumber(value, precision).toFixed(precision)

  const commitValue = React.useCallback(
    (nextValue: number) => {
      onValueChange(normalizeInspectorNumber(nextValue, precision))
    },
    [onValueChange, precision]
  )

  const focusInput = React.useCallback(() => {
    document.getElementById(id)?.focus()
  }, [id])

  const handlePointerDown = (event: React.PointerEvent<HTMLLabelElement>) => {
    if (disabled || event.button !== 0) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      lastValue: normalizeInspectorNumber(value, precision),
      moved: false,
      pointerId: event.pointerId,
      startValue: normalizeInspectorNumber(value, precision),
      startX: event.clientX,
    }
    setDragging(true)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLLabelElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    const steps = Math.round((event.clientX - drag.startX) / DRAG_PIXELS_PER_STEP)
    const nextValue = normalizeInspectorNumber(drag.startValue + steps * step, precision)
    if (nextValue === drag.lastValue) {
      return
    }
    drag.moved = true
    drag.lastValue = nextValue
    commitValue(nextValue)
  }

  const handlePointerEnd = (event: React.PointerEvent<HTMLLabelElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    dragRef.current = null
    setDragging(false)
    if (!drag.moved) {
      focusInput()
    }
  }

  return (
    <div className={cn("tm-inspector-inline-field", className)}>
      <Label
        htmlFor={id}
        className={cn(
          "tm-inspector-inline-label tm-inspector-number-label",
          disabled && "tm-inspector-number-label--disabled"
        )}
        data-dragging={dragging ? "true" : undefined}
        onPointerCancel={handlePointerEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        title={disabled ? undefined : "左右拖拽调整数值"}
      >
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        step={step}
        density="compact"
        size="md"
        className="tm-inspector-input"
        disabled={disabled}
        value={displayValue}
        onChange={(event) => {
          commitValue(Number(event.currentTarget.value || 0))
        }}
      />
      {actions ? <div className="tm-inspector-inline-actions">{actions}</div> : null}
    </div>
  )
}

export { formatInspectorNumber, InspectorNumberField, roundInspectorNumber }
