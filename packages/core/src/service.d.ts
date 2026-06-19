import { ArtifactStore } from "./artifact-store.js";
import { DetongerAdapter } from "./detonger-adapter.js";
import type { BatchPreviewRequest, BatchPreviewResult, DirectCanvasPreviewRequest, PreviewArtifact, PreviewRequest, PreviewResult, PrintByArtifactRequest, PrintCanvasRequest, PrintByTemplateRequest, PrintBatchRequest, PrintJob, Printer, SafeTextLabelInput, TemplateDefinition } from "./types.js";
export interface TuckmarkServiceOptions {
    artifactStore?: ArtifactStore;
    detonger?: DetongerAdapter;
}
export declare class TuckmarkService {
    readonly artifactStore: ArtifactStore;
    readonly detonger: DetongerAdapter;
    readonly serverSidePrintEnabled: boolean;
    constructor(options?: TuckmarkServiceOptions);
    listTemplates(): Promise<TemplateDefinition[]>;
    private normalizeTemplateInput;
    private ensurePrintable;
    listPrinters(): Promise<Printer[]>;
    previewTemplate(request: PreviewRequest): Promise<PreviewResult>;
    previewCanvas(request: DirectCanvasPreviewRequest): Promise<PreviewResult>;
    previewSafeTextLabel(request: SafeTextLabelInput): Promise<PreviewResult>;
    previewBatch(request: BatchPreviewRequest): Promise<BatchPreviewResult>;
    getArtifact(artifactId: string): Promise<PreviewArtifact>;
    listArtifacts(): Promise<PreviewArtifact[]>;
    private ensureServerSidePrintEnabled;
    printByArtifact(request: PrintByArtifactRequest): Promise<PrintJob>;
    printBatch(request: PrintBatchRequest): Promise<{
        jobs: PrintJob[];
    }>;
    printByTemplate(request: PrintByTemplateRequest): Promise<{
        preview: PreviewResult;
        job: PrintJob;
    }>;
    printCanvas(request: PrintCanvasRequest): Promise<{
        preview: PreviewResult;
        job: PrintJob;
    }>;
    printSafeTextLabel(printerId: string, request: SafeTextLabelInput): Promise<{
        preview: PreviewResult;
        job: PrintJob;
    }>;
}
