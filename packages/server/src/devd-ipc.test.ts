import { mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import { listenIpc, requestIpc, resolveIpcEndpoint } from "@tuckmark/ipc"
import { afterEach, describe, expect, it } from "vitest"

import { DevdDataService } from "./devd-data-service.js"
import { createApp } from "./index.js"

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((work) => work()))
})

describe("DEVD named IPC", () => {
  it("routes two named instances to isolated data services", async () => {
    const runtime = await mkdtemp(path.join(os.tmpdir(), "tuckmark-ipc-runtime-"))
    const firstRoot = await mkdtemp(path.join(os.tmpdir(), "tuckmark-ipc-first-"))
    const secondRoot = await mkdtemp(path.join(os.tmpdir(), "tuckmark-ipc-second-"))
    cleanup.push(() => rm(runtime, { recursive: true, force: true }))
    cleanup.push(() => rm(firstRoot, { recursive: true, force: true }))
    cleanup.push(() => rm(secondRoot, { recursive: true, force: true }))
    const previousRuntime = process.env.XDG_RUNTIME_DIR
    process.env.XDG_RUNTIME_DIR = runtime
    const first = createApp(undefined, { devdDataService: new DevdDataService(firstRoot) })
    const second = createApp(undefined, { devdDataService: new DevdDataService(secondRoot) })
    const firstServer = createServer(first)
    const secondServer = createServer(second)
    await listenIpc(firstServer, "debug-first")
    await listenIpc(secondServer, "debug-second")
    cleanup.push(async () => {
      if (previousRuntime === undefined) delete process.env.XDG_RUNTIME_DIR
      else process.env.XDG_RUNTIME_DIR = previousRuntime
      await Promise.all([
        new Promise<void>((resolve) => firstServer.close(() => resolve())),
        new Promise<void>((resolve) => secondServer.close(() => resolve())),
      ])
    })

    const firstStatus = await requestIpc<{ revision: number }>({
      instance: "debug-first",
      path: "/api/data/status",
    })
    const secondStatus = await requestIpc<{ revision: number }>({
      instance: "debug-second",
      path: "/api/data/status",
    })
    expect(firstStatus.status).toBe(200)
    expect(secondStatus.status).toBe(200)
    expect(firstStatus.body.revision).toBe(0)
    expect(secondStatus.body.revision).toBe(0)

    const firstEndpoint = resolveIpcEndpoint("debug-first")
    expect(firstEndpoint.address).toContain("t-")
  })
})
