import {
  type DetongerWasmStatus,
  getDetongerWasmUnavailableMessage,
} from "./browser-direct-path.js"
import initDetongerWasm, {
  encodePngJobMessages,
  initSync as initDetongerWasmSync,
} from "./wasm/pkg/detonger_wasm.js"
import detongerWasmStatus from "./wasm/pkg/detonger_wasm_status.js"

type BrowserEncoderOptions = {
  threshold: number
  xOffsetDots: number
  yOffsetDots: number
  printStrengthLevel: number
  printWidthDots: number
  paperType: "continuous" | "gap"
}

let detongerInitPromise: Promise<unknown> | undefined

function createDetongerWasmUnavailableError(reason?: string | null): Error {
  return new Error(getDetongerWasmUnavailableMessage(reason))
}

function normalizeDetongerInitError(
  error: unknown,
  status: DetongerWasmStatus = detongerWasmStatus
): Error {
  if (!status.available) {
    return createDetongerWasmUnavailableError(status.reason)
  }
  if (error instanceof Error) {
    if (error.message.includes("detonger-wasm")) {
      return error
    }
    if (
      error.message.includes("expected magic word") ||
      error.message.includes("detonger_wasm_bg.wasm")
    ) {
      return new Error(
        `浏览器直连打印依赖 detonger-wasm 初始化失败：产物不完整或内容异常。${error.message}`
      )
    }
    return error
  }
  return new Error(String(error))
}

async function ensureDetongerWasmReady(): Promise<void> {
  if (!detongerWasmStatus.available) {
    throw createDetongerWasmUnavailableError(detongerWasmStatus.reason)
  }
  if (!detongerInitPromise) {
    detongerInitPromise = (
      typeof document === "undefined"
        ? (async () => {
            const { readFile } = await import("node:fs/promises")
            const wasmBytes = await readFile(
              new URL("./wasm/pkg/detonger_wasm_bg.wasm", import.meta.url)
            )
            initDetongerWasmSync(wasmBytes)
          })()
        : initDetongerWasm()
    ).catch((error) => {
      detongerInitPromise = undefined
      throw normalizeDetongerInitError(error)
    })
  }
  await detongerInitPromise
}

export async function encodeBrowserPngMessages(
  pngBytes: Uint8Array,
  options: BrowserEncoderOptions
): Promise<Uint8Array[]> {
  await ensureDetongerWasmReady()

  const messages = encodePngJobMessages(pngBytes, {
    threshold: options.threshold,
    xOffsetDots: options.xOffsetDots,
    yOffsetDots: options.yOffsetDots,
    printStrengthLevel: options.printStrengthLevel,
    printWidthDots: options.printWidthDots,
    paperType: options.paperType,
  })

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("detonger-wasm returned no packets")
  }

  return messages.map((message, index) => {
    if (!(message instanceof Uint8Array)) {
      throw new Error(`unexpected detonger-wasm packet type at index ${index}`)
    }
    return message
  })
}
