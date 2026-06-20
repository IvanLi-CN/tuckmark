import type { Printer, RenderOptions, Template } from "./types.js"

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
  printWidthDots: 384,
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

export function buildInputFromTemplate(template: Template | undefined): Record<string, string> {
  if (!template) {
    return {}
  }

  const fallback = fallbackInputs[template.id] ?? {}
  return Object.fromEntries(
    template.fields.map((field) => [field.key, fallback[field.key] ?? field.defaultValue ?? ""])
  )
}
