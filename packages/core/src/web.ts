export { presetTemplateData } from "./preset-template-data.js"
export { buildSvg, escapeXml, estimateCharsPerLine, wrapText } from "./svg-renderer.js"
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
