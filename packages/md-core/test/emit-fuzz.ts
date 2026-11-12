// generated pages for the fast path's gate: the shapes it accepts and their near misses, seeded so a failure repeats.
// as a script, it runs many and stops at the first page whose markdown differs with the fast path on and off:
//   node test/emit-fuzz.ts [count] [seed]
import { emit } from '../src/emit.ts'
import { parse } from '../src/parse.ts'

export const generator = (seed: number) => {
  let state = seed >>> 0 || 1
  const random = (n: number) => {
    // xorshift: fast, and the same everywhere
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state % n
  }
  const pick = <T>(list: readonly T[]): T => list[random(list.length)]!
  const SPACES = [' ', '  ', '\n', '\t', ' \n ', '&nbsp;', ' ', '', '', '']
  const WORDS = [
    'a',
    'word',
    'Two words',
    '1.',
    '2)',
    '10.',
    'x_y',
    'snake_case_name',
    'é',
    '中文',
    '😀',
  ]
  const MARKS = '*_[]()<>#+-!|\\`~&.:@='.split('')
  const ENTITIES = ['&amp;', '&lt;', '&gt;', '&quot;', '&#42;', '&#x5F;', '&copy;']
  const text = (): string => {
    let out = ''
    for (let i = random(4); i >= 0; i--)
      out +=
        random(3) === 0
          ? pick(MARKS)
          : random(5) === 0
            ? pick(ENTITIES)
            : random(4) === 0
              ? pick(SPACES)
              : pick(WORDS)
    return random(3) === 0 ? pick(SPACES) + out + pick(SPACES) : out
  }
  const HREFS = [
    '/docs/x',
    'https://example.com/a',
    'https://example.com',
    'http://x.test/a b',
    '/a(b)c',
    '#frag',
    '#',
    '',
    ' /padded ',
    'mailto:me@x.test',
    'javascript:alert(1)',
    'ftp://x.test',
    '../up',
    '?q=1&amp;b=2',
    '/a<b>',
    'https://example.com/a',
    'HTTPS://X.TEST',
    '//proto.test/x',
  ]
  const TITLES = ['', ' title="T"', ' title=\'a "q" b\'', ' title=""', ' TITLE=x']
  const SPANS = [
    '<span>',
    '<span class="x">',
    '<span class="flex">',
    '<span class="block">',
    '<span style="color:red">',
    '<span hidden>',
    '<span aria-hidden="true">',
  ]
  const inline = (depth: number): string => {
    let out = ''
    for (let i = random(5); i >= 0; i--) {
      const choice = depth > 2 ? 0 : random(14)
      switch (choice) {
        case 1:
        case 2:
          out += `<${pick(['strong', 'b', 'em', 'i'])}>${inline(depth + 1)}</${pick(['strong', 'b', 'em', 'i'])}>`
          break
        case 3:
          out += `<code>${pick(['x', '`tick`', ' sp ', 'a|b', '', '``', text()])}</code>`
          break
        case 4: {
          const href = pick(HREFS)
          out += `<a href="${href}"${pick(TITLES)}>${random(6) === 0 ? pick(['', ' ', href]) : inline(depth + 1)}</a>`
          break
        }
        case 5:
          out += random(2) ? '<br>' : ' <br> '
          break
        case 6:
          out += `${pick(SPANS)}${inline(depth + 1)}</span>`
          break
        case 7:
          // near misses: what the fast path declines
          out += pick([
            '<img src="/i.png" alt="i">',
            '<sup>1</sup>',
            '<del>d</del>',
            '<kbd>k</kbd>',
            '<u>u</u>',
            '<input>',
            '<button>b</button>',
            '<q>q</q>',
            '<wbr>',
            '<a href="/x"></a>',
            '<a href="/x" aria-label="L"><span></span></a>',
          ])
          break
        default:
          out += text()
      }
    }
    return out
  }
  const block = (): string => {
    switch (random(8)) {
      case 0:
        return `<h${1 + random(6)}${random(4) ? '' : ' id="h"'}>${inline(0)}</h${1 + random(6)}>`
      case 1:
        return `<ul><li>${inline(0)}</li><li><p>${inline(0)}</p></li></ul>`
      case 2:
        return `<blockquote><p>${inline(0)}</p></blockquote>`
      case 3:
        return `<div>${inline(0)}<p>${inline(0)}</p></div>`
      default:
        return `<p${random(4) ? '' : ' class="text-sm"'}>${inline(0)}</p>`
    }
  }
  return () => {
    let body = ''
    for (let i = 1 + random(4); i > 0; i--) body += pick(SPACES) + block()
    return `<html><head><title>T</title></head><body><main>${body}</main></body></html>`
  }
}

// a page's markdown with the fast path and without
export const both = (html: string) => ({
  fast: emit(parse(html), { url: 'https://site.test/a/b' }).markdown,
  slow: emit(parse(html), { url: 'https://site.test/a/b', fast: false } as never).markdown,
})

if (import.meta.main) {
  const count = Number(process.argv[2]) || 100000
  const next = generator(Number(process.argv[3]) || 1)
  for (let i = 0; i < count; i++) {
    const html = next()
    const { fast, slow } = both(html)
    if (fast !== slow) {
      const a = fast.split('\n')
      const b = slow.split('\n')
      let line = 0
      while (a[line] === b[line]) line++
      console.log(`mismatch at case ${i}:\n${html}\n--- fast\n${a[line]}\n--- slow\n${b[line]}`)
      process.exit(1)
    }
  }
  console.log(`${count} pages, no mismatch`)
}
