import { cn } from "../lib/utils.js";

export function ProductMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="tm-product-mark tm-selectable-none">
      <div
        className={cn("tm-product-mark__chip", compact ? "size-10" : "size-12")}
      >
        <span
          className={cn(
            "tm-product-mark__glyph",
            compact ? "text-base" : "text-lg",
          )}
        >
          T
        </span>
      </div>
      <div className="tm-product-mark__copy">
        <div
          className={cn(
            "font-semibold tracking-tight text-foreground",
            compact ? "text-sm" : "text-base",
          )}
        >
          Tuckmark
        </div>
        <div className="text-xs tracking-[0.24em] text-muted-foreground uppercase">
          Label Workbench
        </div>
      </div>
    </div>
  );
}
