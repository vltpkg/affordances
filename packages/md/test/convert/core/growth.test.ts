import { afterEach, expect, test } from 'vitest'
import { forcePath, type Path } from '../../../src/convert/path.ts'
import { htmlToMarkdown, readPage } from '../../../src/index.ts'

afterEach(() => {
  forcePath(undefined)
})

// what a page of n of something costs on one path, md-core (strict: it writes the page, never declines) or the tree
// pipeline: the best of three, and what it wrote
const timed = (path: Path, read: () => string) => {
  forcePath(path)
  let best = Infinity
  let written = ''
  for (let run = 0; run < 3; run++) {
    const started = performance.now()
    written = read()
    best = Math.min(best, performance.now() - started)
  }
  return { best, written }
}
// how the time grows with eight times as many, which a loaded machine slows alike: about 8x when it's linear, about
// 64x when each one reads all the others
const grows = (path: Path, read: (n: number) => string) => {
  const small = timed(path, () => read(1000))
  const large = timed(path, () => read(8000))
  return { ratio: large.best / small.best, written: large.written }
}

// whitespace between empty inline elements: what follows each says whether it's kept, found once for the run
const spans = (n: number) =>
  htmlToMarkdown(`<main><p>a${' <span></span>'.repeat(n)} b</p></main>`).markdown
// filled slots, each an empty inline element once filled
const filled = (n: number) => {
  let html = '<main><p>'
  const fills: Record<string, string> = {}
  for (let i = 0; i < n; i++) {
    html += ` <affordances-md data-mode="slot" data-name="s${i}">…</affordances-md>`
    fills[`s${i}`] = `v${i}`
  }
  return readPage(`${html}</p></main>`).markdown(fills).markdown
}
test.each([
  ['md-core', 'strict'],
  ['the tree pipeline', 'hast'],
] as const)(
  'thousands of empty inline elements in a run of whitespace, on %s, in linear time',
  (_, path) => {
    // each whitespace scanned to the end of the run: ~78s at 32000 on the tree pipeline
    const { ratio, written } = grows(path, spans)
    expect(ratio).toBeLessThan(24)
    expect(written).toBe('a b\n')
  },
)
test.each([
  ['md-core', 'strict'],
  ['the tree pipeline', 'hast'],
] as const)('thousands of filled slots, on %s, in linear time', (_, path) => {
  const { ratio, written } = grows(path, filled)
  expect(ratio).toBeLessThan(24)
  expect(written).toMatch(/^v0\n\nv1\n\n[^]*\n\nv7999\n$/)
})

// a table of rows with a slot each: whether the table stands (it's no skeleton) is judged once, not for every slot
const tableSlots = (n: number) => {
  let html = '<main><table><tr><th>Name</th><th>Version</th></tr>'
  const fills: Record<string, string> = {}
  for (let i = 0; i < n; i++) {
    html += `<tr><td>p${i}</td><td><affordances-md data-mode="slot" data-name="s${i}">…</affordances-md></td></tr>`
    fills[`s${i}`] = `${i}.0`
  }
  return readPage(`${html}</table></main>`).markdown(fills).markdown
}
test('thousands of slots in a table, on md-core, in linear time', () => {
  // each slot walked the whole table: ~65s at 16000 rows
  const { ratio, written } = grows('strict', tableSlots)
  expect(ratio).toBeLessThan(24)
  expect(written).toContain('| p7999 | 7999.0  |\n')
})
