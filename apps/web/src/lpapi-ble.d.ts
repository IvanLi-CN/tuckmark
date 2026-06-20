declare module "lpapi-ble/lib/index.esm.js" {
  export class PrintPackage {
    print(input: Record<string, unknown>): Array<{
      getAllBytes(): Uint8Array
    }>
  }
}
