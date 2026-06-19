import { z } from "zod";
export declare const paperTypeSchema: z.ZodEnum<{
    continuous: "continuous";
    gap: "gap";
}>;
export type PaperType = z.infer<typeof paperTypeSchema>;
export declare const renderOptionsSchema: z.ZodObject<{
    printWidthDots: z.ZodDefault<z.ZodNumber>;
    threshold: z.ZodDefault<z.ZodNumber>;
    xOffsetDots: z.ZodDefault<z.ZodNumber>;
    paperType: z.ZodDefault<z.ZodEnum<{
        continuous: "continuous";
        gap: "gap";
    }>>;
    previewScale: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type RenderOptions = z.infer<typeof renderOptionsSchema>;
export declare const printerCapabilitiesSchema: z.ZodObject<{
    dpi: z.ZodDefault<z.ZodNumber>;
    printWidthDots: z.ZodDefault<z.ZodNumber>;
    supportedPaperTypes: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        continuous: "continuous";
        gap: "gap";
    }>>>;
    colors: z.ZodDefault<z.ZodArray<z.ZodString>>;
    notes: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type PrinterCapabilities = z.infer<typeof printerCapabilitiesSchema>;
export declare const printerSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    rssi: z.ZodOptional<z.ZodNumber>;
    capabilities: z.ZodObject<{
        dpi: z.ZodDefault<z.ZodNumber>;
        printWidthDots: z.ZodDefault<z.ZodNumber>;
        supportedPaperTypes: z.ZodDefault<z.ZodArray<z.ZodEnum<{
            continuous: "continuous";
            gap: "gap";
        }>>>;
        colors: z.ZodDefault<z.ZodArray<z.ZodString>>;
        notes: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type Printer = z.infer<typeof printerSchema>;
export declare const templateFieldSchema: z.ZodObject<{
    key: z.ZodString;
    label: z.ZodString;
    placeholder: z.ZodOptional<z.ZodString>;
    required: z.ZodDefault<z.ZodBoolean>;
    multiline: z.ZodDefault<z.ZodBoolean>;
    defaultValue: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type TemplateField = z.infer<typeof templateFieldSchema>;
export declare const textElementSchema: z.ZodObject<{
    kind: z.ZodLiteral<"text">;
    key: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodOptional<z.ZodNumber>;
    fontSize: z.ZodNumber;
    fontWeight: z.ZodDefault<z.ZodEnum<{
        normal: "normal";
        bold: "bold";
    }>>;
    align: z.ZodDefault<z.ZodEnum<{
        left: "left";
        center: "center";
        right: "right";
    }>>;
    value: z.ZodOptional<z.ZodString>;
    maxLines: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const rectElementSchema: z.ZodObject<{
    kind: z.ZodLiteral<"rect">;
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
    strokeWidth: z.ZodDefault<z.ZodNumber>;
    fill: z.ZodDefault<z.ZodString>;
    stroke: z.ZodDefault<z.ZodString>;
    radius: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export declare const lineElementSchema: z.ZodObject<{
    kind: z.ZodLiteral<"line">;
    x1: z.ZodNumber;
    y1: z.ZodNumber;
    x2: z.ZodNumber;
    y2: z.ZodNumber;
    strokeWidth: z.ZodDefault<z.ZodNumber>;
    stroke: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export declare const templateElementSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"text">;
    key: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodOptional<z.ZodNumber>;
    fontSize: z.ZodNumber;
    fontWeight: z.ZodDefault<z.ZodEnum<{
        normal: "normal";
        bold: "bold";
    }>>;
    align: z.ZodDefault<z.ZodEnum<{
        left: "left";
        center: "center";
        right: "right";
    }>>;
    value: z.ZodOptional<z.ZodString>;
    maxLines: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"rect">;
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
    strokeWidth: z.ZodDefault<z.ZodNumber>;
    fill: z.ZodDefault<z.ZodString>;
    stroke: z.ZodDefault<z.ZodString>;
    radius: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"line">;
    x1: z.ZodNumber;
    y1: z.ZodNumber;
    x2: z.ZodNumber;
    y2: z.ZodNumber;
    strokeWidth: z.ZodDefault<z.ZodNumber>;
    stroke: z.ZodDefault<z.ZodString>;
}, z.core.$strip>], "kind">;
export type TemplateElement = z.infer<typeof templateElementSchema>;
export declare const templateSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodDefault<z.ZodString>;
    width: z.ZodNumber;
    height: z.ZodNumber;
    fields: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        label: z.ZodString;
        placeholder: z.ZodOptional<z.ZodString>;
        required: z.ZodDefault<z.ZodBoolean>;
        multiline: z.ZodDefault<z.ZodBoolean>;
        defaultValue: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    elements: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"text">;
        key: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodOptional<z.ZodNumber>;
        fontSize: z.ZodNumber;
        fontWeight: z.ZodDefault<z.ZodEnum<{
            normal: "normal";
            bold: "bold";
        }>>;
        align: z.ZodDefault<z.ZodEnum<{
            left: "left";
            center: "center";
            right: "right";
        }>>;
        value: z.ZodOptional<z.ZodString>;
        maxLines: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"rect">;
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodNumber;
        height: z.ZodNumber;
        strokeWidth: z.ZodDefault<z.ZodNumber>;
        fill: z.ZodDefault<z.ZodString>;
        stroke: z.ZodDefault<z.ZodString>;
        radius: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"line">;
        x1: z.ZodNumber;
        y1: z.ZodNumber;
        x2: z.ZodNumber;
        y2: z.ZodNumber;
        strokeWidth: z.ZodDefault<z.ZodNumber>;
        stroke: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>], "kind">>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type TemplateDefinition = z.infer<typeof templateSchema>;
export declare const directCanvasSchema: z.ZodObject<{
    id: z.ZodDefault<z.ZodString>;
    name: z.ZodDefault<z.ZodString>;
    width: z.ZodNumber;
    height: z.ZodNumber;
    elements: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"text">;
        key: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodOptional<z.ZodNumber>;
        fontSize: z.ZodNumber;
        fontWeight: z.ZodDefault<z.ZodEnum<{
            normal: "normal";
            bold: "bold";
        }>>;
        align: z.ZodDefault<z.ZodEnum<{
            left: "left";
            center: "center";
            right: "right";
        }>>;
        value: z.ZodOptional<z.ZodString>;
        maxLines: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"rect">;
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodNumber;
        height: z.ZodNumber;
        strokeWidth: z.ZodDefault<z.ZodNumber>;
        fill: z.ZodDefault<z.ZodString>;
        stroke: z.ZodDefault<z.ZodString>;
        radius: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"line">;
        x1: z.ZodNumber;
        y1: z.ZodNumber;
        x2: z.ZodNumber;
        y2: z.ZodNumber;
        strokeWidth: z.ZodDefault<z.ZodNumber>;
        stroke: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>], "kind">>;
}, z.core.$strip>;
export type DirectCanvasDefinition = z.infer<typeof directCanvasSchema>;
export declare const previewSourceSchema: z.ZodEnum<{
    canvas: "canvas";
    template: "template";
    batch_row: "batch_row";
}>;
export type PreviewSource = z.infer<typeof previewSourceSchema>;
export declare const safeTextLabelSchema: z.ZodObject<{
    text: z.ZodString;
    title: z.ZodDefault<z.ZodString>;
    renderOptions: z.ZodDefault<z.ZodObject<{
        printWidthDots: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        threshold: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        xOffsetDots: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        paperType: z.ZodOptional<z.ZodDefault<z.ZodEnum<{
            continuous: "continuous";
            gap: "gap";
        }>>>;
        previewScale: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type SafeTextLabelRequest = z.infer<typeof safeTextLabelSchema>;
export type SafeTextLabelInput = z.input<typeof safeTextLabelSchema>;
export declare const previewArtifactSchema: z.ZodObject<{
    id: z.ZodString;
    source: z.ZodEnum<{
        canvas: "canvas";
        template: "template";
        batch_row: "batch_row";
    }>;
    name: z.ZodString;
    templateId: z.ZodOptional<z.ZodString>;
    batchIndex: z.ZodOptional<z.ZodNumber>;
    createdAt: z.ZodString;
    renderOptions: z.ZodObject<{
        printWidthDots: z.ZodDefault<z.ZodNumber>;
        threshold: z.ZodDefault<z.ZodNumber>;
        xOffsetDots: z.ZodDefault<z.ZodNumber>;
        paperType: z.ZodDefault<z.ZodEnum<{
            continuous: "continuous";
            gap: "gap";
        }>>;
        previewScale: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>;
    input: z.ZodRecord<z.ZodString, z.ZodString>;
    pngPath: z.ZodString;
    bitmapPath: z.ZodString;
    svgPath: z.ZodString;
    width: z.ZodNumber;
    height: z.ZodNumber;
}, z.core.$strip>;
export type PreviewArtifact = z.infer<typeof previewArtifactSchema>;
export declare const previewBatchItemSchema: z.ZodObject<{
    index: z.ZodNumber;
    input: z.ZodRecord<z.ZodString, z.ZodString>;
    artifact: z.ZodObject<{
        id: z.ZodString;
        source: z.ZodEnum<{
            canvas: "canvas";
            template: "template";
            batch_row: "batch_row";
        }>;
        name: z.ZodString;
        templateId: z.ZodOptional<z.ZodString>;
        batchIndex: z.ZodOptional<z.ZodNumber>;
        createdAt: z.ZodString;
        renderOptions: z.ZodObject<{
            printWidthDots: z.ZodDefault<z.ZodNumber>;
            threshold: z.ZodDefault<z.ZodNumber>;
            xOffsetDots: z.ZodDefault<z.ZodNumber>;
            paperType: z.ZodDefault<z.ZodEnum<{
                continuous: "continuous";
                gap: "gap";
            }>>;
            previewScale: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>;
        input: z.ZodRecord<z.ZodString, z.ZodString>;
        pngPath: z.ZodString;
        bitmapPath: z.ZodString;
        svgPath: z.ZodString;
        width: z.ZodNumber;
        height: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
export type PreviewBatchItem = z.infer<typeof previewBatchItemSchema>;
export declare const previewResultSchema: z.ZodObject<{
    artifact: z.ZodObject<{
        id: z.ZodString;
        source: z.ZodEnum<{
            canvas: "canvas";
            template: "template";
            batch_row: "batch_row";
        }>;
        name: z.ZodString;
        templateId: z.ZodOptional<z.ZodString>;
        batchIndex: z.ZodOptional<z.ZodNumber>;
        createdAt: z.ZodString;
        renderOptions: z.ZodObject<{
            printWidthDots: z.ZodDefault<z.ZodNumber>;
            threshold: z.ZodDefault<z.ZodNumber>;
            xOffsetDots: z.ZodDefault<z.ZodNumber>;
            paperType: z.ZodDefault<z.ZodEnum<{
                continuous: "continuous";
                gap: "gap";
            }>>;
            previewScale: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>;
        input: z.ZodRecord<z.ZodString, z.ZodString>;
        pngPath: z.ZodString;
        bitmapPath: z.ZodString;
        svgPath: z.ZodString;
        width: z.ZodNumber;
        height: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
export type PreviewResult = z.infer<typeof previewResultSchema>;
export declare const batchPreviewResultSchema: z.ZodObject<{
    templateId: z.ZodString;
    total: z.ZodNumber;
    items: z.ZodArray<z.ZodObject<{
        index: z.ZodNumber;
        input: z.ZodRecord<z.ZodString, z.ZodString>;
        artifact: z.ZodObject<{
            id: z.ZodString;
            source: z.ZodEnum<{
                canvas: "canvas";
                template: "template";
                batch_row: "batch_row";
            }>;
            name: z.ZodString;
            templateId: z.ZodOptional<z.ZodString>;
            batchIndex: z.ZodOptional<z.ZodNumber>;
            createdAt: z.ZodString;
            renderOptions: z.ZodObject<{
                printWidthDots: z.ZodDefault<z.ZodNumber>;
                threshold: z.ZodDefault<z.ZodNumber>;
                xOffsetDots: z.ZodDefault<z.ZodNumber>;
                paperType: z.ZodDefault<z.ZodEnum<{
                    continuous: "continuous";
                    gap: "gap";
                }>>;
                previewScale: z.ZodDefault<z.ZodNumber>;
            }, z.core.$strip>;
            input: z.ZodRecord<z.ZodString, z.ZodString>;
            pngPath: z.ZodString;
            bitmapPath: z.ZodString;
            svgPath: z.ZodString;
            width: z.ZodNumber;
            height: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type BatchPreviewResult = z.infer<typeof batchPreviewResultSchema>;
export declare const printJobSchema: z.ZodObject<{
    id: z.ZodString;
    artifactId: z.ZodString;
    printerId: z.ZodString;
    createdAt: z.ZodString;
    status: z.ZodEnum<{
        queued: "queued";
        completed: "completed";
        failed: "failed";
    }>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type PrintJob = z.infer<typeof printJobSchema>;
export declare const previewRequestSchema: z.ZodObject<{
    templateId: z.ZodString;
    input: z.ZodRecord<z.ZodString, z.ZodString>;
    renderOptions: z.ZodOptional<z.ZodObject<{
        printWidthDots: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        threshold: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        xOffsetDots: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        paperType: z.ZodOptional<z.ZodDefault<z.ZodEnum<{
            continuous: "continuous";
            gap: "gap";
        }>>>;
        previewScale: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PreviewRequest = z.infer<typeof previewRequestSchema>;
export declare const batchPreviewRequestSchema: z.ZodObject<{
    templateId: z.ZodString;
    csvText: z.ZodString;
    renderOptions: z.ZodOptional<z.ZodObject<{
        printWidthDots: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        threshold: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        xOffsetDots: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        paperType: z.ZodOptional<z.ZodDefault<z.ZodEnum<{
            continuous: "continuous";
            gap: "gap";
        }>>>;
        previewScale: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type BatchPreviewRequest = z.infer<typeof batchPreviewRequestSchema>;
export declare const directCanvasPreviewRequestSchema: z.ZodObject<{
    canvas: z.ZodObject<{
        id: z.ZodDefault<z.ZodString>;
        name: z.ZodDefault<z.ZodString>;
        width: z.ZodNumber;
        height: z.ZodNumber;
        elements: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"text">;
            key: z.ZodString;
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodOptional<z.ZodNumber>;
            fontSize: z.ZodNumber;
            fontWeight: z.ZodDefault<z.ZodEnum<{
                normal: "normal";
                bold: "bold";
            }>>;
            align: z.ZodDefault<z.ZodEnum<{
                left: "left";
                center: "center";
                right: "right";
            }>>;
            value: z.ZodOptional<z.ZodString>;
            maxLines: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"rect">;
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodNumber;
            height: z.ZodNumber;
            strokeWidth: z.ZodDefault<z.ZodNumber>;
            fill: z.ZodDefault<z.ZodString>;
            stroke: z.ZodDefault<z.ZodString>;
            radius: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"line">;
            x1: z.ZodNumber;
            y1: z.ZodNumber;
            x2: z.ZodNumber;
            y2: z.ZodNumber;
            strokeWidth: z.ZodDefault<z.ZodNumber>;
            stroke: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>], "kind">>;
    }, z.core.$strip>;
    renderOptions: z.ZodOptional<z.ZodObject<{
        printWidthDots: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        threshold: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        xOffsetDots: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        paperType: z.ZodOptional<z.ZodDefault<z.ZodEnum<{
            continuous: "continuous";
            gap: "gap";
        }>>>;
        previewScale: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type DirectCanvasPreviewRequest = z.infer<typeof directCanvasPreviewRequestSchema>;
export declare const printByArtifactRequestSchema: z.ZodObject<{
    printerId: z.ZodString;
    artifactId: z.ZodString;
}, z.core.$strip>;
export type PrintByArtifactRequest = z.infer<typeof printByArtifactRequestSchema>;
export declare const printBatchRequestSchema: z.ZodObject<{
    printerId: z.ZodString;
    artifactIds: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type PrintBatchRequest = z.infer<typeof printBatchRequestSchema>;
export declare const printByTemplateRequestSchema: z.ZodObject<{
    printerId: z.ZodString;
    templateId: z.ZodString;
    input: z.ZodRecord<z.ZodString, z.ZodString>;
    renderOptions: z.ZodOptional<z.ZodObject<{
        printWidthDots: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        threshold: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        xOffsetDots: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        paperType: z.ZodOptional<z.ZodDefault<z.ZodEnum<{
            continuous: "continuous";
            gap: "gap";
        }>>>;
        previewScale: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PrintByTemplateRequest = z.infer<typeof printByTemplateRequestSchema>;
export declare const printCanvasRequestSchema: z.ZodObject<{
    printerId: z.ZodString;
    canvas: z.ZodObject<{
        id: z.ZodDefault<z.ZodString>;
        name: z.ZodDefault<z.ZodString>;
        width: z.ZodNumber;
        height: z.ZodNumber;
        elements: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"text">;
            key: z.ZodString;
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodOptional<z.ZodNumber>;
            fontSize: z.ZodNumber;
            fontWeight: z.ZodDefault<z.ZodEnum<{
                normal: "normal";
                bold: "bold";
            }>>;
            align: z.ZodDefault<z.ZodEnum<{
                left: "left";
                center: "center";
                right: "right";
            }>>;
            value: z.ZodOptional<z.ZodString>;
            maxLines: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"rect">;
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodNumber;
            height: z.ZodNumber;
            strokeWidth: z.ZodDefault<z.ZodNumber>;
            fill: z.ZodDefault<z.ZodString>;
            stroke: z.ZodDefault<z.ZodString>;
            radius: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"line">;
            x1: z.ZodNumber;
            y1: z.ZodNumber;
            x2: z.ZodNumber;
            y2: z.ZodNumber;
            strokeWidth: z.ZodDefault<z.ZodNumber>;
            stroke: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>], "kind">>;
    }, z.core.$strip>;
    renderOptions: z.ZodOptional<z.ZodObject<{
        printWidthDots: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        threshold: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        xOffsetDots: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        paperType: z.ZodOptional<z.ZodDefault<z.ZodEnum<{
            continuous: "continuous";
            gap: "gap";
        }>>>;
        previewScale: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PrintCanvasRequest = z.infer<typeof printCanvasRequestSchema>;
