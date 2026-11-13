// output parity: md-core against @affordances/md (the reference) on every corpus page
import { mkdirSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { htmlToMarkdown as reference } from '@affordances/md'
import { filterPages, loadCorpus } from './corpus.ts'
import { table } from './table.ts'

const { values } = parseArgs({
  options: {
    page: { type: 'string' },
    diff: { type: 'string' },
    hunks: { type: 'string', default: '40' },
    write: { type: 'boolean', default: false },
  },
})

const options = { url: 'https://site.test/a' }
const outDir = new URL('./.results/parity/', import.meta.url)

type Convert = (
  html: string,
  o: typeof options,
) => { markdown: string; title?: string; url?: string }
let core: Convert | undefined
let coreFailure = ''
try {
  core = (await import('../../md/src/convert/core/index.ts')).htmlToMarkdown
} catch (error) {
  coreFailure = `import failed: ${(error as Error).message.split('\n')[0]}`
}

// lines as small ints, so the lcs compares numbers, not strings
const intern = (a: string[], b: string[]) => {
  const ids = new Map<string, number>()
  const id = (line: string) => {
    let n = ids.get(line)
    if (n === undefined) ids.set(line, (n = ids.size))
    return n
  }
  return [Int32Array.from(a, id), Int32Array.from(b, id)] as const
}

type Op = { kind: ' ' | '-' | '+'; line: string }

// an lcs over lines with the common prefix and suffix trimmed first: near-identical outputs (the goal) cost almost
// nothing, and the middle is an o(n·m) table of one byte a cell. the reference pages are ~1k lines, so even a fully
// different page is a few mb
const diffLines = (a: string[], b: string[]): { common: number; ops: Op[] } => {
  const [x, y] = intern(a, b)
  let pre = 0
  while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre++
  let suf = 0
  while (
    suf < x.length - pre &&
    suf < y.length - pre &&
    x[x.length - 1 - suf] === y[y.length - 1 - suf]
  )
    suf++
  const n = x.length - pre - suf
  const m = y.length - pre - suf
  // lengths of the lcs of x[i..] and y[j..], two rows at a time; dir records the way back
  const dir = new Uint8Array((n + 1) * (m + 1))
  let next = new Int32Array(m + 1)
  let cur = new Int32Array(m + 1)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const k = i * (m + 1) + j
      if (x[pre + i] === y[pre + j]) {
        cur[j] = next[j + 1]! + 1
        dir[k] = 0
      } else if (next[j]! >= cur[j + 1]!) {
        cur[j] = next[j]!
        dir[k] = 1
      } else {
        cur[j] = cur[j + 1]!
        dir[k] = 2
      }
    }
    ;[next, cur] = [cur, next]
  }
  const ops: Op[] = []
  for (let i = 0; i < pre; i++) ops.push({ kind: ' ', line: a[i]! })
  let i = 0
  let j = 0
  while (i < n && j < m) {
    const d = dir[i * (m + 1) + j]
    if (d === 0) {
      ops.push({ kind: ' ', line: a[pre + i++]! })
      j++
    } else if (d === 1) ops.push({ kind: '-', line: a[pre + i++]! })
    else ops.push({ kind: '+', line: b[pre + j++]! })
  }
  while (i < n) ops.push({ kind: '-', line: a[pre + i++]! })
  while (j < m) ops.push({ kind: '+', line: b[pre + j++]! })
  for (let s = x.length - suf; s < x.length; s++) ops.push({ kind: ' ', line: a[s]! })
  return { common: pre + suf + (next[0] ?? 0), ops }
}

// unified-style hunks with three lines of context
const hunks = (ops: Op[], limit: number) => {
  const context = 3
  const out: string[] = []
  let count = 0
  let k = 0
  // line numbers in the reference (a) and md-core (b) before ops[k]
  const at: [number, number][] = []
  for (let a = 1, b = 1, i = 0; i < ops.length; i++) {
    at.push([a, b])
    if (ops[i]!.kind !== '+') a++
    if (ops[i]!.kind !== '-') b++
  }
  while (k < ops.length && count < limit) {
    while (k < ops.length && ops[k]!.kind === ' ') k++
    if (k >= ops.length) break
    const start = Math.max(0, k - context)
    // extend through every change that's within two contexts of the last one
    let last = k
    for (let i = k; i < ops.length && i - last <= context * 2; i++)
      if (ops[i]!.kind !== ' ') last = i
    const end = Math.min(ops.length, last + 1 + context)
    const slice = ops.slice(start, end)
    const [a, b] = at[start]!
    const aLen = slice.filter((o) => o.kind !== '+').length
    const bLen = slice.filter((o) => o.kind !== '-').length
    out.push(`@@ -${a},${aLen} +${b},${bLen} @@`)
    for (const o of slice) out.push(`${o.kind}${o.line}`)
    count++
    k = end
  }
  const total = (() => {
    let n = 0
    for (let i = 0; i < ops.length; i++)
      if (ops[i]!.kind !== ' ' && (i === 0 || ops[i - 1]!.kind === ' ')) n++
    return n
  })()
  return { text: out.join('\n'), shown: count, total }
}

// rounded down, so a page that isn't exact never shows 100.0%
const floor1 = (n: number) => (Math.floor(n * 10) / 10).toFixed(1)

const pages = filterPages(loadCorpus(), values.page)
if (values.write) mkdirSync(outDir, { recursive: true })

const rows: string[][] = []
let refLines = 0
let common = 0
let exact = 0
let compared = 0
let notImplemented = false
let diffShown = false

for (const page of pages) {
  const ref = reference(page.html, options)
  const file = page.name.replace(/[^a-zA-Z0-9.-]+/g, '_')
  if (values.write) writeFileSync(new URL(`${file}.reference.md`, outDir), ref.markdown)
  const refSplit = ref.markdown.split('\n')
  let got: ReturnType<Convert> | undefined
  let failure = coreFailure
  if (core && !failure) {
    try {
      got = core(page.html, options)
    } catch (error) {
      const message = (error as Error).message.split('\n')[0] ?? String(error)
      failure = message.startsWith('not implemented') ? 'not implemented' : `error: ${message}`
      if (failure === 'not implemented') notImplemented = true
    }
  }
  if (!got) {
    rows.push([page.name, String(refSplit.length), '-', '-', '-', failure])
    continue
  }
  if (values.write) writeFileSync(new URL(`${file}.core.md`, outDir), got.markdown)
  const same = got.markdown === ref.markdown
  const { common: c, ops } = same
    ? { common: refSplit.length, ops: [] as Op[] }
    : diffLines(refSplit, got.markdown.split('\n'))
  const fields = [
    got.title === ref.title
      ? ''
      : `title ${JSON.stringify(got.title)} vs ${JSON.stringify(ref.title)}`,
    got.url === ref.url ? '' : `url ${got.url} vs ${ref.url}`,
  ].filter(Boolean)
  compared++
  refLines += refSplit.length
  common += c
  if (same) exact++
  rows.push([
    page.name,
    String(refSplit.length),
    String(got.markdown.split('\n').length),
    same ? 'yes' : 'no',
    `${floor1((c / refSplit.length) * 100)}%`,
    fields.join('; '),
  ])
  if (values.diff && !same && page.name.toLowerCase().includes(values.diff.toLowerCase())) {
    const h = hunks(ops, Number(values.hunks))
    console.log(`--- ${page.name} (reference)\n+++ ${page.name} (md-core)\n${h.text}`)
    if (h.shown < h.total) console.log(`... ${h.total - h.shown} more hunks`)
    console.log()
    diffShown = true
  }
}

if (values.diff && !diffShown)
  console.log(`no differing page matches '${values.diff}' (or md-core produced nothing to diff)\n`)

console.log(
  table(['page', 'ref lines', 'core lines', 'exact', 'lines kept', 'notes'], rows, ['notes']),
)
console.log(
  compared
    ? `\nparity: ${exact}/${pages.length} exact, ${floor1((common / refLines) * 100)}% of reference lines reproduced in order (over ${compared} page${compared > 1 ? 's' : ''} md-core converted)`
    : `\nparity: n/a, md-core ${notImplemented ? 'not implemented' : coreFailure || 'failed on every page'}`,
)
if (values.write) console.log(`outputs written to ${outDir.pathname}`)
