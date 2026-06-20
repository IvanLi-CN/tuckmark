import type { PreviewArtifact, Printer, RenderOptions, Template } from "./types.js"

export const fallbackTemplates: Template[] = [
  {
    id: "shipping-compact",
    name: "Compact Shipping Label",
    description: "用于收件人与订单信息的紧凑模板。",
    fields: [
      { key: "recipient", label: "Recipient", required: true },
      { key: "address", label: "Address", required: true, multiline: true },
      { key: "orderId", label: "Order ID", required: true },
      { key: "note", label: "Note", required: false, multiline: true },
    ],
  },
  {
    id: "cable-tag",
    name: "Cable Tag",
    description: "用于线缆、设备和端口整理的标签模板。",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "port", label: "Port", required: false },
      { key: "location", label: "Location", required: false },
    ],
  },
]

export const fallbackInputs: Record<string, Record<string, string>> = {
  "shipping-compact": {
    recipient: "Koha Cat",
    address: "Moon Street 42\nShanghai",
    orderId: "TM-001",
    note: "fragile",
  },
  "cable-tag": {
    name: "LAN-01",
    port: "Gi1/0/1",
    location: "Rack A",
  },
}

export const defaultRenderOptions: RenderOptions = {
  paperType: "continuous",
  threshold: 150,
  xOffsetDots: 0,
}

export const seededPrinters: Printer[] = [
  {
    id: "printer-demo-1",
    name: "Studio P2",
    rssi: -48,
    capabilities: {
      printWidthDots: 384,
      supportedPaperTypes: ["continuous", "gap"],
    },
  },
]

export function buildPreviewArtifact(
  templateId: string | undefined,
  renderOptions: RenderOptions,
  idSuffix: string
): PreviewArtifact {
  return {
    id: `artifact-${idSuffix}`,
    name: templateId ? `${templateId} Preview` : "Safe Text Preview",
    templateId,
    renderOptions: {
      printWidthDots: 384,
      previewScale: 4,
      paperType: renderOptions.paperType,
      threshold: renderOptions.threshold,
      xOffsetDots: renderOptions.xOffsetDots,
    },
    width: 384,
    height: templateId === "cable-tag" ? 96 : 120,
    createdAt: "2026-06-20T10:00:00.000Z",
  }
}

export function buildInputFromTemplate(template: Template | undefined): Record<string, string> {
  if (!template) {
    return {}
  }

  const fallback = fallbackInputs[template.id] ?? {}
  return Object.fromEntries(
    template.fields.map((field) => [field.key, fallback[field.key] ?? field.defaultValue ?? ""])
  )
}

export function createPreviewDataUrl(templateId?: string): string {
  const accent = templateId === "cable-tag" ? "#2a7a8a" : "#c4683d"
  const title = templateId === "cable-tag" ? "Cable Tag" : "Shipping Label"
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="768" height="240" viewBox="0 0 768 240">
      <rect width="768" height="240" rx="28" fill="#fffdf9"/>
      <rect x="14" y="14" width="740" height="212" rx="22" fill="#f5efe7" stroke="${accent}" stroke-width="6"/>
      <text x="48" y="78" font-family="Avenir Next, sans-serif" font-size="30" fill="#1f1a18">${title}</text>
      <text x="48" y="122" font-family="Avenir Next, sans-serif" font-size="18" fill="#4d4036">Formal route tree · shared component surface</text>
      <text x="48" y="166" font-family="Avenir Next, sans-serif" font-size="16" fill="#7b6657">GitHub Pages uses mock API and capability gating, not a cloned page.</text>
      <circle cx="680" cy="74" r="28" fill="${accent}" opacity="0.22"/>
      <circle cx="720" cy="132" r="18" fill="${accent}" opacity="0.35"/>
    </svg>
  `.trim()

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
