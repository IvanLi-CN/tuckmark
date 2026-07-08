import type {
  TextFontFamily,
  TextHorizontalAlign,
  TextVerticalAlign,
} from "../../../packages/core/src/web.js"

export type PaperType = "continuous" | "gap"

export type RenderOptions = {
  printWidthDots: number
  paperType: PaperType
  threshold: number
  xOffsetDots: number
}

export type TemplateField = {
  key: string
  label: string
  required: boolean
  multiline?: boolean
  defaultValue?: string
  sampleValue?: string
}

export type Template = {
  id: string
  name: string
  description: string
  width?: number
  height?: number
  fields: TemplateField[]
}

export type CanvasElementKind = "text" | "rect" | "circle" | "triangle" | "line" | "barcode" | "qr"

export type CanvasElement =
  | {
      id: string
      kind: "text"
      x: number
      y: number
      width: number
      height: number
      fontSize: number
      fontFamily: TextFontFamily
      lineHeight: number
      fontWeight: "normal" | "bold"
      align: TextHorizontalAlign
      justifyAlign?: Exclude<TextHorizontalAlign, "justify">
      verticalAlign: TextVerticalAlign
      stretchX: boolean
      stretchY: boolean
      autoWrap: boolean
      verticalText: boolean
      value: string
      maxLines?: number
      rotation?: number
    }
  | {
      id: string
      kind: "rect"
      x: number
      y: number
      width: number
      height: number
      strokeWidth: number
      fill: string
      stroke: string
      radius: number
      rotation?: number
    }
  | {
      id: string
      kind: "circle"
      x: number
      y: number
      size: number
      strokeWidth: number
      fill: string
      stroke: string
    }
  | {
      id: string
      kind: "triangle"
      x: number
      y: number
      width: number
      height: number
      strokeWidth: number
      fill: string
      stroke: string
      rotation?: number
    }
  | {
      id: string
      kind: "line"
      x: number
      y: number
      x2: number
      y2: number
      strokeWidth: number
      stroke: string
    }
  | {
      id: string
      kind: "barcode"
      x: number
      y: number
      width: number
      height: number
      value: string
      format: "CODE128"
      showValue: boolean
      rotation?: number
    }
  | {
      id: string
      kind: "qr"
      x: number
      y: number
      size: number
      value: string
      errorCorrectionLevel: "L" | "M" | "Q" | "H"
      rotation?: number
    }

export type CanvasLayerMeta = {
  name: string
  visible: boolean
  locked: boolean
}

export type CanvasFieldBindingKind = "text" | "barcode" | "qr"

export type CanvasElementBinding = {
  fieldKey: string
  kind: CanvasFieldBindingKind
}

export type CanvasDraftElement = CanvasElement & {
  meta: CanvasLayerMeta
  binding?: CanvasElementBinding
}

export type CanvasDraftSource =
  | {
      kind: "scratch"
      presetId: string
    }
  | {
      kind: "preset-template"
      presetId: string
    }
  | {
      kind: "user-template"
      templateId: string
    }

export type CanvasDraftField = {
  key: string
  label: string
  defaultValue: string
  sampleValue?: string
  multiline: boolean
  bindings: string[]
}

export type UserTemplateVersionKind = "saved" | "autosave"

export type UserTemplateVersionSnapshot = {
  id: string
  templateId: string
  version: number
  kind: UserTemplateVersionKind
  createdAt: string
  label: string
  sourceVersionId?: string
  document: CanvasDraftDocument
}

export type UserTemplateRecord = {
  id: string
  name: string
  description: string
  width: number
  height: number
  createdAt: string
  updatedAt: string
  currentVersionId: string
  fieldOrder: string[]
}

export type CanvasWorkingCopyIndexEntry = {
  sourceKey: string
  source: CanvasDraftSource
  draft: CanvasDraftDocument
  updatedAt: string
  templateId?: string
  baseVersionId?: string
}

export type UserTemplateSummary = UserTemplateRecord & {
  fields: CanvasDraftField[]
}

export type UserTemplateHistory = {
  template: UserTemplateSummary
  saved: UserTemplateVersionSnapshot[]
  autosaves: UserTemplateVersionSnapshot[]
}

export type CanvasDraftDocument = {
  version: 1
  unit?: "mm"
  id: string
  presetId: string
  name: string
  source: CanvasDraftSource
  templateId?: string
  baseVersionId?: string
  lastSavedAt?: string
  width: number
  height: number
  renderOptions?: Partial<RenderOptions>
  fields: CanvasDraftField[]
  elements: CanvasDraftElement[]
  editor: {
    gridEnabled: boolean
    snapEnabled: boolean
  }
}

export type CanvasDocumentPreset = {
  id: string
  name: string
  width: number
  height: number
  description: string
}

export type Printer = {
  id: string
  name?: string
  rssi?: number
  capabilities: {
    printWidthDots: number
    supportedPaperTypes: PaperType[]
  }
}

export type PreviewArtifact = {
  id: string
  name: string
  source?: "template" | "canvas" | "batch_row" | "safe_text" | "user_template"
  templateId?: string
  batchIndex?: number
  renderOptions: RenderOptions & {
    printWidthDots: number
    previewScale: number
  }
  input?: Record<string, string>
  width: number
  height: number
  createdAt: string
}

export type PreviewResult = {
  artifact: PreviewArtifact
}

export type PrintResult = {
  id?: string
  status?: string
  preview?: PreviewResult
  job?: {
    id: string
    status: string
    artifactId: string
    printerId: string
  }
}

export type SetupRefreshResult = {
  printers: Printer[]
  selectedPrinter: Printer | null
  selectedPrinterReason: "preferred-name" | "same-id" | "singleton" | "none"
}

export type PrintPathState = "available" | "disabled" | "mocked" | "unsupported" | "unavailable"

export type AppMode = "runtime" | "demo"

export type AppSurface = "server-http" | "browser-static"

export type ArtifactPackets = {
  artifactId: string
  packetsJsonPath: string
  packets: string[]
  packetCount: number
  totalBytes: number
}

export type ArtifactPreviewSource =
  | {
      kind: "url"
      url: string
    }
  | {
      kind: "data-url"
      dataUrl: string
    }

export type ArtifactData = {
  preview: ArtifactPreviewSource
  packets: ArtifactPackets
}

export type AppCapabilities = {
  browserDirectPrintPath: PrintPathState
  serviceApiPrintPath: PrintPathState
}

export type AppContext = {
  apiBasePath: string
  basePath: string
  mode: AppMode
  surface: AppSurface
  capabilities: AppCapabilities
}
