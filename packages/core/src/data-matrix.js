import bwipjs from "bwip-js";
function isRawBitmapSymbol(value) {
    return (typeof value === "object" &&
        value !== null &&
        Array.isArray(value.pixs) &&
        typeof value.pixx === "number" &&
        typeof value.pixy === "number");
}
export function encodeDataMatrix(value) {
    if (value.trim().length === 0) {
        throw new Error("Data Matrix value is required");
    }
    try {
        const raw = bwipjs.raw({
            bcid: "datamatrix",
            text: value,
        });
        const symbol = raw[0];
        if (!isRawBitmapSymbol(symbol)) {
            throw new Error("bwip-js returned no Data Matrix symbol");
        }
        if (symbol.pixx !== symbol.pixy) {
            throw new Error(`Rectangular Data Matrix is not supported (${symbol.pixx}x${symbol.pixy})`);
        }
        return {
            moduleCount: symbol.pixx,
            modules: symbol.pixs.map((module) => Boolean(module)),
        };
    }
    catch (cause) {
        if (cause instanceof Error && cause.message === "Data Matrix value is required") {
            throw cause;
        }
        throw new Error(`Failed to encode Data Matrix: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
}
