export type { DataMatrixEncoding } from "./data-matrix.js"
export { encodeDataMatrix } from "./data-matrix.js"
export { presetTemplateData } from "./preset-template-data.js"
export { buildSvg, escapeXml } from "./svg-renderer.js"
export type {
  CanvasDraftPayload,
  CanvasDraftRecord,
  ExistingDeletedCanvasDraftMetadata,
  ExistingRecordMetadata,
  RecentPrintPayload,
  RecentPrintRecord,
  SharedCanvasDraftDocument,
  SyncState,
  TemplateUsagePayload,
  TemplateUsageRecord,
} from "./sync-state.js"
export {
  createCanvasDraftRecord,
  createDeletedCanvasDraftRecord,
  createRecentPrintRecord,
  createTemplateUsageRecord,
  emptySyncState,
  mergeSyncState,
  parseSyncState,
  stableHash,
  stableStringify,
} from "./sync-state.js"
export { getTemplateById, presetTemplates } from "./template-library.js"
export type {
  TextFontDefinition,
  TextFontFamily,
  TextFontPickerFamily,
  TextHorizontalAlign,
  TextLayout,
  TextMeasureFunction,
  TextVerticalAlign,
} from "./text-layout.js"
export {
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_VERTICAL_ALIGN,
  estimateCharsPerLine,
  estimateTextLineWidth,
  getTextFontDefinition,
  getTextFontFamilyStack,
  getTextNaturalHeight,
  normalizeTextLineHeight,
  resolveAdaptiveTextFontSize,
  resolveEffectiveTextAutoWrap,
  resolveTextFontFamily,
  resolveTextAxisFit,
  resolveTextLayout,
  TEXT_FONT_FAMILY_STACKS,
  TEXT_LINE_HEIGHT_RATIO,
  textFontFamilies,
  textFontPickerFamilies,
  textFontRegistry,
  textHorizontalAlignments,
  textVerticalAlignments,
  wrapText,
  wrapTextByWidth,
} from "./text-layout.js"
export type {
  ArtifactPackets,
  DirectCanvasDefinition,
  PaperType,
  PreviewArtifact,
  Printer,
  PrinterProbeResult,
  RenderOptions,
  SafeTextLabelInput,
  TemplateDefinition,
  TemplateElement,
  TemplateField,
} from "./types.js"
export type { UserTemplatePackage, UserTemplatePackageField } from "./user-template-package.js"
export {
  compileUserTemplatePackageToCanvas,
  parseUserTemplatePackage,
  resolveUserTemplatePackageRenderOptions,
  userTemplatePackageSchema,
} from "./user-template-package.js"
