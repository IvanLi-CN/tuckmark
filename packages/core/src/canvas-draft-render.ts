import type { DirectCanvasDefinition } from "./types.js"

const DotsPerMillimeter = 8

function toDots(value: number): number {
  return value * DotsPerMillimeter
}

/** Compile the persisted millimetre draft format into the renderer's dot canvas. */
export function compileCanvasDraftToDirectCanvas(
  document: Record<string, any>,
  input: Record<string, string>
): DirectCanvasDefinition {
  const fields = new Map<string, string>(
    (document.fields ?? []).map((field: any) => [
      field.key,
      input[field.key] ?? field.defaultValue ?? "",
    ])
  )
  const elements = (document.elements ?? [])
    .filter((element: any) => element.meta?.visible !== false)
    .map((element: any) => {
      const resolvedValue = element.binding
        ? (fields.get(element.binding.fieldKey) ?? element.value ?? "")
        : element.value
      const key = element.binding?.fieldKey ?? element.id
      switch (element.kind) {
        case "text":
          return {
            kind: "text",
            key,
            x: toDots(element.x),
            y: toDots(element.y),
            width: toDots(element.width),
            height: toDots(element.height),
            fontSize: toDots(element.fontSize),
            ...(element.fontFamily ? { fontFamily: element.fontFamily } : {}),
            ...(element.lineHeight ? { lineHeight: element.lineHeight } : {}),
            fontWeight: element.fontWeight,
            align: element.align,
            ...(element.justifyAlign ? { justifyAlign: element.justifyAlign } : {}),
            verticalAlign: element.verticalAlign,
            stretchXGrow: element.stretchXGrow,
            stretchXShrink: element.stretchXShrink,
            stretchYGrow: element.stretchYGrow,
            stretchYShrink: element.stretchYShrink,
            autoWrap: element.autoWrap,
            adaptiveFontSize: element.adaptiveFontSize,
            verticalText: element.verticalText,
            value: resolvedValue ?? "",
            ...(element.maxLines ? { maxLines: element.maxLines } : {}),
            rotation: element.rotation ?? 0,
          }
        case "rect":
          return {
            kind: "rect",
            x: toDots(element.x),
            y: toDots(element.y),
            width: toDots(element.width),
            height: toDots(element.height),
            strokeWidth: toDots(element.strokeWidth),
            fill: element.fill,
            stroke: element.stroke,
            radius: toDots(element.radius),
            rotation: element.rotation ?? 0,
          }
        case "circle":
          return {
            kind: "circle",
            x: toDots(element.x),
            y: toDots(element.y),
            size: toDots(element.size),
            strokeWidth: toDots(element.strokeWidth),
            fill: element.fill,
            stroke: element.stroke,
          }
        case "triangle":
          return {
            kind: "triangle",
            x: toDots(element.x),
            y: toDots(element.y),
            width: toDots(element.width),
            height: toDots(element.height),
            strokeWidth: toDots(element.strokeWidth),
            fill: element.fill,
            stroke: element.stroke,
            rotation: element.rotation ?? 0,
          }
        case "line":
          return {
            kind: "line",
            x1: toDots(element.x),
            y1: toDots(element.y),
            x2: toDots(element.x2),
            y2: toDots(element.y2),
            strokeWidth: toDots(element.strokeWidth),
            stroke: element.stroke,
          }
        case "barcode":
          return {
            kind: "barcode",
            key,
            x: toDots(element.x),
            y: toDots(element.y),
            width: toDots(element.width),
            height: toDots(element.height),
            value: resolvedValue ?? "",
            format: element.format,
            showValue: element.showValue,
            rotation: element.rotation ?? 0,
          }
        case "qr":
          return {
            kind: "qr",
            key,
            x: toDots(element.x),
            y: toDots(element.y),
            size: toDots(element.size),
            value: resolvedValue ?? "",
            errorCorrectionLevel: element.errorCorrectionLevel,
            rotation: element.rotation ?? 0,
          }
        case "datamatrix":
          return {
            kind: "datamatrix",
            key,
            x: toDots(element.x),
            y: toDots(element.y),
            size: toDots(element.size),
            value: resolvedValue ?? "",
            rotation: element.rotation ?? 0,
          }
        default:
          throw new Error(`Unsupported draft element kind: ${String(element.kind)}`)
      }
    }) as DirectCanvasDefinition["elements"]

  return {
    id: document.id ?? "canvas",
    name: document.name ?? "Canvas",
    width: toDots(document.width),
    height: toDots(document.height),
    elements,
  }
}
