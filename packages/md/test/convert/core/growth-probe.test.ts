import { afterEach, expect, test } from 'vitest'
import { forcePath, type Path } from '../../../src/convert/path.ts'
import { htmlToMarkdown, readPage } from '../../../src/index.ts'
import { leastRatio } from './support/timing.ts'

afterEach(() => {
  forcePath(undefined)
})

// review's growth probe: hostile but cheap pages, each of a feature repeated n times, read at n and at 4n through md's
// entry points (htmlToMarkdown, or readPage and markdown(fills)), on md-core as md runs it (it may decline) and on the
// tree pipeline. what a read costs grows with the page: no more than GROWTH times as fast as the page does (about 1
// when it's linear, 4 when it's quadratic)
const GROWTH = 2.5
const range = (n: number) => Array.from({ length: n }, (_, i) => i)
const join = (n: number, each: (i: number) => string) => range(n).map(each).join('')
const slot = (name: string) =>
  `<affordances-md data-mode="slot" data-name="${name}"><p>default ${name}</p></affordances-md>`
const RC = (i: number) => `<script>$RC("B:${i}","S:${i}")</script>`
type Page = string | { html: string; fills: Record<string, string> }
// a feature, how many of it a page has at 1x, the page, and the paths it's read on
type Feature = [name: string, n: number, page: (n: number) => Page, paths?: (Path | undefined)[]]
const features: Feature[] = [
  // markers
  [
    'shown panels, ids nobody has',
    250,
    (n: number) =>
      join(n, (i: number) => `<p id="e${i}">x</p>`) +
      join(
        n,
        (i: number) =>
          `<section role="tabpanel" data-affordances-md="show" aria-labelledby="m${i} t${i}">p${i}</section>`,
      ) +
      `<div role="tablist"><button role="tab" id="t${n - 1}">Last</button></div>`,
  ],
  [
    'tablists, one shown panel each',
    125,
    (n: number) =>
      join(
        n,
        (i: number) =>
          `<div role="tablist"><button role="tab" id="a${i}" aria-controls="pa${i}">A${i}</button><button role="tab" id="b${i}" aria-controls="pb${i}">B${i}</button></div><div role="tabpanel" id="pa${i}" aria-labelledby="a${i}" data-affordances-md="show"><p>shown ${i}</p></div><div role="tabpanel" id="pb${i}" aria-labelledby="b${i}" hidden><p>hidden ${i}</p></div>`,
      ),
  ],
  [
    'one panel labelled by n ids',
    125,
    (n: number) =>
      `<div role="tablist">${join(n, (i: number) => `<button role="tab" id="t${i}">T${i}</button>`)}</div><div role="tabpanel" aria-labelledby="${range(
        n,
      )
        .map((i: number) => 't' + i)
        .join(' ')}" data-affordances-md="show"><p>P</p></div>`,
  ],
  [
    'tabs repeated id, n panels',
    125,
    (n: number) =>
      `<div role="tablist">${join(n, () => `<button role="tab" id="t">T</button>`)}</div>` +
      join(
        n,
        (i: number) =>
          `<div role="tabpanel" aria-labelledby="t" data-affordances-md="show"><p>P${i}</p></div>`,
      ),
  ],
  [
    'slots, unique, all filled',
    125,
    (n: number) => ({
      html: join(n, (i: number) => slot('s' + i)),
      fills: Object.fromEntries(range(n).map((i: number) => ['s' + i, `fill **${i}**`])),
    }),
  ],
  [
    'slots, one name repeated',
    125,
    (n: number) => ({ html: join(n, () => slot('s')), fills: { s: 'fill' } }),
  ],
  [
    'slots in links',
    125,
    (n: number) => ({
      html: join(n, (i: number) => `<p><a href="/x${i}">go ${slot('s' + i)}</a></p>`),
      fills: Object.fromEntries(range(n).map((i: number) => ['s' + i, `f${i}`])),
    }),
  ],
  [
    'slots in a table',
    250,
    (n: number) => ({
      html: `<table>${join(n, (i: number) => `<tr><td>r${i}</td><td>${slot('s' + i)}</td></tr>`)}</table>`,
      fills: Object.fromEntries(range(n).map((i: number) => ['s' + i, `f${i}`])),
    }),
  ],
  [
    'AgentText inline, one paragraph',
    125,
    (n: number) =>
      `<p>${join(n, (i: number) => `a <affordances-md data-mode="text" data-md="**m${i}** [l](/x${i})"></affordances-md> b `)}</p>`,
  ],
  [
    'AgentText block in cells',
    125,
    (n: number) =>
      `<table>${join(n, (i: number) => `<tr><td>c${i}<affordances-md data-mode="text" data-md="# H${i}&#10;&#10;p"></affordances-md></td></tr>`)}</table>`,
  ],
  [
    'AgentMain, n of them',
    125,
    (n: number) =>
      join(
        n,
        (i: number) =>
          `<affordances-md data-mode="main"><p>m${i}</p></affordances-md><p>out${i}</p>`,
      ),
  ],
  [
    'data-affordances-md skip and show',
    125,
    (n: number) =>
      join(
        n,
        (i: number) =>
          `<div hidden data-affordances-md="show"><p>s${i}</p></div><div data-affordances-md="skip"><p>k${i}</p></div>`,
      ),
  ],
  // structure
  [
    'table rows',
    125,
    (n: number) =>
      `<table><thead><tr><th>a</th><th>b</th><th>c</th></tr></thead>${join(n, (i: number) => `<tr><td>${i}</td><td>x</td><td>y</td></tr>`)}</table>`,
  ],
  [
    'table columns',
    125,
    (n: number) =>
      `<table>${join(3, () => `<tr>${join(n, (i: number) => `<td>${i}</td>`)}</tr>`)}</table>`,
  ],
  [
    'table rowspans and colspans',
    250,
    (n: number) =>
      `<table>${join(n, (i: number) => `<tr><td rowspan="${n}">${i}</td><td colspan="3">x</td></tr>`)}</table>`,
  ],
  ['list items', 125, (n: number) => `<ul>${join(n, (i: number) => `<li>item ${i}</li>`)}</ul>`],
  [
    'lists nested 4 deep',
    50,
    (n: number) =>
      join(
        n,
        (i: number) =>
          `<ul><li>a${i}<ol><li>b<ul><li>c<ol><li>d</li></ol></li></ul></li></ol></li></ul>`,
      ),
  ],
  [
    'list items holding blocks',
    125,
    (n: number) =>
      `<ol>${join(n, (i: number) => `<li><p>p${i}</p><pre>code ${i}</pre><blockquote>q</blockquote></li>`)}</ol>`,
  ],
  [
    'headings',
    125,
    (n: number) =>
      join(n, (i: number) => `<h${(i % 6) + 1}>Heading ${i}</h${(i % 6) + 1}><p>t</p>`),
  ],
  [
    'headings with ids, toc links',
    125,
    (n: number) =>
      `<nav>${join(n, (i: number) => `<a href="#h${i}">to ${i}</a>`)}</nav>` +
      join(n, (i: number) => `<h2 id="h${i}">H${i}</h2>`),
  ],
  [
    'empty links named by ids',
    125,
    (n: number) =>
      join(n, (i: number) => `<p><a href="/a${i}" aria-labelledby="n${i}"></a></p>`) +
      join(n, (i: number) => `<span id="n${i}">Named ${i}</span>`),
  ],
  [
    'empty links, one id repeated',
    125,
    (n: number) =>
      join(n, (i: number) => `<p><a href="/a${i}" aria-labelledby="n"></a></p>`) +
      join(n, () => `<span id="n">N</span>`),
  ],
  [
    'links labelled by n ids each',
    30,
    (n: number) =>
      join(
        n,
        (i: number) =>
          `<p><a href="/a${i}" aria-labelledby="${range(n)
            .map((j: number) => 'n' + j)
            .join(' ')}"></a></p>`,
      ) + join(n, (j: number) => `<span id="n${j}">w${j}</span>`),
  ],
  [
    'repeated link, same href',
    125,
    (n: number) =>
      join(
        n,
        () => `<p><a href="/same">Same</a> <a href="/same"><img alt="Same" src="/i.png"></a></p>`,
      ),
  ],
  [
    'links with images and labels',
    125,
    (n: number) =>
      join(
        n,
        (i: number) =>
          `<p><a href="/a${i}" aria-label="L${i}"><img alt="" src="/i${i}.png"></a><a href="/b${i}" title="t${i}"><svg aria-label="s${i}"></svg></a></p>`,
      ),
  ],
  [
    'inline links in one paragraph',
    125,
    (n: number) => `<p>${join(n, (i: number) => `see <a href="/x${i}">link ${i}</a>, `)}</p>`,
  ],
  [
    'form, n inputs with values',
    125,
    (n: number) =>
      `<form>${join(n, (i: number) => `<label for="f${i}">L${i}</label><input id="f${i}" name="f${i}" value="v${i}">`)}</form>`,
  ],
  [
    'n forms',
    125,
    (n: number) =>
      join(
        n,
        (i: number) => `<form><input name="q${i}" value="v${i}"><button>Go ${i}</button></form>`,
      ),
  ],
  [
    'select with n options',
    125,
    (n: number) =>
      `<form><select name="s">${join(n, (i: number) => `<option value="${i}"${i === 1 ? ' selected' : ''}>O${i}</option>`)}</select></form>`,
  ],
  [
    'form labelled by n ids',
    125,
    (n: number) =>
      `<form aria-labelledby="${range(n)
        .map((i: number) => 'x' + i)
        .join(' ')}"><input name="a"></form>` +
      join(n, (i: number) => `<span id="x${i}">w${i}</span>`),
  ],
  // parser shapes
  [
    'misnested formatting, distinct',
    125,
    (n: number) =>
      join(n, (i: number) => `<b class="c${i}">`) + join(n, (i: number) => `<p>p${i}</p>`),
  ],
  [
    'adoption agency repeats',
    125,
    (n: number) => join(n, (i: number) => `<a href="/x${i}"><div>a${i}</a>b${i}</div>`),
  ],
  [
    'foster parenting',
    125,
    (n: number) =>
      `<table>${join(n, (i: number) => `<div>f${i}</div><tr><td>c${i}</td></tr>`)}</table>`,
  ],
  ['comments', 125, (n: number) => `<p>${join(n, (i: number) => `a${i}<!-- c ${i} -->`)}</p>`],
  [
    'templates',
    125,
    (n: number) => join(n, (i: number) => `<template><p>t${i}</p></template><p>x${i}</p>`),
  ],
  [
    'svg with templates',
    125,
    (n: number) =>
      join(n, (i: number) => `<svg><template><p>t${i}</p></template></svg><p>x${i}</p>`),
  ],
  // react's streaming
  [
    'flight pushes',
    125,
    (n: number) =>
      `<p>body</p>` +
      join(n, (i: number) => `<script>self.__next_f.push([1,"chunk ${i} \\"q\\" \\n"])</script>`),
  ],
  [
    'streamed boundaries',
    125,
    (n: number) =>
      join(
        n,
        (i: number) => `<!--$?--><template id="B:${i}"></template><p>Loading ${i}</p><!--/$-->`,
      ) + join(n, (i: number) => `<div hidden id="S:${i}"><p>Revealed ${i}</p></div>${RC(i)}`),
  ],
  [
    'streamed boundaries nested in order',
    50,
    (n: number) =>
      `<!--$?--><template id="B:0"></template><p>L</p><!--/$-->` +
      join(
        n,
        (i: number) =>
          `<div hidden id="S:${i}"><p>R${i}</p><!--$?--><template id="B:${i + 1}"></template><!--/$--></div>${RC(i)}`,
      ),
  ],
  // the growth findings' own shapes, each at a size where what was quadratic shows (shown panels, slots in a table and
  // rowspans are review's, above, at their own size)
  [
    'whitespace between empty inline elements',
    2000,
    (n: number) => `<p>a${' <span></span>'.repeat(n)} b</p>`,
  ],
  [
    'tabs sharing one id',
    4000,
    (n: number) =>
      `<div role="tablist">${'<button role="tab" id="t">Tab</button>'.repeat(n)}</div><section role="tabpanel" data-affordances-md="show" aria-labelledby="t">P</section>`,
    [undefined],
  ],
  [
    'text between comments',
    4000,
    (n: number) => `<p>${join(n, (i) => `a${i}<!-- c -->`)}</p>`,
    ['hast'],
  ],
  [
    'streamed boundaries nested in order, by the thousand',
    4000,
    (n: number) =>
      `<!--$?--><template id="B:0"></template><p>L</p><!--/$-->` +
      join(
        n,
        (i) =>
          `<div hidden id="S:${i}"><p>R${i}</p><!--$?--><template id="B:${i + 1}"></template><!--/$--></div>${RC(i)}`,
      ),
    [undefined],
  ],
]

const page = (feature: Feature, n: number) => {
  const made = feature[2](n)
  const { html, fills } = typeof made === 'string' ? { html: made, fills: undefined } : made
  return { html: /<(body|html)\b/i.test(html) ? html : `<main>${html}</main>`, fills }
}
const read = ({ html, fills }: ReturnType<typeof page>) =>
  fills ? readPage(html).markdown(fills).markdown : htmlToMarkdown(html).markdown
const timed = (each: () => unknown) => {
  const started = performance.now()
  each()
  return performance.now() - started
}
// how much faster than the page a read's cost grows: the least of N runs of each size, measured again with more runs
// while it looks too fast (support/timing.ts), over the page's own growth
const growthOf = (small: ReturnType<typeof page>, large: ReturnType<typeof page>) => {
  const grew = large.html.length / small.html.length
  return (
    leastRatio(
      () => timed(() => read(small)),
      () => timed(() => read(large)),
      GROWTH * grew,
    ) / grew
  )
}
test.each(features.map((feature) => [feature[0], feature] as const))(
  '%s: read in time that grows with the page',
  (_, feature) => {
    const [, n, , paths = [undefined, 'hast']] = feature
    const small = page(feature, n)
    const large = page(feature, 4 * n)
    for (const path of paths) {
      forcePath(path)
      const growth = growthOf(small, large)
      // a failure says which path, and what it measured
      expect([path ?? 'md-core', growth < GROWTH || growth]).toEqual([path ?? 'md-core', true])
    }
  },
  60_000,
)
