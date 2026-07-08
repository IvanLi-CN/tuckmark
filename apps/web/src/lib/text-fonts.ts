import {
  DEFAULT_TEXT_FONT_FAMILY,
  getTextFontDefinition,
  getTextFontFamilyStack,
  resolveTextFontFamily,
  type TextFontFamily,
  type TextFontPickerFamily,
  textFontRegistry,
} from "../../../../packages/core/src/web.js"

const FONT_PRELOAD_WEIGHTS: Partial<Record<TextFontPickerFamily, readonly number[]>> = {
  archivo: [400, 700],
  barlow: [400, 700],
  "barlow-condensed": [400, 700],
  "bebas-neue": [400],
  "dm-sans": [400, 700],
  "exo-2": [400, 700],
  "ibm-plex-mono": [400, 700],
  "ibm-plex-sans": [400, 700],
  "ibm-plex-serif": [400, 700],
  inconsolata: [400, 700],
  inter: [400, 700],
  "inter-tight": [400, 700],
  "jetbrains-mono": [400, 700],
  manrope: [400, 700],
  "noto-sans-sc": [400, 700],
  "noto-serif-sc": [400, 700],
  oswald: [400, 700],
  outfit: [400, 700],
  overpass: [400, 700],
  "public-sans": [400, 700],
  rajdhani: [400, 700],
  roboto: [400, 700],
  "roboto-condensed": [400, 700],
  "source-sans-3": [400, 700],
  "source-serif-4": [400, 700],
  "space-grotesk": [400, 700],
  "space-mono": [400, 700],
  "work-sans": [400, 700],
}

const fontLoadPromises = new Map<TextFontPickerFamily, Promise<void>>()

function supportsFontLoadingApi() {
  return (
    typeof document !== "undefined" &&
    "fonts" in document &&
    typeof document.fonts.load === "function"
  )
}

export function preloadTextFontFamily(fontFamily: TextFontFamily): Promise<void> {
  const resolvedFontFamily = resolveTextFontFamily(fontFamily)
  const definition = getTextFontDefinition(resolvedFontFamily)
  if (!definition.bundled || !supportsFontLoadingApi()) {
    return Promise.resolve()
  }

  const existing = fontLoadPromises.get(resolvedFontFamily)
  if (existing) {
    return existing
  }

  const weights = FONT_PRELOAD_WEIGHTS[resolvedFontFamily] ?? [400, 700]
  const promise = Promise.all(
    weights.map((weight) =>
      document.fonts.load(
        `${weight} 16px ${getTextFontFamilyStack(resolvedFontFamily)}`,
        definition.loadSample
      )
    )
  )
    .then(() => undefined)
    .catch(() => undefined)

  fontLoadPromises.set(resolvedFontFamily, promise)
  return promise
}

export function preloadCanvasTextFonts(fontFamilies: Iterable<TextFontFamily>): Promise<void> {
  const requestedFonts = new Set<TextFontFamily>([DEFAULT_TEXT_FONT_FAMILY, "noto-serif-sc"])
  for (const fontFamily of fontFamilies) {
    requestedFonts.add(fontFamily)
  }

  return Promise.all(
    Array.from(requestedFonts, (fontFamily) => preloadTextFontFamily(fontFamily))
  ).then(() => undefined)
}

export const textFontOptions = textFontRegistry
