import type { TemplateDefinition } from "./types.js"

const shippingLabel: TemplateDefinition = {
  id: "shipping-compact",
  name: "Compact Shipping Label",
  description: "A compact shipping label with recipient and order metadata.",
  width: 384,
  height: 224,
  tags: ["shipping", "preset"],
  fields: [
    { key: "recipient", label: "Recipient", required: true, multiline: false },
    { key: "address", label: "Address", required: true, multiline: true },
    { key: "orderId", label: "Order ID", required: true, multiline: false },
    { key: "note", label: "Note", required: false, multiline: true },
  ],
  elements: [
    {
      kind: "rect",
      x: 8,
      y: 8,
      width: 368,
      height: 208,
      strokeWidth: 2,
      fill: "white",
      stroke: "#111111",
      radius: 8,
    },
    {
      kind: "text",
      key: "__title",
      value: "SHIP TO",
      x: 18,
      y: 28,
      fontSize: 18,
      fontWeight: "bold",
      align: "left",
    },
    {
      kind: "text",
      key: "recipient",
      x: 18,
      y: 62,
      fontSize: 26,
      fontWeight: "bold",
      align: "left",
    },
    {
      kind: "text",
      key: "address",
      x: 18,
      y: 96,
      fontSize: 18,
      fontWeight: "normal",
      align: "left",
      maxLines: 3,
    },
    { kind: "line", x1: 18, y1: 166, x2: 366, y2: 166, strokeWidth: 2, stroke: "#111111" },
    {
      kind: "text",
      key: "__order_label",
      value: "ORDER",
      x: 18,
      y: 192,
      fontSize: 14,
      fontWeight: "bold",
      align: "left",
    },
    {
      kind: "text",
      key: "orderId",
      x: 90,
      y: 192,
      fontSize: 14,
      fontWeight: "normal",
      align: "left",
    },
    {
      kind: "text",
      key: "note",
      x: 220,
      y: 192,
      fontSize: 14,
      fontWeight: "normal",
      align: "right",
      width: 140,
    },
  ],
}

const cableLabel: TemplateDefinition = {
  id: "cable-tag",
  name: "Cable Tag",
  description: "A simple equipment/cable label for direct organization.",
  width: 384,
  height: 160,
  tags: ["ops", "preset"],
  fields: [
    { key: "name", label: "Name", required: true, multiline: false },
    { key: "port", label: "Port", required: false, multiline: false },
    { key: "location", label: "Location", required: false, multiline: false },
  ],
  elements: [
    {
      kind: "rect",
      x: 6,
      y: 6,
      width: 372,
      height: 148,
      strokeWidth: 2,
      fill: "white",
      stroke: "#111111",
      radius: 12,
    },
    { kind: "text", key: "name", x: 20, y: 56, fontSize: 34, fontWeight: "bold", align: "left" },
    { kind: "text", key: "port", x: 20, y: 104, fontSize: 20, fontWeight: "normal", align: "left" },
    {
      kind: "text",
      key: "location",
      x: 200,
      y: 104,
      width: 160,
      fontSize: 20,
      fontWeight: "normal",
      align: "right",
    },
  ],
}

export const presetTemplates: TemplateDefinition[] = [shippingLabel, cableLabel]

export function getTemplateById(templateId: string): TemplateDefinition {
  const template = presetTemplates.find((item) => item.id === templateId)
  if (!template) {
    throw new Error(`Unknown template: ${templateId}`)
  }
  return template
}
