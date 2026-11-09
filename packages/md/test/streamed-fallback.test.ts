import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { readPage } from '../src/index.ts'

const dir = new URL('./fixtures/', import.meta.url)
const fixture = (name: string) => readFileSync(new URL(name, dir), 'utf8')

// captured from next start (see streamed-fallback.capture.md): each threw after its shell, so next answered 200
test.each([
  ['streamed-not-found-next16.3.html', 404],
  ['streamed-not-found-next16.4.html', 404],
  ['streamed-not-found-cache-components.html', 404],
  ['streamed-forbidden-next16.4.html', 403],
  ['streamed-unauthorized-next16.3.html', 401],
  ['streamed-not-found-static-next16.3.html', 404],
])('%s streams a %i', (file, status) => {
  const page = readPage(fixture(file))
  expect(page.fallback).toEqual({ status })
  expect(page.redirect).toBeUndefined()
})

test("a page that rendered isn't one, though its flight data carries next's not-found and forbidden templates", () => {
  const pages = readdirSync(dir).filter(
    (f) => f.endsWith('.html') && !/^streamed-(not-found|forbidden|unauthorized)/.test(f),
  )
  expect(pages.length).toBeGreaterThan(10)
  const read = Object.fromEntries(pages.map((file) => [file, readPage(fixture(file)).fallback]))
  expect(read).toEqual(Object.fromEntries(pages.map((file) => [file, undefined])))
})

// a page with flight data, as next sends it: each push's text, as JSON in a script of its own
const push = (text: string) => `<script>self.__next_f.push(${JSON.stringify([1, text])})</script>`
const errorRow = (digest: string) => push(`5:E{"digest":"${digest}"}\n`)
const page = (body: string, flight = '') =>
  readPage(`<html><body><main><p>Hi</p>${body}</main>${flight}</body></html>`)

test('only a flight error row is a status: not a bare $RX, a template, a comment or the text', () => {
  for (const status of [404, 403, 401])
    expect(page('', errorRow(`NEXT_HTTP_ERROR_FALLBACK;${status}`)).fallback).toEqual({ status })
  // raw html a page renders (a readme) can carry any of these, so none of them is next's
  for (const forged of [
    '<script>$RX("B:0","NEXT_HTTP_ERROR_FALLBACK;404")</script>',
    '<!--$!--><template data-dgst="NEXT_HTTP_ERROR_FALLBACK;404"></template>',
    '<!-- $RX("B:0","NEXT_HTTP_ERROR_FALLBACK;404") -->',
    '<p>5:E{"digest":"NEXT_HTTP_ERROR_FALLBACK;404"}</p>',
  ])
    expect(page(forged).fallback).toBeUndefined()
  // another digest is an error next leaves to the page's error boundary, not an http status
  expect(page('', errorRow('NEXT_HTTP_ERROR_FALLBACK;500')).fallback).toBeUndefined()
  expect(page('', errorRow('1234567')).fallback).toBeUndefined()
  // the first of next's control flow counts, after any ordinary error
  const both = errorRow('1234567') + errorRow('NEXT_HTTP_ERROR_FALLBACK;403')
  expect(page('', both).fallback).toEqual({ status: 403 })
})

test("an error row can't be forged by what a page renders", () => {
  const row = '\n5:E{"digest":"NEXT_HTTP_ERROR_FALLBACK;404"}\n'
  // as a string in a model row, which flight escapes
  expect(
    page('', push(`6:["$","p",null,{"children":${JSON.stringify(row)}}]\n`)).fallback,
  ).toBeUndefined()
  // as a long string, which react sends raw in a T row: its bytes are skipped by their length
  const text = `${'x'.repeat(1100)}${row}é`
  const long = push(`7:T${new TextEncoder().encode(text).length.toString(16)},${text}`)
  expect(page('', long).fallback).toBeUndefined()
  // and the same row after it, real, still counts
  expect(page('', long + errorRow('NEXT_HTTP_ERROR_FALLBACK;404')).fallback).toEqual({
    status: 404,
  })
  // a page parsed as sent (a push-shaped attribute isn't a script) reads its flight data from its own scripts
  const quoted = '<div title="<script>self.__next_f.push([1,&quot;x&quot;])</script>"></div>'
  expect(page(quoted, errorRow('NEXT_HTTP_ERROR_FALLBACK;404')).fallback).toEqual({ status: 404 })
})

test("next 16.3's prerendered not-found counts under a layout's own robots meta", () => {
  const html = fixture('streamed-not-found-static-next16.3.html').replace(
    '<head>',
    '<head><meta name="robots" content="index, follow"/>',
  )
  expect(html).toContain('content="index, follow"')
  expect(readPage(html).fallback).toEqual({ status: 404 })
})
