import darkProductLogoUrl from "../assets/tuckmark-full-logo-dark.svg"
import lightProductLogoUrl from "../assets/tuckmark-full-logo-light.svg"
import { cn } from "../lib/utils.js"

export function ProductMark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      aria-label="Tuckmark"
      className={cn("tm-product-mark tm-selectable-none", compact && "tm-product-mark--compact")}
      role="img"
    >
      <img
        alt=""
        aria-hidden="true"
        className="tm-product-mark__asset tm-product-mark__asset--light"
        src={lightProductLogoUrl}
      />
      <img
        alt=""
        aria-hidden="true"
        className="tm-product-mark__asset tm-product-mark__asset--dark"
        src={darkProductLogoUrl}
      />
    </span>
  )
}
