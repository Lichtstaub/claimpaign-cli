export class UsageError extends Error {}

export function print(value: unknown, opts: { json: boolean }): void {
  if (opts.json) {
    process.stdout.write(JSON.stringify(value, null, 2) + '\n');
    return;
  }
  if (typeof value === 'string') process.stdout.write(value + '\n');
  else process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

/** Plain aligned table for terminals, one object per row, keys become headers. */
export function table(rows: Record<string, string | number>[]): string {
  if (rows.length === 0) return '(none)';
  const keys = Object.keys(rows[0]);
  const widths = keys.map(k => Math.max(k.length, ...rows.map(r => String(r[k] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  return [line(keys), line(widths.map(w => '-'.repeat(w))), ...rows.map(r => line(keys.map(k => String(r[k] ?? ''))))].join('\n');
}
