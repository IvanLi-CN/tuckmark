import { z } from "zod"
import {
  type DirectCanvasDefinition,
  directCanvasSchema,
  renderOptionsSchema,
  type TemplateElement,
  templateElementSchema,
} from "./types.js"

export const userTemplatePackageFieldSchema = z.object({
  key: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
  label: z.string().min(1),
  defaultValue: z.string().default(""),
  multiline: z.boolean().default(false),
})
export type UserTemplatePackageField = z.infer<typeof userTemplatePackageFieldSchema>

export const userTemplatePackageSchema = z.object({
  schema: z.literal("tuckmark.user-template-package.v1"),
  id: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  name: z.string().min(1),
  description: z.string().default(""),
  canvas: z.object({
    width: z.number().int().positive().max(384),
    height: z.number().int().positive().max(640),
  }),
  fields: z.array(userTemplatePackageFieldSchema).default([]),
  elements: z.array(templateElementSchema).min(1),
  sampleInput: z.record(z.string(), z.string()).default({}),
  renderOptions: renderOptionsSchema.partial().default({}),
  tags: z.array(z.string().min(1)).default([]),
})
export type UserTemplatePackage = z.infer<typeof userTemplatePackageSchema>

export function parseUserTemplatePackage(input: unknown): UserTemplatePackage {
  const parsed = userTemplatePackageSchema.parse(input)
  validateUserTemplatePackageSemantics(parsed)
  return parsed
}

export function compileUserTemplatePackageToCanvas(
  templatePackage: UserTemplatePackage,
  input: Record<string, string> = templatePackage.sampleInput
): DirectCanvasDefinition {
  const mergedInput = {
    ...templatePackage.sampleInput,
    ...input,
  }
  const fieldDefaults = new Map(
    templatePackage.fields.map((field) => [field.key, mergedInput[field.key] ?? field.defaultValue])
  )

  return directCanvasSchema.parse({
    id: templatePackage.id,
    name: templatePackage.name,
    width: templatePackage.canvas.width,
    height: templatePackage.canvas.height,
    elements: templatePackage.elements.map((element) =>
      materializeTemplateElement(element, fieldDefaults)
    ),
  })
}

export function resolveUserTemplatePackageRenderOptions(templatePackage: UserTemplatePackage) {
  return templatePackage.renderOptions
}

function validateUserTemplatePackageSemantics(templatePackage: UserTemplatePackage): void {
  const printWidthDots = templatePackage.renderOptions.printWidthDots
  if (printWidthDots !== undefined && templatePackage.canvas.width > printWidthDots) {
    throw new Error(
      `Canvas width ${templatePackage.canvas.width} exceeds render print width ${printWidthDots}`
    )
  }

  const fieldKeys = new Set<string>()
  const fieldDefaults = new Map<string, string>()
  for (const field of templatePackage.fields) {
    if (fieldKeys.has(field.key)) {
      throw new Error(`Duplicate field key: ${field.key}`)
    }
    fieldKeys.add(field.key)
    fieldDefaults.set(field.key, templatePackage.sampleInput[field.key] ?? field.defaultValue)
  }

  for (const [index, element] of templatePackage.elements.entries()) {
    if (element.kind === "text" || element.kind === "barcode" || element.kind === "qr") {
      if (!element.value && !fieldKeys.has(element.key)) {
        throw new Error(`Element ${index + 1} references unknown field: ${element.key}`)
      }
      if (
        (element.kind === "barcode" || element.kind === "qr") &&
        resolveTemplateElementValue(element, fieldDefaults).trim().length === 0
      ) {
        throw new Error(`Element ${index + 1} requires default ${element.kind} content`)
      }
    }
    validateElementBounds(templatePackage, element, index, fieldDefaults)
  }
}

function validateElementBounds(
  templatePackage: UserTemplatePackage,
  element: TemplateElement,
  index: number,
  fieldDefaults: Map<string, string>
): void {
  const width = templatePackage.canvas.width
  const height = templatePackage.canvas.height
  const fail = (message: string) => {
    throw new Error(`Element ${index + 1} ${message}`)
  }

  switch (element.kind) {
    case "text":
      validateRectBounds(
        {
          left: element.x,
          top: element.y - element.fontSize,
          width: element.width ?? estimateTextWidth(element, fieldDefaults),
          height: element.fontSize + 4,
          rotation: element.rotation,
        },
        width,
        height,
        fail
      )
      return
    case "rect":
      validateRectBounds(
        {
          left: element.x,
          top: element.y,
          width: element.width,
          height: element.height,
          rotation: element.rotation,
        },
        width,
        height,
        fail
      )
      return
    case "line":
      if (Math.min(element.x1, element.x2) < 0 || Math.min(element.y1, element.y2) < 0) {
        fail("is outside the canvas")
      }
      if (Math.max(element.x1, element.x2) > width) fail("exceeds canvas width")
      if (Math.max(element.y1, element.y2) > height) fail("exceeds canvas height")
      return
    case "barcode":
      validateRectBounds(
        {
          left: element.x,
          top: element.y,
          width: element.width,
          height: element.height,
          rotation: element.rotation,
        },
        width,
        height,
        fail
      )
      return
    case "qr":
      validateRectBounds(
        {
          left: element.x,
          top: element.y,
          width: element.size,
          height: element.size,
          rotation: element.rotation,
        },
        width,
        height,
        fail
      )
      return
  }
}

function estimateTextWidth(
  element: Extract<TemplateElement, { kind: "text" }>,
  fieldDefaults: Map<string, string>
): number {
  const text = resolveTemplateElementValue(element, fieldDefaults) || element.key
  return Math.max(text.length, 1) * element.fontSize * 0.6
}

function resolveTemplateElementValue(
  element: Extract<TemplateElement, { kind: "text" | "barcode" | "qr" }>,
  fieldDefaults: Map<string, string>
): string {
  const fieldValue = fieldDefaults.get(element.key)
  return fieldValue && fieldValue.length > 0 ? fieldValue : (element.value ?? "")
}

function validateRectBounds(
  box: { left: number; top: number; width: number; height: number; rotation?: number },
  canvasWidth: number,
  canvasHeight: number,
  fail: (message: string) => never
): void {
  const bounds = getRotatedBounds(box)
  if (
    bounds.left < 0 ||
    bounds.top < 0 ||
    bounds.right > canvasWidth ||
    bounds.bottom > canvasHeight
  ) {
    fail("exceeds rotated canvas bounds")
  }
}

function getRotatedBounds(box: {
  left: number
  top: number
  width: number
  height: number
  rotation?: number
}) {
  const rotation = box.rotation ?? 0
  if (rotation === 0) {
    return {
      left: box.left,
      top: box.top,
      right: box.left + box.width,
      bottom: box.top + box.height,
    }
  }

  const radians = (rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const originX = box.left + box.width / 2
  const originY = box.top + box.height / 2
  const corners = [
    { x: box.left, y: box.top },
    { x: box.left + box.width, y: box.top },
    { x: box.left + box.width, y: box.top + box.height },
    { x: box.left, y: box.top + box.height },
  ].map((corner) => {
    const dx = corner.x - originX
    const dy = corner.y - originY
    return {
      x: originX + dx * cos - dy * sin,
      y: originY + dx * sin + dy * cos,
    }
  })

  return {
    left: Math.min(...corners.map((corner) => corner.x)),
    top: Math.min(...corners.map((corner) => corner.y)),
    right: Math.max(...corners.map((corner) => corner.x)),
    bottom: Math.max(...corners.map((corner) => corner.y)),
  }
}

function materializeTemplateElement(
  element: TemplateElement,
  fieldDefaults: Map<string, string>
): TemplateElement {
  if (element.kind === "text" || element.kind === "barcode" || element.kind === "qr") {
    const fieldValue = fieldDefaults.get(element.key)
    return {
      ...element,
      value: fieldValue && fieldValue.length > 0 ? fieldValue : (element.value ?? ""),
    }
  }
  return element
}
