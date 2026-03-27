/** Split a pipe-delimited markdown table row into trimmed cell strings. Returns null if not a table row. */
export function splitTableRow(line) {
  const trimmed = line?.trim();
  if (!trimmed || !trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  // Split on |, drop first and last empty segments
  const parts = trimmed.split("|");
  return parts.slice(1, -1).map((c) => c.trim());
}

/** Returns true if the line is a markdown table separator row (e.g. | --- | :---: | ---: |) */
export function isTableSeparator(line) {
  const cells = splitTableRow(line);
  if (!cells || cells.length === 0) return false;
  return cells.every((c) => /^:?-+:?$/.test(c));
}

/** Parse a markdown table string into headers and rows. Returns null if no valid table found.
 *  Normalizes blank/duplicate headers. Pads short rows, truncates long rows. */
export function parseMarkdownTableData(md) {
  if (!md?.trim()) return null;
  const lines = md.trim().split("\n");

  // Find first table row
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (splitTableRow(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  // Need at least header + separator
  if (start + 1 >= lines.length) return null;
  if (!isTableSeparator(lines[start + 1])) return null;

  const rawHeaders = splitTableRow(lines[start]);
  const colCount = rawHeaders.length;

  // Header normalization: blank → Column N, duplicates → Name 2, Name 3
  const seen = new Map();
  const headers = rawHeaders.map((h, i) => {
    let name = h || `Column ${i + 1}`;
    if (seen.has(name)) {
      const count = seen.get(name) + 1;
      seen.set(name, count);
      name = `${name} ${count}`;
    } else {
      seen.set(name, 1);
    }
    return name;
  });

  // Collect data rows (skip separator at start+1)
  const rows = [];
  for (let i = start + 2; i < lines.length; i++) {
    const cells = splitTableRow(lines[i]);
    if (!cells) break; // end of table
    // Pad/truncate to colCount
    const row = [];
    for (let c = 0; c < colCount; c++) {
      row.push(cells[c] !== undefined ? cells[c] : "");
    }
    rows.push(row);
  }

  return { headers, rows };
}

/** Infer Notion property types from column data. Best-effort heuristics.
 *  Returns Record<string, string> mapping header name to property type. */
export function inferColumnTypes(headers, rows) {
  const types = {};
  for (let col = 0; col < headers.length; col++) {
    const header = headers[col];

    // First column is always title
    if (col === 0) {
      types[header] = "title";
      continue;
    }

    // Collect non-empty values
    const values = rows.map((r) => r[col]).filter((v) => v !== "" && v !== undefined && v !== null);

    if (values.length === 0) {
      types[header] = "rich_text";
      continue;
    }

    // Test in priority order
    if (values.every((v) => /^https?:\/\/.+/.test(v))) {
      types[header] = "url";
    } else if (values.every((v) => /^\d{4}-\d{2}-\d{2}/.test(v))) {
      types[header] = "date";
    } else if (values.every((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))) {
      types[header] = "email";
    } else if (values.every((v) => /^(true|false|yes|no)$/i.test(v))) {
      types[header] = "checkbox";
    } else if (values.every((v) => /^-?\d+(\.\d+)?$/.test(v) && !/^0\d/.test(v))) {
      types[header] = "number";
    } else {
      // Check for select: at least one repeat, unique count <= 10
      const unique = new Set(values);
      if (unique.size <= 10 && unique.size < values.length) {
        types[header] = "select";
      } else {
        types[header] = "rich_text";
      }
    }
  }
  return types;
}
