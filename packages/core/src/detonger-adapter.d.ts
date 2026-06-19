import { type PreviewArtifact, type Printer } from "./types.js";
export interface DetongerAdapterOptions {
    detongerCommand?: string;
    detongerRepoRoot?: string;
}
export declare class DetongerAdapter {
    private readonly command;
    private readonly repoRoot;
    private readonly mockEnabled;
    private readonly lockRoot;
    private readonly pngRowsPerChunk;
    constructor(options?: DetongerAdapterOptions);
    private detongerArgs;
    scanPrinters(): Promise<Printer[]>;
    printArtifact(printerId: string, artifact: PreviewArtifact): Promise<void>;
    private lockPathForPrinter;
    private resolveRowsPerChunk;
    private withPrinterLock;
}
