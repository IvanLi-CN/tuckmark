import initDetongerWasm, { encodePngJobMessages } from "./wasm/pkg/detonger_wasm.js"

type BrowserEncoderOptions = {
  threshold: number
  xOffsetDots: number
  printWidthDots: number
  paperType: "continuous" | "gap"
}

function normalizeMessages(messages: ArrayLike<unknown>): Uint8Array[] {
  return Array.from(messages, (message, index) => {
    if (!(message instanceof Uint8Array)) {
      throw new Error(`unexpected wasm message type at index ${index}`)
    }
    return message
  })
}

let wasmInitPromise: Promise<void> | undefined

async function ensureDetongerWasm(): Promise<void> {
  if (!wasmInitPromise) {
    wasmInitPromise = initDetongerWasm().then(() => undefined)
  }
  return wasmInitPromise
}

export async function encodeBrowserPngMessages(
  pngBytes: Uint8Array,
  options: BrowserEncoderOptions
): Promise<Uint8Array[]> {
  await ensureDetongerWasm()
  const messages = encodePngJobMessages(pngBytes, {
    threshold: options.threshold,
    xOffsetDots: options.xOffsetDots,
    printWidthDots: options.printWidthDots,
    paperType: options.paperType,
  })

  return normalizeMessages(messages)
}
