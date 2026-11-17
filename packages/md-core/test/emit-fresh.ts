// emit on fresh trees, as bench/run.ts times it: a pool of parsed documents, each emitted once. prints, per page,
// the best of several pool medians (other work on the machine only ever adds time): node test/emit-fresh.ts [page]
import { loadCorpus } from '../bench/corpus.ts'
import { emit } from '../../md/src/convert/core/emit.ts'
import { parse } from '../../md/src/convert/core/parse.ts'

const want = process.argv[2]
const gc = (globalThis as { gc?: () => void }).gc
let total = 0
for (const page of loadCorpus().filter((p) => !want || p.name.includes(want))) {
  let best = Infinity
  for (let round = 0; round < 3; round++) {
    const docs = Array.from({ length: 15 }, () => parse(page.html))
    gc?.()
    const times = docs.map((doc) => {
      const start = performance.now()
      emit(doc, { url: 'https://site.test/a' })
      return performance.now() - start
    })
    best = Math.min(best, times.toSorted((a, b) => a - b)[times.length >> 1]!)
  }
  total += best
  console.log(`${best.toFixed(2).padStart(7)} ms  ${page.name}`)
}
console.log(`${total.toFixed(2).padStart(7)} ms  total`)
