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

const page = (body: string) => readPage(`<html><body><main><p>Hi</p>${body}</main></body></html>`)

test('only an $RX in a script of its own counts: not the flight data, a comment or the text', () => {
  const flight = String.raw`<script>self.__next_f.push([1,"b:E{\"digest\":\"NEXT_HTTP_ERROR_FALLBACK;404\"}\n"])</script>`
  expect(page(flight).fallback).toBeUndefined()
  expect(page(`<!-- $RX("B:0","NEXT_HTTP_ERROR_FALLBACK;404") -->`).fallback).toBeUndefined()
  expect(page(`<p>$RX("B:0","NEXT_HTTP_ERROR_FALLBACK;404")</p>`).fallback).toBeUndefined()
  expect(
    page(`<p>$RX(&quot;B:0&quot;,&quot;NEXT_HTTP_ERROR_FALLBACK;404&quot;)</p>`).fallback,
  ).toBeUndefined()
  // another digest is an error next leaves to the page's error boundary, not an http status
  expect(page(`<script>$RX("B:0","1234567")</script>`).fallback).toBeUndefined()
  expect(
    page(`<script>$RX("B:0","NEXT_HTTP_ERROR_FALLBACK;500")</script>`).fallback,
  ).toBeUndefined()
  // next dev adds the message and stacks
  expect(
    page(`<script>$RX("B:2","NEXT_HTTP_ERROR_FALLBACK;403","msg","stack")</script>`).fallback,
  ).toEqual({
    status: 403,
  })
})
