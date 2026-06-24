declare module "qrcode" {
  export type QRCodeErrorCorrectionLevel = "L" | "M" | "Q" | "H"

  export function create(
    text: string,
    options?: {
      errorCorrectionLevel?: QRCodeErrorCorrectionLevel
    }
  ): {
    modules: {
      size: number
      data: boolean[]
    }
  }

  const QRCode: {
    create: typeof create
  }

  export default QRCode
}
