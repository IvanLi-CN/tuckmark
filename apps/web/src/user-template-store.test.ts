// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest"

import {
  createDraftFromPreset,
  getPresetById,
  toggleElementBinding,
} from "./canvas-editor-model.js"
import {
  clearTemplateAutosaves,
  getAutosaveIntervalMs,
  loadWorkingCopy,
  readUserTemplateHistory,
  resetUserTemplateStoreForTest,
  saveUserTemplate,
  saveUserTemplateAutosave,
} from "./user-template-store.js"

describe("user-template-store", () => {
  beforeEach(async () => {
    await resetUserTemplateStoreForTest()
  })

  it("creates a saved template, appends versions, and keeps the working copy aligned", async () => {
    const base = createDraftFromPreset(getPresetById("shipping-wide"))
    const firstText = base.elements.find((element) => element.kind === "text")
    const firstTextId = firstText?.id
    if (!firstTextId) {
      throw new Error("expected shipping-wide preset to include a text element")
    }
    const initialDraft = toggleElementBinding(base, firstTextId, true)

    const firstSave = await saveUserTemplate({
      name: "Warehouse Label",
      document: initialDraft,
    })

    expect(firstSave.template.id).toBeTruthy()
    expect(firstSave.version.kind).toBe("saved")
    expect(firstSave.version.version).toBe(1)
    expect(firstSave.workingCopy.source.kind).toBe("user-template")
    expect(firstSave.workingCopy.baseVersionId).toBe(firstSave.version.id)

    const secondDraft = structuredClone(firstSave.workingCopy.draft)
    secondDraft.fields = secondDraft.fields.map((field, index) =>
      index === 0 ? { ...field, defaultValue: "Dock A-17" } : field
    )

    const secondSave = await saveUserTemplate({
      name: "Warehouse Label",
      templateId: firstSave.template.id,
      sourceVersionId: firstSave.version.id,
      document: secondDraft,
    })

    expect(secondSave.version.version).toBe(2)

    const history = await readUserTemplateHistory(firstSave.template.id)
    expect(history).not.toBeNull()
    expect(history?.saved).toHaveLength(2)
    expect(history?.template.currentVersionId).toBe(secondSave.version.id)

    const workingCopy = await loadWorkingCopy({
      kind: "user-template",
      templateId: firstSave.template.id,
    })
    expect(workingCopy?.baseVersionId).toBe(secondSave.version.id)
    expect(workingCopy?.draft.fields[0]?.defaultValue).toBe("Dock A-17")
  })

  it("creates autosaves only for named user templates and respects the autosave interval", async () => {
    const draft = createDraftFromPreset(getPresetById("ops-tag"))
    const saved = await saveUserTemplate({
      name: "Rack Tag",
      document: draft,
    })

    const firstAutosave = structuredClone(saved.workingCopy.draft)
    firstAutosave.name = "Rack Tag edited"
    await saveUserTemplateAutosave({
      templateId: saved.template.id,
      source: { kind: "user-template", templateId: saved.template.id },
      document: firstAutosave,
      sourceVersionId: saved.version.id,
    })

    const secondAutosave = structuredClone(firstAutosave)
    secondAutosave.name = "Rack Tag edited twice"
    await saveUserTemplateAutosave({
      templateId: saved.template.id,
      source: { kind: "user-template", templateId: saved.template.id },
      document: secondAutosave,
      sourceVersionId: saved.version.id,
    })

    const history = await readUserTemplateHistory(saved.template.id)
    expect(history?.autosaves).toHaveLength(1)

    expect(getAutosaveIntervalMs()).toBe(5 * 60 * 1000)
  })

  it("clears autosave history without touching saved versions", async () => {
    const draft = createDraftFromPreset(getPresetById("shipping-wide"))
    const saved = await saveUserTemplate({
      name: "Dispatch Slip",
      document: draft,
    })

    const autosaveDraft = structuredClone(saved.workingCopy.draft)
    autosaveDraft.name = "Dispatch Slip draft"
    await saveUserTemplateAutosave({
      templateId: saved.template.id,
      source: { kind: "user-template", templateId: saved.template.id },
      document: autosaveDraft,
      sourceVersionId: saved.version.id,
    })

    await clearTemplateAutosaves(saved.template.id)

    const history = await readUserTemplateHistory(saved.template.id)
    expect(history?.saved).toHaveLength(1)
    expect(history?.autosaves).toHaveLength(0)
  })
})
