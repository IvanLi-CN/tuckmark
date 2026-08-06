import { mkdtemp, rm } from "node:fs/promises"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { DevdConfigService } from "./devd-config.js"
import { DevdDataService } from "./devd-data-service.js"
import { createApp } from "./index.js"

const cleanup: Array<() => Promise<void> | void> = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((work) => work()))
})

describe("DEVD data HTTP contract", () => {
  it("reads and updates data-directory configuration through the shared app", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-config-routes-"))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const activeDir = path.join(root, "active")
    const nextDir = path.join(root, "next")
    const configService = new DevdConfigService({
      env: { TUCKMARK_DATA_DIR: activeDir },
      documentsDir: path.join(root, "Documents"),
      configDir: path.join(root, "config"),
    })
    configService.resolveStartupDataDirectory()
    const dataService = new DevdDataService(activeDir)
    const app = createApp(undefined, {
      devdConfigService: configService,
      devdDataService: dataService,
    })
    const server = app.listen(0)
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    expect(
      await fetch(`${baseUrl}/api/data/config`).then((response) => response.json())
    ).toMatchObject({ activeDataDir: activeDir, activeSource: "environment" })
    const updated = await fetch(`${baseUrl}/api/data/config/data-directory`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataDir: nextDir }),
    })
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({
      activeDataDir: activeDir,
      savedDataDir: nextDir,
      restartRequired: true,
    })
  })

  it("exposes status and maps stale commands to a 409 conflict", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-routes-"))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const dataService = new DevdDataService(root)
    const app = createApp(undefined, { devdDataService: dataService })
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

    const invalidMaterial = await fetch(`${baseUrl}/api/data/inventory/save-material`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 0, args: {} }),
    })
    expect(invalidMaterial.status).toBe(400)

    const invalidTemplate = await fetch(`${baseUrl}/api/data/runtime/save-template`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 0,
        args: { name: "Missing mock dimensions", document: {} },
      }),
    })
    expect(invalidTemplate.status).toBe(400)
    expect(
      await fetch(`${baseUrl}/api/data/status`).then((response) => response.json())
    ).toMatchObject({
      revision: 0,
    })

    const rejectedLocalTemplate = await fetch(
      `${baseUrl}/api/agent-import/sessions/mock/items/mock/template-input`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedRevision: 0,
          template: {
            source: "user-template",
            id: "browser-local-template",
            name: "Browser-local Mock Template",
            fields: [],
          },
          localTemplate: {},
        }),
      }
    )
    expect(rejectedLocalTemplate.status).toBe(400)
    expect(((await rejectedLocalTemplate.json()) as { error: string }).error).toContain(
      "Unrecognized key"
    )

    const crossOrigin = await fetch(`${baseUrl}/api/data/status`, {
      headers: { origin: "https://unrelated.example" },
    })
    expect(crossOrigin.status).toBe(403)

    const localProxyOrigin = await fetch(`${baseUrl}/api/data/status`, {
      headers: { origin: "http://127.0.0.1:5173" },
    })
    expect(localProxyOrigin.status).toBe(200)

    const bracketedIpv6Host = await fetch(`${baseUrl}/api/data/status`, {
      headers: { host: `[::1]:${(server.address() as AddressInfo).port}` },
    })
    expect(bracketedIpv6Host.status).toBe(200)

    const rebindingOrigin = await fetch(`${baseUrl}/api/data/status`, {
      headers: { host: "rebind.example", origin: "http://rebind.example" },
    })
    expect(rebindingOrigin.status).toBe(403)

    const remoteApp = createApp(undefined, {
      devdDataService: dataService,
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
