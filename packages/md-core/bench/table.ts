// a plain-text table: the first column left-aligned, the rest right-aligned (they're numbers) unless named in left
export const table = (head: string[], rows: string[][], left: string[] = []) => {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  const line = (cells: string[]) =>
    cells
      .map((c, i) =>
        i === 0 || left.includes(head[i] ?? '')
          ? c.padEnd(widths[i] ?? 0)
          : c.padStart(widths[i] ?? 0),
      )
      .join('  ')
      .trimEnd()
  return [line(head), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n')
}

export const ms = (n: number) => (n < 1 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : n.toFixed(0))

export const kb = (bytes: number) => (bytes / 1024).toFixed(0)

export const pct = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(0)}%`
