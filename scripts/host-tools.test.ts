import path from "node:path"

import { describe, expect, it } from "vitest"

import { assertBuildOutputDirectory, HOST_TOOL_TARGETS } from "./build-host-tools.mjs"

describe("host-tools build contract", () => {
  it("defines exactly the four native release targets", () => {
    expect(Object.keys(HOST_TOOL_TARGETS).sort()).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "linux-x64",
      "windows-x64",
    ])
    expect(HOST_TOOL_TARGETS["darwin-arm64"].bunTarget).toBe("bun-darwin-arm64")
    expect(HOST_TOOL_TARGETS["darwin-x64"].bunTarget).toBe("bun-darwin-x64")
    expect(HOST_TOOL_TARGETS["linux-x64"].bunTarget).toBe("bun-linux-x64-baseline")
    expect(HOST_TOOL_TARGETS["windows-x64"].bunTarget).toBe("bun-windows-x64-baseline")
  })

  it("embeds a complete target triple in each executable", () => {
    expect(HOST_TOOL_TARGETS["darwin-arm64"].targetTriple).toBe("aarch64-apple-darwin")
    expect(HOST_TOOL_TARGETS["darwin-x64"].targetTriple).toBe("x86_64-apple-darwin")
    expect(HOST_TOOL_TARGETS["linux-x64"].targetTriple).toBe("x86_64-unknown-linux-gnu")
    expect(HOST_TOOL_TARGETS["windows-x64"].targetTriple).toBe("x86_64-pc-windows-msvc")
  })

  it("only permits a dedicated work directory as a build output", () => {
    expect(() => assertBuildOutputDirectory(path.resolve("work/host-tools-test"))).not.toThrow()
    expect(() => assertBuildOutputDirectory(path.resolve("."))).toThrow(
      "Host-tools output must be a dedicated directory under work/"
    )
  })
})
