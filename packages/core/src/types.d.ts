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
export declare const printerProbeStageSchema: z.ZodEnum<{
    not_found: "not_found";
    open: "open";
    connect: "connect";
    discover_service: "discover_service";
    discover_characteristic: "discover_characteristic";
    disconnect: "disconnect";
    complete: "complete";
}>;
export type PrinterProbeStage = z.infer<typeof printerProbeStageSchema>;
export declare const printerProbeTimingsSchema: z.ZodObject<{
    connectMs: z.ZodOptional<z.ZodNumber>;
    discoverServiceMs: z.ZodOptional<z.ZodNumber>;
    discoverCharacteristicMs: z.ZodOptional<z.ZodNumber>;
    disconnectMs: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type PrinterProbeTimings = z.infer<typeof printerProbeTimingsSchema>;
export declare const printerProbeResultSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    printerId: z.ZodString;
    printerName: z.ZodOptional<z.ZodString>;
    stage: z.ZodEnum<{
        not_found: "not_found";
        open: "open";
        connect: "connect";
        discover_service: "discover_service";
        discover_characteristic: "discover_characteristic";
        disconnect: "disconnect";
        complete: "complete";
    }>;
    message: z.ZodString;
    log: z.ZodDefault<z.ZodArray<z.ZodString>>;
    timingsMs: z.ZodDefault<z.ZodObject<{
        connectMs: z.ZodOptional<z.ZodNumber>;
        discoverServiceMs: z.ZodOptional<z.ZodNumber>;
        discoverCharacteristicMs: z.ZodOptional<z.ZodNumber>;
        disconnectMs: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PrinterProbeResult = z.infer<typeof printerProbeResultSchema>;
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
    height: z.ZodOptional<z.ZodNumber>;
    fontSize: z.ZodNumber;
    fontFamily: z.ZodOptional<z.ZodEnum<{
        arial: "arial";
        archivo: "archivo";
        barlow: "barlow";
        "barlow-condensed": "barlow-condensed";
        "bebas-neue": "bebas-neue";
        "courier-new": "courier-new";
        "dm-sans": "dm-sans";
        "exo-2": "exo-2";
        georgia: "georgia";
        "ibm-plex-mono": "ibm-plex-mono";
        "ibm-plex-sans": "ibm-plex-sans";
        "ibm-plex-serif": "ibm-plex-serif";
        inconsolata: "inconsolata";
        inter: "inter";
        "inter-tight": "inter-tight";
        "jetbrains-mono": "jetbrains-mono";
        manrope: "manrope";
        "noto-sans-sc": "noto-sans-sc";
        "noto-serif-sc": "noto-serif-sc";
        oswald: "oswald";
        outfit: "outfit";
        overpass: "overpass";
        "public-sans": "public-sans";
        rajdhani: "rajdhani";
        roboto: "roboto";
        "roboto-condensed": "roboto-condensed";
        "source-sans-3": "source-sans-3";
        "source-serif-4": "source-serif-4";
        "space-grotesk": "space-grotesk";
        "space-mono": "space-mono";
        "times-new-roman": "times-new-roman";
        "trebuchet-ms": "trebuchet-ms";
        verdana: "verdana";
        "work-sans": "work-sans";
        "system-sans": "system-sans";
        "system-serif": "system-serif";
        "system-mono": "system-mono";
    }>>;
    lineHeight: z.ZodOptional<z.ZodNumber>;
    fontWeight: z.ZodDefault<z.ZodEnum<{
        normal: "normal";
        bold: "bold";
    }>>;
    align: z.ZodDefault<z.ZodEnum<{
        left: "left";
        center: "center";
        right: "right";
        justify: "justify";
    }>>;
    justifyAlign: z.ZodOptional<z.ZodEnum<{
        left: "left";
        center: "center";
        right: "right";
    }>>;
    verticalAlign: z.ZodOptional<z.ZodEnum<{
        top: "top";
        middle: "middle";
        bottom: "bottom";
    }>>;
    stretchXGrow: z.ZodOptional<z.ZodBoolean>;
    stretchXShrink: z.ZodOptional<z.ZodBoolean>;
    stretchYGrow: z.ZodOptional<z.ZodBoolean>;
    stretchYShrink: z.ZodOptional<z.ZodBoolean>;
    stretchX: z.ZodOptional<z.ZodBoolean>;
    stretchY: z.ZodOptional<z.ZodBoolean>;
    autoWrap: z.ZodOptional<z.ZodBoolean>;
    adaptiveFontSize: z.ZodOptional<z.ZodBoolean>;
    verticalText: z.ZodOptional<z.ZodBoolean>;
    value: z.ZodOptional<z.ZodString>;
    maxLines: z.ZodOptional<z.ZodNumber>;
    rotation: z.ZodDefault<z.ZodNumber>;
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
    rotation: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export declare const circleElementSchema: z.ZodObject<{
    kind: z.ZodLiteral<"circle">;
    x: z.ZodNumber;
    y: z.ZodNumber;
    size: z.ZodNumber;
    strokeWidth: z.ZodDefault<z.ZodNumber>;
    fill: z.ZodDefault<z.ZodString>;
    stroke: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export declare const triangleElementSchema: z.ZodObject<{
    kind: z.ZodLiteral<"triangle">;
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
    strokeWidth: z.ZodDefault<z.ZodNumber>;
    fill: z.ZodDefault<z.ZodString>;
    stroke: z.ZodDefault<z.ZodString>;
    rotation: z.ZodDefault<z.ZodNumber>;
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
export declare const barcodeElementSchema: z.ZodObject<{
    kind: z.ZodLiteral<"barcode">;
    key: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
    value: z.ZodOptional<z.ZodString>;
    format: z.ZodDefault<z.ZodLiteral<"CODE128">>;
    showValue: z.ZodDefault<z.ZodBoolean>;
    rotation: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export declare const qrElementSchema: z.ZodObject<{
    kind: z.ZodLiteral<"qr">;
    key: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    size: z.ZodNumber;
    value: z.ZodOptional<z.ZodString>;
    errorCorrectionLevel: z.ZodDefault<z.ZodEnum<{
        M: "M";
        L: "L";
        Q: "Q";
        H: "H";
    }>>;
    rotation: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export declare const dataMatrixElementSchema: z.ZodObject<{
    kind: z.ZodLiteral<"datamatrix">;
    key: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    size: z.ZodNumber;
    value: z.ZodOptional<z.ZodString>;
    rotation: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export declare const templateElementSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"text">;
    key: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodOptional<z.ZodNumber>;
    height: z.ZodOptional<z.ZodNumber>;
    fontSize: z.ZodNumber;
    fontFamily: z.ZodOptional<z.ZodEnum<{
        arial: "arial";
        archivo: "archivo";
        barlow: "barlow";
        "barlow-condensed": "barlow-condensed";
        "bebas-neue": "bebas-neue";
        "courier-new": "courier-new";
        "dm-sans": "dm-sans";
        "exo-2": "exo-2";
        georgia: "georgia";
        "ibm-plex-mono": "ibm-plex-mono";
        "ibm-plex-sans": "ibm-plex-sans";
        "ibm-plex-serif": "ibm-plex-serif";
        inconsolata: "inconsolata";
        inter: "inter";
        "inter-tight": "inter-tight";
        "jetbrains-mono": "jetbrains-mono";
        manrope: "manrope";
        "noto-sans-sc": "noto-sans-sc";
        "noto-serif-sc": "noto-serif-sc";
        oswald: "oswald";
        outfit: "outfit";
        overpass: "overpass";
        "public-sans": "public-sans";
        rajdhani: "rajdhani";
        roboto: "roboto";
        "roboto-condensed": "roboto-condensed";
        "source-sans-3": "source-sans-3";
        "source-serif-4": "source-serif-4";
        "space-grotesk": "space-grotesk";
        "space-mono": "space-mono";
        "times-new-roman": "times-new-roman";
        "trebuchet-ms": "trebuchet-ms";
        verdana: "verdana";
        "work-sans": "work-sans";
        "system-sans": "system-sans";
        "system-serif": "system-serif";
        "system-mono": "system-mono";
    }>>;
    lineHeight: z.ZodOptional<z.ZodNumber>;
    fontWeight: z.ZodDefault<z.ZodEnum<{
        normal: "normal";
        bold: "bold";
    }>>;
    align: z.ZodDefault<z.ZodEnum<{
        left: "left";
        center: "center";
        right: "right";
        justify: "justify";
    }>>;
    justifyAlign: z.ZodOptional<z.ZodEnum<{
        left: "left";
        center: "center";
        right: "right";
    }>>;
    verticalAlign: z.ZodOptional<z.ZodEnum<{
        top: "top";
        middle: "middle";
        bottom: "bottom";
    }>>;
    stretchXGrow: z.ZodOptional<z.ZodBoolean>;
    stretchXShrink: z.ZodOptional<z.ZodBoolean>;
    stretchYGrow: z.ZodOptional<z.ZodBoolean>;
    stretchYShrink: z.ZodOptional<z.ZodBoolean>;
    stretchX: z.ZodOptional<z.ZodBoolean>;
    stretchY: z.ZodOptional<z.ZodBoolean>;
    autoWrap: z.ZodOptional<z.ZodBoolean>;
    adaptiveFontSize: z.ZodOptional<z.ZodBoolean>;
    verticalText: z.ZodOptional<z.ZodBoolean>;
    value: z.ZodOptional<z.ZodString>;
    maxLines: z.ZodOptional<z.ZodNumber>;
    rotation: z.ZodDefault<z.ZodNumber>;
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
    rotation: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"circle">;
    x: z.ZodNumber;
    y: z.ZodNumber;
    size: z.ZodNumber;
    strokeWidth: z.ZodDefault<z.ZodNumber>;
    fill: z.ZodDefault<z.ZodString>;
    stroke: z.ZodDefault<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"triangle">;
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
    strokeWidth: z.ZodDefault<z.ZodNumber>;
    fill: z.ZodDefault<z.ZodString>;
    stroke: z.ZodDefault<z.ZodString>;
    rotation: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"line">;
    x1: z.ZodNumber;
    y1: z.ZodNumber;
    x2: z.ZodNumber;
    y2: z.ZodNumber;
    strokeWidth: z.ZodDefault<z.ZodNumber>;
    stroke: z.ZodDefault<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"barcode">;
    key: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
    value: z.ZodOptional<z.ZodString>;
    format: z.ZodDefault<z.ZodLiteral<"CODE128">>;
    showValue: z.ZodDefault<z.ZodBoolean>;
    rotation: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"qr">;
    key: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    size: z.ZodNumber;
    value: z.ZodOptional<z.ZodString>;
    errorCorrectionLevel: z.ZodDefault<z.ZodEnum<{
        M: "M";
        L: "L";
        Q: "Q";
        H: "H";
    }>>;
    rotation: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"datamatrix">;
    key: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    size: z.ZodNumber;
    value: z.ZodOptional<z.ZodString>;
    rotation: z.ZodDefault<z.ZodNumber>;
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
        height: z.ZodOptional<z.ZodNumber>;
        fontSize: z.ZodNumber;
        fontFamily: z.ZodOptional<z.ZodEnum<{
            arial: "arial";
            archivo: "archivo";
            barlow: "barlow";
            "barlow-condensed": "barlow-condensed";
            "bebas-neue": "bebas-neue";
            "courier-new": "courier-new";
            "dm-sans": "dm-sans";
            "exo-2": "exo-2";
            georgia: "georgia";
            "ibm-plex-mono": "ibm-plex-mono";
            "ibm-plex-sans": "ibm-plex-sans";
            "ibm-plex-serif": "ibm-plex-serif";
            inconsolata: "inconsolata";
            inter: "inter";
            "inter-tight": "inter-tight";
            "jetbrains-mono": "jetbrains-mono";
            manrope: "manrope";
            "noto-sans-sc": "noto-sans-sc";
            "noto-serif-sc": "noto-serif-sc";
            oswald: "oswald";
            outfit: "outfit";
            overpass: "overpass";
            "public-sans": "public-sans";
            rajdhani: "rajdhani";
            roboto: "roboto";
            "roboto-condensed": "roboto-condensed";
            "source-sans-3": "source-sans-3";
            "source-serif-4": "source-serif-4";
            "space-grotesk": "space-grotesk";
            "space-mono": "space-mono";
            "times-new-roman": "times-new-roman";
            "trebuchet-ms": "trebuchet-ms";
            verdana: "verdana";
            "work-sans": "work-sans";
            "system-sans": "system-sans";
            "system-serif": "system-serif";
            "system-mono": "system-mono";
        }>>;
        lineHeight: z.ZodOptional<z.ZodNumber>;
        fontWeight: z.ZodDefault<z.ZodEnum<{
            normal: "normal";
            bold: "bold";
        }>>;
        align: z.ZodDefault<z.ZodEnum<{
            left: "left";
            center: "center";
            right: "right";
            justify: "justify";
        }>>;
        justifyAlign: z.ZodOptional<z.ZodEnum<{
            left: "left";
            center: "center";
            right: "right";
        }>>;
        verticalAlign: z.ZodOptional<z.ZodEnum<{
            top: "top";
            middle: "middle";
            bottom: "bottom";
        }>>;
        stretchXGrow: z.ZodOptional<z.ZodBoolean>;
        stretchXShrink: z.ZodOptional<z.ZodBoolean>;
        stretchYGrow: z.ZodOptional<z.ZodBoolean>;
        stretchYShrink: z.ZodOptional<z.ZodBoolean>;
        stretchX: z.ZodOptional<z.ZodBoolean>;
        stretchY: z.ZodOptional<z.ZodBoolean>;
        autoWrap: z.ZodOptional<z.ZodBoolean>;
        adaptiveFontSize: z.ZodOptional<z.ZodBoolean>;
        verticalText: z.ZodOptional<z.ZodBoolean>;
        value: z.ZodOptional<z.ZodString>;
        maxLines: z.ZodOptional<z.ZodNumber>;
        rotation: z.ZodDefault<z.ZodNumber>;
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
        rotation: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"circle">;
        x: z.ZodNumber;
        y: z.ZodNumber;
        size: z.ZodNumber;
        strokeWidth: z.ZodDefault<z.ZodNumber>;
        fill: z.ZodDefault<z.ZodString>;
        stroke: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"triangle">;
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodNumber;
        height: z.ZodNumber;
        strokeWidth: z.ZodDefault<z.ZodNumber>;
        fill: z.ZodDefault<z.ZodString>;
        stroke: z.ZodDefault<z.ZodString>;
        rotation: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"line">;
        x1: z.ZodNumber;
        y1: z.ZodNumber;
        x2: z.ZodNumber;
        y2: z.ZodNumber;
        strokeWidth: z.ZodDefault<z.ZodNumber>;
        stroke: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"barcode">;
        key: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodNumber;
        height: z.ZodNumber;
        value: z.ZodOptional<z.ZodString>;
        format: z.ZodDefault<z.ZodLiteral<"CODE128">>;
        showValue: z.ZodDefault<z.ZodBoolean>;
        rotation: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"qr">;
        key: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        size: z.ZodNumber;
        value: z.ZodOptional<z.ZodString>;
        errorCorrectionLevel: z.ZodDefault<z.ZodEnum<{
            M: "M";
            L: "L";
            Q: "Q";
            H: "H";
        }>>;
        rotation: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"datamatrix">;
        key: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        size: z.ZodNumber;
        value: z.ZodOptional<z.ZodString>;
        rotation: z.ZodDefault<z.ZodNumber>;
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
        height: z.ZodOptional<z.ZodNumber>;
        fontSize: z.ZodNumber;
        fontFamily: z.ZodOptional<z.ZodEnum<{
            arial: "arial";
            archivo: "archivo";
            barlow: "barlow";
            "barlow-condensed": "barlow-condensed";
            "bebas-neue": "bebas-neue";
            "courier-new": "courier-new";
            "dm-sans": "dm-sans";
            "exo-2": "exo-2";
            georgia: "georgia";
            "ibm-plex-mono": "ibm-plex-mono";
            "ibm-plex-sans": "ibm-plex-sans";
            "ibm-plex-serif": "ibm-plex-serif";
            inconsolata: "inconsolata";
            inter: "inter";
            "inter-tight": "inter-tight";
            "jetbrains-mono": "jetbrains-mono";
            manrope: "manrope";
            "noto-sans-sc": "noto-sans-sc";
            "noto-serif-sc": "noto-serif-sc";
            oswald: "oswald";
            outfit: "outfit";
            overpass: "overpass";
            "public-sans": "public-sans";
            rajdhani: "rajdhani";
            roboto: "roboto";
            "roboto-condensed": "roboto-condensed";
            "source-sans-3": "source-sans-3";
            "source-serif-4": "source-serif-4";
            "space-grotesk": "space-grotesk";
            "space-mono": "space-mono";
            "times-new-roman": "times-new-roman";
            "trebuchet-ms": "trebuchet-ms";
            verdana: "verdana";
            "work-sans": "work-sans";
            "system-sans": "system-sans";
            "system-serif": "system-serif";
            "system-mono": "system-mono";
        }>>;
        lineHeight: z.ZodOptional<z.ZodNumber>;
        fontWeight: z.ZodDefault<z.ZodEnum<{
            normal: "normal";
            bold: "bold";
        }>>;
        align: z.ZodDefault<z.ZodEnum<{
            left: "left";
            center: "center";
            right: "right";
            justify: "justify";
        }>>;
        justifyAlign: z.ZodOptional<z.ZodEnum<{
            left: "left";
            center: "center";
            right: "right";
        }>>;
        verticalAlign: z.ZodOptional<z.ZodEnum<{
            top: "top";
            middle: "middle";
            bottom: "bottom";
        }>>;
        stretchXGrow: z.ZodOptional<z.ZodBoolean>;
        stretchXShrink: z.ZodOptional<z.ZodBoolean>;
        stretchYGrow: z.ZodOptional<z.ZodBoolean>;
        stretchYShrink: z.ZodOptional<z.ZodBoolean>;
        stretchX: z.ZodOptional<z.ZodBoolean>;
        stretchY: z.ZodOptional<z.ZodBoolean>;
        autoWrap: z.ZodOptional<z.ZodBoolean>;
        adaptiveFontSize: z.ZodOptional<z.ZodBoolean>;
        verticalText: z.ZodOptional<z.ZodBoolean>;
        value: z.ZodOptional<z.ZodString>;
        maxLines: z.ZodOptional<z.ZodNumber>;
        rotation: z.ZodDefault<z.ZodNumber>;
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
        rotation: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"circle">;
        x: z.ZodNumber;
        y: z.ZodNumber;
        size: z.ZodNumber;
        strokeWidth: z.ZodDefault<z.ZodNumber>;
        fill: z.ZodDefault<z.ZodString>;
        stroke: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"triangle">;
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodNumber;
        height: z.ZodNumber;
        strokeWidth: z.ZodDefault<z.ZodNumber>;
        fill: z.ZodDefault<z.ZodString>;
        stroke: z.ZodDefault<z.ZodString>;
        rotation: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"line">;
        x1: z.ZodNumber;
        y1: z.ZodNumber;
        x2: z.ZodNumber;
        y2: z.ZodNumber;
        strokeWidth: z.ZodDefault<z.ZodNumber>;
        stroke: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"barcode">;
        key: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodNumber;
        height: z.ZodNumber;
        value: z.ZodOptional<z.ZodString>;
        format: z.ZodDefault<z.ZodLiteral<"CODE128">>;
        showValue: z.ZodDefault<z.ZodBoolean>;
        rotation: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"qr">;
        key: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        size: z.ZodNumber;
        value: z.ZodOptional<z.ZodString>;
        errorCorrectionLevel: z.ZodDefault<z.ZodEnum<{
            M: "M";
            L: "L";
            Q: "Q";
            H: "H";
        }>>;
        rotation: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"datamatrix">;
        key: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        size: z.ZodNumber;
        value: z.ZodOptional<z.ZodString>;
        rotation: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>], "kind">>;
}, z.core.$strip>;
export type DirectCanvasDefinition = z.infer<typeof directCanvasSchema>;
export declare const previewSourceSchema: z.ZodEnum<{
    canvas: "canvas";
    template: "template";
    batch_row: "batch_row";
    safe_text: "safe_text";
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
        safe_text: "safe_text";
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
            safe_text: "safe_text";
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
            safe_text: "safe_text";
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
export declare const artifactPacketsSchema: z.ZodObject<{
    artifactId: z.ZodString;
    packetsJsonPath: z.ZodString;
    packets: z.ZodArray<z.ZodString>;
    packetCount: z.ZodNumber;
    totalBytes: z.ZodNumber;
}, z.core.$strip>;
export type ArtifactPackets = z.infer<typeof artifactPacketsSchema>;
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
                safe_text: "safe_text";
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
            height: z.ZodOptional<z.ZodNumber>;
            fontSize: z.ZodNumber;
            fontFamily: z.ZodOptional<z.ZodEnum<{
                arial: "arial";
                archivo: "archivo";
                barlow: "barlow";
                "barlow-condensed": "barlow-condensed";
                "bebas-neue": "bebas-neue";
                "courier-new": "courier-new";
                "dm-sans": "dm-sans";
                "exo-2": "exo-2";
                georgia: "georgia";
                "ibm-plex-mono": "ibm-plex-mono";
                "ibm-plex-sans": "ibm-plex-sans";
                "ibm-plex-serif": "ibm-plex-serif";
                inconsolata: "inconsolata";
                inter: "inter";
                "inter-tight": "inter-tight";
                "jetbrains-mono": "jetbrains-mono";
                manrope: "manrope";
                "noto-sans-sc": "noto-sans-sc";
                "noto-serif-sc": "noto-serif-sc";
                oswald: "oswald";
                outfit: "outfit";
                overpass: "overpass";
                "public-sans": "public-sans";
                rajdhani: "rajdhani";
                roboto: "roboto";
                "roboto-condensed": "roboto-condensed";
                "source-sans-3": "source-sans-3";
                "source-serif-4": "source-serif-4";
                "space-grotesk": "space-grotesk";
                "space-mono": "space-mono";
                "times-new-roman": "times-new-roman";
                "trebuchet-ms": "trebuchet-ms";
                verdana: "verdana";
                "work-sans": "work-sans";
                "system-sans": "system-sans";
                "system-serif": "system-serif";
                "system-mono": "system-mono";
            }>>;
            lineHeight: z.ZodOptional<z.ZodNumber>;
            fontWeight: z.ZodDefault<z.ZodEnum<{
                normal: "normal";
                bold: "bold";
            }>>;
            align: z.ZodDefault<z.ZodEnum<{
                left: "left";
                center: "center";
                right: "right";
                justify: "justify";
            }>>;
            justifyAlign: z.ZodOptional<z.ZodEnum<{
                left: "left";
                center: "center";
                right: "right";
            }>>;
            verticalAlign: z.ZodOptional<z.ZodEnum<{
                top: "top";
                middle: "middle";
                bottom: "bottom";
            }>>;
            stretchXGrow: z.ZodOptional<z.ZodBoolean>;
            stretchXShrink: z.ZodOptional<z.ZodBoolean>;
            stretchYGrow: z.ZodOptional<z.ZodBoolean>;
            stretchYShrink: z.ZodOptional<z.ZodBoolean>;
            stretchX: z.ZodOptional<z.ZodBoolean>;
            stretchY: z.ZodOptional<z.ZodBoolean>;
            autoWrap: z.ZodOptional<z.ZodBoolean>;
            adaptiveFontSize: z.ZodOptional<z.ZodBoolean>;
            verticalText: z.ZodOptional<z.ZodBoolean>;
            value: z.ZodOptional<z.ZodString>;
            maxLines: z.ZodOptional<z.ZodNumber>;
            rotation: z.ZodDefault<z.ZodNumber>;
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
            rotation: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"circle">;
            x: z.ZodNumber;
            y: z.ZodNumber;
            size: z.ZodNumber;
            strokeWidth: z.ZodDefault<z.ZodNumber>;
            fill: z.ZodDefault<z.ZodString>;
            stroke: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"triangle">;
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodNumber;
            height: z.ZodNumber;
            strokeWidth: z.ZodDefault<z.ZodNumber>;
            fill: z.ZodDefault<z.ZodString>;
            stroke: z.ZodDefault<z.ZodString>;
            rotation: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"line">;
            x1: z.ZodNumber;
            y1: z.ZodNumber;
            x2: z.ZodNumber;
            y2: z.ZodNumber;
            strokeWidth: z.ZodDefault<z.ZodNumber>;
            stroke: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"barcode">;
            key: z.ZodString;
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodNumber;
            height: z.ZodNumber;
            value: z.ZodOptional<z.ZodString>;
            format: z.ZodDefault<z.ZodLiteral<"CODE128">>;
            showValue: z.ZodDefault<z.ZodBoolean>;
            rotation: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"qr">;
            key: z.ZodString;
            x: z.ZodNumber;
            y: z.ZodNumber;
            size: z.ZodNumber;
            value: z.ZodOptional<z.ZodString>;
            errorCorrectionLevel: z.ZodDefault<z.ZodEnum<{
                M: "M";
                L: "L";
                Q: "Q";
                H: "H";
            }>>;
            rotation: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"datamatrix">;
            key: z.ZodString;
            x: z.ZodNumber;
            y: z.ZodNumber;
            size: z.ZodNumber;
            value: z.ZodOptional<z.ZodString>;
            rotation: z.ZodDefault<z.ZodNumber>;
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
    printerName: z.ZodOptional<z.ZodString>;
    artifactId: z.ZodString;
}, z.core.$strip>;
export type PrintByArtifactRequest = z.infer<typeof printByArtifactRequestSchema>;
export declare const printBatchRequestSchema: z.ZodObject<{
    printerId: z.ZodString;
    printerName: z.ZodOptional<z.ZodString>;
    artifactIds: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type PrintBatchRequest = z.infer<typeof printBatchRequestSchema>;
export declare const printByTemplateRequestSchema: z.ZodObject<{
    printerId: z.ZodString;
    printerName: z.ZodOptional<z.ZodString>;
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
    printerName: z.ZodOptional<z.ZodString>;
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
            height: z.ZodOptional<z.ZodNumber>;
            fontSize: z.ZodNumber;
            fontFamily: z.ZodOptional<z.ZodEnum<{
                arial: "arial";
                archivo: "archivo";
                barlow: "barlow";
                "barlow-condensed": "barlow-condensed";
                "bebas-neue": "bebas-neue";
                "courier-new": "courier-new";
                "dm-sans": "dm-sans";
                "exo-2": "exo-2";
                georgia: "georgia";
                "ibm-plex-mono": "ibm-plex-mono";
                "ibm-plex-sans": "ibm-plex-sans";
                "ibm-plex-serif": "ibm-plex-serif";
                inconsolata: "inconsolata";
                inter: "inter";
                "inter-tight": "inter-tight";
                "jetbrains-mono": "jetbrains-mono";
                manrope: "manrope";
                "noto-sans-sc": "noto-sans-sc";
                "noto-serif-sc": "noto-serif-sc";
                oswald: "oswald";
                outfit: "outfit";
                overpass: "overpass";
                "public-sans": "public-sans";
                rajdhani: "rajdhani";
                roboto: "roboto";
                "roboto-condensed": "roboto-condensed";
                "source-sans-3": "source-sans-3";
                "source-serif-4": "source-serif-4";
                "space-grotesk": "space-grotesk";
                "space-mono": "space-mono";
                "times-new-roman": "times-new-roman";
                "trebuchet-ms": "trebuchet-ms";
                verdana: "verdana";
                "work-sans": "work-sans";
                "system-sans": "system-sans";
                "system-serif": "system-serif";
                "system-mono": "system-mono";
            }>>;
            lineHeight: z.ZodOptional<z.ZodNumber>;
            fontWeight: z.ZodDefault<z.ZodEnum<{
                normal: "normal";
                bold: "bold";
            }>>;
            align: z.ZodDefault<z.ZodEnum<{
                left: "left";
                center: "center";
                right: "right";
                justify: "justify";
            }>>;
            justifyAlign: z.ZodOptional<z.ZodEnum<{
                left: "left";
                center: "center";
                right: "right";
            }>>;
            verticalAlign: z.ZodOptional<z.ZodEnum<{
                top: "top";
                middle: "middle";
                bottom: "bottom";
            }>>;
            stretchXGrow: z.ZodOptional<z.ZodBoolean>;
            stretchXShrink: z.ZodOptional<z.ZodBoolean>;
            stretchYGrow: z.ZodOptional<z.ZodBoolean>;
            stretchYShrink: z.ZodOptional<z.ZodBoolean>;
            stretchX: z.ZodOptional<z.ZodBoolean>;
            stretchY: z.ZodOptional<z.ZodBoolean>;
            autoWrap: z.ZodOptional<z.ZodBoolean>;
            adaptiveFontSize: z.ZodOptional<z.ZodBoolean>;
            verticalText: z.ZodOptional<z.ZodBoolean>;
            value: z.ZodOptional<z.ZodString>;
            maxLines: z.ZodOptional<z.ZodNumber>;
            rotation: z.ZodDefault<z.ZodNumber>;
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
            rotation: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"circle">;
            x: z.ZodNumber;
            y: z.ZodNumber;
            size: z.ZodNumber;
            strokeWidth: z.ZodDefault<z.ZodNumber>;
            fill: z.ZodDefault<z.ZodString>;
            stroke: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"triangle">;
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodNumber;
            height: z.ZodNumber;
            strokeWidth: z.ZodDefault<z.ZodNumber>;
            fill: z.ZodDefault<z.ZodString>;
            stroke: z.ZodDefault<z.ZodString>;
            rotation: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"line">;
            x1: z.ZodNumber;
            y1: z.ZodNumber;
            x2: z.ZodNumber;
            y2: z.ZodNumber;
            strokeWidth: z.ZodDefault<z.ZodNumber>;
            stroke: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"barcode">;
            key: z.ZodString;
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodNumber;
            height: z.ZodNumber;
            value: z.ZodOptional<z.ZodString>;
            format: z.ZodDefault<z.ZodLiteral<"CODE128">>;
            showValue: z.ZodDefault<z.ZodBoolean>;
            rotation: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"qr">;
            key: z.ZodString;
            x: z.ZodNumber;
            y: z.ZodNumber;
            size: z.ZodNumber;
            value: z.ZodOptional<z.ZodString>;
            errorCorrectionLevel: z.ZodDefault<z.ZodEnum<{
                M: "M";
                L: "L";
                Q: "Q";
                H: "H";
            }>>;
            rotation: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"datamatrix">;
            key: z.ZodString;
            x: z.ZodNumber;
            y: z.ZodNumber;
            size: z.ZodNumber;
            value: z.ZodOptional<z.ZodString>;
            rotation: z.ZodDefault<z.ZodNumber>;
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
