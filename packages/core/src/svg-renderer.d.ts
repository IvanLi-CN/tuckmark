import type { TemplateElement } from "./types.js";
type RenderInput = Record<string, string>;
export declare function escapeXml(value: string): string;
export declare function wrapText(text: string, maxCharsPerLine: number, maxLines?: number): string[];
export declare function estimateCharsPerLine(fontSize: number, width?: number): number;
export declare function buildSvg(width: number, height: number, elements: TemplateElement[], input: RenderInput): string;
export {};
