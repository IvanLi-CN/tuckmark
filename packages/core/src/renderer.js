import { randomUUID } from "node:crypto";
import { Resvg } from "@resvg/resvg-js";
import { renderOptionsSchema, safeTextLabelSchema } from "./types.js";
function escapeXml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&apos;");
}
function wrapText(text, maxCharsPerLine, maxLines) {
    const normalized = text.replaceAll("\r\n", "\n").split("\n");
    const lines = [];
    for (const chunk of normalized) {
        if (chunk.length === 0) {
            lines.push("");
            continue;
        }
        let current = "";
        for (const token of chunk.split(/\s+/)) {
            const candidate = current ? `${current} ${token}` : token;
            if (candidate.length > maxCharsPerLine && current) {
                lines.push(current);
                current = token;
            }
            else {
                current = candidate;
            }
        }
        if (current) {
            lines.push(current);
        }
    }
    return maxLines ? lines.slice(0, maxLines) : lines;
}
function estimateCharsPerLine(fontSize, width) {
    if (!width) {
        return 100;
    }
    return Math.max(4, Math.floor(width / (fontSize * 0.6)));
}
function renderTextElement(element, input) {
    const resolved = element.value ?? input[element.key] ?? "";
    const escaped = escapeXml(resolved);
    const lines = wrapText(escaped, estimateCharsPerLine(element.fontSize, element.width), element.maxLines);
    const anchor = element.align === "center"
        ? "middle"
        : element.align === "right"
            ? "end"
            : "start";
    const x = element.align === "center" && element.width
        ? element.x + element.width / 2
        : element.align === "right" && element.width
            ? element.x + element.width
            : element.x;
    return lines
        .map((line, index) => {
        const y = element.y + index * (element.fontSize + 4);
        return `<text x="${x}" y="${y}" font-size="${element.fontSize}" font-weight="${element.fontWeight}" text-anchor="${anchor}" font-family="ui-sans-serif, system-ui, sans-serif" fill="#111111">${line}</text>`;
    })
        .join("");
}
function renderElement(element, input) {
    switch (element.kind) {
        case "text":
            return renderTextElement(element, input);
        case "rect":
            return `<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="${element.radius}" ry="${element.radius}" fill="${element.fill}" stroke="${element.stroke}" stroke-width="${element.strokeWidth}" />`;
        case "line":
            return `<line x1="${element.x1}" y1="${element.y1}" x2="${element.x2}" y2="${element.y2}" stroke="${element.stroke}" stroke-width="${element.strokeWidth}" />`;
    }
}
function buildSvg(width, height, elements, input) {
    return [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        `<rect width="${width}" height="${height}" fill="white" />`,
        elements.map((element) => renderElement(element, input)).join(""),
        `</svg>`
    ].join("");
}
function renderSvgToPng(svg) {
    const resvg = new Resvg(svg, {
        fitTo: {
            mode: "original"
        }
    });
    return Buffer.from(resvg.render().asPng());
}
function createPreviewArtifactBase(params) {
    const base = {
        id: randomUUID(),
        source: params.source,
        name: params.name,
        createdAt: new Date().toISOString(),
        renderOptions: params.renderOptions,
        input: params.input,
        pngPath: "",
        bitmapPath: "",
        svgPath: "",
        width: params.width,
        height: params.height
    };
    if (params.templateId) {
        base.templateId = params.templateId;
    }
    if (params.batchIndex !== undefined) {
        base.batchIndex = params.batchIndex;
    }
    return base;
}
function thresholdPngToBitmap(png, width, height) {
    const header = Buffer.from(`BITMAP:${width}x${height}\n`, "utf8");
    return Buffer.concat([header, png]);
}
export function renderTemplateToPreview(template, input, options, batchIndex) {
    const renderOptions = renderOptionsSchema.parse(options ?? {});
    const svg = buildSvg(template.width, template.height, template.elements, input);
    const png = renderSvgToPng(svg);
    const bitmap = thresholdPngToBitmap(png, template.width, template.height);
    const artifactArgs = {
        source: batchIndex === undefined ? "template" : "batch_row",
        name: template.name,
        templateId: template.id,
        renderOptions,
        input,
        width: template.width,
        height: template.height
    };
    if (batchIndex !== undefined) {
        artifactArgs.batchIndex = batchIndex;
    }
    const artifact = createPreviewArtifactBase(artifactArgs);
    return { artifact, png, bitmap, svg };
}
export function renderCanvasToPreview(canvas, options) {
    const renderOptions = renderOptionsSchema.parse(options ?? {});
    const svg = buildSvg(canvas.width, canvas.height, canvas.elements, {});
    const png = renderSvgToPng(svg);
    const bitmap = thresholdPngToBitmap(png, canvas.width, canvas.height);
    const artifact = createPreviewArtifactBase({
        source: "canvas",
        name: canvas.name,
        renderOptions,
        input: {},
        width: canvas.width,
        height: canvas.height
    });
    return { artifact, png, bitmap, svg };
}
export function renderSafeTextLabelPreview(request) {
    const parsedRequest = {
        ...request,
        renderOptions: {
            ...request.renderOptions,
            paperType: "continuous"
        }
    };
    const normalizedRequest = safeTextLabelSchema.parse(parsedRequest);
    const renderOptions = renderOptionsSchema.parse(normalizedRequest.renderOptions);
    const width = renderOptions.printWidthDots;
    const lineHeight = 34;
    const horizontalPadding = 16;
    const verticalPadding = 16;
    const text = normalizedRequest.text.trimEnd() || "Tuckmark";
    const maxChars = Math.max(8, Math.floor((width - horizontalPadding * 2) / (24 * 0.6)));
    const lines = wrapText(escapeXml(text), maxChars, 4);
    const height = Math.max(64, verticalPadding * 2 + lines.length * lineHeight);
    const elements = lines.map((line, index) => ({
        kind: "text",
        key: `line-${index + 1}`,
        value: line,
        x: horizontalPadding,
        y: verticalPadding + 24 + index * lineHeight,
        width: width - horizontalPadding * 2,
        fontSize: 24,
        fontWeight: "normal",
        align: "left",
        maxLines: 1
    }));
    const svg = buildSvg(width, height, elements, {});
    const png = renderSvgToPng(svg);
    const bitmap = thresholdPngToBitmap(png, width, height);
    const artifact = createPreviewArtifactBase({
        source: "template",
        name: normalizedRequest.title,
        templateId: "safe-text-label",
        renderOptions,
        input: { text },
        width,
        height
    });
    return { artifact, png, bitmap, svg };
}
//# sourceMappingURL=renderer.js.map