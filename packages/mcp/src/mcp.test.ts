import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { PreviewArtifact } from "@tuckmark/core"
import { afterEach, describe, expect, it } from "vitest"

import { createServer, type McpService } from "./index.js"

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((item) => rm(item, { recursive: true, force: true }))
  )
})

function createArtifact(root: string): PreviewArtifact {
  return {
    id: "artifact-1",
    source: "template",
    name: "Shipping Label",
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
    },
    pngPath: path.join(root, "artifact-1.png"),
    bitmapPath: path.join(root, "artifact-1.bin"),
    svgPath: path.join(root, "artifact-1.svg"),
    width: 384,
    height: 120,
  }
}

class FakeMcpService implements McpService {
  readonly artifact: PreviewArtifact
  calls: Array<{ method: string; args: unknown[] }> = []

  constructor(artifact: PreviewArtifact) {
    this.artifact = artifact
  }

  async listPrinters(): ReturnType<McpService["listPrinters"]> {
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
          notes: [] as string[],
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

  async listTemplates() {
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

  async previewTemplate() {
    this.calls.push({ method: "previewTemplate", args: [] })
    return { artifact: this.artifact }
  }

  async previewBatch() {
    this.calls.push({ method: "previewBatch", args: [] })
    return {
      templateId: "shipping-compact",
      total: 1,
      items: [{ index: 0, input: { recipient: "Koha" }, artifact: this.artifact }],
    }
  }

  async previewCanvas() {
    this.calls.push({ method: "previewCanvas", args: [] })
    return { artifact: this.artifact }
  }

  async previewSafeTextLabel() {
    this.calls.push({ method: "previewSafeTextLabel", args: [] })
    return { artifact: this.artifact }
  }

  async printByArtifact() {
    this.calls.push({ method: "printByArtifact", args: [] })
    return {
      id: "job-1",
      artifactId: this.artifact.id,
      printerId: "printer-1",
      createdAt: "2026-06-18T00:00:00.000Z",
      status: "completed" as const,
    }
  }

  async printBatch() {
    this.calls.push({ method: "printBatch", args: [] })
    return {
      jobs: [
        {
          id: "job-1",
          artifactId: this.artifact.id,
          printerId: "printer-1",
          createdAt: "2026-06-18T00:00:00.000Z",
          status: "completed" as const,
        },
      ],
    }
  }

  async printByTemplate() {
    this.calls.push({ method: "printByTemplate", args: [] })
    return {
      preview: { artifact: this.artifact },
      job: {
        id: "job-template",
        artifactId: this.artifact.id,
        printerId: "printer-1",
        createdAt: "2026-06-18T00:00:00.000Z",
        status: "completed" as const,
      },
    }
  }

  async printCanvas() {
    this.calls.push({ method: "printCanvas", args: [] })
    return {
      preview: { artifact: this.artifact },
      job: {
        id: "job-canvas",
        artifactId: this.artifact.id,
        printerId: "printer-1",
        createdAt: "2026-06-18T00:00:00.000Z",
        status: "completed" as const,
      },
    }
  }

  async printSafeTextLabel() {
    this.calls.push({ method: "printSafeTextLabel", args: [] })
    return {
      preview: { artifact: this.artifact },
      job: {
        id: "job-safe-text",
        artifactId: this.artifact.id,
        printerId: "printer-1",
        createdAt: "2026-06-18T00:00:00.000Z",
        status: "completed" as const,
      },
    }
  }

  async listArtifacts() {
    this.calls.push({ method: "listArtifacts", args: [] })
    return [this.artifact]
  }

  async getArtifact(artifactId: string) {
    this.calls.push({ method: "getArtifact", args: [artifactId] })
    return { ...this.artifact, id: artifactId }
  }

  async getArtifactPackets(artifactId: string) {
    this.calls.push({ method: "getArtifactPackets", args: [artifactId] })
    return {
      artifactId,
      packetsJsonPath: path.join(path.dirname(this.artifact.pngPath), "packets.json"),
      packets: ["AQID"],
      packetCount: 1,
      totalBytes: 3,
    }
  }
}

describe("mcp", () => {
  it("registers template preview and artifact print tools on the shared service", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-mcp-"))
    cleanupPaths.push(root)
    const artifact = createArtifact(root)
    await writeFile(artifact.pngPath, Buffer.from("png-data"))
    await writeFile(artifact.svgPath, "<svg></svg>", "utf8")
    const service = new FakeMcpService(artifact)

    const server = createServer(service)

    const registeredTools = (
      server as unknown as {
        _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>
      }
    )._registeredTools
    const toolNames = Object.keys(registeredTools)
    expect(toolNames).toContain("preview_template")
    expect(toolNames).toContain("print_by_artifact")
    expect(toolNames).toContain("probe_printer")
    const previewTool = registeredTools.preview_template
    const printArtifactTool = registeredTools.print_by_artifact
    const probeTool = registeredTools.probe_printer
    if (!previewTool || !printArtifactTool || !probeTool) {
      throw new Error("required tools not registered")
    }

    const preview = await previewTool.handler(
      {
        templateId: "shipping-compact",
        input: { recipient: "Koha" },
      },
      {} as never
    )
    expect(
      (preview as { structuredContent: { artifact: { id: string } } }).structuredContent.artifact.id
    ).toBe("artifact-1")

    const job = await printArtifactTool.handler(
      {
        printerId: "printer-1",
        artifactId: "artifact-1",
      },
      {} as never
    )
    expect((job as { structuredContent: { status: string } }).structuredContent.status).toBe(
      "completed"
    )

    const probe = await probeTool.handler(
      {
        printerId: "printer-1",
        printerName: "Mock P2",
      },
      {} as never
    )
    expect(
      (probe as { structuredContent: { ok: boolean; stage: string } }).structuredContent.ok
    ).toBe(true)
    expect(
      (probe as { structuredContent: { ok: boolean; stage: string } }).structuredContent.stage
    ).toBe("complete")

    const resourceTemplates = (
      server as unknown as {
        _registeredResourceTemplates: Record<
          string,
          {
            resourceTemplate: {
              listCallback?: (ctx: unknown) => Promise<{ resources: Array<{ uri: string }> }>
            }
            readCallback: (
              uri: URL,
              vars: Record<string, string>,
              ctx: unknown
            ) => Promise<{ contents: Array<{ text?: string }> }>
          }
        >
      }
    )._registeredResourceTemplates

    const artifactTemplate = resourceTemplates.artifact
    const pngTemplate = resourceTemplates["artifact-png"]
    const packetsTemplate = resourceTemplates["artifact-packets"]
    if (!artifactTemplate || !pngTemplate || !packetsTemplate) {
      throw new Error("required resources not registered")
    }

    const artifactList = await artifactTemplate.resourceTemplate.listCallback?.({} as never)
    const pngList = await pngTemplate.resourceTemplate.listCallback?.({} as never)
    const packetsList = await packetsTemplate.resourceTemplate.listCallback?.({} as never)
    expect(artifactList?.resources.map((resource) => resource.uri)).toContain(
      "tuckmark://artifacts/artifact-1"
    )
    expect(pngList?.resources.map((resource) => resource.uri)).toContain(
      "tuckmark://artifacts/artifact-1/png"
    )
    expect(packetsList?.resources.map((resource) => resource.uri)).toContain(
      "tuckmark://artifacts/artifact-1/packets"
    )

    const artifactResource = await artifactTemplate.readCallback(
      new URL("tuckmark://artifacts/artifact-1"),
      { artifactId: "artifact-1" },
      {} as never
    )
    expect(artifactResource.contents[0]?.text?.includes('"id": "artifact-1"')).toBe(true)

    const packetsResource = await packetsTemplate.readCallback(
      new URL("tuckmark://artifacts/artifact-1/packets"),
      { artifactId: "artifact-1" },
      {} as never
    )
    expect(packetsResource.contents[0]?.text?.includes('"artifactId": "artifact-1"')).toBe(true)
  })
})
