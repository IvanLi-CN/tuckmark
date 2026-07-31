import { mkdtemp, rm } from "node:fs/promises"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { DevdDataService } from "./devd-data-service.js"
import { createApp } from "./index.js"

const cleanup: Array<() => Promise<void> | void> = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((work) => work()))
})

describe("DEVD data HTTP contract", () => {
  it("exposes status and maps stale commands to a 409 conflict", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-routes-"))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const app = createApp(undefined, { devdDataService: new DevdDataService(root) })
    const server = app.listen(0)
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    const status = await fetch(`${baseUrl}/api/data/status`).then((response) => response.json())
    expect(status).toMatchObject({ revision: 0, directoryName: path.basename(root) })

    const stale = await fetch(`${baseUrl}/api/data/runtime/rename-template`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 9, args: { templateId: "missing", name: "No" } }),
    })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({
      status: "error",
      code: "revision_conflict",
      expectedRevision: 9,
      actualRevision: 0,
      error: "Data revision changed from 9 to 0.",
    })

    const crossOrigin = await fetch(`${baseUrl}/api/data/status`, {
      headers: { origin: "https://unrelated.example" },
    })
    expect(crossOrigin.status).toBe(403)

    const localProxyOrigin = await fetch(`${baseUrl}/api/data/status`, {
      headers: { origin: "http://127.0.0.1:5173" },
    })
    expect(localProxyOrigin.status).toBe(200)

    const rebindingOrigin = await fetch(`${baseUrl}/api/data/status`, {
      headers: { host: "rebind.example", origin: "http://rebind.example" },
    })
    expect(rebindingOrigin.status).toBe(403)

    const remoteApp = createApp(undefined, {
      devdDataService: new DevdDataService(root),
      clientAddress: () => "192.0.2.45",
    })
    const remoteServer = remoteApp.listen(0)
    cleanup.push(() => new Promise<void>((resolve) => remoteServer.close(() => resolve())))
    const remoteBaseUrl = `http://127.0.0.1:${(remoteServer.address() as AddressInfo).port}`
    const spoofedHost = await fetch(`${remoteBaseUrl}/api/data/status`, {
      headers: { host: "localhost" },
    })
    expect(spoofedHost.status).toBe(403)
  })
})
