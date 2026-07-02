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
  const fieldKeys = new Set<string>()
  for (const field of templatePackage.fields) {
    if (fieldKeys.has(field.key)) {
      throw new Error(`Duplicate field key: ${field.key}`)
    }
    fieldKeys.add(field.key)
  }

  for (const [index, element] of templatePackage.elements.entries()) {
    if (element.kind === "text" || element.kind === "barcode" || element.kind === "qr") {
      if (!element.value && !fieldKeys.has(element.key)) {
        throw new Error(`Element ${index + 1} references unknown field: ${element.key}`)
      }
    }
    validateElementBounds(templatePackage, element, index)
  }
}

function validateElementBounds(
  templatePackage: UserTemplatePackage,
  element: TemplateElement,
  index: number
): void {
  const width = templatePackage.canvas.width
  const height = templatePackage.canvas.height
  const fail = (message: string) => {
    throw new Error(`Element ${index + 1} ${message}`)
  }

  switch (element.kind) {
    case "text":
      if (element.x < 0 || element.y < 0) fail("is outside the canvas")
      if (element.width && element.x + element.width > width) fail("exceeds canvas width")
      if (element.y > height) fail("exceeds canvas height")
      return
    case "rect":
      if (element.x < 0 || element.y < 0) fail("is outside the canvas")
      if (element.x + element.width > width) fail("exceeds canvas width")
      if (element.y + element.height > height) fail("exceeds canvas height")
      return
    case "line":
      if (Math.min(element.x1, element.x2) < 0 || Math.min(element.y1, element.y2) < 0) {
        fail("is outside the canvas")
      }
      if (Math.max(element.x1, element.x2) > width) fail("exceeds canvas width")
      if (Math.max(element.y1, element.y2) > height) fail("exceeds canvas height")
      return
    case "barcode":
      if (element.x < 0 || element.y < 0) fail("is outside the canvas")
      if (element.x + element.width > width) fail("exceeds canvas width")
      if (element.y + element.height > height) fail("exceeds canvas height")
      return
    case "qr":
      if (element.x < 0 || element.y < 0) fail("is outside the canvas")
      if (element.x + element.size > width) fail("exceeds canvas width")
      if (element.y + element.size > height) fail("exceeds canvas height")
      return
  }
}

function materializeTemplateElement(
  element: TemplateElement,
  fieldDefaults: Map<string, string>
): TemplateElement {
  if (element.kind === "text" || element.kind === "barcode" || element.kind === "qr") {
    return {
      ...element,
      value: fieldDefaults.get(element.key) ?? element.value ?? "",
    }
  }
  return element
}
