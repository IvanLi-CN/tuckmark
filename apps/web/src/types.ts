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
  fields: TemplateField[]
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
  templateId?: string
  renderOptions: RenderOptions & {
    printWidthDots: number
    previewScale: number
  }
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
