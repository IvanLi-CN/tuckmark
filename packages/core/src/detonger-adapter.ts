import { mkdir, open, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  printerSchema,
  type ArtifactPackets,
  type PreviewArtifact,
  type PrinterProbeResult,
  type Printer
} from "./types.js";
import { encodeArtifactWithLpapiCompact } from "./lpapi-compact-encoder.js";

const execFileAsync = promisify(execFile);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultDetongerRepoRoot = path.resolve(moduleDir, "../../../detonger");
const printerNamePrefixes = ["P2-", "Detonger"];
const printerCacheTtlMs = 60_000;
const packetEncoderEnvName = "TUCKMARK_DETONGER_PACKET_ENCODER";
const defaultPrintTimeoutMs = 20_000;

type DetongerScanItem = {
  device: string;
  name?: string | null;
  rssi?: number | null;
};

type DetongerJsonErrorPayload = {
  kind?: string;
  message?: string;
};

type DetongerJsonCommandResult = {
  status?: string;
  out?: string | null;
  error?: DetongerJsonErrorPayload | null;
};

export interface DetongerAdapterOptions {
  detongerCommand?: string;
  detongerRepoRoot?: string;
}

export class DetongerAdapter {
  private readonly command: string;
  private readonly repoRoot: string;
  private readonly mockEnabled: boolean;
  private readonly lockRoot: string;
  private readonly pngRowsPerChunk: number | undefined;
  private readonly printTimeoutMs: number;
  private printerCache = new Map<string, { printer: Printer; seenAt: number }>();

  constructor(options?: DetongerAdapterOptions) {
    this.command = options?.detongerCommand ?? process.env.TUCKMARK_DETONGER_COMMAND ?? "cargo";
    this.repoRoot =
      options?.detongerRepoRoot ??
      process.env.TUCKMARK_DETONGER_REPO_ROOT ??
      defaultDetongerRepoRoot;
    this.mockEnabled = process.env.TUCKMARK_MOCK_PRINTERS !== "0";
    this.lockRoot = path.join(os.tmpdir(), "tuckmark-printer-locks");
    this.pngRowsPerChunk = this.resolveRowsPerChunk();
    this.printTimeoutMs = this.resolvePrintTimeoutMs();
  }

  private detongerArgs(args: string[]): string[] {
    if (this.command === "cargo") {
      return ["run", "-q", "-p", "detonger", "--", ...args];
    }
    return args;
  }

  private packetEncoder(): "lpapi" | "rust" {
    const raw = process.env[packetEncoderEnvName]?.trim().toLowerCase();
    if (!raw || raw === "rust") {
      return "rust";
    }
    if (raw === "lpapi") {
      return "lpapi";
    }
    throw new Error(`Invalid ${packetEncoderEnvName}: ${raw}`);
  }

  private async runScan(timeoutSeconds = 8): Promise<DetongerScanItem[]> {
    const { stdout } = await execFileAsync(
      this.command,
      this.detongerArgs(["scan", "--timeout-s", String(timeoutSeconds), "--format", "json"]),
      {
        cwd: this.repoRoot
      }
    );
    return JSON.parse(stdout) as DetongerScanItem[];
  }

  private toUtf8(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }
    if (Buffer.isBuffer(value)) {
      return value.toString("utf8");
    }
    return "";
  }

  private parseDetongerJsonResult(raw: string): DetongerJsonCommandResult | undefined {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("{")) {
      return undefined;
    }

    try {
      return JSON.parse(trimmed) as DetongerJsonCommandResult;
    } catch {
      return undefined;
    }
  }

  private normalizeDetongerCommandError(args: string[], error: unknown): Error {
    const nodeError = error as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number | string;
    };
    const stdout = this.toUtf8(nodeError.stdout);
    const stderr = this.toUtf8(nodeError.stderr).trim();
    const json = this.parseDetongerJsonResult(stdout);
    const commandLabel = `detonger ${args.slice(0, 2).join(" ")}`.trim();

    if (json?.status === "error" && json.error?.message) {
      const kind = json.error.kind ? `[${json.error.kind}] ` : "";
      const suffix = stderr ? ` (${stderr})` : "";
      return new Error(`${commandLabel} failed: ${kind}${json.error.message}${suffix}`);
    }

    const baseMessage = error instanceof Error ? error.message : String(error);
    if (stderr) {
      return new Error(`${commandLabel} failed: ${stderr}`);
    }
    if (stdout.trim()) {
      return new Error(`${commandLabel} failed: ${stdout.trim()}`);
    }
    return new Error(`${commandLabel} failed: ${baseMessage}`);
  }

  private async runDetongerCommandWithLogs(
    args: string[],
    options?: {
      timeoutMs?: number;
      logPath?: string;
    }
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      const result = await execFileAsync(this.command, this.detongerArgs(args), {
        cwd: this.repoRoot,
        timeout: options?.timeoutMs
      });
      const stdout = this.toUtf8(result.stdout);
      const stderr = this.toUtf8(result.stderr);
      await this.writeCommandLog(options?.logPath, args, stdout, stderr, true);
      return { stdout, stderr };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException & {
        stdout?: string | Buffer;
        stderr?: string | Buffer;
        killed?: boolean;
        signal?: NodeJS.Signals | null;
      };
      const stdout = this.toUtf8(nodeError.stdout);
      const stderr = this.toUtf8(nodeError.stderr);
      await this.writeCommandLog(options?.logPath, args, stdout, stderr, false);

      if (nodeError.killed && nodeError.signal === "SIGTERM" && options?.timeoutMs) {
        const suffix = options.logPath ? ` Log: ${options.logPath}` : "";
        throw new Error(
          `detonger ${args.slice(0, 2).join(" ")} timed out after ${options.timeoutMs}ms.${suffix}`
        );
      }

      throw this.normalizeDetongerCommandError(args, {
        ...nodeError,
        stdout,
        stderr
      });
    }
  }

  private async writeCommandLog(
    logPath: string | undefined,
    args: string[],
    stdout: string,
    stderr: string,
    ok: boolean
  ): Promise<void> {
    if (!logPath) {
      return;
    }

    const lines = [
      `timestamp=${new Date().toISOString()}`,
      `ok=${ok}`,
      `command=${this.command}`,
      `args=${JSON.stringify(this.detongerArgs(args))}`,
      "--- stdout ---",
      stdout,
      "--- stderr ---",
      stderr
    ];
    await writeFile(logPath, `${lines.join("\n")}\n`, "utf8");
  }

  private mergeScanItems(items: DetongerScanItem[]): DetongerScanItem[] {
    const merged = new Map<string, DetongerScanItem>();

    for (const item of items) {
      const existing = merged.get(item.device);
      if (!existing) {
        merged.set(item.device, item);
        continue;
      }

      merged.set(item.device, {
        device: item.device,
        ...(existing.name ?? item.name ? { name: existing.name ?? item.name ?? null } : {}),
        rssi:
          existing.rssi === undefined || existing.rssi === null
            ? item.rssi ?? null
            : item.rssi === undefined || item.rssi === null
              ? existing.rssi
              : Math.max(existing.rssi, item.rssi)
      });
    }

    return [...merged.values()];
  }

  private async runAggregatedScan(): Promise<DetongerScanItem[]> {
    const rounds = [4, 4, 4];
    const all: DetongerScanItem[] = [];

    for (const timeoutSeconds of rounds) {
      try {
        all.push(...(await this.runScan(timeoutSeconds)));
      } catch (error) {
        if (all.length === 0) {
          throw error;
        }
      }
    }

    return this.mergeScanItems(all);
  }

  private buildPrinter(item: DetongerScanItem): Printer {
    return printerSchema.parse({
      id: item.device,
      ...(item.name ? { name: item.name } : {}),
      ...(item.rssi !== undefined && item.rssi !== null ? { rssi: item.rssi } : {}),
      capabilities: {
        dpi: 203,
        printWidthDots: 384,
        supportedPaperTypes: ["gap", "continuous"],
        colors: ["mono"],
        notes: ["Backed by detonger printer defaults."]
      }
    });
  }

  private rememberPrinters(printers: Printer[]): void {
    const now = Date.now();
    for (const printer of printers) {
      this.printerCache.set(printer.id, { printer, seenAt: now });
    }
  }

  private getCachedPrinters(): Printer[] {
    const now = Date.now();
    const cached: Printer[] = [];

    for (const [id, entry] of this.printerCache.entries()) {
      if (now - entry.seenAt > printerCacheTtlMs) {
        this.printerCache.delete(id);
        continue;
      }
      cached.push(entry.printer);
    }

    return cached.sort(
      (left, right) => (right.rssi ?? Number.NEGATIVE_INFINITY) - (left.rssi ?? Number.NEGATIVE_INFINITY)
    );
  }

  async scanPrinters(): Promise<Printer[]> {
    try {
      const parsed = await this.runAggregatedScan();
      const filtered = parsed.filter((item) =>
        item.name ? printerNamePrefixes.some((prefix) => item.name?.startsWith(prefix)) : false
      );
      if (filtered.length === 0) {
        const cached = this.getCachedPrinters();
        if (cached.length > 0) {
          return cached;
        }
      }
      const printers = filtered
        .map((item) => this.buildPrinter(item))
        .sort((left, right) => (right.rssi ?? Number.NEGATIVE_INFINITY) - (left.rssi ?? Number.NEGATIVE_INFINITY));
      this.rememberPrinters(printers);
      return printers;
    } catch (error) {
      const cached = this.getCachedPrinters();
      if (cached.length > 0) {
        return cached;
      }

      if (!this.mockEnabled) {
        throw error;
      }

      return [
        printerSchema.parse({
          id: "mock-printer",
          name: "Mock Label Printer",
          capabilities: {
            dpi: 203,
            printWidthDots: 384,
            supportedPaperTypes: ["gap", "continuous"],
            colors: ["mono"],
            notes: ["Mock fallback printer while detonger is unavailable."]
          }
        })
      ];
    }
  }

  async probePrinter(printerId: string, printerName?: string): Promise<PrinterProbeResult> {
    if (this.command !== "cargo") {
      return {
        ok: false,
        printerId,
        ...(printerName ? { printerName } : {}),
        stage: "open",
        message: "Printer probe requires cargo-backed detonger workspace.",
        log: [],
        timingsMs: {}
      };
    }

    const args = [
      "run",
      "--quiet",
      "--example",
      "connect_probe",
      "-p",
      "detonger-printer",
      "--",
      printerId,
      "1",
      "scan-each"
    ];

    try {
      const result = await execFileAsync(this.command, args, {
        cwd: this.repoRoot
      });
      return this.parseProbeResult(printerId, printerName, this.toUtf8(result.stdout), this.toUtf8(result.stderr), true);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException & {
        stdout?: string | Buffer;
        stderr?: string | Buffer;
      };
      return this.parseProbeResult(
        printerId,
        printerName,
        this.toUtf8(nodeError.stdout),
        this.toUtf8(nodeError.stderr),
        false
      );
    }
  }

  async printArtifact(printerId: string, artifact: PreviewArtifact): Promise<void> {
    try {
      await this.withPrinterLock(printerId, async () => {
        const packets = await this.encodeArtifactPackets(artifact);
        const args = [
          "print",
          "job",
          "--format",
          "json",
          "--device",
          printerId,
          "--input",
          packets.packetsJsonPath,
          "--input-format",
          "packets-json"
        ];

        const printLogPath = path.join(path.dirname(artifact.pngPath), "print-command.log");
        await this.runDetongerCommandWithLogs(args, {
          timeoutMs: this.printTimeoutMs,
          logPath: printLogPath
        });
      });
    } catch (error) {
      if (!this.mockEnabled) {
        throw error;
      }

      if (printerId !== "mock-printer") {
        throw error;
      }
    }
  }

  async encodeArtifactPackets(artifact: PreviewArtifact): Promise<ArtifactPackets> {
    const packetsJsonPath = this.packetsPathForArtifact(artifact);
    const preferredEncoder = this.packetEncoder();

    if (preferredEncoder === "lpapi") {
      return this.encodeArtifactPacketsWithLpapi(artifact, packetsJsonPath);
    }

    return this.encodeArtifactPacketsWithRust(artifact, packetsJsonPath);
  }

  private packetsPathForArtifact(artifact: PreviewArtifact): string {
    return path.join(path.dirname(artifact.pngPath), "packets.json");
  }

  private async encodeArtifactPacketsWithLpapi(
    artifact: PreviewArtifact,
    packetsJsonPath: string
  ): Promise<ArtifactPackets> {
    const encoded = await encodeArtifactWithLpapiCompact(artifact);
    const packets = encoded.packets.flatMap((packet) =>
      this.splitVendorMessages(Buffer.from(packet, "base64")).map((message) =>
        Buffer.from(message).toString("base64")
      )
    );

    await writeFile(
      packetsJsonPath,
      JSON.stringify(
        {
          packets
        },
        null,
        2
      ) + "\n",
      "utf8"
    );

    const totalBytes = packets.reduce(
      (sum, packet) => sum + Buffer.from(packet, "base64").length,
      0
    );

    return {
      artifactId: artifact.id,
      packetsJsonPath,
      packets,
      packetCount: packets.length,
      totalBytes
    };
  }

  private async encodeArtifactPacketsWithRust(
    artifact: PreviewArtifact,
    packetsJsonPath: string
  ): Promise<ArtifactPackets> {
    const rowsPerChunk = this.rowsPerChunkForArtifact(artifact);
    const args = [
      "preview",
      "packets",
      "--format",
      "json",
      "--png",
      artifact.pngPath,
      "--out",
      packetsJsonPath,
      "--width",
      String(artifact.renderOptions.printWidthDots),
      "--threshold",
      String(artifact.renderOptions.threshold),
      "--x-offset",
      String(artifact.renderOptions.xOffsetDots),
      "--paper-type",
      artifact.renderOptions.paperType
    ];

    if (rowsPerChunk !== undefined) {
      args.push("--rows-per-chunk", String(rowsPerChunk));
    }

    const packetsLogPath = path.join(path.dirname(artifact.pngPath), "packets-command.log");
    await this.runDetongerCommandWithLogs(args, {
      logPath: packetsLogPath
    });

    const raw = await readFile(packetsJsonPath, "utf8");

    const packets = this.parsePacketsJson(raw, packetsJsonPath);
    const totalBytes = packets.reduce(
      (sum, packet) => sum + Buffer.from(packet, "base64").length,
      0
    );

    return {
      artifactId: artifact.id,
      packetsJsonPath,
      packets,
      packetCount: packets.length,
      totalBytes
    };
  }

  private parsePacketsJson(raw: string, packetsJsonPath: string): string[] {
    const parsed = JSON.parse(raw) as { packets?: unknown };
    if (!Array.isArray(parsed.packets) || parsed.packets.length === 0) {
      throw new Error(`Invalid packets json: ${packetsJsonPath}`);
    }

    const packets = parsed.packets.filter(
      (packet): packet is string => typeof packet === "string" && packet.length > 0
    );
    if (packets.length !== parsed.packets.length) {
      throw new Error(`Invalid packets json payload: ${packetsJsonPath}`);
    }

    return packets;
  }

  private parseProbeResult(
    printerId: string,
    printerName: string | undefined,
    stdout: string,
    stderr: string,
    ok: boolean
  ): PrinterProbeResult {
    const log = [...stdout.split(/\r?\n/), ...stderr.split(/\r?\n/)]
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    let stage: PrinterProbeResult["stage"] = "open";
    const timingsMs: PrinterProbeResult["timingsMs"] = {};

    for (const line of log) {
      if (line.includes("stage=open")) {
        stage = "open";
      } else if (line.includes("stage=connect")) {
        stage = "connect";
      } else if (line.includes("stage=discover-service")) {
        stage = "discover_service";
      } else if (line.includes("stage=discover-char")) {
        stage = "discover_characteristic";
      } else if (line.includes("stage=disconnect")) {
        stage = "disconnect";
      }

      const connected = /^round=\d+ connected_after_ms=(\d+)$/.exec(line);
      if (connected) {
        timingsMs.connectMs = Number.parseInt(connected[1] ?? "0", 10);
      }

      const service = /^round=\d+ service_count=\d+ service_after_ms=(\d+)$/.exec(line);
      if (service) {
        timingsMs.discoverServiceMs = Number.parseInt(service[1] ?? "0", 10);
      }

      const characteristic = /^round=\d+ char_count=\d+ char_after_ms=(\d+)$/.exec(line);
      if (characteristic) {
        timingsMs.discoverCharacteristicMs = Number.parseInt(characteristic[1] ?? "0", 10);
      }

      const disconnect = /^round=\d+ disconnected_after_ms=(\d+)$/.exec(line);
      if (disconnect) {
        timingsMs.disconnectMs = Number.parseInt(disconnect[1] ?? "0", 10);
      }
    }

    if (ok) {
      return {
        ok: true,
        printerId,
        ...(printerName ? { printerName } : {}),
        stage: "complete",
        message: "Printer discovery and connect probe succeeded.",
        log,
        timingsMs
      };
    }

    const message = log.at(-1) ?? "Printer probe failed.";
    if (/not found/i.test(message)) {
      stage = "not_found";
    }

    return {
      ok: false,
      printerId,
      ...(printerName ? { printerName } : {}),
      stage,
      message,
      log,
      timingsMs
    };
  }

  private splitVendorMessages(payload: Uint8Array): Uint8Array[] {
    const out: Uint8Array[] = [];
    let index = 0;

    while (index < payload.length) {
      if (payload[index] !== 0x1f) {
        let next = index + 1;
        while (next < payload.length && payload[next] !== 0x1f) {
          next += 1;
        }
        const segment = payload.slice(index, next);
        if (out.length > 0) {
          const last = out[out.length - 1]!;
          const merged = new Uint8Array(last.length + segment.length);
          merged.set(last, 0);
          merged.set(segment, last.length);
          out[out.length - 1] = merged;
        } else {
          out.push(segment);
        }
        index = next;
        continue;
      }

      const dzpkgEnd = this.tryDzpkgEnd(payload, index);
      if (dzpkgEnd !== undefined) {
        out.push(payload.slice(index, dzpkgEnd));
        index = dzpkgEnd;
        continue;
      }

      if (index + 2 >= payload.length) {
        throw new Error(`Truncated command header at offset=${index}`);
      }

      const cmd = payload[index + 1]!;
      const end = this.vendorMessageEnd(payload, index, cmd);
      if (end > payload.length) {
        throw new Error(
          `Truncated cmd=0x${cmd.toString(16)} at offset=${index} need=${end} have=${payload.length}`
        );
      }

      out.push(payload.slice(index, end));
      index = end;
    }

    if (out.length === 0) {
      throw new Error("No messages found in payload");
    }

    return out;
  }

  private tryDzpkgEnd(payload: Uint8Array, index: number): number | undefined {
    if (index + 4 > payload.length || payload[index] !== 0x1f) {
      return undefined;
    }

    const len0 = payload[index + 2]!;
    const [dataLength, lengthLength] =
      len0 >= 0xc0
        ? index + 5 <= payload.length
          ? [((len0 & 0x3f) << 8) | payload[index + 3]!, 2]
          : [NaN, 0]
        : [len0, 1];

    if (!Number.isFinite(dataLength)) {
      return undefined;
    }

    const dataStart = index + 2 + lengthLength;
    const end = dataStart + dataLength + 1;
    if (end > payload.length) {
      return undefined;
    }

    return payload[end - 1] === 0x88 ? end : undefined;
  }

  private vendorMessageEnd(payload: Uint8Array, index: number, cmd: number): number {
    if (cmd === 0x2e) {
      return index + 3;
    }

    if (cmd === 0x2b) {
      if (index + 4 > payload.length) {
        throw new Error(`Truncated 0x2b header at offset=${index}`);
      }
      if (payload[index + 2] === 0x00) {
        return index + 4 + (((payload[index + 2] ?? 0) << 8) | (payload[index + 3] ?? 0));
      }
      return index + 3 + (payload[index + 2] ?? 0);
    }

    if ([0x29, 0x2c, 0x2d, 0x3c, 0x3d].includes(cmd)) {
      return index + 3 + (payload[index + 2] ?? 0);
    }

    return index + 2;
  }

  private lockPathForPrinter(printerId: string): string {
    const safeId = printerId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.lockRoot, `${safeId}.lock`);
  }

  private rowsPerChunkForArtifact(artifact: PreviewArtifact): number | undefined {
    if (this.pngRowsPerChunk !== undefined) {
      return this.pngRowsPerChunk;
    }
    return undefined;
  }

  private resolveRowsPerChunk(): number | undefined {
    const raw = process.env.TUCKMARK_DETONGER_PNG_ROWS_PER_CHUNK?.trim();
    if (!raw) {
      return undefined;
    }

    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid TUCKMARK_DETONGER_PNG_ROWS_PER_CHUNK: ${raw}`);
    }

    return value;
  }

  private resolvePrintTimeoutMs(): number {
    const raw = process.env.TUCKMARK_DETONGER_PRINT_TIMEOUT_MS?.trim();
    if (!raw) {
      return defaultPrintTimeoutMs;
    }

    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid TUCKMARK_DETONGER_PRINT_TIMEOUT_MS: ${raw}`);
    }

    return value;
  }

  private async withPrinterLock<T>(printerId: string, task: () => Promise<T>): Promise<T> {
    await mkdir(this.lockRoot, { recursive: true });
    const lockPath = this.lockPathForPrinter(printerId);
    const deadline = Date.now() + 120_000;
    const staleAfterMs = 5 * 60_000;

    while (true) {
      try {
        const handle = await open(lockPath, "wx");
        try {
          await handle.writeFile(
            JSON.stringify({
              printerId,
              pid: process.pid,
              createdAt: new Date().toISOString()
            }),
            "utf8"
          );
          return await task();
        } finally {
          await handle.close().catch(() => undefined);
          await unlink(lockPath).catch(() => undefined);
        }
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code !== "EEXIST") {
          throw error;
        }

        const info = await stat(lockPath).catch(() => null);
        if (info && Date.now() - info.mtimeMs > staleAfterMs) {
          await rm(lockPath, { force: true }).catch(() => undefined);
          continue;
        }

        if (Date.now() >= deadline) {
          throw new Error(`Printer busy: ${printerId}`);
        }

        await sleep(250);
      }
    }
  }
}
