import { afterEach, expect, test } from 'vitest'
import { forcePath, type Path } from '../../../src/convert/path.ts'
import { htmlToMarkdown, readPage } from '../../../src/index.ts'
import { onBoth } from './support/paths.ts'

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
const grows = (path: Path, read: (n: number) => string, n = 1000) => {
  const small = timed(path, () => read(n))
  const large = timed(path, () => read(8 * n))
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

// thousands of tabs that share an id, in tablists, with a shown panel they label: md-core kept every tab by its id,
// copying the list for each one, and never read it. it writes the page as the tree pipeline does
test('thousands of tabs with one id read on md-core as the tree pipeline reads them', () => {
  const tabs = '<button role="tab" id="t">Tab</button>'.repeat(4000)
  const html = `<main><div role="tablist">${tabs}</div><section role="tabpanel" data-affordances-md="show" aria-labelledby="t">Panel</section></main>`
  const { core, tree, declined } = onBoth(() => readPage(html).markdown().markdown, 'strict')
  expect(declined).toEqual([])
  expect(core).toBe(tree)
  expect(core).toContain('**Tab**\n\nPanel')
})

// a rowspan down every row: GFM's grid pads each row with the cells spanned into it, n×n from 2n cells (~16M, out of
// memory, at 4000 rows). past four times the table's cells, and 64 more, the table is its cells as text, on both paths
test.each([
  ['md-core', 'strict'],
  ['the tree pipeline', 'hast'],
] as const)(
  'a table whose spans would make a grid far bigger than it is written as text, on %s',
  (_, path) => {
    const rows = 4000
    let html = '<main><table>'
    for (let i = 0; i < rows; i++)
      html += `<tr><td rowspan="${rows}">${i}</td><td colspan="3">x</td></tr>`
    forcePath(path)
    const { markdown } = htmlToMarkdown(`${html}</table></main>`)
    expect(markdown.length).toBeLessThan(10 * rows)
    expect(markdown).toMatch(/^0\n\nx\n\n1\n\nx\n\n[^]*\n\n3999\n\nx\n$/)
  },
)
// a small one still is a grid: spans pad it, within the limit
test('a table whose spans pad it a little is still a grid, on both paths', () => {
  const html =
    '<main><table><tr><th>a</th><th>b</th><th>c</th></tr><tr><td rowspan="3">r</td><td colspan="2">wide</td></tr><tr><td>1</td></tr><tr><td>2</td></tr></table></main>'
  const { core, tree } = onBoth(() => htmlToMarkdown(html).markdown, 'strict')
  expect(core).toBe(tree)
  expect(core).toBe(
    '| a | b    | c |\n| - | ---- | - |\n| r | wide |   |\n|   | 1    |   |\n|   | 2    |   |\n',
  )
})

// a run of text between comments, or between inline elements Markdown has no node for: toMdast's last pass joined each
// to the one before by splicing the list, ~11s at 64000 between comments. the tree pipeline joins them first
const between = (split: string) => (n: number) =>
  htmlToMarkdown(
    `<main><p>${Array.from({ length: n }, (_, i) => `a${i}${split}`).join('')}</p></main>`,
  ).markdown
test.each([
  ['comments', '<!-- c -->'],
  ['inline elements', '<span>b</span>'],
])('a run of text between thousands of %s, on the tree pipeline, in linear time', (_, split) => {
  const { ratio, written } = grows('hast', between(split), 2000)
  expect(ratio).toBeLessThan(24)
  expect(written).toMatch(split.startsWith('<!') ? /^a0a1a2[^]*a15999\n$/ : /^a0ba1b[^]*a15999b\n$/)
})
