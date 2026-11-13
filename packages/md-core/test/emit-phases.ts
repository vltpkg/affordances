// where emit's time goes, phase by phase, over the corpus: node test/emit-phases.ts
import { convertRoot, startConvert } from '../../md/src/convert/core/emit-convert.ts'
import { toMarkdown } from '../../md/src/convert/core/emit-markdown.ts'
import { begin, findMain, made, setPage } from '../../md/src/convert/core/emit-prune.ts'
import type { Document } from '../../md/src/convert/core/types.ts'
import { oracle } from '../../md/test/convert/core/support/oracle.ts'
import { corpusPages } from '../../md/test/convert/core/emit-pages.ts'

// --parser: documents from md's src/convert/core/parse.ts, else the oracle's
const build = process.argv.includes('--parser')
  ? ((await import('../../md/src/convert/core/parse.ts')) as { parse: (html: string) => Document })
      .parse
  : oracle
const corpus = corpusPages().map((page) => ({ page, doc: build(page.html) }))
// per phase, the fastest whole-corpus run: other work on the machine only ever adds time
const best = { main: Infinity, convert: Infinity, markdown: Infinity }
const runs = Number(process.argv[2]) || 100
for (let run = 0; run < runs; run++) {
  const totals = { main: 0, convert: 0, markdown: 0 }
  for (const { page, doc } of corpus) {
    let at = performance.now()
    begin(false)
    setPage(doc.root)
    const main = findMain(doc.mains)
    if (!main) begin(true)
    totals.main += performance.now() - at
    at = performance.now()
    startConvert({ url: page.url }, page.url)
    const root = convertRoot(main ? made(doc.root, [main], '#root') : doc.root)
    totals.convert += performance.now() - at
    at = performance.now()
    toMarkdown(root)
    totals.markdown += performance.now() - at
  }
  for (const phase of ['main', 'convert', 'markdown'] as const)
    best[phase] = Math.min(best[phase], totals[phase])
}
for (const [phase, total] of Object.entries(best))
  console.log(`${phase.padEnd(9)} ${total.toFixed(2)} ms`)
