export function initSync() {}

export default async function init() {
  return undefined
}

export function encodePngJobMessages(pngBytes, _options) {
  const bytes = pngBytes instanceof Uint8Array ? pngBytes : new Uint8Array(pngBytes)
  const chunkSize = 512
  const packets = []
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    packets.push(bytes.slice(offset, offset + chunkSize))
  }
  if (packets.length === 0) {
    packets.push(new Uint8Array())
  }
  return packets
}
