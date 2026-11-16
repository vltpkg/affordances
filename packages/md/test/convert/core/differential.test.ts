import { afterEach, expect, test } from 'vitest'
import { page as synthetic } from '../../../../md-core/bench/corpus/synthetic.mjs'
import { declines, forcePath } from '../../../src/convert/path.ts'
import { htmlToMarkdown, readPage, type Options } from '../../../src/index.ts'
import { DOCS_OPTIONS, docsPages } from './docs-fuzz.ts'
import { generator } from './emit-fuzz.ts'
import { treePages } from './tree-fuzz.ts'
import { fixturePages } from './emit-pages.ts'

afterEach(() => {
  forcePath(undefined)
  declines.clear()
})

// md-core against the tree pipeline on what's committed: md's fixtures, the bench's synthetic pages and generated
// pages on fixed seeds. md-core may decline only what it leaves to the tree pipeline by design (streamed boundaries
// that move, an element named like a selector); any other decline, and any page where the two write differently, fails
const compare = (pages: { name: string; html: string }[], options: Options) => {
  const differ: string[] = []
  for (const { name, html } of pages) {
    forcePath('hast')
    const tree = htmlToMarkdown(html, options)
    forcePath('core')
    const core = htmlToMarkdown(html, options)
    if (JSON.stringify(core) !== JSON.stringify(tree)) differ.push(name)
  }
  const declined = Object.fromEntries(declines)
  delete declined.streamed
  delete declined['selector tag name']
  return { differ, declined }
}
const none = { differ: [], declined: {} }

test('md fixtures', () => {
  const pages = fixturePages()
  expect(compare(pages, { url: 'https://shop.test/page' })).toEqual(none)
  expect(
    compare(pages, {
      url: 'https://shop.test/page',
      frontmatter: false,
      jsonLd: false,
      extract: 'none',
    }),
  ).toEqual(none)
})

test('the synthetic pages', { timeout: 30_000 }, () => {
  const pages = [50, 200].map((sections) => ({
    name: `synthetic/${sections}`,
    html: synthetic(sections),
  }))
  expect(compare(pages, { url: 'https://site.test/a', link: (url) => `${url.href}.md` })).toEqual(
    none,
  )
})

// 300 pages: about 6 s, most of it the tree pipeline's
test('generated pages, on fixed seeds', { timeout: 30_000 }, () => {
  const pages: { name: string; html: string }[] = []
  for (const seed of [1, 2, 3]) {
    const next = generator(seed)
    for (let i = 0; i < 100; i++) pages.push({ name: `seed ${seed} #${i}`, html: next() })
  }
  expect(compare(pages, { url: 'https://site.test/a/b' })).toEqual(none)
})

// pages shaped like a react docs site's: texts split by react's empty comments beside elements made boxes, head links
// as real heads write them. 3000 pages: about 3 s
test('generated docs pages, on fixed seeds', { timeout: 30_000 }, () => {
  // each page under one of the options, in turn
  const pages = DOCS_OPTIONS.map(() => [] as { name: string; html: string }[])
  for (const seed of [1, 2, 3]) {
    const next = docsPages(seed)
    for (let i = 0; i < 1000; i++) {
      const html = next()
      pages[i % pages.length]!.push({ name: `seed ${seed} #${i} ${JSON.stringify(html)}`, html })
    }
  }
  for (const [n, options] of DOCS_OPTIONS.entries())
    expect(compare(pages[n]!, options)).toEqual(none)
})

// pages heavy on html's recovery paths, each read both ways (htmlToMarkdown, and readPage with a fill), under the
// options a caller passes. a flight placeholder can reach the markdown on either path (a push in json-ld), and it's a
// fresh uuid each time, so it's compared as one
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const OPTIONS: Options[] = [
  {},
  { url: 'https://site.test/a/b' },
  { url: 'https://site.test/a/', extract: 'none' },
  { slots: { a: 'FILLED' } },
  { link: (url) => (url.pathname.endsWith('/x') ? `${url.href}.md` : undefined) },
]
const both = (html: string, options: Options) => {
  const page = readPage(html, options)
  const { markdown, ...rest } = page
  return JSON.stringify([htmlToMarkdown(html, options), rest, markdown({ a: 'F' })]).replace(
    UUID,
    'UUID',
  )
}
// 4000 pages: about 3.5 s
test("generated pages on html's recovery paths, on fixed seeds", { timeout: 30_000 }, () => {
  const differ: string[] = []
  for (const seed of [1, 2, 3, 4]) {
    const next = treePages(seed)
    for (let i = 0; i < 1000; i++) {
      const html = next()
      const options = OPTIONS[i % OPTIONS.length]!
      forcePath('hast')
      const tree = both(html, options)
      forcePath('core')
      if (both(html, options) !== tree) differ.push(`seed ${seed} #${i} ${JSON.stringify(html)}`)
    }
  }
  expect(differ).toEqual([])
})
