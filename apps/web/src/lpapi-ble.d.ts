declare module "pngjs" {
  export class PNG {
    constructor(options?: {
      width?: number
      height?: number
      fill?: boolean
    })
    static sync: {
      read(buffer: Buffer): PNG
      write(png: { width: number; height: number; data: Buffer | Uint8Array }): Buffer
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
