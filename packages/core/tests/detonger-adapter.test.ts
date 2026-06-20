import { execFile } from "node:child_process"
import fs from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ArtifactStore } from "../src/artifact-store.ts"
import { DetongerAdapter } from "../src/detonger-adapter.ts"
import { TuckmarkService } from "../src/service.ts"

const cleanupPaths: string[] = []
const execFileAsync = promisify(execFile)

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((item) => rm(item, { recursive: true, force: true }))
  )
  Reflect.deleteProperty(process.env, "TUCKMARK_DETONGER_PACKET_ENCODER")
  Reflect.deleteProperty(process.env, "TUCKMARK_DETONGER_COMMAND")
  Reflect.deleteProperty(process.env, "TUCKMARK_DETONGER_PRINT_TIMEOUT_MS")
  Reflect.deleteProperty(process.env, "TUCKMARK_DETONGER_PNG_ROWS_PER_CHUNK")
  vi.restoreAllMocks()
})

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("DetongerAdapter", () => {
  it("encodes preview artifacts into detonger-compatible vendor messages by default", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-detonger-"))
    cleanupPaths.push(root)

    const service = new TuckmarkService({
      artifactStore: new ArtifactStore(root),
    })
    const adapter = new DetongerAdapter()

    const preview = await service.previewTemplate({
      templateId: "shipping-compact",
      input: {
        recipient: "Koha",
        address: "Moon St 42",
        orderId: "TM-007",
        note: "fragile",
      },
    })

    const packets = await adapter.encodeArtifactPackets(preview.artifact)
    const decoded = packets.packets.map((packet) => Buffer.from(packet, "base64"))

    expect(packets.packetCount).toBeGreaterThan(20)
    expect(decoded[0]?.toString("hex")).toBe("1f2002000188")
    expect(decoded[1]?.toString("hex")).toBe("1f27013088")
    expect(decoded.some((packet) => packet[1] === 0x2b)).toBe(true)
    expect(decoded.some((packet) => packet[1] === 0x2e)).toBe(true)
    expect(decoded.every((packet) => packet[1] !== 0x2c && packet[1] !== 0x2d)).toBe(true)
    expect(decoded.at(-1)?.at(-1)).toBe(0x0c)
  }, 60_000)

  it("can opt into lpapi compact packets explicitly", async () => {
    process.env.TUCKMARK_DETONGER_PACKET_ENCODER = "lpapi"
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-detonger-"))
    cleanupPaths.push(root)

    const service = new TuckmarkService({
      artifactStore: new ArtifactStore(root),
    })
    const adapter = new DetongerAdapter()

    const preview = await service.previewTemplate({
      templateId: "shipping-compact",
      input: {
        recipient: "Koha",
        address: "Moon St 42",
        orderId: "TM-007",
        note: "fragile",
      },
    })

    const packets = await adapter.encodeArtifactPackets(preview.artifact)
    const decoded = packets.packets.map((packet) => Buffer.from(packet, "base64"))

    expect(decoded.some((packet) => packet[1] === 0x2c || packet[1] === 0x2d)).toBe(true)
  })

  it("surfaces detonger json errors without retrying hardware print", async () => {
    const printerId = "printer-json-error"
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-detonger-"))
    cleanupPaths.push(root)
    const fakeDetongerPath = path.join(root, "fake-detonger.js")
    const callsPath = path.join(root, "calls.log")

    const service = new TuckmarkService({
      artifactStore: new ArtifactStore(root),
    })
    const preview = await service.previewTemplate({
      templateId: "shipping-compact",
      input: {
        recipient: "Koha",
        address: "Moon St 42",
        orderId: "TM-008",
        note: "fragile",
      },
      renderOptions: {
        paperType: "continuous",
      },
    })

    await writeFile(
      fakeDetongerPath,
      [
        "import fs from 'node:fs';",
        "const args = process.argv.slice(2);",
        `fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + '\\n');`,
        "if (args[0] === 'preview' && args[1] === 'packets') {",
        "  const outIndex = args.indexOf('--out');",
        "  if (outIndex >= 0 && args[outIndex + 1]) {",
        "    fs.writeFileSync(args[outIndex + 1], JSON.stringify({ packets: ['HyACAAGI'] }) + '\\n');",
        "  }",
        "  console.log(JSON.stringify({ status: 'ok' }));",
        "  process.exit(0);",
        "}",
        "console.log(JSON.stringify({ status: 'error', error: { kind: 'timeout', message: 'timeout' } }));",
        "process.exit(10);",
      ].join("\n"),
      "utf8"
    )

    process.env.TUCKMARK_DETONGER_COMMAND = process.execPath

    const directAdapter = new DetongerAdapter({
      detongerCommand: process.execPath,
      detongerRepoRoot: root,
    })

    vi.spyOn(directAdapter as DetongerAdapter, "detongerArgs" as never).mockImplementation(((
      args: string[]
    ) => [fakeDetongerPath, ...args]) as never)

    await expect(directAdapter.printArtifact(printerId, preview.artifact)).rejects.toThrow(
      /detonger print job failed: \[timeout\] timeout/
    )

    const calls = fs.readFileSync(callsPath, "utf8").trim().split("\n").filter(Boolean)

    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain("preview")
    expect(calls[0]).toContain("--paper-type")
    expect(calls[0]).toContain("continuous")
    expect(calls[1]).toContain("print")
    expect(calls[1]).toContain("job")
  }, 20_000)

  it("uses unchunked packets and print job for continuous paper by default", async () => {
    const printerId = "printer-unchunked-default"
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-detonger-"))
    cleanupPaths.push(root)
    const fakeDetongerPath = path.join(root, "fake-detonger.js")
    const callsPath = path.join(root, "calls.log")

    const service = new TuckmarkService({
      artifactStore: new ArtifactStore(root),
    })
    const preview = await service.previewTemplate({
      templateId: "cable-tag",
      input: {
        name: "LAN-01",
        port: "Gi1/0/1",
        location: "Rack A",
      },
      renderOptions: {
        paperType: "continuous",
      },
    })

    await writeFile(
      fakeDetongerPath,
      [
        "import fs from 'node:fs';",
        "const args = process.argv.slice(2);",
        `fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + '\\n');`,
        "if (args[0] === 'preview' && args[1] === 'packets') {",
        "  const outIndex = args.indexOf('--out');",
        "  if (outIndex >= 0 && args[outIndex + 1]) {",
        "    fs.writeFileSync(args[outIndex + 1], JSON.stringify({ packets: ['HyACAAGI'] }) + '\\n');",
        "  }",
        "}",
        "console.log(JSON.stringify({ status: 'ok' }));",
      ].join("\n"),
      "utf8"
    )

    const adapter = new DetongerAdapter({
      detongerCommand: process.execPath,
      detongerRepoRoot: root,
    })

    vi.spyOn(adapter as DetongerAdapter, "detongerArgs" as never).mockImplementation(((
      args: string[]
    ) => [fakeDetongerPath, ...args]) as never)

    await adapter.printArtifact(printerId, preview.artifact)

    const calls = fs
      .readFileSync(callsPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[])

    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain("preview")
    expect(calls[0]).toContain("packets")
    expect(calls[0]).not.toContain("--rows-per-chunk")
    expect(calls[0]).toContain("--paper-type")
    expect(calls[0]).toContain("continuous")
    expect(calls[1]).toContain("print")
    expect(calls[1]).toContain("job")
    expect(calls[1]).toContain("--input-format")
    expect(calls[1]).toContain("packets-json")
  }, 20_000)

  it("can opt into chunked packets for continuous paper explicitly", async () => {
    process.env.TUCKMARK_DETONGER_PNG_ROWS_PER_CHUNK = "8"
    const printerId = "printer-chunked-explicit"
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-detonger-"))
    cleanupPaths.push(root)
    const fakeDetongerPath = path.join(root, "fake-detonger.js")
    const callsPath = path.join(root, "calls.log")

    const service = new TuckmarkService({
      artifactStore: new ArtifactStore(root),
    })
    const preview = await service.previewTemplate({
      templateId: "cable-tag",
      input: {
        name: "LAN-01",
        port: "Gi1/0/1",
        location: "Rack A",
      },
      renderOptions: {
        paperType: "continuous",
      },
    })

    await writeFile(
      fakeDetongerPath,
      [
        "import fs from 'node:fs';",
        "const args = process.argv.slice(2);",
        `fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + '\\n');`,
        "if (args[0] === 'preview' && args[1] === 'packets') {",
        "  const outIndex = args.indexOf('--out');",
        "  if (outIndex >= 0 && args[outIndex + 1]) {",
        "    fs.writeFileSync(args[outIndex + 1], JSON.stringify({ packets: ['HyACAAGI'] }) + '\\n');",
        "  }",
        "}",
        "console.log(JSON.stringify({ status: 'ok' }));",
      ].join("\n"),
      "utf8"
    )

    const adapter = new DetongerAdapter({
      detongerCommand: process.execPath,
      detongerRepoRoot: root,
    })

    vi.spyOn(adapter as DetongerAdapter, "detongerArgs" as never).mockImplementation(((
      args: string[]
    ) => [fakeDetongerPath, ...args]) as never)

    await adapter.printArtifact(printerId, preview.artifact)

    const calls = fs
      .readFileSync(callsPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[])

    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain("--rows-per-chunk")
    expect(calls[0]).toContain("8")
  }, 20_000)

  it("reuses cached printers when a fresh scan returns no matching detonger devices", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-detonger-"))
    cleanupPaths.push(root)
    const fakeDetongerPath = path.join(root, "fake-detonger.js")
    const statePath = path.join(root, "state.json")

    await writeFile(statePath, JSON.stringify({ count: 0 }), "utf8")
    await writeFile(
      fakeDetongerPath,
      [
        "import fs from 'node:fs';",
        `const statePath = ${JSON.stringify(statePath)};`,
        "const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));",
        "state.count += 1;",
        "fs.writeFileSync(statePath, JSON.stringify(state));",
        "if (state.count === 1) {",
        "  console.log(JSON.stringify([{ device: 'printer-1', name: 'P2-Y404125469', rssi: -42 }]));",
        "} else {",
        "  console.log(JSON.stringify([{ device: 'other-1', name: 'Ivan的iPad', rssi: -60 }]));",
        "}",
      ].join("\n"),
      "utf8"
    )

    const adapter = new DetongerAdapter({
      detongerCommand: process.execPath,
      detongerRepoRoot: root,
    })

    vi.spyOn(adapter as DetongerAdapter, "detongerArgs" as never).mockImplementation(((
      args: string[]
    ) => [fakeDetongerPath, ...args]) as never)

    const first = await adapter.scanPrinters()
    const second = await adapter.scanPrinters()

    expect(first).toHaveLength(1)
    expect(first[0]?.id).toBe("printer-1")
    expect(second).toHaveLength(1)
    expect(second[0]?.id).toBe("printer-1")

    const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as { count: number }
    expect(state.count).toBeGreaterThanOrEqual(2)
  })

  it("times out hanging detonger print commands and writes a command log", async () => {
    const printerId = "printer-hanging-command"
    const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-detonger-"))
    cleanupPaths.push(root)
    const fakeDetongerPath = path.join(root, "fake-detonger.js")

    const service = new TuckmarkService({
      artifactStore: new ArtifactStore(root),
    })
    const preview = await service.previewTemplate({
      templateId: "shipping-compact",
      input: {
        recipient: "Koha",
        address: "Moon St 42",
        orderId: "TM-009",
        note: "fragile",
      },
      renderOptions: {
        paperType: "continuous",
      },
    })

    await writeFile(
      fakeDetongerPath,
      [
        "import fs from 'node:fs';",
        "const args = process.argv.slice(2);",
        "if (args[0] === 'preview' && args[1] === 'packets') {",
        "  const outIndex = args.indexOf('--out');",
        "  if (outIndex >= 0 && args[outIndex + 1]) {",
        "    fs.writeFileSync(args[outIndex + 1], JSON.stringify({ packets: ['HyACAAGI'] }) + '\\n');",
        "  }",
        "  console.log(JSON.stringify({ status: 'ok' }));",
        "  process.exit(0);",
        "}",
        "console.log('starting hang');",
        "setInterval(() => {}, 1000);",
      ].join("\n"),
      "utf8"
    )

    process.env.TUCKMARK_DETONGER_PRINT_TIMEOUT_MS = "200"

    const adapter = new DetongerAdapter({
      detongerCommand: process.execPath,
      detongerRepoRoot: root,
    })

    vi.spyOn(adapter as DetongerAdapter, "detongerArgs" as never).mockImplementation(((
      args: string[]
    ) => [fakeDetongerPath, ...args]) as never)

    await expect(adapter.printArtifact(printerId, preview.artifact)).rejects.toThrow(
      /timed out after 200ms/
    )

    const logPath = path.join(path.dirname(preview.artifact.pngPath), "print-command.log")
    const log = fs.readFileSync(logPath, "utf8")
    expect(log).toContain("ok=false")
    expect(log).toContain("starting hang")
    expect(log).toContain("--input-format")
  }, 20_000)
})
