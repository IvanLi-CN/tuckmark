interface BluetoothRemoteGATTCharacteristic {
  writeValue(value: BufferSource): Promise<void>
  writeValueWithoutResponse?(value: BufferSource): Promise<void>
  writeValueWithResponse?(value: BufferSource): Promise<void>
}

interface BluetoothRemoteGATTService {
  getCharacteristic(
    characteristic: BluetoothCharacteristicUUID
  ): Promise<BluetoothRemoteGATTCharacteristic>
}

interface BluetoothRemoteGATTServer {
  connected: boolean
  connect(): Promise<BluetoothRemoteGATTServer>
  disconnect(): void
  getPrimaryService(service: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>
}

interface BluetoothDevice extends EventTarget {
  id: string
  name?: string
  gatt?: BluetoothRemoteGATTServer
  addEventListener(
    type: "gattserverdisconnected",
    listener: EventListenerOrEventListenerObject | null
  ): void
  removeEventListener(
    type: "gattserverdisconnected",
    listener: EventListenerOrEventListenerObject | null
  ): void
}

interface Bluetooth {
  requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>
  getDevices?(): Promise<BluetoothDevice[]>
}

interface RequestDeviceOptions {
  filters?: Array<{ name?: string; namePrefix?: string; services?: BluetoothServiceUUID[] }>
  optionalServices?: BluetoothServiceUUID[]
  acceptAllDevices?: boolean
}

type BluetoothServiceUUID = string | number
type BluetoothCharacteristicUUID = string | number

interface Navigator {
  bluetooth: Bluetooth
}
