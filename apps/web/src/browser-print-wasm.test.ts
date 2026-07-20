import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  detongerWasmStatusMock,
  encodePngJobMessagesMock,
  initDetongerWasmMock,
  initSyncMock,
  readFileMock,
} = vi.hoisted(() => ({
  detongerWasmStatusMock: { available: true, reason: null as string | null },
  encodePngJobMessagesMock: vi.fn(),
  initDetongerWasmMock: vi.fn(),
  initSyncMock: vi.fn(),
  readFileMock: vi.fn(),
}))

vi.mock("pngjs", () => ({
  PNG: {
    sync: {
      read: vi.fn(() => ({
        data: Buffer.from([255, 255, 255, 255]),
        width: 1,
        height: 1,
      })),
      write: vi.fn(() => Buffer.from([137, 80, 78, 71])),
    },
  },
}))

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
}))

vi.mock("./wasm/pkg/detonger_wasm.js", () => ({
  default: initDetongerWasmMock,
  encodePngJobMessages: encodePngJobMessagesMock,
  initSync: initSyncMock,
}))

vi.mock("./wasm/pkg/detonger_wasm_status.js", () => ({
  default: detongerWasmStatusMock,
  detongerWasmStatus: detongerWasmStatusMock,
}))

const pngBytes = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9t8AAAAASUVORK5CYII=",
    "base64"
  )
)

describe("encodeBrowserPngMessages", () => {
  beforeEach(() => {
    vi.resetModules()
    detongerWasmStatusMock.available = true
    detongerWasmStatusMock.reason = null
    encodePngJobMessagesMock.mockReset()
    encodePngJobMessagesMock.mockImplementation(() => [new Uint8Array([1, 2, 3])])
    initDetongerWasmMock.mockReset()
    initSyncMock.mockReset()
    readFileMock.mockReset()
  })

  it("retries wasm initialization after a transient failure in the same session", async () => {
    readFileMock.mockRejectedValueOnce(new Error("transient wasm init failure"))
    readFileMock.mockResolvedValueOnce(new Uint8Array([0, 97, 115, 109]))

    const { encodeBrowserPngMessages } = await import("./browser-print-wasm.js")

    await expect(
      encodeBrowserPngMessages(pngBytes, {
        paperType: "continuous",
        printWidthDots: 384,
        threshold: 150,
        xOffsetDots: 0,
        yOffsetDots: 0,
        printStrengthLevel: 0,
      })
    ).rejects.toThrow("transient wasm init failure")

    await expect(
      encodeBrowserPngMessages(pngBytes, {
        paperType: "continuous",
        printWidthDots: 384,
        threshold: 150,
        xOffsetDots: 0,
        yOffsetDots: 0,
        printStrengthLevel: 0,
      })
    ).resolves.toEqual([new Uint8Array([1, 2, 3])])

    expect(readFileMock).toHaveBeenCalledTimes(2)
    expect(initSyncMock).toHaveBeenCalledTimes(1)
  })

  it("fails fast with a clear error when detonger-wasm was downgraded during startup", async () => {
    detongerWasmStatusMock.available = false
    detongerWasmStatusMock.reason = "missing detonger submodule"

    const { encodeBrowserPngMessages } = await import("./browser-print-wasm.js")

    await expect(
      encodeBrowserPngMessages(pngBytes, {
        paperType: "continuous",
        printWidthDots: 384,
        threshold: 150,
        xOffsetDots: 0,
        yOffsetDots: 0,
        printStrengthLevel: 0,
      })
    ).rejects.toThrow("missing detonger submodule")

    expect(initDetongerWasmMock).not.toHaveBeenCalled()
    expect(readFileMock).not.toHaveBeenCalled()
  })
})
