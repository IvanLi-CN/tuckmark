import { mkdir, open, rm, stat, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { printerSchema } from "./types.js";
const execFileAsync = promisify(execFile);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultDetongerRepoRoot = path.resolve(moduleDir, "../../../detonger");
const printerNamePrefixes = ["P2-", "Detonger"];
export class DetongerAdapter {
    command;
    repoRoot;
    mockEnabled;
    lockRoot;
    pngRowsPerChunk;
    constructor(options) {
        this.command = options?.detongerCommand ?? process.env.TUCKMARK_DETONGER_COMMAND ?? "cargo";
        this.repoRoot =
            options?.detongerRepoRoot ??
                process.env.TUCKMARK_DETONGER_REPO_ROOT ??
                defaultDetongerRepoRoot;
        this.mockEnabled = process.env.TUCKMARK_MOCK_PRINTERS !== "0";
        this.lockRoot = path.join(os.tmpdir(), "tuckmark-printer-locks");
        this.pngRowsPerChunk = this.resolveRowsPerChunk();
    }
    detongerArgs(args) {
        if (this.command === "cargo") {
            return ["run", "-q", "-p", "detonger", "--", ...args];
        }
        return args;
    }
    async scanPrinters() {
        try {
            const { stdout } = await execFileAsync(this.command, this.detongerArgs(["scan", "--format", "json"]), {
                cwd: this.repoRoot
            });
            const parsed = JSON.parse(stdout);
            const filtered = parsed.filter((item) => item.name ? printerNamePrefixes.some((prefix) => item.name?.startsWith(prefix)) : false);
            return filtered
                .map((item) => printerSchema.parse({
                id: item.device,
                ...(item.name ? { name: item.name } : {}),
                ...(item.rssi !== undefined ? { rssi: item.rssi } : {}),
                capabilities: {
                    dpi: 203,
                    printWidthDots: 384,
                    supportedPaperTypes: ["gap", "continuous"],
                    colors: ["mono"],
                    notes: ["Backed by detonger printer defaults."]
                }
            }))
                .sort((left, right) => (right.rssi ?? Number.NEGATIVE_INFINITY) - (left.rssi ?? Number.NEGATIVE_INFINITY));
        }
        catch (error) {
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
    async printArtifact(printerId, artifact) {
        try {
            await this.withPrinterLock(printerId, async () => {
                const args = [
                    "print",
                    "png",
                    "--format",
                    "json",
                    "--device",
                    printerId,
                    "--png",
                    artifact.pngPath,
                    "--threshold",
                    String(artifact.renderOptions.threshold),
                    "--x-offset",
                    String(artifact.renderOptions.xOffsetDots),
                    "--paper-type",
                    artifact.renderOptions.paperType
                ];
                if (this.pngRowsPerChunk !== undefined) {
                    args.push("--rows-per-chunk", String(this.pngRowsPerChunk));
                }
                await execFileAsync(this.command, this.detongerArgs(args), {
                    cwd: this.repoRoot
                });
            });
        }
        catch (error) {
            if (!this.mockEnabled) {
                throw error;
            }
            if (printerId !== "mock-printer") {
                throw error;
            }
        }
    }
    lockPathForPrinter(printerId) {
        const safeId = printerId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
        return path.join(this.lockRoot, `${safeId}.lock`);
    }
    resolveRowsPerChunk() {
        const raw = process.env.TUCKMARK_DETONGER_PNG_ROWS_PER_CHUNK?.trim();
        if (!raw) {
            return 32;
        }
        const value = Number.parseInt(raw, 10);
        if (!Number.isFinite(value) || value <= 0) {
            throw new Error(`Invalid TUCKMARK_DETONGER_PNG_ROWS_PER_CHUNK: ${raw}`);
        }
        return value;
    }
    async withPrinterLock(printerId, task) {
        await mkdir(this.lockRoot, { recursive: true });
        const lockPath = this.lockPathForPrinter(printerId);
        const deadline = Date.now() + 120_000;
        const staleAfterMs = 5 * 60_000;
        while (true) {
            try {
                const handle = await open(lockPath, "wx");
                try {
                    await handle.writeFile(JSON.stringify({
                        printerId,
                        pid: process.pid,
                        createdAt: new Date().toISOString()
                    }), "utf8");
                    return await task();
                }
                finally {
                    await handle.close().catch(() => undefined);
                    await unlink(lockPath).catch(() => undefined);
                }
            }
            catch (error) {
                const nodeError = error;
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
//# sourceMappingURL=detonger-adapter.js.map