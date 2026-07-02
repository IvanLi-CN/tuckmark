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
  readUserTemplate,
  readUserTemplateHistory,
  replaceUserTemplateWorkingCopy,
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

  it("does not create an autosave when the draft only differs by version metadata", async () => {
    const draft = createDraftFromPreset(getPresetById("ops-tag"))
    const saved = await saveUserTemplate({
      name: "Rack Tag",
      document: draft,
    })

    const reopenedDraft = structuredClone(saved.workingCopy.draft)
    reopenedDraft.baseVersionId = saved.version.id
    reopenedDraft.lastSavedAt = new Date().toISOString()

    await saveUserTemplateAutosave({
      templateId: saved.template.id,
      source: { kind: "user-template", templateId: saved.template.id },
      document: reopenedDraft,
      sourceVersionId: saved.version.id,
    })

    const history = await readUserTemplateHistory(saved.template.id)
    expect(history?.saved).toHaveLength(1)
    expect(history?.autosaves).toHaveLength(0)
  })

  it("persists render options as saved template content", async () => {
    const draft = createDraftFromPreset(getPresetById("shipping-wide"))
    const saved = await saveUserTemplate({
      name: "Render Options Template",
      document: {
        ...draft,
        renderOptions: { paperType: "gap", threshold: 80, printWidthDots: 192 },
      },
    })

    const editedDraft = structuredClone(saved.workingCopy.draft)
    editedDraft.renderOptions = {
      ...editedDraft.renderOptions,
      threshold: 150,
    }

    const updated = await saveUserTemplate({
      name: "Render Options Template",
      templateId: saved.template.id,
      sourceVersionId: saved.version.id,
      document: editedDraft,
    })

    expect(updated.version.document.renderOptions).toMatchObject({
      paperType: "gap",
      threshold: 150,
      printWidthDots: 192,
    })
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

  it("replaces the persisted working copy without creating a new autosave version", async () => {
    const draft = createDraftFromPreset(getPresetById("shipping-wide"))
    const saved = await saveUserTemplate({
      name: "Version Reset",
      document: draft,
    })

    const autosaveDraft = structuredClone(saved.workingCopy.draft)
    autosaveDraft.name = "Version Reset draft"
    await saveUserTemplateAutosave({
      templateId: saved.template.id,
      source: { kind: "user-template", templateId: saved.template.id },
      document: autosaveDraft,
      sourceVersionId: saved.version.id,
    })

    const restoredDraft = structuredClone(saved.workingCopy.draft)
    restoredDraft.name = "Version Reset"
    restoredDraft.baseVersionId = saved.version.id

    const replaced = await replaceUserTemplateWorkingCopy({
      templateId: saved.template.id,
      source: { kind: "user-template", templateId: saved.template.id },
      document: restoredDraft,
      sourceVersionId: saved.version.id,
    })

    expect(replaced.baseVersionId).toBe(saved.version.id)
    expect(replaced.draft.name).toBe("Version Reset")

    const workingCopy = await loadWorkingCopy({
      kind: "user-template",
      templateId: saved.template.id,
    })
    expect(workingCopy?.baseVersionId).toBe(saved.version.id)
    expect(workingCopy?.draft.name).toBe("Version Reset")

    const history = await readUserTemplateHistory(saved.template.id)
    expect(history?.saved).toHaveLength(1)
    expect(history?.autosaves).toHaveLength(1)
  })

  it("builds template summary fields from the persisted working copy before the next save", async () => {
    const draft = createDraftFromPreset(getPresetById("shipping-wide"))
    const textElement = draft.elements.find((element) => element.kind === "text")
    if (!textElement) {
      throw new Error("expected shipping-wide preset to include a text element")
    }
    const boundDraft = toggleElementBinding(draft, textElement.id, true)
    const saved = await saveUserTemplate({
      name: "Schema Drift",
      document: boundDraft,
    })

    const workingCopyDraft = structuredClone(saved.workingCopy.draft)
    workingCopyDraft.fields = workingCopyDraft.fields.map((field, index) =>
      index === 0 ? { ...field, label: "收件人（草稿）" } : field
    )

    await replaceUserTemplateWorkingCopy({
      templateId: saved.template.id,
      source: { kind: "user-template", templateId: saved.template.id },
      document: workingCopyDraft,
      sourceVersionId: saved.version.id,
    })

    const template = await readUserTemplate(saved.template.id)
    expect(template?.fields[0]?.label).toBe("收件人（草稿）")
  })

  it("keeps saved version numbers monotonic after retention trimming", async () => {
    const draft = createDraftFromPreset(getPresetById("shipping-wide"))
    const firstSave = await saveUserTemplate({
      name: "Retention Label",
      document: draft,
    })

    let lastSave = firstSave
    for (let index = 0; index < 21; index += 1) {
      const nextDraft = structuredClone(lastSave.workingCopy.draft)
      nextDraft.name = `Retention Label ${index + 2}`
      lastSave = await saveUserTemplate({
        name: nextDraft.name,
        templateId: firstSave.template.id,
        sourceVersionId: lastSave.version.id,
        document: nextDraft,
      })
    }

    expect(lastSave.version.version).toBe(22)
    expect(lastSave.version.label).toBe("已保存版本 22")

    const history = await readUserTemplateHistory(firstSave.template.id)
    expect(history?.saved).toHaveLength(20)
    expect(history?.saved[0]?.version).toBe(22)
    expect(history?.saved[0]?.label).toBe("已保存版本 22")
  })
})
