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
}

export type Template = {
  id: string
  name: string
  description: string
  width?: number
  height?: number
  fields: TemplateField[]
}

export type CanvasElementKind = "text" | "rect" | "line" | "barcode" | "qr"

export type CanvasElement =
  | {
      id: string
      kind: "text"
      x: number
      y: number
      width: number
      fontSize: number
      fontWeight: "normal" | "bold"
      align: "left" | "center" | "right"
      value: string
      maxLines?: number
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
    }
  | {
      id: string
      kind: "qr"
      x: number
      y: number
      size: number
      value: string
      errorCorrectionLevel: "L" | "M" | "Q" | "H"
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
  source?: "template" | "canvas" | "batch_row" | "safe_text"
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
