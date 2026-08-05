import { describe, expect, it } from "vitest"

import {
  IpcConfigurationError,
  resolveIpcEndpoint,
  resolveRequiredInstance,
  validateInstanceName,
} from "./index.js"

describe("DEVD IPC endpoint", () => {
  it("normalizes and validates named instances", () => {
    expect(validateInstanceName(" Dev-Preview ")).toBe("dev-preview")
    expect(() => validateInstanceName("bad instance")).toThrow(IpcConfigurationError)
    expect(() => validateInstanceName("-bad")).toThrow(IpcConfigurationError)
  })

  it("requires an explicit instance", () => {
    expect(() => resolveRequiredInstance({ env: {} })).toThrow("DEVD instance is required")
  })

  it("derives a stable per-user endpoint", () => {
    const endpoint = resolveIpcEndpoint("preview")
    expect(endpoint.instance).toBe("preview")
    expect(endpoint.address).toContain("preview")
    expect(["unix", "pipe"]).toContain(endpoint.transport)
  })
})
