import productLogoUrl from "../assets/tuckmark-full-logo-light.svg"
import { cn } from "../lib/utils.js"

export function ProductMark({ compact = false }: { compact?: boolean }) {
  return (
    <img
      alt="Tuckmark"
      className={cn("tm-product-mark tm-selectable-none", compact && "tm-product-mark--compact")}
      src={productLogoUrl}
    />
  )
}
