import {
  DEFAULT_TEXT_FONT_FAMILY,
  getTextFontDefinition,
  getTextFontMetricProfile,
  resolveTextFontFamily,
  TEXT_FONT_FAMILY_STACKS,
  type TextFontDefinition,
  type TextFontFamily,
  type TextFontPickerFamily,
  textFontFamilies,
  textFontPickerFamilies,
  textFontRegistry,
} from "./text-font-registry.js"

export {
  DEFAULT_TEXT_FONT_FAMILY,
  getTextFontDefinition,
  resolveTextFontFamily,
  TEXT_FONT_FAMILY_STACKS,
  type TextFontDefinition,
  type TextFontFamily,
  type TextFontPickerFamily,
  textFontFamilies,
  textFontPickerFamilies,
  textFontRegistry,
}

export const TEXT_LINE_HEIGHT_RATIO = 1.2
export const DEFAULT_TEXT_LINE_HEIGHT = TEXT_LINE_HEIGHT_RATIO
export const TEXT_VISUAL_TOP_TRIM_RATIO = 0.18
export const TEXT_VISUAL_ASCENT_RATIO = 1 - TEXT_VISUAL_TOP_TRIM_RATIO
export const TEXT_VISUAL_DESCENT_RATIO = 1 - TEXT_VISUAL_ASCENT_RATIO

export const textVerticalAlignments = ["top", "middle", "bottom"] as const
export type TextVerticalAlign = (typeof textVerticalAlignments)[number]

export const textHorizontalAlignments = ["left", "center", "right", "justify"] as const
export type TextHorizontalAlign = (typeof textHorizontalAlignments)[number]
export const DEFAULT_TEXT_VERTICAL_ALIGN: TextVerticalAlign = "top"

export type TextLayoutInput = {
  text: string
  fontSize: number
  fontFamily?: TextFontFamily | undefined
  fontWeight?: "normal" | "bold" | undefined
  width: number
  height: number
  lineHeight?: number | undefined
  align?: TextHorizontalAlign | undefined
  maxLines?: number | undefined
  verticalAlign?: TextVerticalAlign | undefined
  stretchXGrow?: boolean | undefined
  stretchXShrink?: boolean | undefined
  stretchYGrow?: boolean | undefined
  stretchYShrink?: boolean | undefined
  stretchX?: boolean | undefined
  stretchY?: boolean | undefined
  autoWrap?: boolean | undefined
  adaptiveFontSize?: boolean | undefined
  verticalText?: boolean | undefined
  measureText?: TextMeasureFunction | undefined
}

export type TextMeasureInput = {
  text: string
  fontSize: number
  fontFamily?: TextFontFamily | undefined
  fontWeight?: "normal" | "bold" | undefined
}

export type TextMeasurement = {
  width: number
  actualBoundingBoxAscent?: number | undefined
  actualBoundingBoxDescent?: number | undefined
  actualBoundingBoxLeft?: number | undefined
  actualBoundingBoxRight?: number | undefined
  fontBoundingBoxAscent?: number | undefined
  fontBoundingBoxDescent?: number | undefined
}

export type TextMeasureFunction = (input: TextMeasureInput) => TextMeasurement | undefined

export type TextLayoutLine = {
  text: string
  x: number
  y: number
  width: number
  letterSpacing: number
}

export type TextLayoutGlyph = {
  text: string
  x: number
  y: number
}

export type TextLayout = {
  lines: string[]
  lineLayouts: TextLayoutLine[]
  glyphs: TextLayoutGlyph[]
  verticalText: boolean
  effectiveAutoWrap: boolean
  resolvedFontSize: number
  lineHeight: number
  renderHeight: number
  naturalWidth: number
  naturalHeight: number
  contentX: number
  contentY: number
  contentWidth: number
  contentHeight: number
  textOffsetX: number
  textOffsetY: number
  baselineOffsetY: number
  scaleX: number
  scaleY: number
}

export type ResolvedTextAxisFit = {
  stretchXGrow: boolean
  stretchXShrink: boolean
  stretchYGrow: boolean
  stretchYShrink: boolean
}

function roundResolvedFontSize(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function resolveTextAxisFit(
  input: Pick<
    TextLayoutInput,
    "stretchXGrow" | "stretchXShrink" | "stretchYGrow" | "stretchYShrink" | "stretchX" | "stretchY"
  >
): ResolvedTextAxisFit {
  const legacyStretchX = input.stretchX ?? false
  const legacyStretchY = input.stretchY ?? false

  return {
    stretchXGrow: input.stretchXGrow ?? legacyStretchX,
    stretchXShrink: input.stretchXShrink ?? legacyStretchX,
    stretchYGrow: input.stretchYGrow ?? legacyStretchY,
    stretchYShrink: input.stretchYShrink ?? legacyStretchY,
  }
}

export function resolveEffectiveTextAutoWrap(
  autoWrap: boolean | undefined,
  adaptiveFontSize: boolean | undefined
): boolean {
  return adaptiveFontSize ? false : (autoWrap ?? true)
}

function resolveAxisScale(
  containerSize: number,
  contentSize: number,
  grow: boolean,
  shrink: boolean
): number {
  const ratio = containerSize / Math.max(contentSize, 0.0001)
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 1
  }
  if (ratio > 1) {
    return grow ? ratio : 1
  }
  if (ratio < 1) {
    return shrink ? ratio : 1
  }
  return 1
}

export function wrapText(text: string, maxCharsPerLine: number, maxLines?: number): string[] {
  const normalized = text.replaceAll("\r\n", "\n").split("\n")
  const lines: string[] = []
  for (const chunk of normalized) {
    if (chunk.length === 0) {
      lines.push("")
      continue
    }
    let current = ""
    for (const token of chunk.split(/\s+/)) {
      const candidate = current ? `${current} ${token}` : token
      if (candidate.length > maxCharsPerLine && current) {
        lines.push(current)
        current = token
      } else {
        current = candidate
      }
    }
    if (current) {
      lines.push(current)
    }
  }
  return maxLines ? lines.slice(0, maxLines) : lines
}

function isCjkOrFullWidth(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xff01 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  )
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function getAverageGlyphWidthRatio(fontFamily?: TextFontFamily): number {
  const profile = getTextFontMetricProfile(fontFamily)
  return (profile.uppercase + profile.lowercase + profile.digit + profile.symbol) / 4
}

function estimateGlyphWidthRatio(char: string, fontFamily?: TextFontFamily): number {
  const profile = getTextFontMetricProfile(fontFamily)
  const codePoint = char.codePointAt(0)
  if (codePoint === undefined) {
    return profile.fallback
  }
  if (/\s/u.test(char)) {
    return profile.space
  }
  if (isCjkOrFullWidth(codePoint)) {
    return profile.cjk
  }
  if (/[A-Z]/u.test(char)) {
    return profile.uppercase
  }
  if (/[a-z]/u.test(char)) {
    return profile.lowercase
  }
  if (/[0-9]/u.test(char)) {
    return profile.digit
  }
  if (/[-.,:;'"!?|/\\()[\]{}]/u.test(char)) {
    return profile.punctuation
  }
  return profile.symbol
}

export function wrapTextByWidth(
  text: string,
  fontSize: number,
  width?: number,
  maxLines?: number,
  autoWrap = true,
  fontFamily?: TextFontFamily,
  measureText?: TextMeasureFunction,
  fontWeight?: "normal" | "bold"
): string[] {
  if (!autoWrap) {
    const lines = text.replaceAll("\r\n", "\n").split("\n")
    return maxLines ? lines.slice(0, maxLines) : lines
  }

  if (!width) {
    return wrapText(text, 100, maxLines)
  }

  const breakToken = (token: string): string[] => {
    const parts: string[] = []
    let current = ""
    for (const char of Array.from(token)) {
      const candidate = `${current}${char}`
      if (
        current &&
        measureTextAdvanceWidth(candidate, fontSize, fontFamily, measureText, fontWeight) > width
      ) {
        parts.push(current)
        current = char
      } else {
        current = candidate
      }
    }
    if (current) {
      parts.push(current)
    }
    return parts
  }

  const normalized = text.replaceAll("\r\n", "\n").split("\n")
  const lines: string[] = []
  for (const chunk of normalized) {
    if (chunk.length === 0) {
      lines.push("")
      continue
    }
    let current = ""
    for (const token of chunk.split(/\s+/)) {
      const candidate = current ? `${current} ${token}` : token
      if (
        measureTextAdvanceWidth(candidate, fontSize, fontFamily, measureText, fontWeight) > width &&
        current
      ) {
        lines.push(current)
        const parts = breakToken(token)
        lines.push(...parts.slice(0, -1))
        current = parts[parts.length - 1] ?? ""
      } else if (
        measureTextAdvanceWidth(candidate, fontSize, fontFamily, measureText, fontWeight) > width
      ) {
        const parts = breakToken(token)
        lines.push(...parts.slice(0, -1))
        current = parts[parts.length - 1] ?? ""
      } else {
        current = candidate
      }
    }
    if (current) {
      lines.push(current)
    }
  }
  return maxLines ? lines.slice(0, maxLines) : lines
}

export function estimateCharsPerLine(
  fontSize: number,
  width?: number,
  fontFamily?: TextFontFamily
): number {
  if (!width) {
    return 100
  }
  return Math.max(4, Math.floor(width / (fontSize * getAverageGlyphWidthRatio(fontFamily))))
}

export function estimateTextLineWidth(
  line: string,
  fontSize: number,
  fontFamily?: TextFontFamily
): number {
  return (
    Array.from(line).reduce((sum, char) => sum + estimateGlyphWidthRatio(char, fontFamily), 0) *
    fontSize
  )
}

function measureTextAdvanceWidth(
  line: string,
  fontSize: number,
  fontFamily?: TextFontFamily,
  measureText?: TextMeasureFunction,
  fontWeight?: "normal" | "bold"
): number {
  const measured = measureText?.({ text: line, fontSize, fontFamily, fontWeight })
  return isFinitePositiveNumber(measured?.width)
    ? measured.width
    : estimateTextLineWidth(line, fontSize, fontFamily)
}

type ResolvedTextLineMetrics = {
  measured: boolean
  advanceWidth: number
  visualLeft: number
  visualRight: number
  actualAscent: number
  actualDescent: number
  fontAscent: number
  fontDescent: number
}

function getFallbackTextLineMetrics(
  line: string,
  fontSize: number,
  fontFamily?: TextFontFamily
): ResolvedTextLineMetrics {
  const advanceWidth = estimateTextLineWidth(line, fontSize, fontFamily)
  const actualAscent = fontSize * TEXT_VISUAL_ASCENT_RATIO
  const actualDescent = fontSize * TEXT_VISUAL_DESCENT_RATIO
  return {
    measured: false,
    advanceWidth,
    visualLeft: 0,
    visualRight: advanceWidth,
    actualAscent,
    actualDescent,
    fontAscent: actualAscent,
    fontDescent: actualDescent,
  }
}

function resolveMeasuredTextLineMetrics(
  line: string,
  input: TextLayoutInput
): ResolvedTextLineMetrics {
  const fallback = getFallbackTextLineMetrics(line, input.fontSize, input.fontFamily)
  const measured = input.measureText?.({
    text: line,
    fontSize: input.fontSize,
    fontFamily: input.fontFamily,
    fontWeight: input.fontWeight,
  })
  if (!measured || !isFinitePositiveNumber(measured.width)) {
    return fallback
  }

  const actualAscent = isFinitePositiveNumber(measured.actualBoundingBoxAscent)
    ? measured.actualBoundingBoxAscent
    : fallback.actualAscent
  const actualDescent =
    typeof measured.actualBoundingBoxDescent === "number" &&
    Number.isFinite(measured.actualBoundingBoxDescent) &&
    measured.actualBoundingBoxDescent >= 0
      ? measured.actualBoundingBoxDescent
      : fallback.actualDescent
  const fontAscent = isFinitePositiveNumber(measured.fontBoundingBoxAscent)
    ? measured.fontBoundingBoxAscent
    : actualAscent
  const fontDescent =
    typeof measured.fontBoundingBoxDescent === "number" &&
    Number.isFinite(measured.fontBoundingBoxDescent) &&
    measured.fontBoundingBoxDescent >= 0
      ? measured.fontBoundingBoxDescent
      : actualDescent
  const visualLeft =
    typeof measured.actualBoundingBoxLeft === "number" &&
    Number.isFinite(measured.actualBoundingBoxLeft)
      ? -measured.actualBoundingBoxLeft
      : fallback.visualLeft
  const visualRight =
    typeof measured.actualBoundingBoxRight === "number" &&
    Number.isFinite(measured.actualBoundingBoxRight)
      ? measured.actualBoundingBoxRight
      : measured.width

  return {
    measured: true,
    advanceWidth: measured.width,
    visualLeft,
    visualRight: Math.max(visualRight, visualLeft + 0.0001),
    actualAscent,
    actualDescent,
    fontAscent,
    fontDescent,
  }
}

function getKonvaLineBaselineOffset(
  lineHeight: number,
  metrics: Pick<ResolvedTextLineMetrics, "fontAscent" | "fontDescent">
): number {
  return (metrics.fontAscent - metrics.fontDescent) / 2 + lineHeight / 2
}

export function normalizeTextLineHeight(lineHeight?: number): number {
  return Math.max(0.7, Math.min(4, lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT))
}

export function getTextNaturalHeight(
  fontSize: number,
  lineCount: number,
  lineHeight = DEFAULT_TEXT_LINE_HEIGHT
): number {
  const normalizedLineHeight = normalizeTextLineHeight(lineHeight)
  return fontSize + (Math.max(1, lineCount) - 1) * fontSize * normalizedLineHeight
}

export function getTextFontFamilyStack(fontFamily?: TextFontFamily): string {
  return TEXT_FONT_FAMILY_STACKS[fontFamily ?? DEFAULT_TEXT_FONT_FAMILY]
}

function getVerticalTextColumns(
  text: string,
  fontSize: number,
  height: number,
  lineHeightRatio: number,
  maxLines?: number,
  autoWrap = true
): string[] {
  const columnCapacity = autoWrap
    ? Math.max(
        1,
        Math.floor((height + fontSize * (lineHeightRatio - 1)) / (fontSize * lineHeightRatio))
      )
    : Number.POSITIVE_INFINITY
  const columns: string[] = []
  const normalized = text.replaceAll("\r\n", "\n").split("\n")

  for (const chunk of normalized) {
    const chars = Array.from(chunk)
    if (chars.length === 0) {
      columns.push("")
      continue
    }

    for (let index = 0; index < chars.length; index += columnCapacity) {
      columns.push(chars.slice(index, index + columnCapacity).join(""))
    }
  }

  const visibleColumns = maxLines ? columns.slice(0, maxLines) : columns
  return visibleColumns.length > 0 ? visibleColumns : [""]
}

function resolveTextLayoutForFontSize(
  input: TextLayoutInput,
  resolvedFontSize: number,
  axisFit: ResolvedTextAxisFit,
  effectiveAutoWrap: boolean
): TextLayout {
  const sizedInput: TextLayoutInput = {
    ...input,
    fontSize: resolvedFontSize,
  }
  const verticalText = sizedInput.verticalText ?? false
  const lineHeightRatio = normalizeTextLineHeight(input.lineHeight)
  const lines = verticalText
    ? getVerticalTextColumns(
        sizedInput.text,
        resolvedFontSize,
        sizedInput.height,
        lineHeightRatio,
        sizedInput.maxLines,
        effectiveAutoWrap
      )
    : wrapTextByWidth(
        sizedInput.text,
        resolvedFontSize,
        sizedInput.width,
        sizedInput.maxLines,
        effectiveAutoWrap,
        sizedInput.fontFamily,
        sizedInput.measureText,
        sizedInput.fontWeight
      )
  const renderedLines = lines.length > 0 ? lines : [""]
  const lineHeight = resolvedFontSize * lineHeightRatio
  const renderHeight = verticalText
    ? Math.max(...renderedLines.map((line) => Array.from(line).length), 1) * lineHeight
    : lineHeight * renderedLines.length
  const lineMetrics = renderedLines.map((line) => resolveMeasuredTextLineMetrics(line, sizedInput))
  const fontMetrics = resolveMeasuredTextLineMetrics("M", sizedInput)
  const hasMeasuredMetrics =
    !verticalText && fontMetrics.measured && lineMetrics.every((metrics) => metrics.measured)
  const baselineOffset = getKonvaLineBaselineOffset(lineHeight, fontMetrics)
  const visualLeft = verticalText
    ? 0
    : Math.min(...lineMetrics.map((metrics) => metrics.visualLeft))
  const visualRight = verticalText
    ? resolvedFontSize
    : Math.max(...lineMetrics.map((metrics) => metrics.visualRight))
  const visualTop = verticalText
    ? 0
    : Math.min(
        ...lineMetrics.map(
          (metrics, index) => baselineOffset + index * lineHeight - metrics.actualAscent
        )
      )
  const visualBottom = verticalText
    ? renderHeight
    : Math.max(
        ...lineMetrics.map(
          (metrics, index) => baselineOffset + index * lineHeight + metrics.actualDescent
        )
      )
  const naturalWidth = verticalText
    ? getTextNaturalHeight(resolvedFontSize, renderedLines.length, lineHeightRatio)
    : hasMeasuredMetrics
      ? Math.max(visualRight - visualLeft, resolvedFontSize * 0.6)
      : Math.max(...lineMetrics.map((metrics) => metrics.advanceWidth), resolvedFontSize * 0.6)
  const naturalHeight = verticalText
    ? getTextNaturalHeight(
        resolvedFontSize,
        Math.max(...renderedLines.map((line) => Array.from(line).length), 1),
        lineHeightRatio
      )
    : hasMeasuredMetrics
      ? Math.max(visualBottom - visualTop, resolvedFontSize * 0.1)
      : getTextNaturalHeight(resolvedFontSize, renderedLines.length, lineHeightRatio)
  const contentWidth =
    (sizedInput.align ?? "left") === "justify" && !verticalText
      ? Math.max(sizedInput.width, naturalWidth)
      : naturalWidth
  const contentHeight = naturalHeight
  const scaleX = resolveAxisScale(
    sizedInput.width,
    contentWidth,
    axisFit.stretchXGrow,
    axisFit.stretchXShrink
  )
  const scaleY = resolveAxisScale(
    sizedInput.height,
    contentHeight,
    axisFit.stretchYGrow,
    axisFit.stretchYShrink
  )
  const alignedX = (() => {
    if (scaleX !== 1 || ((sizedInput.align ?? "left") === "justify" && !verticalText)) {
      return 0
    }
    switch (sizedInput.align ?? "left") {
      case "center":
        return (sizedInput.width - naturalWidth) / 2
      case "right":
        return sizedInput.width - naturalWidth
      case "justify":
      case "left":
        return 0
    }
  })()

  const alignedY = (() => {
    if (scaleY !== 1) {
      return 0
    }
    switch (sizedInput.verticalAlign ?? DEFAULT_TEXT_VERTICAL_ALIGN) {
      case "middle":
        return (sizedInput.height - naturalHeight) / 2
      case "bottom":
        return sizedInput.height - naturalHeight
      case "top":
        return 0
    }
  })()
  const lineLayouts: TextLayoutLine[] = verticalText
    ? []
    : renderedLines.map((line, index) => {
        const metrics =
          lineMetrics[index] ??
          getFallbackTextLineMetrics(line, resolvedFontSize, sizedInput.fontFamily)
        const width = metrics.advanceWidth
        const glyphCount = Array.from(line).length
        const letterSpacing =
          (sizedInput.align ?? "left") === "justify" && glyphCount > 1 && width < sizedInput.width
            ? (sizedInput.width - width) / (glyphCount - 1)
            : 0
        return {
          text: line,
          x: hasMeasuredMetrics ? -visualLeft : 0,
          y: hasMeasuredMetrics
            ? baselineOffset - visualTop + index * lineHeight
            : resolvedFontSize * TEXT_VISUAL_ASCENT_RATIO + index * lineHeight,
          width,
          letterSpacing,
        }
      })
  const glyphs: TextLayoutGlyph[] = verticalText
    ? renderedLines.flatMap((line, columnIndex) =>
        Array.from(line).map((char, rowIndex) => ({
          text: char,
          x: columnIndex * lineHeight + resolvedFontSize / 2,
          y: rowIndex * lineHeight,
        }))
      )
    : []

  return {
    lines: renderedLines,
    lineLayouts,
    glyphs,
    verticalText,
    effectiveAutoWrap,
    resolvedFontSize,
    lineHeight,
    renderHeight,
    naturalWidth,
    naturalHeight,
    contentX: alignedX,
    contentY: alignedY,
    contentWidth,
    contentHeight,
    textOffsetX: hasMeasuredMetrics ? -visualLeft : 0,
    textOffsetY: hasMeasuredMetrics ? -visualTop : -resolvedFontSize * TEXT_VISUAL_TOP_TRIM_RATIO,
    baselineOffsetY: hasMeasuredMetrics
      ? baselineOffset - visualTop
      : resolvedFontSize * TEXT_VISUAL_ASCENT_RATIO,
    scaleX,
    scaleY,
  }
}

export function resolveAdaptiveTextFontSize(input: TextLayoutInput): number {
  const baseFontSize = roundResolvedFontSize(input.fontSize)
  if (
    !input.adaptiveFontSize ||
    !Number.isFinite(input.height) ||
    input.height <= 0 ||
    !Number.isFinite(baseFontSize) ||
    baseFontSize <= 0
  ) {
    return baseFontSize
  }

  const axisFit = resolveTextAxisFit(input)
  const effectiveAutoWrap = resolveEffectiveTextAutoWrap(input.autoWrap, true)
  const initialLayout = resolveTextLayoutForFontSize(
    input,
    baseFontSize,
    axisFit,
    effectiveAutoWrap
  )
  if (!Number.isFinite(initialLayout.naturalHeight) || initialLayout.naturalHeight <= 0) {
    return baseFontSize
  }

  const primaryFontSize = roundResolvedFontSize(
    Math.max(0.1, (baseFontSize * input.height) / initialLayout.naturalHeight)
  )
  const correctedLayout = resolveTextLayoutForFontSize(
    input,
    primaryFontSize,
    axisFit,
    effectiveAutoWrap
  )
  if (!Number.isFinite(correctedLayout.naturalHeight) || correctedLayout.naturalHeight <= 0) {
    return primaryFontSize
  }

  return roundResolvedFontSize(
    Math.max(0.1, (primaryFontSize * input.height) / correctedLayout.naturalHeight)
  )
}

export function resolveTextLayout(input: TextLayoutInput): TextLayout {
  const axisFit = resolveTextAxisFit(input)
  const effectiveAutoWrap = resolveEffectiveTextAutoWrap(input.autoWrap, input.adaptiveFontSize)
  const resolvedFontSize = input.adaptiveFontSize
    ? resolveAdaptiveTextFontSize(input)
    : roundResolvedFontSize(input.fontSize)
  return resolveTextLayoutForFontSize(input, resolvedFontSize, axisFit, effectiveAutoWrap)
}
