import type { DirectCanvasDefinition, PreviewArtifact, SafeTextLabelInput, TemplateDefinition } from "./types.js";
type RenderInput = Record<string, string>;
export declare function renderTemplateToPreview(template: TemplateDefinition, input: RenderInput, options?: unknown, batchIndex?: number): {
    artifact: PreviewArtifact;
    png: Buffer;
    bitmap: Buffer;
    svg: string;
};
export declare function renderCanvasToPreview(canvas: DirectCanvasDefinition, options?: unknown): {
    artifact: PreviewArtifact;
    png: Buffer;
    bitmap: Buffer;
    svg: string;
};
export declare function renderSafeTextLabelPreview(request: SafeTextLabelInput): {
    artifact: PreviewArtifact;
    png: Buffer;
    bitmap: Buffer;
    svg: string;
};
export {};
