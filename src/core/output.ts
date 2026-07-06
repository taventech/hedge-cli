// Human tables + a --json passthrough. No deps; monospace-aligned columns.
export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function table(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return "(none)";
  const cols = columns ?? Object.keys(rows[0]);
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd();
  const head = line(cols.map((c) => c.toUpperCase()));
  const body = rows.map((r) => line(cols.map((c) => String(r[c] ?? ""))));
  return [head, ...body].join("\n");
}

export function kv(obj: Record<string, unknown>): string {
  const width = Math.max(...Object.keys(obj).map((k) => k.length));
  return Object.entries(obj)
    .map(([k, v]) => `${k.padEnd(width)}  ${v ?? ""}`)
    .join("\n");
}
