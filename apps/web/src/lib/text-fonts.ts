import {
  getTextFontDefinition,
  getTextFontFamilyStack,
  TEXT_FONT_GROUP_LABELS,
  type TextFontDefinition,
  type TextFontFamily,
  type TextFontGroupId,
  textFontGroupIds,
  textFontRegistry,
} from "../../../../packages/core/src/web.js"

type TextFontGroup = {
  id: TextFontGroupId
  label: string
  fonts: readonly TextFontDefinition[]
}

const FONT_PRELOAD_WEIGHTS: Partial<Record<TextFontFamily, readonly number[]>> = {
  "noto-sans-sc": [400, 700],
  "noto-serif-sc": [400, 700],
  "ibm-plex-sans": [400, 600, 700],
  "ibm-plex-mono": [400, 700],
  "space-grotesk": [400, 500, 700],
  oswald: [400, 500, 700],
}

const fontLoadPromises = new Map<TextFontFamily, Promise<void>>()

export const textFontGroups: readonly TextFontGroup[] = textFontGroupIds.map((groupId) => ({
  id: groupId,
  label: TEXT_FONT_GROUP_LABELS[groupId],
  fonts: textFontRegistry.filter((definition) => definition.group === groupId),
}))

function supportsFontLoadingApi() {
  return (
    typeof document !== "undefined" &&
    "fonts" in document &&
    typeof document.fonts.load === "function"
  )
}

export function preloadTextFontFamily(fontFamily: TextFontFamily): Promise<void> {
  const definition = getTextFontDefinition(fontFamily)
  if (definition.compatOnly || !supportsFontLoadingApi()) {
    return Promise.resolve()
  }

  const existing = fontLoadPromises.get(fontFamily)
  if (existing) {
    return existing
  }

  const weights = FONT_PRELOAD_WEIGHTS[fontFamily] ?? [400, 700]
  const promise = Promise.all(
    weights.map((weight) =>
      document.fonts.load(
        `${weight} 16px ${getTextFontFamilyStack(fontFamily)}`,
        definition.loadSample
      )
    )
  )
    .then(() => undefined)
    .catch(() => undefined)

  fontLoadPromises.set(fontFamily, promise)
  return promise
}

export function preloadOfficialTextFonts(): Promise<void> {
  return Promise.all(
    textFontRegistry
      .filter((definition) => !definition.compatOnly)
      .map((definition) => preloadTextFontFamily(definition.id))
  ).then(() => undefined)
}
