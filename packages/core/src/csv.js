import { parse } from "csv-parse/sync";
export function parseCsvRows(csvText) {
    const rows = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true
    });
    return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value ?? ""])));
}
//# sourceMappingURL=csv.js.map