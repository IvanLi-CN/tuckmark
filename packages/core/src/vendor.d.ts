declare module "pngjs" {
  export class PNG {
    static sync: {
      read(buffer: Buffer): PNG;
    };
    width: number;
    height: number;
    data: Buffer;
  }
}

declare module "lpapi-ble/lib/index.esm.js" {
  export const DzCommand: {
    CMD_PAGE_END: number;
    CMD_PAGE_PRINT: number;
  };

  export const PackageBuffer: {
    getBytes(command: number): Uint8Array;
  };

  export class PrintPackage {
    print(input: Record<string, unknown>): Array<{
      getAllBytes(): Uint8Array;
    }>;
  }
}
