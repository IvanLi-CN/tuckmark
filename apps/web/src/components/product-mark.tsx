import productMarkUrl from "../assets/tuckmark-mark-light-workbench.svg"
import { cn } from "../lib/utils.js"

export function ProductMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="tm-product-mark tm-selectable-none">
      <div className={cn("tm-product-mark__chip", compact ? "size-10" : "size-12")}>
        <img
          alt=""
          aria-hidden="true"
          className={cn("tm-product-mark__logo", compact ? "h-8" : "h-10")}
          src={productMarkUrl}
        />
      </div>
      <div className="tm-product-mark__copy">
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
