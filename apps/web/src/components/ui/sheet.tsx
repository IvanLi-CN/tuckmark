import * as Dialog from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import * as React from "react"

import { cn } from "../../lib/utils.js"

const Sheet = Dialog.Root
const SheetTrigger = Dialog.Trigger
const SheetClose = Dialog.Close
const SheetPortal = Dialog.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof Dialog.Overlay>,
  React.ComponentPropsWithoutRef<typeof Dialog.Overlay>
>(({ className, ...props }, ref) => (
  <Dialog.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-[rgba(26,20,16,0.32)] backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out",
      className
    )}
    {...props}
  />
))

SheetOverlay.displayName = Dialog.Overlay.displayName

const sideClasses = {
  right:
    "inset-y-0 right-0 h-full w-full max-w-[420px] border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
} as const

const SheetContent = React.forwardRef<
  React.ElementRef<typeof Dialog.Content>,
  React.ComponentPropsWithoutRef<typeof Dialog.Content> & {
    side?: keyof typeof sideClasses
  }
>(({ className, children, side = "right", ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <Dialog.Content
      ref={ref}
      className={cn(
        "fixed z-50 bg-card text-card-foreground shadow-[0_24px_64px_rgba(30,22,16,0.24)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out",
        sideClasses[side],
        className
      )}
      {...props}
    >
      {children}
      <SheetClose className="absolute top-4 right-4 inline-flex size-9 items-center justify-center rounded-full border border-border/70 bg-background/80 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70">
        <X className="size-4" />
        <span className="sr-only">Close</span>
      </SheetClose>
    </Dialog.Content>
  </SheetPortal>
))

SheetContent.displayName = Dialog.Content.displayName

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("grid gap-2 border-b border-border/70 px-6 py-5", className)} {...props} />
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof Dialog.Title>) {
  return <Dialog.Title className={cn("text-lg font-semibold", className)} {...props} />
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof Dialog.Description>) {
  return (
    <Dialog.Description className={cn("text-sm text-muted-foreground", className)} {...props} />
  )
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger }
