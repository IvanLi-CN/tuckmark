import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { previewArtifactSchema, type PreviewArtifact } from "./types.js";

export class ArtifactStore {
  readonly root: string;

  constructor(root?: string) {
    this.root = root ?? path.resolve(process.cwd(), ".tuckmark");
  }

  private previewDir(): string {
    return path.join(this.root, "previews");
  }

  async ensure(): Promise<void> {
    await mkdir(this.previewDir(), { recursive: true });
  }

  async writeArtifact(artifact: PreviewArtifact, files: { png: Buffer; bitmap: Buffer; svg: string }): Promise<PreviewArtifact> {
    await this.ensure();
    const baseDir = path.join(this.previewDir(), artifact.id);
    await mkdir(baseDir, { recursive: true });

    const pngPath = path.join(baseDir, "preview.png");
    const bitmapPath = path.join(baseDir, "bitmap.bin");
    const svgPath = path.join(baseDir, "preview.svg");
    const metaPath = path.join(baseDir, "artifact.json");

    await Promise.all([
      writeFile(pngPath, files.png),
      writeFile(bitmapPath, files.bitmap),
      writeFile(svgPath, files.svg, "utf8")
    ]);

    const materialized = previewArtifactSchema.parse({
      ...artifact,
      pngPath,
      bitmapPath,
      svgPath
    });

    await writeFile(metaPath, JSON.stringify(materialized, null, 2), "utf8");
    return materialized;
  }

  async getArtifact(artifactId: string): Promise<PreviewArtifact> {
    const metaPath = path.join(this.previewDir(), artifactId, "artifact.json");
    const raw = await readFile(metaPath, "utf8");
    return previewArtifactSchema.parse(JSON.parse(raw));
  }

  async listArtifacts(): Promise<PreviewArtifact[]> {
    await this.ensure();
    const entries = await readdir(this.previewDir(), { withFileTypes: true });
    const artifacts = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.getArtifact(entry.name))
    );
    return artifacts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

