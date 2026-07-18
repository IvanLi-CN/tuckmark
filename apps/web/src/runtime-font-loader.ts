let extendedRuntimeFontStylesPromise: Promise<void> | null = null

export function ensureExtendedRuntimeFontStyles(): Promise<void> {
  if (!extendedRuntimeFontStylesPromise) {
    extendedRuntimeFontStylesPromise = import("./runtime-fonts.css").then(() => undefined)
  }
  return extendedRuntimeFontStylesPromise
}
