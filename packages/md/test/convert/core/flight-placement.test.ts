import { afterEach, expect, test } from 'vitest'
import { parse } from '../../../src/convert/core/parse.ts'
import { flightStripper, readPage, readStreamed } from '../../../src/convert/index.ts'
import { Declined, forcePath } from '../../../src/convert/path.ts'
import { corpusPages, fixturePages } from './emit-pages.ts'

afterEach(() => forcePath(undefined))

// where page content can put a script: md parses with scripting off, so a script in a <noscript> or in mathml is a
// script element to it, but a browser with scripting on never runs one there (noscript's content is text, and mathml's
// script isn't html's). a flight push or a streamed instruction there is never next's, so the page's flight data isn't
// trusted (unrun). where a browser runs the script (svg, mathml's text integration points, an html annotation-xml) it's
// the page's own, as a plain one is (runs). the rest aren't scripts at all (inert)
type Kind = 'runs' | 'unrun' | 'inert'
const placements: [string, (script: string) => string, Kind][] = [
  ['a plain script', (s) => s, 'runs'],
  ['in <noscript>', (s) => `<noscript>${s}</noscript>`, 'unrun'],
  ['in <noscript><p>', (s) => `<noscript><p>${s}</p></noscript>`, 'unrun'],
  ['in <svg> in <noscript>', (s) => `<noscript><svg>${s}</svg></noscript>`, 'unrun'],
  ['directly in <math>', (s) => `<math>${s}</math>`, 'unrun'],
  ['in <math><mrow>', (s) => `<math><mrow>${s}</mrow></math>`, 'unrun'],
  ['in <math><mi>', (s) => `<math><mi>${s}</mi></math>`, 'runs'],
  [
    'in an html annotation-xml',
    (s) => `<math><annotation-xml encoding="text/html">${s}</annotation-xml></math>`,
    'runs',
  ],
  ['directly in <svg>', (s) => `<svg>${s}</svg>`, 'runs'],
  ['as text', (s) => s.replaceAll('<', '&lt;'), 'inert'],
  ['in <textarea>', (s) => `<textarea>${s}</textarea>`, 'inert'],
  ['in <template>', (s) => `<template>${s}</template>`, 'inert'],
  ['in a comment', (s) => `<!--${s}-->`, 'inert'],
  ['in <noembed>', (s) => `<noembed>${s}</noembed>`, 'inert'],
]

const push = (row: string) => `<script>self.__next_f.push([1,${JSON.stringify(row)}])</script>`
// the page's own flight data, so a forged push isn't caught by the count alone
const own = push('0:["$","p",null,{}]\n')
const page = (content: string) =>
  `<!doctype html><html><head><title>Post</title></head><body><main><h1>Post</h1>${content}</main>${own}</body></html>`

// readPage, as a caller reads a page, or readStreamed, as the route reads one it stripped as it streamed
const read = (html: string, how: 'page' | 'streamed') => {
  if (how === 'page') return readPage(html, { url: 'https://site.test/post' })
  const strip = flightStripper()
  const kept = strip.write(html) + strip.end()
  return readStreamed(kept, strip.swapped(), { url: 'https://site.test/post' })
}
// what a read gives, on the tree pipeline and on md-core where it takes the page: each different one once
const onEachPath = (outcome: () => unknown) => {
  const seen = new Set<string>()
  for (const path of ['hast', 'strict'] as const) {
    forcePath(path)
    try {
      seen.add(JSON.stringify(outcome()))
    } catch (error) {
      if (!(error instanceof Declined)) throw error
    }
  }
  return [...seen].map((json) => JSON.parse(json) as unknown)
}
// the route's read, or the reason it threw, which the route answers 502 for
const routeRead = <T>(html: string, of: (page: ReturnType<typeof read>) => T) => {
  try {
    return of(read(html, 'streamed'))
  } catch (error) {
    if (error instanceof Declined) throw error
    return (error as { reason?: string }).reason
  }
}

const digests: [string, object][] = [
  ['NEXT_HTTP_ERROR_FALLBACK;404', { fallback: { status: 404 } }],
  ['NEXT_HTTP_ERROR_FALLBACK;403', { fallback: { status: 403 } }],
  [
    'NEXT_REDIRECT;replace;https://other.test/x;307;',
    { redirect: { status: 307, location: 'https://other.test/x' } },
  ],
]
const control = ({ fallback, redirect }: ReturnType<typeof read>) => ({
  ...(fallback && { fallback }),
  ...(redirect && { redirect }),
})

test.each(placements)("a control digest's push %s", (_, place, kind) => {
  for (const [digest, said] of digests) {
    const html = page(place(push(`9:E{"digest":"${digest}"}\n`)))
    // readPage never throws: flight data it can't trust reads as none. the route's read throws, so it answers 502,
    // private, no-store
    const expected = {
      runs: { digest, page: said, route: said },
      unrun: { digest, page: {}, route: 'unrun' },
      inert: { digest, page: {}, route: {} },
    }[kind]
    expect(
      onEachPath(() => ({
        digest,
        page: control(read(html, 'page')),
        route: routeRead(html, control),
      })),
    ).toEqual([expected])
  }
})

// a streamed boundary's instruction moves a hidden segment into the page: only where a browser would run it. a
// script's there makes the flight data untrusted; a template's moves nothing
const boundary = `<!--$?--><template id="B:0"></template><p>Loading</p><!--/$--><div hidden id="S:0"><p>Hidden segment</p></div>`
const instructions: [string, string][] = [
  ['$RC', '<script>$RC("B:0","S:0")</script>'],
  ['$RR', '<script>$RR("B:0","S:0",[])</script>'],
  ['template', '<template data-rci="" data-bid="B:0" data-sid="S:0"></template>'],
]
const shown = (found: ReturnType<typeof read>) =>
  found.markdown().markdown.includes('Hidden segment')
test.each(placements.filter(([name, , kind]) => kind === 'unrun' || name === 'a plain script'))(
  'a streamed instruction %s',
  (_, place, kind) => {
    for (const [what, instruction] of instructions) {
      const html = page(boundary + place(instruction))
      const expected =
        kind === 'runs'
          ? { what, page: true, route: true }
          : { what, page: false, route: what === 'template' ? false : 'unrun' }
      expect(
        onEachPath(() => ({
          what,
          page: shown(read(html, 'page')),
          route: routeRead(html, shown),
        })),
      ).toEqual([expected])
    }
  },
)

// next writes its pushes and instructions at the body's top level, never in a <noscript> or mathml: every real page
// keeps its flight data trusted
test("the fixtures' and the corpus' flight data is still trusted", () => {
  const pages = [...fixturePages(), ...corpusPages()]
  const found = pages.map(({ name, html }) => ({
    name,
    unrun: parse(html).unrun,
    route: routeRead(html, () => 'read'),
  }))
  expect(found.filter(({ unrun, route }) => unrun.length || route === 'unrun')).toEqual([])
})
