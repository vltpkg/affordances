// how many top-level paragraphs and headings each corpus page writes by the fast path, and why the rest declined:
//   node test/emit-coverage.ts
import { loadCorpus } from '../bench/corpus.ts'
import { emit } from '../src/emit.ts'
import { fastStats } from '../src/emit-convert.ts'
import { parse } from '../src/parse.ts'

for (const page of loadCorpus()) {
  fastStats.taken = 0
  fastStats.declined.clear()
  emit(parse(page.html), { url: page.url ?? 'https://site.test/a' })
  const declined = [...fastStats.declined.values()].reduce((a, b) => a + b, 0)
  const reasons = [...fastStats.declined]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([why, n]) => `${why} ${n}`)
  console.log(
    `${page.name.padEnd(26)} fast ${String(fastStats.taken).padStart(4)}  declined ${String(declined).padStart(4)}  ${reasons.join(', ')}`,
  )
}
