/** Normalize ID: 32-char hex → hyphenated UUID, already-hyphenated unchanged, idempotent */
export function normalizeId(id) {
  if (!id || typeof id !== "string") return id;
  const clean = id.replace(/-/g, "");
  if (clean.length !== 32) return id;
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
}

/** Sanitize filename: max 50 chars, alphanumeric/spaces/hyphens only */
export function safeName(str) {
  return str
    .replace(/[^\w\s-]/g, "")
    .trim()
    .slice(0, 50)
    .trim();
}

/** Escape a value for CSV: quote, double-escape inner quotes, replace newlines */
export function csvEscape(value) {
  const str = String(value ?? "");
  return `"${str.replace(/"/g, '""').replace(/[\r\n]+/g, " ")}"`;
}
