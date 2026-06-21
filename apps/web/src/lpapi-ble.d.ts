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
