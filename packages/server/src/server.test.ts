import { mkdtemp, rm, writeFile } from "node:fs/promises"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import type {
  ArtifactPackets,
  BatchPreviewRequest,
  CanvasDraftRecord,
  DirectCanvasPreviewRequest,
  PreviewArtifact,
  PreviewRequest,
  PrintBatchRequest,
  PrintByArtifactRequest,
  PrintByTemplateRequest,
  PrintCanvasRequest,
  RecentPrintRecord,
  SafeTextLabelInput,
  SyncState,
  TemplateUsageRecord,
  TuckmarkService,
} from "@tuckmark/core"
import { afterEach, describe, expect, it } from "vitest"
import { createApp, type ServerService, startServer } from "./index.js"

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((item) => rm(item, { recursive: true, force: true }))
  )
})

function createArtifact(root: string, id: string): PreviewArtifact {
  return {
    id,
    source: "template",
    name: "Test Artifact",
    templateId: "shipping-compact",
    createdAt: "2026-06-18T00:00:00.000Z",
    renderOptions: {
      printWidthDots: 384,
      threshold: 150,
      xOffsetDots: 0,
      paperType: "continuous",
      previewScale: 4,
    },
    input: {
      recipient: "Koha",
      address: "Moon Street",
      orderId: "TM-001",
      note: "fragile",
    },
    pngPath: path.join(root, `${id}.png`),
    bitmapPath: path.join(root, `${id}.bin`),
    svgPath: path.join(root, `${id}.svg`),
    width: 384,
    height: 120,
  }
}

class FakeServerService implements ServerService {
  readonly artifact: PreviewArtifact
  calls: Array<{ method: string; args: unknown[] }> = []
  syncState: SyncState = {
    schemaVersion: 1,
    updatedAt: "2026-06-18T00:00:00.000Z",
    templateUsageRecords: [],
    recentPrintRecords: [],
    canvasDraftRecords: [],
  }

  constructor(artifact: PreviewArtifact) {
    this.artifact = artifact
  }

  async listTemplates(): Promise<Awaited<ReturnType<TuckmarkService["listTemplates"]>>> {
    this.calls.push({ method: "listTemplates", args: [] })
    return [
      {
        id: "shipping-compact",
        name: "Compact Shipping Label",
        description: "Preset shipping label",
        width: 384,
        height: 224,
        tags: ["preset"],
        fields: [{ key: "recipient", label: "Recipient", required: true, multiline: false }],
        elements: [],
      },
    ]
  }

  async listPrinters(): Promise<Awaited<ReturnType<TuckmarkService["listPrinters"]>>> {
    this.calls.push({ method: "listPrinters", args: [] })
    return [
      {
        id: "printer-1",
        name: "Mock P2",
        capabilities: {
          dpi: 203,
          printWidthDots: 384,
          supportedPaperTypes: ["continuous", "gap"],
          colors: ["mono"],
          notes: [],
        },
      },
    ]
  }

  async probePrinter(printerId: string, printerName?: string) {
    this.calls.push({ method: "probePrinter", args: [printerId, printerName] })
    return {
      ok: true,
      printerId,
      printerName,
      stage: "complete" as const,
      message: "Printer discovery and connect probe succeeded.",
      log: ["round=1 stage=open", "round=1 stage=connect"],
      timingsMs: {
        connectMs: 382,
      },
    }
  }

  async listArtifacts(): Promise<Awaited<ReturnType<TuckmarkService["listArtifacts"]>>> {
    this.calls.push({ method: "listArtifacts", args: [] })
    return [this.artifact]
  }

  async getArtifact(
    artifactId: string
  ): Promise<Awaited<ReturnType<TuckmarkService["getArtifact"]>>> {
    this.calls.push({ method: "getArtifact", args: [artifactId] })
    return { ...this.artifact, id: artifactId }
  }

  async getArtifactPackets(artifactId: string): Promise<ArtifactPackets> {
    this.calls.push({ method: "getArtifactPackets", args: [artifactId] })
    return {
      artifactId,
      packetsJsonPath: path.join(path.dirname(this.artifact.pngPath), "packets.json"),
      packets: ["AQID"],
      packetCount: 1,
      totalBytes: 3,
    }
  }

  async getSyncState(): Promise<SyncState> {
    this.calls.push({ method: "getSyncState", args: [] })
    return this.syncState
  }

  async mergeSyncState(next: SyncState): Promise<SyncState> {
    this.calls.push({ method: "mergeSyncState", args: [next] })
    this.syncState = next
    return this.syncState
  }

  async upsertTemplateUsageRecord(record: TemplateUsageRecord): Promise<SyncState> {
    this.calls.push({ method: "upsertTemplateUsageRecord", args: [record] })
    this.syncState = {
      ...this.syncState,
      templateUsageRecords: [record],
    }
    return this.syncState
  }

  async upsertRecentPrintRecord(record: RecentPrintRecord): Promise<SyncState> {
    this.calls.push({ method: "upsertRecentPrintRecord", args: [record] })
    this.syncState = {
      ...this.syncState,
      recentPrintRecords: [record],
    }
    return this.syncState
  }

  async upsertCanvasDraftRecord(record: CanvasDraftRecord): Promise<SyncState> {
    this.calls.push({ method: "upsertCanvasDraftRecord", args: [record] })
    this.syncState = {
      ...this.syncState,
      canvasDraftRecords: [record],
    }
    return this.syncState
  }

  async previewTemplate(
    request: PreviewRequest
  ): Promise<Awaited<ReturnType<TuckmarkService["previewTemplate"]>>> {
    this.calls.push({ method: "previewTemplate", args: [request] })
    return { artifact: this.artifact }
  }

  async previewCanvas(
    request: DirectCanvasPreviewRequest
  ): Promise<Awaited<ReturnType<TuckmarkService["previewCanvas"]>>> {
    this.calls.push({ method: "previewCanvas", args: [request] })
    return { artifact: this.artifact }
  }

  async previewBatch(
    request: BatchPreviewRequest
  ): Promise<Awaited<ReturnType<TuckmarkService["previewBatch"]>>> {
    this.calls.push({ method: "previewBatch", args: [request] })
    return {
      templateId: request.templateId,
      total: 1,
      items: [{ index: 0, input: { recipient: "Koha" }, artifact: this.artifact }],
    }
  }

  async previewSafeTextLabel(
    request: SafeTextLabelInput
  ): Promise<Awaited<ReturnType<TuckmarkService["previewSafeTextLabel"]>>> {
    this.calls.push({ method: "previewSafeTextLabel", args: [request] })
    return { artifact: this.artifact }
  }

  async printByArtifact(
    request: PrintByArtifactRequest
  ): Promise<Awaited<ReturnType<TuckmarkService["printByArtifact"]>>> {
    this.calls.push({ method: "printByArtifact", args: [request] })
    return {
      id: "job-1",
      artifactId: request.artifactId,
      printerId: request.printerId,
      createdAt: "2026-06-18T00:00:00.000Z",
      status: "completed",
    }
  }

  async printBatch(
    request: PrintBatchRequest
  ): Promise<Awaited<ReturnType<TuckmarkService["printBatch"]>>> {
    this.calls.push({ method: "printBatch", args: [request] })
    return {
      jobs: request.artifactIds.map((artifactId, index) => ({
        id: `job-${index + 1}`,
        artifactId,
        printerId: request.printerId,
        createdAt: "2026-06-18T00:00:00.000Z",
        status: "completed" as const,
      })),
    }
  }

  async printByTemplate(
    request: PrintByTemplateRequest
  ): Promise<Awaited<ReturnType<TuckmarkService["printByTemplate"]>>> {
    this.calls.push({ method: "printByTemplate", args: [request] })
    return {
      preview: { artifact: this.artifact },
      job: {
        id: "job-template",
        artifactId: this.artifact.id,
        printerId: request.printerId,
        createdAt: "2026-06-18T00:00:00.000Z",
        status: "completed",
      },
    }
  }

  async printCanvas(
    request: PrintCanvasRequest
  ): Promise<Awaited<ReturnType<TuckmarkService["printCanvas"]>>> {
    this.calls.push({ method: "printCanvas", args: [request] })
    return {
      preview: { artifact: this.artifact },
      job: {
        id: "job-canvas",
        artifactId: this.artifact.id,
        printerId: request.printerId,
        createdAt: "2026-06-18T00:00:00.000Z",
        status: "completed",
      },
    }
  }

  async printSafeTextLabel(
    printerId: string,
    request: SafeTextLabelInput
  ): Promise<Awaited<ReturnType<TuckmarkService["printSafeTextLabel"]>>> {
    this.calls.push({ method: "printSafeTextLabel", args: [printerId, request] })
    return {
      preview: { artifact: this.artifact },
      job: {
        id: "job-safe-text",
        artifactId: this.artifact.id,
        printerId,
        createdAt: "2026-06-18T00:00:00.000Z",
        status: "completed",
      },
    }
  }
}

describe("server", () => {
  it("serves template preview and artifact print through the shared service", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-server-"))
    cleanupPaths.push(root)
    const artifact = createArtifact(root, "artifact-1")
    await writeFile(artifact.pngPath, Buffer.from("png-data"))
    await writeFile(artifact.svgPath, "<svg></svg>", "utf8")

    const service = new FakeServerService(artifact)
    const app = createApp(service)
    const server = app.listen(0)
    const baseUrl = await new Promise<string>((resolve, reject) => {
      server.once("error", reject)
      server.once("listening", () => {
        const address = server.address() as AddressInfo
        resolve(`http://127.0.0.1:${address.port}`)
      })
    })

    const previewRes = await fetch(`${baseUrl}/api/preview/template`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        templateId: "shipping-compact",
        input: { recipient: "Koha" },
        renderOptions: { paperType: "continuous" },
      }),
    })
    const previewJson = await previewRes.json()

    expect((previewJson as { artifact: { id: string } }).artifact.id).toBe("artifact-1")
    expect(service.calls[0]?.method).toBe("previewTemplate")

    const printRes = await fetch(`${baseUrl}/api/print/artifact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        printerId: "printer-1",
        artifactId: "artifact-1",
      }),
    })
    const printJson = await printRes.json()

    expect((printJson as { status: string }).status).toBe("completed")
    expect(service.calls[1]?.method).toBe("printByArtifact")

    const pngRes = await fetch(`${baseUrl}/api/artifacts/artifact-1/png`)
    const pngBuffer = Buffer.from(await pngRes.arrayBuffer())

    expect(pngBuffer.toString()).toBe("png-data")
    const packetsRes = await fetch(`${baseUrl}/api/artifacts/artifact-1/packets`)
    const packetsJson = await packetsRes.json()
    expect((packetsJson as { artifactId: string }).artifactId).toBe("artifact-1")
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  })

  it("returns validation errors as 400 json", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-server-"))
    cleanupPaths.push(root)
    const service = new FakeServerService(createArtifact(root, "artifact-1"))
    const app = createApp(service)
    const server = app.listen(0)
    const baseUrl = await new Promise<string>((resolve, reject) => {
      server.once("error", reject)
      server.once("listening", () => {
        const address = server.address() as AddressInfo
        resolve(`http://127.0.0.1:${address.port}`)
      })
    })

    const badRes = await fetch(`${baseUrl}/api/print/template`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ printerId: "printer-1" }),
    })
    const badJson = await badRes.json()

    expect(badRes.status).toBe(400)
    expect((badJson as { status: string }).status).toBe("error")
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  })

  it("returns a clear error when server-side print is explicitly disabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-server-"))
    cleanupPaths.push(root)
    const service = new FakeServerService(createArtifact(root, "artifact-disabled"))
    service.printByArtifact = async () => {
      throw new Error(
        "Server-side printer control is disabled. Set TUCKMARK_ENABLE_SERVER_SIDE_PRINT=1 to enable it."
      )
    }
    const app = createApp(service)
    const server = app.listen(0)
    const baseUrl = await new Promise<string>((resolve, reject) => {
      server.once("error", reject)
      server.once("listening", () => {
        const address = server.address() as AddressInfo
        resolve(`http://127.0.0.1:${address.port}`)
      })
    })

    const previewRes = await fetch(`${baseUrl}/api/preview/template`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        templateId: "shipping-compact",
        input: {
          recipient: "Koha",
          address: "Moon Street 42",
          orderId: "TM-001",
          note: "fragile",
        },
        renderOptions: { paperType: "continuous" },
      }),
    })
    const previewJson = (await previewRes.json()) as { artifact: { id: string } }

    const printRes = await fetch(`${baseUrl}/api/print/artifact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        printerId: "printer-1",
        artifactId: previewJson.artifact.id,
      }),
    })
    const printJson = (await printRes.json()) as { status: string; error: string }

    expect(printRes.status).toBe(400)
    expect(printJson.status).toBe("error")
    expect(printJson.error).toMatch(/Server-side printer control is disabled/)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  })

  it("fails fast on startup when service-api print is enabled but detonger readiness is missing", async () => {
    const previousEnabled = process.env.TUCKMARK_ENABLE_SERVER_SIDE_PRINT
    const previousRoot = process.env.TUCKMARK_DETONGER_REPO_ROOT
    process.env.TUCKMARK_ENABLE_SERVER_SIDE_PRINT = "1"
    process.env.TUCKMARK_DETONGER_REPO_ROOT = "/tmp/tuckmark-missing-detonger"

    try {
      expect(() =>
        startServer(new FakeServerService(createArtifact(os.tmpdir(), "artifact-fail")), 0)
      ).toThrow(/Service-api print path is enabled, but detonger runtime is not ready/)
    } finally {
      if (previousEnabled === undefined) {
        Reflect.deleteProperty(process.env, "TUCKMARK_ENABLE_SERVER_SIDE_PRINT")
      } else {
        process.env.TUCKMARK_ENABLE_SERVER_SIDE_PRINT = previousEnabled
      }
      if (previousRoot === undefined) {
        Reflect.deleteProperty(process.env, "TUCKMARK_DETONGER_REPO_ROOT")
      } else {
        process.env.TUCKMARK_DETONGER_REPO_ROOT = previousRoot
      }
    }
  })

  it("still starts when service-api print is not explicitly enabled", async () => {
    const previousEnabled = process.env.TUCKMARK_ENABLE_SERVER_SIDE_PRINT
    const previousRoot = process.env.TUCKMARK_DETONGER_REPO_ROOT
    Reflect.deleteProperty(process.env, "TUCKMARK_ENABLE_SERVER_SIDE_PRINT")
    process.env.TUCKMARK_DETONGER_REPO_ROOT = "/tmp/tuckmark-missing-detonger"

    let server: Server | undefined
    try {
      expect(() => {
        server = startServer(new FakeServerService(createArtifact(os.tmpdir(), "artifact-ok")), 0)
      }).not.toThrow()
    } finally {
      await new Promise<void>(
        (resolve, reject) =>
          server?.close((error) => (error ? reject(error) : resolve())) ?? resolve()
      )
      if (previousEnabled === undefined) {
        Reflect.deleteProperty(process.env, "TUCKMARK_ENABLE_SERVER_SIDE_PRINT")
      } else {
        process.env.TUCKMARK_ENABLE_SERVER_SIDE_PRINT = previousEnabled
      }
      if (previousRoot === undefined) {
        Reflect.deleteProperty(process.env, "TUCKMARK_DETONGER_REPO_ROOT")
      } else {
        process.env.TUCKMARK_DETONGER_REPO_ROOT = previousRoot
      }
    }
  })

  it("exposes printer probe without sending print data", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-server-"))
    cleanupPaths.push(root)
    const service = new FakeServerService(createArtifact(root, "artifact-probe"))
    const app = createApp(service)
    const server = app.listen(0)
    const baseUrl = await new Promise<string>((resolve, reject) => {
      server.once("error", reject)
      server.once("listening", () => {
        const address = server.address() as AddressInfo
        resolve(`http://127.0.0.1:${address.port}`)
      })
    })

    const probeRes = await fetch(`${baseUrl}/api/printers/probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        printerId: "printer-1",
        printerName: "Mock P2",
      }),
    })
    const probeJson = (await probeRes.json()) as { ok: boolean; stage: string; printerId: string }

    expect(probeRes.status).toBe(200)
    expect(probeJson.ok).toBe(true)
    expect(probeJson.stage).toBe("complete")
    expect(probeJson.printerId).toBe("printer-1")
    expect(service.calls.some((call) => call.method === "probePrinter")).toBe(true)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  })

  it("exposes sync state get and merge endpoints", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-server-"))
    cleanupPaths.push(root)
    const service = new FakeServerService(createArtifact(root, "artifact-sync"))
    const app = createApp(service)
    const server = app.listen(0)
    const baseUrl = await new Promise<string>((resolve, reject) => {
      server.once("error", reject)
      server.once("listening", () => {
        const address = server.address() as AddressInfo
        resolve(`http://127.0.0.1:${address.port}`)
      })
    })

    const getRes = await fetch(`${baseUrl}/api/sync/state`)
    const getJson = (await getRes.json()) as { state: SyncState }
    expect(getRes.status).toBe(200)
    expect(getJson.state.schemaVersion).toBe(1)

    const nextState: SyncState = {
      schemaVersion: 1,
      updatedAt: "2026-06-28T00:00:00.000Z",
      templateUsageRecords: [],
      recentPrintRecords: [],
      canvasDraftRecords: [],
    }
    const postRes = await fetch(`${baseUrl}/api/sync/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(nextState),
    })
    const postJson = (await postRes.json()) as { state: SyncState }
    expect(postRes.status).toBe(200)
    expect(postJson.state.updatedAt).toBe("2026-06-28T00:00:00.000Z")
    expect(service.calls.some((call) => call.method === "mergeSyncState")).toBe(true)

    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  })
})
