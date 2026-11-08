import { expect, test } from 'vitest'
import { htmlToMarkdown, readPage } from '../src/index.ts'

// <AgentSlot name> (F-1, FB-1) and links in a marker's markdown (FB-4, F-8)
const page = (body: string) => `<html><body><main>${body}</main></body></html>`
const slot = (name: string, children = '') =>
  `<affordances-md data-mode="slot" data-name="${name}" style="display:contents">${children}</affordances-md>`
const text = (markdown: string, block = false) =>
  `<affordances-md data-mode="text" style="display:contents" data-md="${markdown.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"${block ? ' data-block=""' : ''}></affordances-md>`
// the twin hook the handler passes: a same-site page's .md
const link = (url: URL) =>
  url.origin === 'https://vlt.test' && !url.pathname.endsWith('.md')
    ? `${url.origin}${url.pathname}.md`
    : undefined
const md = (body: string, slots?: Record<string, string>) =>
  htmlToMarkdown(page(body), { url: 'https://vlt.test/p', link, frontmatter: false, slots })
    .markdown

const skip = (children: string) =>
  `<affordances-md data-mode="skip" style="display:contents">${children}</affordances-md>`
const main = (children: string) =>
  `<affordances-md data-mode="main" style="display:contents">${children}</affordances-md>`

test('readPage lists the names in page order, unique and duplicate', () => {
  expect(
    readPage(page(`${slot('readme')}<p>${slot('tags')}</p>${slot('versions')}${slot('tags')}`))
      .slots,
  ).toEqual({ unique: ['readme', 'versions'], duplicate: ['tags'] })
  expect(readPage(page('<p>no slots</p>')).slots).toEqual({ unique: [], duplicate: [] })
  // a marker without a name isn't a slot
  expect(readPage(page(slot(''))).slots).toEqual({ unique: [], duplicate: [] })
})

test('a slot that never reaches the markdown never counts, so its fill never runs', () => {
  // inside <AgentSkip>, hidden from people, or outside <AgentMain>: the converter drops it before it counts
  const body = `${skip(slot('skipped'))}<div hidden>${slot('hidden')}</div>${main(slot('kept'))}${slot('outside')}`
  expect(readPage(page(body)).slots).toEqual({ unique: ['kept'], duplicate: [] })
  // a dropped marker keeps its fill off the page, and doesn't make a kept marker a duplicate
  expect(
    md(`${skip(slot('readme', 'fake'))}${main(slot('readme', 'Loading'))}`, {
      readme: 'Real readme',
    }),
  ).toBe('Real readme\n')
  expect(md(`${skip(slot('readme'))}<p>Text</p>`, { readme: 'LEAK' })).not.toContain('LEAK')
  // outside <main>, with the page's own extraction
  expect(
    readPage(`<html><body><nav>${slot('nav')}</nav><main>${slot('main')}</main></body></html>`)
      .slots,
  ).toEqual({ unique: ['main'], duplicate: [] })
  // and the extract option htmlToMarkdown gets
  expect(
    readPage(`<html><body><nav>${slot('nav')}</nav></body></html>`, { extract: 'none' }).slots,
  ).toEqual({ unique: ['nav'], duplicate: [] })
})

test('readPage counts a slot react streamed into place, not one left in a fallback', () => {
  const html =
    '<html><body><main><!--$?--><template id="B:0"></template><p>Loading</p><!--/$--></main>' +
    `<div hidden id="S:0">${slot('readme')}</div><script>$RC("B:0","S:0")</script></body></html>`
  expect(readPage(html).slots).toEqual({ unique: ['readme'], duplicate: [] })
  expect(htmlToMarkdown(html, { frontmatter: false, slots: { readme: 'Filled' } }).markdown).toBe(
    'Filled\n',
  )
  // a boundary that never resolved keeps its fallback, so a slot only in the segment doesn't count
  expect(readPage(html.replace(/<script>.*<\/script>/, '')).slots).toEqual({
    unique: [],
    duplicate: [],
  })
})

test('a fill replaces its slot’s children; the rest of the page converts as usual', () => {
  expect(
    md(`<h1>express</h1>${slot('readme', '<p>Loading readme…</p>')}<p>Published today</p>`, {
      readme: '## Readme\n\nFast, unopinionated.',
    }),
  ).toBe('# express\n\n## Readme\n\nFast, unopinionated.\n\nPublished today\n')
})

test('an unfilled slot converts its children, and an empty fill leaves nothing', () => {
  const body = `${slot('readme', '<p>Loading readme…</p>')}<p>After</p>`
  expect(md(body)).toBe('Loading readme…\n\nAfter\n')
  expect(md(body, {})).toBe('Loading readme…\n\nAfter\n')
  expect(md(body, { other: 'x' })).toBe('Loading readme…\n\nAfter\n')
  expect(md(body, { readme: '' })).toBe('After\n')
  // a name that happens to be an object property is still just a missing key
  expect(md(`${slot('constructor', '<p>Kids</p>')}${slot('__proto__', '<p>Too</p>')}`, {})).toBe(
    'Kids\n\nToo\n',
  )
})

test('a duplicate name fills no copy, whatever the slots say', () => {
  expect(
    md(`${slot('readme', '<p>One</p>')}<p>Middle</p>${slot('readme', '<p>Two</p>')}`, {
      readme: 'FILL',
    }),
  ).toBe('One\n\nMiddle\n\nTwo\n')
})

test('a fill is a block: an inline slot splits its paragraph', () => {
  expect(
    md(`<p>Latest ${slot('version', '<span>…</span>')} today</p>`, { version: '**5.1.0**' }),
  ).toBe('Latest\n\n**5.1.0**\n\ntoday\n')
  // so is a block <AgentText> in a paragraph, which ran into the paragraph's text before
  expect(md(`<p>Hi ${text('- a\n- b', true)}</p>`)).toBe('Hi\n\n- a\n- b\n')
  // an inline one stays inline
  expect(md(`<p>Price ${text('**$48**')} today</p>`)).toBe('Price **$48** today\n')
})

test('markers inside and around a slot', () => {
  // a filled slot's children are gone, markers and nested slots in them included
  expect(
    md(slot('outer', `${slot('inner', '<p>Inner kids</p>')}<p>Outer kids</p>`), {
      outer: 'Outer fill',
      inner: 'Inner fill',
    }),
  ).toBe('Outer fill\n')
  // an unfilled one converts its children, and a slot inside it is never filled either (A10): its fill would never run
  expect(
    md(slot('outer', `${slot('inner', '<p>Inner kids</p>')}<p>Outer kids</p>`), {
      inner: 'Inner fill',
    }),
  ).toBe('Inner kids\n\nOuter kids\n')
  // inside <AgentOnly>, agents get the fill
  expect(
    md(`<affordances-md data-mode="only" hidden="">${slot('readme')}</affordances-md>`, {
      readme: 'Only fill',
    }),
  ).toBe('Only fill\n')
})

test('a fake slot in user content can only cancel a fill, or move this visitor’s own', () => {
  // a readme rendered as raw html carries a marker named like the page's slot: both are duplicates, so neither is
  // filled and the page's children convert as usual
  const readme = `<article><p>Hello</p>${slot('versions', '<p>fake</p>')}</article>`
  expect(
    md(`${slot('versions', '<p>Loading versions…</p>')}${readme}`, { versions: '- 5.1.0' }),
  ).toBe('Loading versions…\n\nHello\n\nfake\n')
  // with no real marker for the name on this page, the fake one gets the fill: this request's own data, for this page,
  // in another spot. it never reaches another page or visitor, and strip <affordances-md> from untrusted html
  expect(md(readme, { versions: '- 5.1.0' })).toBe('Hello\n\n- 5.1.0\n')
  // the page can't fake a fill's verbatim attribute either
  expect(md('<p><span data-affordances-md-text="FORGED">kept</span></p>')).toBe('kept\n')
})

test('FB-4: links in <AgentText md> are absolute and twinned like page links', () => {
  expect(md(`<p>By <a href="/~ann">${text('Ann')}</a>, ${text('[Bob](/~bob)')}</p>`)).toBe(
    'By [Ann](https://vlt.test/~ann.md), [Bob](https://vlt.test/~bob.md)\n',
  )
  // reference definitions, titles and fragments; an image, and a definition an image uses, are only made absolute
  expect(
    md(
      text(
        '[Docs][d] ![logo](/logo.png) ![pic][i] [top](#top "Top") [t](/t "Title")\n\n[d]: /docs\n[i]: /i.png',
        true,
      ),
    ),
  ).toBe(
    '[Docs][d] ![logo](https://vlt.test/logo.png) ![pic][i] [top](https://vlt.test/p#top "Top") [t](https://vlt.test/t.md "Title")\n\n[d]: https://vlt.test/docs.md\n[i]: https://vlt.test/i.png\n',
  )
})

test('FB-4: autolinks to the site point at their twin; others, code and raw html are left as written', () => {
  expect(
    md(text('<https://vlt.test/a_b> https://vlt.test/lit <https://elsewhere.test/x>', true)),
  ).toBe(
    '[https://vlt.test/a\\_b](https://vlt.test/a_b.md) [https://vlt.test/lit](https://vlt.test/lit.md) <https://elsewhere.test/x>\n',
  )
  expect(
    md(text('`[c](/code)` <ops@vlt.test> www.elsewhere.test <a href="/raw">raw</a>', true)),
  ).toBe('`[c](/code)` <ops@vlt.test> www.elsewhere.test <a href="/raw">raw</a>\n')
  // a destination a bare url can't hold goes in <…>
  expect(md(text('[p](/a(b)) [q](</s p>)', true))).toBe(
    '[p](<https://vlt.test/a(b).md>) [q](https://vlt.test/s%20p.md)\n',
  )
})

test('FB-4: a fill’s links get the same treatment, and nothing changes without a base', () => {
  expect(md(slot('readme'), { readme: 'See [the docs](/docs) and <https://vlt.test/api>.' })).toBe(
    'See [the docs](https://vlt.test/docs.md) and [https://vlt.test/api](https://vlt.test/api.md).\n',
  )
  expect(
    htmlToMarkdown(page(`<p>${text('[Bob](/~bob)')}</p>`), { frontmatter: false, link }).markdown,
  ).toBe('[Bob](/~bob)\n')
})

test('marker markdown in a table cell stays in its cell', () => {
  expect(
    md(
      `<table><tr><th>Name</th><th>Notes</th></tr><tr><td>${slot('a', '…')}</td><td><p>${slot('b', '…')}</p></td></tr></table>`,
      { a: 'line1\n\nline2 a|b', b: '- x\n- y' },
    ),
  ).toBe(
    '| Name                | Notes      |\n| ------------------- | ---------- |\n| line1<br>line2 a\\|b | - x<br>- y |\n',
  )
})

test('a fill with tens of thousands of links converts in linear time', () => {
  // each link rewrites only its own span; applying them one copy at a time took ~12s at this size
  const fill = Array.from(
    { length: 15000 },
    (_, i) => `- [l](/p/${i}) <https://vlt.test/q${i}>`,
  ).join('\n')
  const started = performance.now()
  const markdown = md(slot('readme'), { readme: fill })
  expect(performance.now() - started).toBeLessThan(8000)
  expect(markdown).toContain(
    '- [l](https://vlt.test/p/14999.md) [https://vlt.test/q14999](https://vlt.test/q14999.md)',
  )
}, 30000)

test('A10: a slot inside another slot never counts, so its fill never runs', () => {
  const html = page(slot('outer', `${slot('inner', '<p>Inner kids</p>')}<p>Outer kids</p>`))
  expect(readPage(html).slots).toEqual({ unique: ['outer'], duplicate: [] })
  // and doesn't make an outer slot of the same name a duplicate
  expect(readPage(page(`${slot('readme', slot('readme'))}`)).slots).toEqual({
    unique: ['readme'],
    duplicate: [],
  })
})

test('A11: a block fill is lifted out of a heading, a link or emphasis, not only a paragraph', () => {
  expect(md(`<h1>Package ${slot('name', '…')}</h1>`, { name: 'express' })).toBe(
    '# Package\n\nexpress\n',
  )
  // a multi-line fill in a heading doesn't make a stray setext heading
  expect(md(`<h2>${slot('name', '…')} docs</h2>`, { name: 'line one\n---' })).toBe(
    'line one\n---\n\n## docs\n',
  )
  // a fill with a link, inside a link, isn't a link inside a link
  expect(
    md(`<p><a href="/pkg">See ${slot('readme', '…')} more</a></p>`, { readme: '[docs](/docs)' }),
  ).toBe(
    '[See](https://vlt.test/pkg.md)\n\n[docs](https://vlt.test/docs.md)\n\n[more](https://vlt.test/pkg.md)\n',
  )
  expect(md(`<p><em>A ${slot('x', '…')}</em> b</p>`, { x: '- one' })).toBe('_A_\n\n- one\n\nb\n')
})

test('readPage reads the page once: its slots, a streamed redirect, and markdown for any fills', () => {
  const read = readPage(page(`<h1>express</h1>${slot('readme', '<p>Loading</p>')}`), {
    url: 'https://vlt.test/p',
    link,
    frontmatter: false,
  })
  expect(read.slots).toEqual({ unique: ['readme'], duplicate: [] })
  expect(read.redirect).toBeUndefined()
  expect(read.markdown({ readme: 'One [x](/x)' }).markdown).toBe(
    '# express\n\nOne [x](https://vlt.test/x.md)\n',
  )
  // the page is left as it was, so it converts again with other fills, or none
  expect(read.markdown({ readme: 'Two' }).markdown).toBe('# express\n\nTwo\n')
  expect(read.markdown().markdown).toBe('# express\n\nLoading\n')
})

const meta = (content: string) =>
  `<html><body><main><p>Loading</p></main><meta id="__next-page-redirect" http-equiv="refresh" content="${content}"/></body></html>`

test('readPage reads next’s streamed redirect from the parse', () => {
  expect(readPage(meta('1;url=/sign-in?next=%2Fa&amp;b=1')).redirect).toEqual({
    status: 307,
    location: '/sign-in?next=%2Fa&b=1',
  })
  expect(readPage(meta('0;url=/moved')).redirect).toEqual({ status: 308, location: '/moved' })
  // in any attribute order, and only a real element: not one in a comment or a script's text
  expect(
    readPage(
      '<html><body><meta content="1;url=/x" http-equiv="refresh" id="__next-page-redirect"></body></html>',
    ).redirect,
  ).toEqual({ status: 307, location: '/x' })
  for (const html of [
    '<html><body><!-- <meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/x"> --></body></html>',
    '<html><body><script>"<meta id=\\"__next-page-redirect\\" http-equiv=\\"refresh\\" content=\\"1;url=/x\\">"</script></body></html>',
    '<html><body><meta id="__next-page-redirect" http-equiv="refresh" content="5;url=/x"></body></html>',
  ])
    expect(readPage(html).redirect).toBeUndefined()
})

test('A15: a pipe after an escaped backslash stays in its cell', () => {
  // a \\| b is a backslash, then a pipe that would end the cell; \| is already escaped
  expect(
    md(`<table><tr><th>A</th></tr><tr><td>${text('a \\\\| b \\| c', true)}</td></tr></table>`),
  ).toBe('| A             |\n| ------------- |\n| a \\\\\\| b \\| c |\n')
})
