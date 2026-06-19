import { parse } from "csv-parse/sync";

export function parseCsvRows(csvText: string): Record<string, string>[] {
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as Record<string, string>[];

  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value ?? ""]))
  );
}

