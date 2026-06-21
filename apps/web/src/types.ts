export type PaperType = "continuous" | "gap"

export type RenderOptions = {
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

export type AppMode = "runtime" | "demo-seeded" | "mock-shell"

export type AppCapabilities = {
  browserDirectPrintPath: PrintPathState
  serviceApiPrintPath: PrintPathState
}

export type AppContext = {
  apiBasePath: string
  basePath: string
  isPages: boolean
  mode: AppMode
  capabilities: AppCapabilities
}
