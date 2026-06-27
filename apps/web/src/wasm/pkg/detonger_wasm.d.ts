export function initSync(bytes?: BufferSource): void
export default function init(): Promise<void>
export function encodePngJobMessages(
  pngBytes: Uint8Array,
  options: {
    threshold: number
    xOffsetDots: number
    printWidthDots: number
    paperType: "continuous" | "gap"
  }
): Uint8Array[]
