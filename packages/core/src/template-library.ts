import { presetTemplateData } from "./preset-template-data.js"
import type { TemplateDefinition } from "./types.js"

export const presetTemplates: TemplateDefinition[] = presetTemplateData

export function getTemplateById(templateId: string): TemplateDefinition {
  const template = presetTemplates.find((item) => item.id === templateId)
  if (!template) {
    throw new Error(`Unknown template: ${templateId}`)
  }
  return template
}
