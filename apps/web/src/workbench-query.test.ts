// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest"

import { loadCanvasRouteData } from "./canvas-route-data.js"
import type { AppContext } from "./types.js"
import { resetUserTemplateStoreForTest } from "./user-template-store.js"
import {
  canvasRouteDataQueryOptions,
  getArchivedUserTemplatesQueryKey,
  getUserTemplatesQueryKey,
} from "./workbench-query.js"

const context: AppContext = {
  apiBasePath: "",
  basePath: "",
  mode: "runtime",
  surface: "browser-static",
  capabilities: {
    browserDirectPrintPath: "available",
    serviceApiPrintPath: "disabled",
  },
}

describe("workbench data source generation", () => {
  beforeEach(async () => {
    await resetUserTemplateStoreForTest()
  })

  it("separates template and canvas queries by runtime data generation", () => {
    expect(getUserTemplatesQueryKey(context, 0)).not.toEqual(getUserTemplatesQueryKey(context, 1))
    expect(getArchivedUserTemplatesQueryKey(context, 0)).not.toEqual(
      getArchivedUserTemplatesQueryKey(context, 1)
    )
    expect(
      canvasRouteDataQueryOptions(
        context,
        { kind: "user-template", templateId: "removed-template" },
        0
      ).queryKey
    ).not.toEqual(
      canvasRouteDataQueryOptions(
        context,
        { kind: "user-template", templateId: "removed-template" },
        1
      ).queryKey
    )
  })

  it("invalidates a removed current user-template canvas instead of loading stale data", async () => {
    await expect(
      loadCanvasRouteData({ kind: "user-template", templateId: "removed-template" })
    ).rejects.toThrow("当前用户模板不存在")
  })
})
