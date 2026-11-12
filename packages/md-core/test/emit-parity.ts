// parity of emit(oracle(html)) with @affordances/md's htmlToMarkdown, per page. run with node:
//   node test/emit-parity.ts            every page: exact, or the share of the reference's lines reproduced in order
//   node test/emit-parity.ts <name>     one page's first differing hunks
//   node test/emit-parity.ts --time     emit-only time for the corpus (median of runs, warm)
import { writeFileSync } from 'node:fs'
import { htmlToMarkdown } from '@affordances/md'
import { emit } from '../src/emit.ts'
import type { Document } from '../src/types.ts'
import { oracle } from './support/oracle.ts'
import { corpusPages, fixturePages, similarity } from './emit-pages.ts'

// the first differing hunks, as a unified-ish listing
const hunks = (reference: string, ours: string, count = 6) => {
  const a = reference.split('\n')
  const b = ours.split('\n')
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length && out.length < count * 12) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    // resync: the nearest pair of equal lines ahead
    let best: [number, number] | undefined
    for (let d = 1; d < 400 && !best; d++)
      for (let k = 0; k <= d; k++)
        if (a[i + k] !== undefined && a[i + k] === b[j + d - k] && a[i + k] !== '') {
          best = [i + k, j + d - k]
          break
        }
    const [ni, nj] = best ?? [a.length, b.length]
    out.push(`@@ ref ${i + 1} / ours ${j + 1}`)
    for (let k = Math.max(0, i - 1); k < i; k++) out.push(`  ${a[k]}`)
    for (let k = i; k < Math.min(ni, i + 8); k++) out.push(`- ${a[k]}`)
    for (let k = j; k < Math.min(nj, j + 8); k++) out.push(`+ ${b[k]}`)
    i = ni
    j = nj
  }
  return out.join('\n')
}

const median = (values: number[]) => values.toSorted((a, b) => a - b)[values.length >> 1]!
const args = process.argv.slice(2)
const parser = async (): Promise<(html: string) => Document> =>
  ((await import('../src/parse.ts')) as { parse: (html: string) => Document }).parse
const pages = [...corpusPages(), ...fixturePages()]
if (args[0] === '--time') {
  // emit alone, over documents built once; --runs n, and per page with --pages
  // --parser: documents from src/parse.ts (while it's being written, it may not load), else the oracle's
  const build = args.includes('--parser') ? await parser() : oracle
  const real = corpusPages()
  let corpus = real.map((page) => ({ page, doc: build(page.html) }))
  const count = Number(args[args.indexOf('--runs') + 1]) || 30
  // --cold: fresh documents for every run (built outside the timing), so nothing emit caches on one is reused
  const cold = args.includes('--cold')
  const runs: number[] = []
  const pageTimes = corpus.map(() => [] as number[])
  for (let run = 0; run < count; run++) {
    if (cold && run) corpus = real.map((page) => ({ page, doc: build(page.html) }))
    let total = 0
    corpus.forEach(({ page, doc }, i) => {
      const at = performance.now()
      emit(doc, { url: page.url })
      const took = performance.now() - at
      pageTimes[i]!.push(took)
      total += took
    })
    runs.push(total)
  }
  if (args.includes('--pages'))
    corpus.forEach(({ page }, i) =>
      console.log(`${median(pageTimes[i]!).toFixed(2).padStart(7)} ms  ${page.name}`),
    )
  console.log(
    `emit, corpus total: median ${median(runs).toFixed(2)} ms, min ${Math.min(...runs).toFixed(2)} ms`,
  )
} else if (args[0]) {
  const page = pages.find((p) => p.name === args[0] || p.name.includes(args[0]!))
  if (!page) throw new Error(`no page ${args[0]}`)
  const reference = htmlToMarkdown(page.html, { url: page.url }).markdown
  const ours = emit(oracle(page.html), { url: page.url }).markdown
  // --write <dir>: both outputs, for a diff tool
  if (args[1] === '--write' && args[2]) {
    writeFileSync(`${args[2]}/ref.md`, reference)
    writeFileSync(`${args[2]}/ours.md`, ours)
  }
  console.log(reference === ours ? 'exact' : hunks(reference, ours, Number(args[1]) || 6))
} else {
  let exact = 0
  let fixtures = 0
  for (const page of pages) {
    const reference = htmlToMarkdown(page.html, { url: page.url }).markdown
    const ours = emit(oracle(page.html), { url: page.url }).markdown
    if (!page.corpus) fixtures++
    if (reference === ours) exact++
    // a page that isn't exact never reads 100%, even with every reference line in place
    const share =
      reference === ours
        ? 'exact '
        : `${Math.min(99.9, similarity(reference, ours) * 100)
            .toFixed(1)
            .padStart(5)}%`
    if (page.corpus || reference !== ours) console.log(`${share}  ${page.name}`)
  }
  console.log(
    `${exact}/${pages.length} exact (${pages.length - fixtures} corpus pages, ${fixtures} fixtures)`,
  )
}
