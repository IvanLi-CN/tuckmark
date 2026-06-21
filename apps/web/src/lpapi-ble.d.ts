declare module "pngjs" {
  export class PNG {
    static sync: {
      read(buffer: Buffer): PNG
    }
    width: number
    height: number
    data: Buffer
  }
}

declare module "lpapi-ble/lib/index.esm.js" {
  export class PrintPackage {
    print(input: Record<string, unknown>): Array<{
      getAllBytes(): Uint8Array
    }>
  }
}

declare module "./wasm/pkg/detonger_wasm.js" {
  export default function init(input?: BufferSource | WebAssembly.Module): Promise<void>
  export function encodePngJobMessages(
    pngBytes: Uint8Array,
    options: {
      threshold: number
      xOffsetDots: number
      printWidthDots: number
      paperType: "continuous" | "gap"
    }
  ): Uint8Array[]
}
