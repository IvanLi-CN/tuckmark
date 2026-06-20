export type BrowserPrintableArtifact = {
  id: string
  pngUrl: string
  packetsUrl: string
  renderOptions: {
    printWidthDots: number
    threshold: number
    xOffsetDots: number
    paperType: "continuous" | "gap"
  }
}
