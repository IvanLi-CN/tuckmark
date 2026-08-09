// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  DRAFT_PROCESSING_ROUTE_PATH,
  getDraftProcessingPath,
  isDraftProcessingPath,
  openDraftProcessingWindow,
} from "./draft-processing-route.js"

afterEach(() => {
  window.history.replaceState({}, "", "/")
  vi.restoreAllMocks()
})

describe("draft processing route", () => {
  it("builds a restricted processing route for every draft source", () => {
    expect(getDraftProcessingPath({ kind: "user-template", templateId: "power module" })).toBe(
      "/canvas/draft-processing?source=user-template&templateId=power+module"
    )
    expect(
      getDraftProcessingPath(
        { kind: "preset-template", presetId: "cable-tag" },
        { demo: true, panel: "versions", status: "created" }
      )
    ).toBe(
      "/canvas/draft-processing?source=preset-template&templateId=cable-tag&panel=versions&status=created&demo=true"
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

  it("preserves the formal demo data source when opening a processing tab", () => {
    const focus = vi.fn()
    const openWindow = vi.spyOn(window, "open").mockReturnValue({ focus } as unknown as Window)
    window.history.replaceState({}, "", "/system?demo=true")

    openDraftProcessingWindow({ kind: "preset-template", presetId: "cable-tag" })

    const [launchPath, target] = openWindow.mock.calls[0] ?? []
    const launchUrl = new URL(String(launchPath), window.location.origin)
    expect(target).toBe("_blank")
    expect(decodeURIComponent(launchUrl.searchParams.get("__tuckmark_redirect__") ?? "")).toBe(
      "/canvas/draft-processing?source=preset-template&templateId=cable-tag&demo=true"
    )
    expect(focus).toHaveBeenCalledTimes(1)
  })
})
