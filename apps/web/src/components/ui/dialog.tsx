import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import * as React from "react"

import { cn } from "../../lib/utils.js"
import { Button } from "./button.js"
import { Input } from "./input.js"
import { Label } from "./label.js"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close
const DialogPortal = DialogPrimitive.Portal

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-[rgba(26,20,16,0.34)] backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out",
      className
    )}
    {...props}
  />
))

DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed top-1/2 left-1/2 z-50 grid w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-5 rounded-xl border border-border/80 bg-card p-5 text-card-foreground shadow-[0_8px_14px_rgba(73,46,24,0.14)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out",
        className
      )}
      {...props}
    >
      {children}
      <DialogClose className="absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70">
        <X className="size-4" />
        <span className="sr-only">关闭</span>
      </DialogClose>
    </DialogPrimitive.Content>
  </DialogPortal>
))

DialogContent.displayName = DialogPrimitive.Content.displayName

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid gap-2 pr-8", className)} {...props} />
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-base font-semibold leading-6 text-foreground", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm leading-6 text-muted-foreground", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  )
}

type ConfirmDialogProps = {
  open: boolean
  title: string
  description: string
  cancelLabel?: string
  confirmLabel?: string
  confirmVariant?: React.ComponentProps<typeof Button>["variant"]
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

function ConfirmDialog({
  open,
  title,
  description,
  cancelLabel = "取消",
  confirmLabel = "确认",
  confirmVariant = "default",
  onOpenChange,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            onClick={() => {
              onOpenChange(false)
              onConfirm()
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type PromptDialogProps = {
  open: boolean
  title: string
  description: string
  label: string
  defaultValue: string
  cancelLabel?: string
  confirmLabel?: string
  requiredMessage?: string
  onOpenChange: (open: boolean) => void
  onConfirm: (value: string) => void
}

function PromptDialog({
  open,
  title,
  description,
  label,
  defaultValue,
  cancelLabel = "取消",
  confirmLabel = "保存",
  requiredMessage = "请输入名称。",
  onOpenChange,
  onConfirm,
}: PromptDialogProps) {
  const inputId = React.useId()
  const errorId = React.useId()
  const [value, setValue] = React.useState(defaultValue)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setValue(defaultValue)
      setError(null)
    }
  }, [defaultValue, open])

  const submit = React.useCallback(() => {
    const trimmedValue = value.trim()
    if (!trimmedValue) {
      setError(requiredMessage)
      return
    }
    onOpenChange(false)
    onConfirm(trimmedValue)
  }, [onConfirm, onOpenChange, requiredMessage, value])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={inputId}>{label}</Label>
            <Input
              id={inputId}
              autoFocus
              value={value}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => {
                setValue(event.currentTarget.value)
                if (error) {
                  setError(null)
                }
              }}
            />
            {error ? (
              <p id={errorId} className="text-sm leading-5 text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {cancelLabel}
            </Button>
            <Button type="submit">{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export {
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  PromptDialog,
}
