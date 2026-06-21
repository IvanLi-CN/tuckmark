import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it, vi } from "vitest"

import { assertServerSidePrintRuntimeReady } from "../src/server-side-print-readiness.ts"

describe("server-side print readiness", () => {
  it("accepts repo-relative detonger repo roots", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
    const detongerRoot = path.resolve(repoRoot, "./detonger")
    const manifestPath = path.resolve(repoRoot, "tools/detonger-preview-encoder/Cargo.toml")
    const existsSync = vi.spyOn(fs, "existsSync").mockImplementation((target) => {
      const resolved = String(target)
      return (
        resolved === detongerRoot ||
        resolved === path.resolve(detongerRoot, "Cargo.toml") ||
        resolved === manifestPath
      )
    })

    expect(() =>
      assertServerSidePrintRuntimeReady({
        TUCKMARK_ENABLE_SERVER_SIDE_PRINT: "1",
        TUCKMARK_DETONGER_REPO_ROOT: "./detonger",
      })
    ).not.toThrow()

    expect(existsSync).toHaveBeenCalledWith(detongerRoot)
    expect(existsSync).toHaveBeenCalledWith(path.resolve(detongerRoot, "Cargo.toml"))
  })
})
