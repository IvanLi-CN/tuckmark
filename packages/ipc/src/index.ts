import { createHash } from "node:crypto"
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs"
import { request as httpRequest, type RequestOptions, type Server } from "node:http"
import type { Socket } from "node:net"
import { createConnection } from "node:net"
import os from "node:os"
import path from "node:path"

const INSTANCE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u
const IPC_SOCKET_MARKER = Symbol.for("tuckmark.ipc.socket")

type MarkedSocket = {
  [IPC_SOCKET_MARKER]?: boolean
}

export class IpcConfigurationError extends Error {}

export type IpcEndpoint = {
  instance: string
  transport: "unix" | "pipe"
  address: string
}

export function isIpcSocket(socket: unknown): boolean {
  return (
    typeof socket === "object" &&
    socket !== null &&
    Boolean((socket as MarkedSocket)[IPC_SOCKET_MARKER])
  )
}

function markIpcSocket(socket: Socket): void {
  Object.defineProperty(socket, IPC_SOCKET_MARKER, { configurable: true, value: true })
}

export function validateInstanceName(instance: string): string {
  const normalized = instance.trim().toLowerCase()
  if (!INSTANCE_PATTERN.test(normalized)) {
    throw new IpcConfigurationError(
      "DEVD instance must be 1-48 lowercase letters, numbers, or hyphens and cannot end with a hyphen."
    )
  }
  return normalized
}

function userToken(): string {
  const identity = process.platform === "win32" ? process.env.USERNAME : process.env.USER
  return createHash("sha256")
    .update(`${identity ?? "unknown"}:${process.getuid?.() ?? "windows"}`)
    .digest("hex")
    .slice(0, 12)
}

export function resolveIpcEndpoint(instance: string): IpcEndpoint {
  const normalized = validateInstanceName(instance)
  if (process.platform === "win32") {
    return {
      instance: normalized,
      transport: "pipe",
      address: `\\\\.\\pipe\\tuckmark-${userToken()}-${normalized}`,
    }
  }

  const runtimeRoot = process.env.XDG_RUNTIME_DIR?.trim() || os.tmpdir()
  const endpointToken = createHash("sha256")
    .update(`${userToken()}:${normalized}`)
    .digest("hex")
    .slice(0, 12)
  return {
    instance: normalized,
    transport: "unix",
    // Keep the complete Unix socket path below macOS/Linux's 108-byte limit.
    address: path.join(runtimeRoot, `t-${endpointToken}`),
  }
}

export function resolveRequiredInstance(
  args: { instance?: string; env?: NodeJS.ProcessEnv } = {}
): string {
  const value =
    args.instance ?? args.env?.TUCKMARK_DEVD_INSTANCE ?? process.env.TUCKMARK_DEVD_INSTANCE
  if (!value?.trim()) {
    throw new IpcConfigurationError(
      "DEVD instance is required. Pass --instance or set TUCKMARK_DEVD_INSTANCE."
    )
  }
  return validateInstanceName(value)
}

export type IpcRequest = {
  instance: string
  method?: string
  path: string
  body?: unknown
  headers?: Record<string, string>
  timeoutMs?: number
}

export type IpcResponse<T> = {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: T
}

export async function requestIpc<T>(options: IpcRequest): Promise<IpcResponse<T>> {
  const endpoint = resolveIpcEndpoint(options.instance)
  const body = options.body === undefined ? undefined : JSON.stringify(options.body)
  const requestOptions: RequestOptions = {
    method: options.method ?? (body === undefined ? "GET" : "POST"),
    path: options.path,
    socketPath: endpoint.address,
    headers: {
      accept: "application/json",
      ...(body === undefined
        ? {}
        : {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body).toString(),
          }),
      ...options.headers,
      "x-tuckmark-ipc": "1",
    },
  }

  return await new Promise<IpcResponse<T>>((resolve, reject) => {
    const request = httpRequest(requestOptions, (response) => {
      const chunks: Buffer[] = []
      response.on("data", (chunk: Buffer) => chunks.push(chunk))
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8")
        let parsed: T
        try {
          parsed = (text ? JSON.parse(text) : undefined) as T
        } catch (error) {
          reject(
            new Error(
              `DEVD IPC returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
            )
          )
          return
        }
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: parsed,
        })
      })
    })
    request.once("error", (error) => reject(new Error(`DEVD IPC request failed: ${error.message}`)))
    if (options.timeoutMs !== undefined) {
      request.setTimeout(options.timeoutMs, () => {
        request.destroy(new Error(`DEVD IPC request timed out after ${options.timeoutMs}ms.`))
      })
    }
    if (body !== undefined) request.write(body)
    request.end()
  })
}

async function removeStaleUnixSocket(address: string): Promise<void> {
  if (!existsSync(address)) return
  if (!lstatSync(address).isSocket()) {
    throw new IpcConfigurationError(`IPC endpoint is occupied by a non-socket path: ${address}`)
  }
  await new Promise<void>((resolve, reject) => {
    const probe = createConnection({ path: address })
    probe.once("connect", () => {
      probe.destroy()
      reject(new IpcConfigurationError(`IPC endpoint is already in use: ${address}`))
    })
    probe.once("error", (error: NodeJS.ErrnoException) => {
      probe.destroy()
      if (error.code === "ECONNREFUSED" || error.code === "ENOENT") {
        unlinkSync(address)
        resolve()
        return
      }
      reject(error)
    })
  })
}

type UnixEndpointLock = {
  release: () => void
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

function acquireUnixEndpointLock(address: string): UnixEndpointLock {
  const lockPath = `${address}.lock`
  // Every DEVD owner claims this lock before probing or binding, so stale
  // endpoint recovery cannot race another current instance.
  for (;;) {
    try {
      const descriptor = openSync(lockPath, "wx", 0o600)
      try {
        writeSync(descriptor, `${process.pid}\n`)
      } finally {
        closeSync(descriptor)
      }
      let released = false
      return {
        release: () => {
          if (released) return
          released = true
          try {
            unlinkSync(lockPath)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
          }
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      let ownerPid = Number.NaN
      try {
        ownerPid = Number.parseInt(readFileSync(lockPath, "utf8"), 10)
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === "ENOENT") continue
        throw readError
      }
      if (Number.isInteger(ownerPid) && ownerPid > 0 && isProcessAlive(ownerPid)) {
        throw new IpcConfigurationError(`IPC endpoint is already in use: ${address}`)
      }
      try {
        unlinkSync(lockPath)
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError
      }
    }
  }
}

export async function listenIpc(server: Server, instance: string): Promise<IpcEndpoint> {
  const endpoint = resolveIpcEndpoint(instance)
  let lock: UnixEndpointLock | undefined
  if (endpoint.transport === "unix") {
    const directory = path.dirname(endpoint.address)
    const directoryExisted = existsSync(directory)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    if (!directoryExisted) chmodSync(directory, 0o700)
    lock = acquireUnixEndpointLock(endpoint.address)
    try {
      await removeStaleUnixSocket(endpoint.address)
    } catch (error) {
      lock.release()
      throw error
    }
  }
  server.on("connection", markIpcSocket)
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening)
        reject(error)
      }
      const onListening = () => {
        server.off("error", onError)
        resolve()
      }
      server.once("error", onError)
      server.once("listening", onListening)
      server.listen(endpoint.address)
    })
    if (endpoint.transport === "unix") {
      // The IPC marker bypasses HTTP loopback checks, so the filesystem
      // endpoint itself must be owner-only even when the process umask is loose.
      chmodSync(endpoint.address, 0o600)
    }
  } catch (error) {
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    lock?.release()
    throw error
  }
  if (lock) server.once("close", lock.release)
  return endpoint
}
