export declare const TEXT_AVERAGE_GLYPH_WIDTH_RATIO = 0.78;
export type TextFontMetricProfile = {
    space: number;
    cjk: number;
    uppercase: number;
    lowercase: number;
    digit: number;
    punctuation: number;
    symbol: number;
    fallback: number;
};
export declare const textFontPickerFamilies: readonly ["arial", "archivo", "barlow", "barlow-condensed", "bebas-neue", "courier-new", "dm-sans", "exo-2", "georgia", "ibm-plex-mono", "ibm-plex-sans", "ibm-plex-serif", "inconsolata", "inter", "inter-tight", "jetbrains-mono", "manrope", "noto-sans-sc", "noto-serif-sc", "oswald", "outfit", "overpass", "public-sans", "rajdhani", "roboto", "roboto-condensed", "source-sans-3", "source-serif-4", "space-grotesk", "space-mono", "times-new-roman", "trebuchet-ms", "verdana", "work-sans"];
export type TextFontPickerFamily = (typeof textFontPickerFamilies)[number];
export declare const legacyTextFontFamilyAliases: {
    readonly "system-sans": "arial";
    readonly "system-serif": "times-new-roman";
    readonly "system-mono": "courier-new";
};
export type LegacyTextFontFamily = keyof typeof legacyTextFontFamilyAliases;
export declare const textFontFamilies: readonly ["arial", "archivo", "barlow", "barlow-condensed", "bebas-neue", "courier-new", "dm-sans", "exo-2", "georgia", "ibm-plex-mono", "ibm-plex-sans", "ibm-plex-serif", "inconsolata", "inter", "inter-tight", "jetbrains-mono", "manrope", "noto-sans-sc", "noto-serif-sc", "oswald", "outfit", "overpass", "public-sans", "rajdhani", "roboto", "roboto-condensed", "source-sans-3", "source-serif-4", "space-grotesk", "space-mono", "times-new-roman", "trebuchet-ms", "verdana", "work-sans", "system-sans", "system-serif", "system-mono"];
export type TextFontFamily = (typeof textFontFamilies)[number];
export type TextFontDefinition = {
    id: TextFontPickerFamily;
    label: string;
    attributes: readonly string[];
    bundled: boolean;
    supportsCjk: boolean;
    stack: string;
    loadSample: string;
    metricProfile: TextFontMetricProfile;
};
export declare const DEFAULT_TEXT_FONT_FAMILY: TextFontPickerFamily;
export declare const textFontRegistry: {
    label: string;
    bundled: boolean;
    supportsCjk: boolean;
    stack: string;
    loadSample: string;
    metricProfile: TextFontMetricProfile;
    id: "arial" | "archivo" | "barlow" | "barlow-condensed" | "bebas-neue" | "courier-new" | "dm-sans" | "exo-2" | "georgia" | "ibm-plex-mono" | "ibm-plex-sans" | "ibm-plex-serif" | "inconsolata" | "inter" | "inter-tight" | "jetbrains-mono" | "manrope" | "noto-sans-sc" | "noto-serif-sc" | "oswald" | "outfit" | "overpass" | "public-sans" | "rajdhani" | "roboto" | "roboto-condensed" | "source-sans-3" | "source-serif-4" | "space-grotesk" | "space-mono" | "times-new-roman" | "trebuchet-ms" | "verdana" | "work-sans";
    attributes: readonly string[];
}[];
export declare function resolveTextFontFamily(fontFamily?: TextFontFamily): TextFontPickerFamily;
export declare const TEXT_FONT_FAMILY_STACKS: Record<TextFontFamily, string>;
export declare const TEXT_FONT_METRIC_PROFILES: Record<TextFontFamily, TextFontMetricProfile>;
export declare function getTextFontDefinition(fontFamily?: TextFontFamily): TextFontDefinition;
export declare function getTextFontMetricProfile(fontFamily?: TextFontFamily): TextFontMetricProfile;
