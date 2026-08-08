import { describe, expect, it } from "vitest"

import {
  DRAFT_PROCESSING_ROUTE_PATH,
  getDraftProcessingPath,
  isDraftProcessingPath,
} from "./draft-processing-route.js"

describe("draft processing route", () => {
  it("builds a restricted processing route for every draft source", () => {
    expect(getDraftProcessingPath({ kind: "user-template", templateId: "power module" })).toBe(
      "/canvas/draft-processing?source=user-template&templateId=power+module"
    )
    expect(
      getDraftProcessingPath(
        { kind: "preset-template", presetId: "cable-tag" },
        { panel: "versions", status: "created" }
      )
    ).toBe(
      "/canvas/draft-processing?source=preset-template&templateId=cable-tag&panel=versions&status=created"
    )
    expect(getDraftProcessingPath({ kind: "scratch", presetId: "shipping-wide" })).toBe(
      "/canvas/draft-processing?presetId=shipping-wide"
    )
  })

  it("recognizes the processing route without matching the ordinary canvas route", () => {
    expect(isDraftProcessingPath(DRAFT_PROCESSING_ROUTE_PATH)).toBe(true)
    expect(isDraftProcessingPath(`${DRAFT_PROCESSING_ROUTE_PATH}/?source=user-template`)).toBe(true)
    expect(isDraftProcessingPath("/canvas?source=user-template")).toBe(false)
  })
})
