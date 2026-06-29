/**
 * @file _shared/csv.ts
 *
 * Minimal CSV parser shared by the bulk-import Edge Functions.
 * Supports comma-separated values with optional double-quoted
 * fields (quotes escaped as ""). No external dependency needed —
 * the import format is fully controlled by us (admin-authored
 * templates), so a small hand-rolled parser is sufficient.
 *
 * Usage:
 *   const rows = parseCsv(csvText);
 *   // rows[0] === { nama: 'Budi', nip_atau_nik: '123', ... }
 */

function splitCsvLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (inQuotes) {
            if (char === '"') {
                if (line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                current += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            fields.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    fields.push(current.trim());
    return fields;
}

/**
 * Parses CSV text into an array of row objects keyed by header.
 * Blank lines are skipped. Header is the first non-blank line.
 */
export function parseCsv(text: string): Record<string, string>[] {
    const lines = text
        .split(/\r\n|\n|\r/)
        .filter(line => line.trim().length > 0);

    if (lines.length === 0) return [];

    const headers = splitCsvLine(lines[0]).map(h => h.toLowerCase());
    const rows: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
        const values = splitCsvLine(lines[i]);
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
        rows.push(row);
    }

    return rows;
}
