/**
 * Lightweight CSV Parser
 * Handles quoted fields, escaped commas, multiline fields, and delimiter auto-detection.
 */

export interface ParsedCSV {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

export interface CSVParseOptions {
  delimiter?: string;
  hasHeaders?: boolean;
}

/**
 * Auto-detect the delimiter used in a CSV string.
 * Checks comma, semicolon, tab, and pipe.
 */
export function detectDelimiter(content: string): string {
  const firstLines = content.split('\n').slice(0, 5).join('\n');
  const candidates = [',', ';', '\t', '|'];
  let bestDelimiter = ',';
  let bestCount = 0;

  for (const delim of candidates) {
    // Count occurrences outside of quoted fields
    let count = 0;
    let inQuotes = false;
    for (const char of firstLines) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delim && !inQuotes) {
        count++;
      }
    }
    if (count > bestCount) {
      bestCount = count;
      bestDelimiter = delim;
    }
  }

  return bestDelimiter;
}

/**
 * Parse a CSV string into headers and rows.
 * Handles:
 * - Quoted fields (double-quote enclosed)
 * - Escaped quotes (doubled: "")
 * - Multiline fields within quotes
 * - Various delimiters
 */
export function parseCSV(content: string, options: CSVParseOptions = {}): ParsedCSV {
  const delimiter = options.delimiter ?? detectDelimiter(content);
  const hasHeaders = options.hasHeaders ?? true;

  const rows = parseRows(content, delimiter);

  if (rows.length === 0) {
    return { headers: [], rows: [], delimiter };
  }

  if (hasHeaders) {
    const headers = rows[0] ?? [];
    return { headers, rows: rows.slice(1), delimiter };
  }

  // Generate column headers if none
  const maxCols = Math.max(...rows.map((r) => r.length));
  const headers = Array.from({ length: maxCols }, (_, i) => `Column ${i + 1}`);
  return { headers, rows, delimiter };
}

/**
 * Parse CSV content into an array of rows, each row being an array of field values.
 */
function parseRows(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const char = content[i]!;

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote (doubled)
        if (i + 1 < content.length && content[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        }
        // End of quoted field
        inQuotes = false;
        i++;
        continue;
      }
      currentField += char;
      i++;
      continue;
    }

    // Not in quotes
    if (char === '"' && currentField === '') {
      // Start of quoted field
      inQuotes = true;
      i++;
      continue;
    }

    if (char === delimiter) {
      currentRow.push(currentField);
      currentField = '';
      i++;
      continue;
    }

    if (char === '\r') {
      // Handle \r\n or standalone \r
      if (i + 1 < content.length && content[i + 1] === '\n') {
        i++; // Skip \r, \n will be handled next iteration
      }
      currentRow.push(currentField);
      currentField = '';
      rows.push(currentRow);
      currentRow = [];
      i++;
      continue;
    }

    if (char === '\n') {
      currentRow.push(currentField);
      currentField = '';
      rows.push(currentRow);
      currentRow = [];
      i++;
      continue;
    }

    currentField += char;
    i++;
  }

  // Handle last field/row
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  // Filter out completely empty rows (trailing newlines)
  return rows.filter((row) => !(row.length === 1 && row[0] === ''));
}

