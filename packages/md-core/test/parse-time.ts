// times parse() over the corpus: `node test/parse-time.ts` from the package. each page is parsed warm and timed in
// turn with the others (so no page has the optimizer to itself), and the median of each is reported
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { parse } from '../../md/src/convert/core/parse.ts'

const dir = new URL('../bench/corpus/.cache/', import.meta.url)
if (!existsSync(dir)) throw new Error('no corpus: run the bench fetch first')
const files = readdirSync(dir).filter((file) => file.endsWith('.html'))
const pages = files.map((file) => readFileSync(new URL(file, dir), 'utf8'))
const median = (times: number[]) => times.toSorted((a, b) => a - b)[times.length >> 1]!

for (let i = 0; i < 30; i++) for (const page of pages) parse(page)
const times = pages.map(() => [] as number[])
for (let run = 0; run < 51; run++)
  pages.forEach((page, i) => {
    const start = performance.now()
    parse(page)
    times[i]!.push(performance.now() - start)
  })
const medians = times.map(median)
files.forEach((file, i) =>
  console.log(
    `${medians[i]!.toFixed(2).padStart(6)} ms  ${(pages[i]!.length / 1024).toFixed(0).padStart(4)} KB  ${file}`,
  ),
)
const bytes = pages.reduce((sum, page) => sum + page.length, 0)
console.log(
  `${medians
    .reduce((sum, ms) => sum + ms, 0)
    .toFixed(2)
    .padStart(6)} ms  ${(bytes / 1024).toFixed(0)} KB  total`,
)
