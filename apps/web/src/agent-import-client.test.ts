// @vitest-environment jsdom

import { describe, expect, it } from "vitest"

import { getTemplateById } from "../../../packages/core/src/web.js"
import { HttpAgentImportClient } from "./agent-import-client.js"
import { createDraftFromSystemTemplate } from "./canvas-editor-model.js"

describe("HttpAgentImportClient", () => {
  it("renders user templates from the authoritative DEVD document", async () => {
    const draft = createDraftFromSystemTemplate(getTemplateById("cable-tag"))
    const client = new HttpAgentImportClient("/api", {
      async readTemplate(templateId) {
        return {
          id: templateId,
          name: "Mock user chip template",
          description: "Mock-only test fixture",
          width: draft.width,
          height: draft.height,
          createdAt: "2030-01-01T00:00:00.000Z",
          updatedAt: "2030-01-01T00:00:00.000Z",
          currentVersionId: "mock-version",
          fieldOrder: draft.fields.map((field) => field.key),
          fields: draft.fields,
          document: draft,
        }
      },
    })

    const preview = await client.renderTemplatePreview(
      {
        source: "user-template",
        id: "mock-chip-template",
        name: "芯片",
        fields: [],
      },
      { name: "TPD4E05U06DQAR", port: "USON-10", location: "A-01" }
    )

    expect(preview).toContain("<svg")
    expect(preview).toContain("TPD4E05")
    expect(preview).toContain("U06DQAR")
    expect(preview).toContain("USON-10")
  })
})
