import { type PreviewArtifact } from "./types.js";
export declare class ArtifactStore {
    readonly root: string;
    constructor(root?: string);
    private previewDir;
    ensure(): Promise<void>;
    writeArtifact(artifact: PreviewArtifact, files: {
        png: Buffer;
        bitmap: Buffer;
        svg: string;
    }): Promise<PreviewArtifact>;
    getArtifact(artifactId: string): Promise<PreviewArtifact>;
    listArtifacts(): Promise<PreviewArtifact[]>;
}
