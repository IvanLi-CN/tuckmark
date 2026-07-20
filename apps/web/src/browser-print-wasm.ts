import initDetongerWasm, {
  encodePngJobMessages,
  initSync as initDetongerWasmSync,
} from "./wasm/pkg/detonger_wasm.js"

type BrowserEncoderOptions = {
  threshold: number
  xOffsetDots: number
  yOffsetDots: number
  printStrengthLevel: number
  printWidthDots: number
  paperType: "continuous" | "gap"
}

let detongerInitPromise: Promise<unknown> | undefined

async function ensureDetongerWasmReady(): Promise<void> {
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
      throw error
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
