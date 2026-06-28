import * as PopoverPrimitive from "@radix-ui/react-popover"
import type * as React from "react"

import { cn } from "../../lib/utils.js"

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root {...props} />
}

function PopoverAnchor(props: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor {...props} />
}

function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 10,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-80 rounded-xl border border-border/80 bg-popover p-4 text-popover-foreground shadow-xl outline-none",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-1.5 data-[side=top]:slide-in-from-bottom-1.5",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverClose(props: React.ComponentProps<typeof PopoverPrimitive.Close>) {
  return <PopoverPrimitive.Close {...props} />
}

export { Popover, PopoverAnchor, PopoverClose, PopoverContent, PopoverTrigger }
