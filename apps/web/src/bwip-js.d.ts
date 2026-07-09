declare module "bwip-js" {
  export type BwipJsRawSymbol =
    | { bbs: number[]; bhs: number[]; sbs: number[] }
    | { pixs: number[]; pixx: number; pixy: number; height: number; width: number }

  const bwipjs: {
    raw(
      options:
        | { bcid: string; text: string }
        | { bcid: string; text: string; [key: string]: string | number | boolean | undefined }
    ): BwipJsRawSymbol[]
  }

  export default bwipjs
}
