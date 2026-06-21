import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { ArtifactStore } from "../src/artifact-store.ts"
import { TuckmarkService } from "../src/service.ts"
import type { PreviewArtifact, Printer } from "../src/types.ts"

class FakeDetongerAdapter {
  readonly printers: Printer[] = []
  readonly printerScans: Printer[][] = []

  printed: Array<{ printerId: string; artifact: PreviewArtifact }> = []
  encoded: Array<{ artifactId: string }> = []

  constructor() {
    this.printers.push(this.makePrinter("printer-1"))
  }

  private makePrinter(id: string, name = "Mock P2"): Printer {
    return {
      id,
      name,
      capabilities: {
        dpi: 203,
        printWidthDots: 384,
        supportedPaperTypes: ["gap", "continuous"],
        colors: ["mono"],
        notes: [],
      },
    }
  }

  async scanPrinters(): Promise<Printer[]> {
    const queued = this.printerScans.shift()
    if (queued) {
      return queued
    }
    return this.printers
  }

  async printArtifact(printerId: string, artifact: PreviewArtifact): Promise<void> {
    this.printed.push({ printerId, artifact })
  }

  async encodeArtifactPackets(artifact: PreviewArtifact) {
    this.encoded.push({ artifactId: artifact.id })
    return {
      artifactId: artifact.id,
      packetsJsonPath: path.join(path.dirname(artifact.pngPath), "packets.json"),
      packets: ["AQID"],
      packetCount: 1,
      totalBytes: 3,
    }
  }
}

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((item) => rm(item, { recursive: true, force: true }))
  )
  Reflect.deleteProperty(process.env, "TUCKMARK_ENABLE_SERVER_SIDE_PRINT")
})

describe("TuckmarkService", () => {
  it("renders and stores a template preview artifact", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-core-"))
    cleanupPaths.push(root)
    const fake = new FakeDetongerAdapter()
    const service = new TuckmarkService({
      artifactStore: new ArtifactStore(root),
      detonger: fake as never,
    })

    const preview = await service.previewTemplate({
      templateId: "shipping-compact",
      input: {
        recipient: "Koha",
        address: "Moon St 42",
        orderId: "TM-001",
        note: "fragile",
      },
    })

    expect(preview.artifact.templateId).toBe("shipping-compact")
    expect(preview.artifact.pngPath.endsWith("preview.png")).toBe(true)
  })

  it("supports batch preview and print by artifact", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-core-"))
    cleanupPaths.push(root)
    const fake = new FakeDetongerAdapter()
    const service = new TuckmarkService({
      artifactStore: new ArtifactStore(root),
      detonger: fake as never,
    })

    const batch = await service.previewBatch({
      templateId: "cable-tag",
      csvText: "name,port,location\nLAN-01,Gi1/0/1,Rack A\nLAN-02,Gi1/0/2,Rack B",
    })

    expect(batch.total).toBe(2)
    const job = await service.printByArtifact({
      printerId: "printer-1",
      artifactId: batch.items[0]?.artifact.id ?? "",
    })

    expect(job.status).toBe("completed")
    expect(fake.printed).toHaveLength(1)
  })

  it("supports direct template print through preview unification", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-core-"))
    cleanupPaths.push(root)
    const fake = new FakeDetongerAdapter()
    const service = new TuckmarkService({
      artifactStore: new ArtifactStore(root),
      detonger: fake as never,
    })

    const result = await service.printByTemplate({
      printerId: "printer-1",
      templateId: "shipping-compact",
      input: {
        recipient: "Koha",
        address: "Moon St 42",
        orderId: "TM-003",
        note: "fragile",
      },
    })

    expect(result.preview.artifact.templateId).toBe("shipping-compact")
    expect(result.job.status).toBe("completed")
    expect(fake.printed).toHaveLength(1)
  })

  it("supports safe text label preview and print", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-core-"))
    cleanupPaths.push(root)
    const fake = new FakeDetongerAdapter()
    const service = new TuckmarkService({
      artifactStore: new ArtifactStore(root),
      detonger: fake as never,
    })

    const result = await service.printSafeTextLabel("printer-1", {
      text: "hello detonger",
      title: "Safe Text Label",
    })

    expect(result.preview.artifact.templateId).toBe("safe-text-label")
    expect(result.preview.artifact.source).toBe("safe_text")
    expect(result.preview.artifact.height).toBeGreaterThanOrEqual(64)
    expect(result.preview.artifact.renderOptions.paperType).toBe("continuous")
    expect(result.job.status).toBe("completed")
    expect(fake.printed).toHaveLength(1)
    expect(fake.printed[0]?.artifact.renderOptions.paperType).toBe("continuous")
  })

  it("supports batch printing with existing artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-core-"))
    cleanupPaths.push(root)
    const fake = new FakeDetongerAdapter()
    const service = new TuckmarkService({
      artifactStore: new ArtifactStore(root),
      detonger: fake as never,
    })

    const batch = await service.previewBatch({
      templateId: "cable-tag",
      csvText: "name,port,location\nLAN-01,Gi1/0/1,Rack A\nLAN-02,Gi1/0/2,Rack B",
    })

    const result = await service.printBatch({
      printerId: "printer-1",
      artifactIds: batch.items.map((item) => item.artifact.id),
    })

    expect(result.jobs).toHaveLength(2)
    expect(fake.printed).toHaveLength(2)
  })

  it("encodes preview artifacts into transport packets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-core-"))
    cleanupPaths.push(root)
    const fake = new FakeDetongerAdapter()
    const service = new TuckmarkService({
      artifactStore: new ArtifactStore(root),
      detonger: fake as never,
    })

    const preview = await service.previewTemplate({
      templateId: "shipping-compact",
      input: {
        recipient: "Koha",
        address: "Moon St 42",
        orderId: "TM-004",
        note: "fragile",
      },
    })

    const packets = await service.getArtifactPackets(preview.artifact.id)
    expect(packets.artifactId).toBe(preview.artifact.id)
    expect(packets.packetCount).toBe(1)
    expect(fake.encoded).toEqual([{ artifactId: preview.artifact.id }])
  })

  it("can disable server-side physical printing explicitly", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-core-"))
    cleanupPaths.push(root)
    const fake = new FakeDetongerAdapter()
    process.env.TUCKMARK_ENABLE_SERVER_SIDE_PRINT = "0"
    const service = new TuckmarkService({
      artifactStore: new ArtifactStore(root),
      detonger: fake as never,
    })

    const preview = await service.previewTemplate({
      templateId: "shipping-compact",
      input: {
        recipient: "Koha",
        address: "Moon St 42",
        orderId: "TM-999",
        note: "fragile",
      },
    })

    await expect(
      service.printByArtifact({
        printerId: "printer-1",
        artifactId: preview.artifact.id,
      })
    ).rejects.toThrow(/Server-side printer control is disabled/)
    expect(fake.printed).toHaveLength(0)
  })

  it("rejects printing when the selected backend printer is no longer discoverable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-core-"))
    cleanupPaths.push(root)
    const fake = new FakeDetongerAdapter()
    const service = new TuckmarkService({
      artifactStore: new ArtifactStore(root),
      detonger: fake as never,
    })

    const preview = await service.previewTemplate({
      templateId: "shipping-compact",
      input: {
        recipient: "Koha",
        address: "Moon St 42",
        orderId: "TM-404",
        note: "fragile",
      },
    })

    fake.printers.splice(0, fake.printers.length)

    await expect(
      service.printByArtifact({
        printerId: "printer-1",
        printerName: "Mock P2",
        artifactId: preview.artifact.id,
      })
    ).rejects.toThrow(/Printer is no longer available/)
    expect(fake.printed).toHaveLength(0)
  })

  it("rebinds by printer name when the backend printer instance id changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-core-"))
    cleanupPaths.push(root)
    const fake = new FakeDetongerAdapter()
    const service = new TuckmarkService({
      artifactStore: new ArtifactStore(root),
      detonger: fake as never,
    })

    const preview = await service.previewTemplate({
      templateId: "cable-tag",
      input: {
        name: "LAN-01",
        port: "Gi1/0/1",
        location: "Rack A",
      },
    })

    const firstPrinter = fake.printers[0]
    if (!firstPrinter) {
      throw new Error("Missing fake printer")
    }
    fake.printerScans.push([{ ...firstPrinter, id: "printer-2" }])
    fake.printerScans.push([{ ...firstPrinter, id: "printer-2" }])

    const job = await service.printByArtifact({
      printerId: "printer-1",
      printerName: "Mock P2",
      artifactId: preview.artifact.id,
    })

    expect(job.printerId).toBe("printer-2")
    expect(fake.printed).toEqual([
      {
        printerId: "printer-2",
        artifact: expect.objectContaining({ id: preview.artifact.id }),
      },
    ])
  })
})
