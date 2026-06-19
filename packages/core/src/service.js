import { randomUUID } from "node:crypto";
import { ArtifactStore } from "./artifact-store.js";
import { parseCsvRows } from "./csv.js";
import { DetongerAdapter } from "./detonger-adapter.js";
import { renderCanvasToPreview, renderSafeTextLabelPreview, renderTemplateToPreview } from "./renderer.js";
import { getTemplateById, presetTemplates } from "./template-library.js";
export class TuckmarkService {
    artifactStore;
    detonger;
    serverSidePrintEnabled;
    constructor(options) {
        this.artifactStore = options?.artifactStore ?? new ArtifactStore();
        this.detonger = options?.detonger ?? new DetongerAdapter();
        this.serverSidePrintEnabled = process.env.TUCKMARK_ENABLE_SERVER_SIDE_PRINT === "1";
    }
    async listTemplates() {
        return presetTemplates;
    }
    normalizeTemplateInput(template, input) {
        const resolved = {};
        for (const field of template.fields) {
            const raw = input[field.key] ?? field.defaultValue ?? "";
            const value = raw.trim();
            if (field.required && value.length === 0) {
                throw new Error(`Missing required field: ${field.key}`);
            }
            resolved[field.key] = raw;
        }
        for (const [key, value] of Object.entries(input)) {
            if (!(key in resolved)) {
                resolved[key] = value;
            }
        }
        return resolved;
    }
    ensurePrintable(caps, artifact) {
        if (artifact.width > caps.printWidthDots) {
            throw new Error(`Artifact width ${artifact.width} exceeds printer width ${caps.printWidthDots}`);
        }
        if (!caps.supportedPaperTypes.includes(artifact.renderOptions.paperType)) {
            throw new Error(`Printer does not support paper type: ${artifact.renderOptions.paperType}`);
        }
    }
    async listPrinters() {
        return this.detonger.scanPrinters();
    }
    async previewTemplate(request) {
        const template = getTemplateById(request.templateId);
        const normalizedInput = this.normalizeTemplateInput(template, request.input);
        const rendered = renderTemplateToPreview(template, normalizedInput, request.renderOptions);
        const artifact = await this.artifactStore.writeArtifact(rendered.artifact, {
            png: rendered.png,
            bitmap: rendered.bitmap,
            svg: rendered.svg
        });
        return { artifact };
    }
    async previewCanvas(request) {
        const rendered = renderCanvasToPreview(request.canvas, request.renderOptions);
        const artifact = await this.artifactStore.writeArtifact(rendered.artifact, {
            png: rendered.png,
            bitmap: rendered.bitmap,
            svg: rendered.svg
        });
        return { artifact };
    }
    async previewSafeTextLabel(request) {
        const rendered = renderSafeTextLabelPreview(request);
        const artifact = await this.artifactStore.writeArtifact(rendered.artifact, {
            png: rendered.png,
            bitmap: rendered.bitmap,
            svg: rendered.svg
        });
        return { artifact };
    }
    async previewBatch(request) {
        const template = getTemplateById(request.templateId);
        const rows = parseCsvRows(request.csvText);
        const items = [];
        for (const [index, row] of rows.entries()) {
            const normalizedInput = this.normalizeTemplateInput(template, row);
            const rendered = renderTemplateToPreview(template, normalizedInput, request.renderOptions, index);
            const artifact = await this.artifactStore.writeArtifact(rendered.artifact, {
                png: rendered.png,
                bitmap: rendered.bitmap,
                svg: rendered.svg
            });
            items.push({ index, input: row, artifact });
        }
        return {
            templateId: template.id,
            total: items.length,
            items
        };
    }
    async getArtifact(artifactId) {
        return this.artifactStore.getArtifact(artifactId);
    }
    async listArtifacts() {
        return this.artifactStore.listArtifacts();
    }
    ensureServerSidePrintEnabled() {
        if (!this.serverSidePrintEnabled) {
            throw new Error("Server-side printer control is disabled. Use Web preview + browser Bluetooth print, or set TUCKMARK_ENABLE_SERVER_SIDE_PRINT=1 to opt in.");
        }
    }
    async printByArtifact(request) {
        this.ensureServerSidePrintEnabled();
        const artifact = await this.getArtifact(request.artifactId);
        const printers = await this.listPrinters();
        const printer = printers.find((item) => item.id === request.printerId);
        if (printer) {
            this.ensurePrintable(printer.capabilities, artifact);
        }
        await this.detonger.printArtifact(request.printerId, artifact);
        return {
            id: randomUUID(),
            artifactId: artifact.id,
            printerId: request.printerId,
            createdAt: new Date().toISOString(),
            status: "completed"
        };
    }
    async printBatch(request) {
        this.ensureServerSidePrintEnabled();
        const jobs = [];
        for (const artifactId of request.artifactIds) {
            jobs.push(await this.printByArtifact({ printerId: request.printerId, artifactId }));
        }
        return { jobs };
    }
    async printByTemplate(request) {
        this.ensureServerSidePrintEnabled();
        const preview = await this.previewTemplate({
            templateId: request.templateId,
            input: request.input,
            renderOptions: request.renderOptions
        });
        const job = await this.printByArtifact({
            printerId: request.printerId,
            artifactId: preview.artifact.id
        });
        return { preview, job };
    }
    async printCanvas(request) {
        this.ensureServerSidePrintEnabled();
        const preview = await this.previewCanvas({
            canvas: request.canvas,
            renderOptions: request.renderOptions
        });
        const job = await this.printByArtifact({
            printerId: request.printerId,
            artifactId: preview.artifact.id
        });
        return { preview, job };
    }
    async printSafeTextLabel(printerId, request) {
        this.ensureServerSidePrintEnabled();
        const preview = await this.previewSafeTextLabel(request);
        const job = await this.printByArtifact({
            printerId,
            artifactId: preview.artifact.id
        });
        return { preview, job };
    }
}
//# sourceMappingURL=service.js.map