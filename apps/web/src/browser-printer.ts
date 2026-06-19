type PaperType = "continuous" | "gap";

export type BrowserPrinterSession = {
  deviceId: string;
  name: string;
};

export type BrowserPrintableArtifact = {
  id: string;
  pngUrl: string;
  renderOptions: {
    printWidthDots: number;
    threshold: number;
    xOffsetDots: number;
    paperType: PaperType;
  };
};

export type BrowserPrintResult = {
  artifactId: string;
  printer: BrowserPrinterSession;
  statusCode: number;
  printable?: number;
  message: string;
  packetCount?: number;
  totalBytes?: number;
};

type PacketsResponse = {
  artifactId: string;
  packetsJsonPath: string;
  packets: string[];
  packetCount: number;
  totalBytes: number;
};

type PrintErrorCode =
  | "permission_denied"
  | "device_not_found"
  | "service_not_found"
  | "char_not_found"
  | "write_failed"
  | "unsupported";

type PrintError = Error & { code: PrintErrorCode };

const PRINTER_SERVICE_UUID = "49535343-fe7d-4ae5-8fa9-9fafd205e455";
const PRINTER_WRITE_CHARACTERISTIC_UUID = "49535343-8841-43f4-a8d4-ecbe34729bb3";
const WRITE_DELAY_MS = 5;

let selectedPrinter: BrowserPrinterSession | null = null;
let connectedDevice: BluetoothDevice | undefined;
let connectedCharacteristic: BluetoothRemoteGATTCharacteristic | undefined;

function createPrintError(code: PrintErrorCode, message: string): PrintError {
  const error = new Error(message) as PrintError;
  error.code = code;
  return error;
}

function ensureBrowserEnvironment(): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("当前环境不是浏览器，无法直接连接蓝牙打印机。");
  }

  if (!isBrowserPrintSupported()) {
    throw createPrintError(
      "unsupported",
      "当前浏览器不支持 Web Bluetooth。请使用 Chrome 桌面版并在 localhost/HTTPS 下访问。"
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function detachDevice(device: BluetoothDevice | undefined, waitForDisconnectEvent = false): void {
  if (!device) {
    return;
  }
  if (device.gatt?.connected) {
    device.gatt.disconnect();
    if (waitForDisconnectEvent) {
      return;
    }
  }
  device.removeEventListener("gattserverdisconnected", handleDisconnected);
}

const handleDisconnected = () => {
  detachDevice(connectedDevice);
  connectedDevice = undefined;
  connectedCharacteristic = undefined;
};

function describeDevice(device: BluetoothDevice): BrowserPrinterSession {
  return {
    deviceId: device.id,
    name: device.name ?? device.id
  };
}

async function requestArtifactPackets(artifact: BrowserPrintableArtifact): Promise<PacketsResponse> {
  const response = await fetch(`/api/artifacts/${artifact.id}/packets`);
  if (!response.ok) {
    throw new Error(`无法读取打印协议包: ${response.status}`);
  }

  const json = (await response.json()) as Partial<PacketsResponse>;
  if (
    json.artifactId !== artifact.id ||
    !Array.isArray(json.packets) ||
    json.packets.length === 0 ||
    typeof json.packetCount !== "number" ||
    typeof json.totalBytes !== "number"
  ) {
    throw new Error("打印协议包响应不完整。");
  }

  return {
    artifactId: json.artifactId,
    packetsJsonPath: String(json.packetsJsonPath ?? ""),
    packets: json.packets,
    packetCount: json.packetCount,
    totalBytes: json.totalBytes
  };
}

function decodePacket(packet: string, index: number): Uint8Array {
  try {
    const binary = window.atob(packet);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (error) {
    throw new Error(
      `协议包 base64 解码失败（packet ${index + 1}）：${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function ensureConnectedPrinter(session: BrowserPrinterSession): Promise<{
  device: BluetoothDevice;
  characteristic: BluetoothRemoteGATTCharacteristic;
}> {
  if (
    connectedDevice?.gatt?.connected &&
    connectedCharacteristic &&
    connectedDevice.id === session.deviceId
  ) {
    return {
      device: connectedDevice,
      characteristic: connectedCharacteristic
    };
  }

  throw createPrintError("device_not_found", "浏览器打印机会话已失效，请重新连接。");
}

export function isBrowserPrintSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.bluetooth !== "undefined";
}

export function getSelectedBrowserPrinter(): BrowserPrinterSession | null {
  return selectedPrinter;
}

export async function connectBrowserPrinter(): Promise<BrowserPrinterSession> {
  ensureBrowserEnvironment();

  if (connectedCharacteristic && connectedDevice?.gatt?.connected) {
    const printer = describeDevice(connectedDevice);
    selectedPrinter = printer;
    return printer;
  }

  let device: BluetoothDevice;
  try {
    device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [PRINTER_SERVICE_UUID]
    });
  } catch (error) {
    throw createPrintError(
      "permission_denied",
      `蓝牙授权被拒绝或取消：${error instanceof Error ? error.message : String(error)}`
    );
  }

  detachDevice(connectedDevice);
  connectedCharacteristic = undefined;
  device.addEventListener("gattserverdisconnected", handleDisconnected);

  try {
    const server = await device.gatt?.connect();
    if (!server) {
      throw createPrintError("device_not_found", "设备未建立 GATT 连接。请重试。");
    }

    const service = await server.getPrimaryService(PRINTER_SERVICE_UUID).catch(() => undefined);
    if (!service) {
      throw createPrintError("service_not_found", `未找到目标服务 UUID: ${PRINTER_SERVICE_UUID}`);
    }

    const characteristic = await service
      .getCharacteristic(PRINTER_WRITE_CHARACTERISTIC_UUID)
      .catch(() => undefined);
    if (!characteristic) {
      throw createPrintError(
        "char_not_found",
        `未找到写入特征 UUID: ${PRINTER_WRITE_CHARACTERISTIC_UUID}`
      );
    }

    connectedDevice = device;
    connectedCharacteristic = characteristic;
    selectedPrinter = describeDevice(device);
    return selectedPrinter;
  } catch (error) {
    detachDevice(device);
    connectedDevice = undefined;
    connectedCharacteristic = undefined;
    if (error instanceof Error) {
      throw error;
    }
    throw createPrintError("device_not_found", String(error));
  }
}

export async function printPreviewArtifact(
  session: BrowserPrinterSession,
  artifact: BrowserPrintableArtifact
): Promise<BrowserPrintResult> {
  ensureBrowserEnvironment();

  const packets = await requestArtifactPackets(artifact);
  const { characteristic } = await ensureConnectedPrinter(session);

  for (const [index, packet] of packets.packets.entries()) {
    const bytes = decodePacket(packet, index);
    const payload = bytes as unknown as BufferSource;
    try {
      if (typeof characteristic.writeValueWithResponse === "function") {
        await characteristic.writeValueWithResponse(payload);
      } else {
        await characteristic.writeValue(payload);
      }
    } catch (error) {
      throw createPrintError(
        "write_failed",
        `写入 BLE 数据失败（packet ${index + 1}/${packets.packetCount}，${bytes.byteLength} bytes）：${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if (WRITE_DELAY_MS > 0) {
      await sleep(WRITE_DELAY_MS);
    }
  }

  return {
    artifactId: artifact.id,
    printer: session,
    statusCode: 0,
    printable: 0,
    packetCount: packets.packetCount,
    totalBytes: packets.totalBytes,
    message: "浏览器蓝牙打印已提交。"
  };
}
