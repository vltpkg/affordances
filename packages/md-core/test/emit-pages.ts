import { existsSync, readdirSync, readFileSync } from 'node:fs'

// the pages emit is measured on: the benchmark corpus (real pages, cached by bench/fetch.ts, maybe absent) and
// @affordances/md's fixtures, each with the url it's converted against
export type Page = { name: string; html: string; url: string; corpus: boolean }

const corpusDir = new URL('../bench/corpus/', import.meta.url)
const fixturesDir = new URL('../../md/test/fixtures/', import.meta.url)

export const corpusPages = (): Page[] => {
  const cache = new URL('.cache/', corpusDir)
  if (!existsSync(cache)) return []
  const urls = readFileSync(new URL('urls.txt', corpusDir), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  return urls.flatMap((url) => {
    const file = new URL(url.replace(/[^a-zA-Z0-9]/g, '_') + '.html', cache)
    if (!existsSync(file)) return []
    const { hostname, pathname } = new URL(url)
    const name = `${hostname.split('.').at(-2)}/${pathname.split('/').filter(Boolean).at(-1) ?? ''}`
    return [{ name, html: readFileSync(file, 'utf8'), url, corpus: true }]
  })
}

export const fixturePages = (): Page[] =>
  readdirSync(fixturesDir)
    .filter((file) => file.endsWith('.html'))
    .toSorted()
    .map((file) => ({
      name: file.replace(/\.html$/, ''),
      html: readFileSync(new URL(file, fixturesDir), 'utf8'),
      url: 'https://shop.test/page',
      corpus: false,
    }))

// the longest common subsequence of two line lists, as a count: how many of the reference's lines appear in order
export const common = (a: string[], b: string[]) => {
  // lines as numbers, so the table compares ints
  const ids = new Map<string, number>()
  const id = (line: string) => {
    let n = ids.get(line)
    if (n === undefined) ids.set(line, (n = ids.size))
    return n
  }
  const x = a.map(id)
  const y = b.map(id)
  let prev = new Uint32Array(y.length + 1)
  let next = new Uint32Array(y.length + 1)
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++)
      next[j] = x[i - 1] === y[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, next[j - 1]!)
    ;[prev, next] = [next, prev]
  }
  return prev[y.length]!
}

export const similarity = (reference: string, ours: string) => {
  if (reference === ours) return 1
  const a = reference.split('\n')
  return common(a, ours.split('\n')) / a.length
}
