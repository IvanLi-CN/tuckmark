export const TEXT_LINE_HEIGHT_RATIO = 1.2;
export const DEFAULT_TEXT_LINE_HEIGHT = TEXT_LINE_HEIGHT_RATIO;
export const TEXT_VISUAL_TOP_TRIM_RATIO = 0.18;
export const TEXT_VISUAL_ASCENT_RATIO = 1 - TEXT_VISUAL_TOP_TRIM_RATIO;
export const TEXT_VISUAL_DESCENT_RATIO = 1 - TEXT_VISUAL_ASCENT_RATIO;
export const TEXT_AVERAGE_GLYPH_WIDTH_RATIO = 0.78;
export const textVerticalAlignments = ["top", "middle", "bottom"];
export const textHorizontalAlignments = ["left", "center", "right", "justify"];
export const textFontFamilies = [
    "system-sans",
    "system-serif",
    "system-mono",
    "arial",
    "noto-sans-sc",
];
export const DEFAULT_TEXT_FONT_FAMILY = "system-sans";
export const DEFAULT_TEXT_VERTICAL_ALIGN = "top";
export const TEXT_FONT_FAMILY_STACKS = {
    "system-sans": "ui-sans-serif, system-ui, sans-serif",
    "system-serif": "ui-serif, Georgia, serif",
    "system-mono": "ui-monospace, SFMono-Regular, Menlo, monospace",
    arial: "Arial, Helvetica, sans-serif",
    "noto-sans-sc": "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
};
export function wrapText(text, maxCharsPerLine, maxLines) {
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
function isCjkOrFullWidth(codePoint) {
    return ((codePoint >= 0x1100 && codePoint <= 0x11ff) ||
        (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
        (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
        (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
        (codePoint >= 0xff01 && codePoint <= 0xff60) ||
        (codePoint >= 0xffe0 && codePoint <= 0xffe6));
}
const TEXT_FONT_METRIC_PROFILES = {
    "system-sans": {
        space: 0.33,
        cjk: 1,
        uppercase: 0.72,
        lowercase: 0.56,
        digit: 0.56,
        punctuation: 0.34,
        symbol: 0.78,
        fallback: TEXT_AVERAGE_GLYPH_WIDTH_RATIO,
    },
    "system-serif": {
        space: 0.32,
        cjk: 1,
        uppercase: 0.74,
        lowercase: 0.54,
        digit: 0.52,
        punctuation: 0.32,
        symbol: 0.74,
        fallback: 0.74,
    },
    "system-mono": {
        space: 0.62,
        cjk: 1,
        uppercase: 0.62,
        lowercase: 0.62,
        digit: 0.62,
        punctuation: 0.62,
        symbol: 0.62,
        fallback: 0.62,
    },
    arial: {
        space: 0.28,
        cjk: 1,
        uppercase: 0.7,
        lowercase: 0.54,
        digit: 0.56,
        punctuation: 0.3,
        symbol: 0.72,
        fallback: 0.72,
    },
    "noto-sans-sc": {
        space: 0.32,
        cjk: 1,
        uppercase: 0.73,
        lowercase: 0.57,
        digit: 0.56,
        punctuation: 0.36,
        symbol: 0.8,
        fallback: 0.8,
    },
};
function getTextFontMetricProfile(fontFamily) {
    return TEXT_FONT_METRIC_PROFILES[fontFamily ?? DEFAULT_TEXT_FONT_FAMILY];
}
function isFinitePositiveNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function getAverageGlyphWidthRatio(fontFamily) {
    const profile = getTextFontMetricProfile(fontFamily);
    return (profile.uppercase + profile.lowercase + profile.digit + profile.symbol) / 4;
}
function estimateGlyphWidthRatio(char, fontFamily) {
    const profile = getTextFontMetricProfile(fontFamily);
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
        return profile.fallback;
    }
    if (/\s/u.test(char)) {
        return profile.space;
    }
    if (isCjkOrFullWidth(codePoint)) {
        return profile.cjk;
    }
    if (/[A-Z]/u.test(char)) {
        return profile.uppercase;
    }
    if (/[a-z]/u.test(char)) {
        return profile.lowercase;
    }
    if (/[0-9]/u.test(char)) {
        return profile.digit;
    }
    if (/[-.,:;'"!?|/\\()[\]{}]/u.test(char)) {
        return profile.punctuation;
    }
    return profile.symbol;
}
export function wrapTextByWidth(text, fontSize, width, maxLines, autoWrap = true, fontFamily, measureText, fontWeight) {
    if (!autoWrap) {
        const lines = text.replaceAll("\r\n", "\n").split("\n");
        return maxLines ? lines.slice(0, maxLines) : lines;
    }
    if (!width) {
        return wrapText(text, 100, maxLines);
    }
    const breakToken = (token) => {
        const parts = [];
        let current = "";
        for (const char of Array.from(token)) {
            const candidate = `${current}${char}`;
            if (current &&
                measureTextAdvanceWidth(candidate, fontSize, fontFamily, measureText, fontWeight) > width) {
                parts.push(current);
                current = char;
            }
            else {
                current = candidate;
            }
        }
        if (current) {
            parts.push(current);
        }
        return parts;
    };
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
            if (measureTextAdvanceWidth(candidate, fontSize, fontFamily, measureText, fontWeight) > width &&
                current) {
                lines.push(current);
                const parts = breakToken(token);
                lines.push(...parts.slice(0, -1));
                current = parts[parts.length - 1] ?? "";
            }
            else if (measureTextAdvanceWidth(candidate, fontSize, fontFamily, measureText, fontWeight) > width) {
                const parts = breakToken(token);
                lines.push(...parts.slice(0, -1));
                current = parts[parts.length - 1] ?? "";
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
export function estimateCharsPerLine(fontSize, width, fontFamily) {
    if (!width) {
        return 100;
    }
    return Math.max(4, Math.floor(width / (fontSize * getAverageGlyphWidthRatio(fontFamily))));
}
export function estimateTextLineWidth(line, fontSize, fontFamily) {
    return Array.from(line).reduce((sum, char) => sum + estimateGlyphWidthRatio(char, fontFamily), 0) * fontSize;
}
function measureTextAdvanceWidth(line, fontSize, fontFamily, measureText, fontWeight) {
    const measured = measureText?.({ text: line, fontSize, fontFamily, fontWeight });
    return isFinitePositiveNumber(measured?.width)
        ? measured.width
        : estimateTextLineWidth(line, fontSize, fontFamily);
}
function getFallbackTextLineMetrics(line, fontSize, fontFamily) {
    const advanceWidth = estimateTextLineWidth(line, fontSize, fontFamily);
    const actualAscent = fontSize * TEXT_VISUAL_ASCENT_RATIO;
    const actualDescent = fontSize * TEXT_VISUAL_DESCENT_RATIO;
    return {
        measured: false,
        advanceWidth,
        visualLeft: 0,
        visualRight: advanceWidth,
        actualAscent,
        actualDescent,
        fontAscent: actualAscent,
        fontDescent: actualDescent,
    };
}
function resolveMeasuredTextLineMetrics(line, input) {
    const fallback = getFallbackTextLineMetrics(line, input.fontSize, input.fontFamily);
    const measured = input.measureText?.({
        text: line,
        fontSize: input.fontSize,
        fontFamily: input.fontFamily,
        fontWeight: input.fontWeight,
    });
    if (!measured || !isFinitePositiveNumber(measured.width)) {
        return fallback;
    }
    const actualAscent = isFinitePositiveNumber(measured.actualBoundingBoxAscent)
        ? measured.actualBoundingBoxAscent
        : fallback.actualAscent;
    const actualDescent = typeof measured.actualBoundingBoxDescent === "number" &&
        Number.isFinite(measured.actualBoundingBoxDescent) &&
        measured.actualBoundingBoxDescent >= 0
        ? measured.actualBoundingBoxDescent
        : fallback.actualDescent;
    const fontAscent = isFinitePositiveNumber(measured.fontBoundingBoxAscent)
        ? measured.fontBoundingBoxAscent
        : actualAscent;
    const fontDescent = typeof measured.fontBoundingBoxDescent === "number" &&
        Number.isFinite(measured.fontBoundingBoxDescent) &&
        measured.fontBoundingBoxDescent >= 0
        ? measured.fontBoundingBoxDescent
        : actualDescent;
    const visualLeft = typeof measured.actualBoundingBoxLeft === "number" &&
        Number.isFinite(measured.actualBoundingBoxLeft)
        ? -measured.actualBoundingBoxLeft
        : fallback.visualLeft;
    const visualRight = typeof measured.actualBoundingBoxRight === "number" &&
        Number.isFinite(measured.actualBoundingBoxRight)
        ? measured.actualBoundingBoxRight
        : measured.width;
    return {
        measured: true,
        advanceWidth: measured.width,
        visualLeft,
        visualRight: Math.max(visualRight, visualLeft + 0.0001),
        actualAscent,
        actualDescent,
        fontAscent,
        fontDescent,
    };
}
function getKonvaLineBaselineOffset(lineHeight, metrics) {
    return (metrics.fontAscent - metrics.fontDescent) / 2 + lineHeight / 2;
}
export function normalizeTextLineHeight(lineHeight) {
    return Math.max(0.7, Math.min(4, lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT));
}
export function getTextNaturalHeight(fontSize, lineCount, lineHeight = DEFAULT_TEXT_LINE_HEIGHT) {
    const normalizedLineHeight = normalizeTextLineHeight(lineHeight);
    return fontSize + (Math.max(1, lineCount) - 1) * fontSize * normalizedLineHeight;
}
export function getTextFontFamilyStack(fontFamily) {
    return TEXT_FONT_FAMILY_STACKS[fontFamily ?? DEFAULT_TEXT_FONT_FAMILY];
}
function getVerticalTextColumns(text, fontSize, height, lineHeightRatio, maxLines, autoWrap = true) {
    const columnCapacity = autoWrap
        ? Math.max(1, Math.floor((height + fontSize * (lineHeightRatio - 1)) / (fontSize * lineHeightRatio)))
        : Number.POSITIVE_INFINITY;
    const columns = [];
    const normalized = text.replaceAll("\r\n", "\n").split("\n");
    for (const chunk of normalized) {
        const chars = Array.from(chunk);
        if (chars.length === 0) {
            columns.push("");
            continue;
        }
        for (let index = 0; index < chars.length; index += columnCapacity) {
            columns.push(chars.slice(index, index + columnCapacity).join(""));
        }
    }
    const visibleColumns = maxLines ? columns.slice(0, maxLines) : columns;
    return visibleColumns.length > 0 ? visibleColumns : [""];
}
export function resolveTextLayout(input) {
    const verticalText = input.verticalText ?? false;
    const lineHeightRatio = normalizeTextLineHeight(input.lineHeight);
    const lines = verticalText
        ? getVerticalTextColumns(input.text, input.fontSize, input.height, lineHeightRatio, input.maxLines, input.autoWrap ?? true)
        : wrapTextByWidth(input.text, input.fontSize, input.width, input.maxLines, input.autoWrap ?? true, input.fontFamily, input.measureText, input.fontWeight);
    const renderedLines = lines.length > 0 ? lines : [""];
    const lineHeight = input.fontSize * lineHeightRatio;
    const renderHeight = verticalText
        ? Math.max(...renderedLines.map((line) => Array.from(line).length), 1) * lineHeight
        : lineHeight * renderedLines.length;
    const lineMetrics = renderedLines.map((line) => resolveMeasuredTextLineMetrics(line, input));
    const fontMetrics = resolveMeasuredTextLineMetrics("M", input);
    const hasMeasuredMetrics = !verticalText && fontMetrics.measured && lineMetrics.every((metrics) => metrics.measured);
    const baselineOffset = getKonvaLineBaselineOffset(lineHeight, fontMetrics);
    const visualLeft = verticalText ? 0 : Math.min(...lineMetrics.map((metrics) => metrics.visualLeft));
    const visualRight = verticalText
        ? input.fontSize
        : Math.max(...lineMetrics.map((metrics) => metrics.visualRight));
    const visualTop = verticalText
        ? 0
        : Math.min(...lineMetrics.map((metrics, index) => baselineOffset + index * lineHeight - metrics.actualAscent));
    const visualBottom = verticalText
        ? renderHeight
        : Math.max(...lineMetrics.map((metrics, index) => baselineOffset + index * lineHeight + metrics.actualDescent));
    const naturalWidth = verticalText
        ? getTextNaturalHeight(input.fontSize, renderedLines.length, lineHeightRatio)
        : hasMeasuredMetrics
            ? Math.max(visualRight - visualLeft, input.fontSize * 0.6)
            : Math.max(...lineMetrics.map((metrics) => metrics.advanceWidth), input.fontSize * 0.6);
    const naturalHeight = verticalText
        ? getTextNaturalHeight(input.fontSize, Math.max(...renderedLines.map((line) => Array.from(line).length), 1), lineHeightRatio)
        : hasMeasuredMetrics
            ? Math.max(visualBottom - visualTop, input.fontSize * 0.1)
            : getTextNaturalHeight(input.fontSize, renderedLines.length, lineHeightRatio);
    const contentWidth = (input.align ?? "left") === "justify" && !verticalText ? input.width : naturalWidth;
    const contentHeight = naturalHeight;
    const scaleX = input.stretchX ? input.width / Math.max(contentWidth, 0.0001) : 1;
    const scaleY = input.stretchY ? input.height / Math.max(contentHeight, 0.0001) : 1;
    const alignedX = (() => {
        if (input.stretchX || ((input.align ?? "left") === "justify" && !verticalText)) {
            return 0;
        }
        switch (input.align ?? "left") {
            case "center":
                return (input.width - naturalWidth) / 2;
            case "right":
                return input.width - naturalWidth;
            case "justify":
            case "left":
                return 0;
        }
    })();
    const alignedY = (() => {
        if (input.stretchY) {
            return 0;
        }
        switch (input.verticalAlign ?? DEFAULT_TEXT_VERTICAL_ALIGN) {
            case "middle":
                return (input.height - naturalHeight) / 2;
            case "bottom":
                return input.height - naturalHeight;
            case "top":
                return 0;
        }
    })();
    const lineLayouts = verticalText
        ? []
        : renderedLines.map((line, index) => {
            const metrics = lineMetrics[index] ?? getFallbackTextLineMetrics(line, input.fontSize, input.fontFamily);
            const width = metrics.advanceWidth;
            const glyphCount = Array.from(line).length;
            const letterSpacing = (input.align ?? "left") === "justify" && glyphCount > 1 && width < input.width
                ? (input.width - width) / (glyphCount - 1)
                : 0;
            return {
                text: line,
                x: hasMeasuredMetrics ? -visualLeft : 0,
                y: hasMeasuredMetrics
                    ? baselineOffset - visualTop + index * lineHeight
                    : input.fontSize * TEXT_VISUAL_ASCENT_RATIO + index * lineHeight,
                width,
                letterSpacing,
            };
        });
    const glyphs = verticalText
        ? renderedLines.flatMap((line, columnIndex) => Array.from(line).map((char, rowIndex) => ({
            text: char,
            x: columnIndex * lineHeight + input.fontSize / 2,
            y: rowIndex * lineHeight,
        })))
        : [];
    return {
        lines: renderedLines,
        lineLayouts,
        glyphs,
        verticalText,
        lineHeight,
        renderHeight,
        naturalWidth,
        naturalHeight,
        contentX: alignedX,
        contentY: alignedY,
        contentWidth,
        contentHeight,
        textOffsetX: hasMeasuredMetrics ? -visualLeft : 0,
        textOffsetY: hasMeasuredMetrics ? -visualTop : -input.fontSize * TEXT_VISUAL_TOP_TRIM_RATIO,
        baselineOffsetY: hasMeasuredMetrics
            ? baselineOffset - visualTop
            : input.fontSize * TEXT_VISUAL_ASCENT_RATIO,
        scaleX,
        scaleY,
    };
}
//# sourceMappingURL=text-layout.js.map
