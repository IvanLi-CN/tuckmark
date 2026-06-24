import { cn } from "../lib/utils.js"

export function ProductMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "grid place-items-center rounded-[1.1rem] bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.92),rgba(255,255,255,0.48)_34%,rgba(198,146,108,0.22)_100%),linear-gradient(180deg,#f5d9c3 0%,#ddb58c 100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_12px_30px_rgba(82,48,20,0.18)]",
          compact ? "size-10" : "size-12"
        )}
      >
        <span className={cn("font-black text-[#6d4120]", compact ? "text-base" : "text-lg")}>
          T
        </span>
      </div>
      <div className="grid gap-0.5">
        <div
          className={cn(
            "font-semibold tracking-tight text-foreground",
            compact ? "text-sm" : "text-base"
          )}
        >
          Tuckmark
        </div>
        <div className="text-xs tracking-[0.24em] text-muted-foreground uppercase">
          Label Workbench
        </div>
      </div>
    </div>
  )
}
