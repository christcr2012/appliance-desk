// ---------------------------------------------------------------------------
// Plain CSV writer (2026-09-28) — no library needed for something this
// small. RFC 4180-ish: a field is quoted (and its own quotes doubled)
// only when it contains a comma, quote, or newline, so a normal export
// stays easy to read in a text editor, not every field wrapped in quotes.
// ---------------------------------------------------------------------------

function csvField(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Builds a full CSV document (header row + one row per record) from an
 * array of plain objects and an explicit column list — explicit rather
 * than `Object.keys()` so column order is stable and a caller controls
 * exactly what's exported (e.g. leaving out an internal id). */
export function toCsv<T extends Record<string, unknown>>(
  columns: { key: keyof T; header: string }[],
  rows: T[],
): string {
  const lines = [columns.map((c) => csvField(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvField(row[c.key])).join(","));
  }
  // CRLF is the RFC 4180 convention and what Excel expects without
  // guessing at the line-ending.
  return lines.join("\r\n") + "\r\n";
}
