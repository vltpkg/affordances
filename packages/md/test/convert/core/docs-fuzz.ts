// generated pages shaped like a react-rendered docs site, seeded so a failure repeats: texts react splits with an empty
// comment (S<!-- -->5) beside elements tailwind makes boxes or hides (block, flex, inline-flex, grid, sr-only, hidden),
// in paragraphs, list items, cells, headings and links; head links, meta and titles as real heads and near misses write
// them; and the page parts a docs page has around them (a nav, heading anchors, highlighted code, icons, a copy button).
// as a script, it runs many on both paths and prints each page they write differently, minimized:
//   node test/convert/core/docs-fuzz.ts [count] [seed]
import { forcePath } from '../../../src/convert/path.ts'
import { htmlToMarkdown, type Options } from '../../../src/index.ts'

const CLASSES = [
  '',
  '',
  ' class="block"',
  ' class="flex"',
  ' class="inline-flex"',
  ' class="inline-block"',
  ' class="inline"',
  ' class="grid"',
  ' class="inline-grid"',
  ' class="md:flex"',
  ' class="contents"',
  ' class="hidden"',
  ' class="sr-only"',
  ' class="hidden md:block"',
  ' class="block text-muted-foreground"',
  ' class="flex items-center gap-2"',
  ' class="text-sm"',
  ' style="display:block"',
  ' style="display: flex"',
  ' style="display:none"',
]
const WORDS = [
  'S',
  '5',
  'x',
  '×',
  'Search',
  'pa',
  'npm',
  'install',
  '1.2.0',
  'v',
  '(',
  ')',
  ':',
  '.',
  ',',
  '中文',
]
const SEPARATORS = ['<!-- -->', '<!-- -->', '<!---->', '']
const SPACES = ['', '', '', ' ', ' ', '\n  ', '&nbsp;']
const INLINE = [
  'span',
  'span',
  'span',
  'a',
  'code',
  'b',
  'strong',
  'em',
  'i',
  'small',
  'kbd',
  'div',
]
const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"></path></svg>'
const HREFS = ['/docs/a', '#install', 'https://a.example/b', 'https://other.test/c', '']
const RELS = [
  'canonical',
  'canonical',
  ' canonical',
  'canonical ',
  ' canonical ',
  'Canonical',
  'CANONICAL',
  'canonical alternate',
  'alternate canonical',
  'canonical\t',
  '\ncanonical',
  'canonicals',
  'stylesheet',
  'alternate',
  'icon',
  '',
]
const LINK_HREFS = [
  '',
  ' href="https://a.example/c"',
  ' href="https://a.example/c"',
  ' href="/c"',
  ' href="c"',
  ' href=""',
  ' href=" "',
  ' href=" https://a.example/p "',
  ' href="#f"',
  ' href="https://other.test/c"',
  ' HREF="https://a.example/u"',
]
const METAS = [
  '<meta name="description" content="D">',
  '<meta name="description" content="">',
  '<meta name="description">',
  '<meta name="Description" content="U">',
  '<meta name=" description" content="S">',
  '<meta property="og:title" content="O">',
  '<meta property="og:description" content="OD">',
  '<meta name="robots" content="noindex">',
  '<meta charset="utf-8">',
]
const TITLES = [
  '<title>Docs</title>',
  '<title> Docs | Site </title>',
  '<title></title>',
  '<title>A<!-- -->B</title>',
  '<title>&amp; x</title>',
]

const NAV = `<nav class="flex"><a href="/" class="flex items-center gap-2">${ICON}<span>Site</span></a><a href="/docs" class="hidden md:block">Docs</a></nav>`

export const docsPages = (seed: number) => {
  let state = seed >>> 0 || 1
  const random = (n: number) => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state % n
  }
  const pick = <T>(list: readonly T[]): T => list[random(list.length)]!
  // what react writes for {a}{' '}{b}: texts split by an empty comment, and elements between them
  const run = (depth: number): string => {
    let out = ''
    for (let i = 1 + random(5); i > 0; i--) {
      const r = depth > 1 ? random(6) : random(10)
      if (r < 4) out += pick(WORDS) + pick(SPACES)
      else if (r < 6) out += pick(SEPARATORS) + pick(SPACES)
      else if (r === 6) out += random(2) ? ICON : '<br>'
      else {
        const tag = pick(INLINE)
        const href =
          tag === 'a'
            ? ` href="${pick(HREFS)}"${pick(['', '', ' aria-current="page"'])}`
            : tag === 'span' && !random(8)
              ? ' role="presentation"'
              : ''
        out += `<${tag}${href}${pick(CLASSES)}>${run(depth + 1)}</${tag}>`
      }
    }
    return out
  }
  const head = () => {
    let out = random(5) ? pick(TITLES) : ''
    // a canonical with no url to give, before one that has it
    if (!random(6)) out += `<link rel="${pick(RELS)}"${pick(['', ' href=""', ' href=" "'])}>`
    for (let i = random(4); i > 0; i--)
      out += random(2) ? `<link rel="${pick(RELS)}"${pick(LINK_HREFS)}>` : pick(METAS)
    if (!random(6)) out += pick(TITLES)
    return out
  }
  const SHIKI = () =>
    `<pre class="shiki" tabindex="0"><code><span class="line"><span style="color:#F97583">${pick(WORDS)}</span><span style="color:#E1E4E8"> ${pick(WORDS)}</span></span>\n<span class="line"><span>${pick(WORDS)}</span></span></code></pre>`
  const block = (): string => {
    switch (random(17)) {
      case 0:
      case 1: {
        const level = 1 + random(5)
        const id = pick(['install', 'a', ''])
        const anchor = random(2)
          ? `<a href="#${id}" class="anchor" aria-label="Link to section">${random(2) ? '#' : ICON}</a>`
          : ''
        return `<h${level}${id ? ` id="${id}"` : ''}>${run(0)}${anchor}</h${level}>`
      }
      case 2: {
        const tag = pick(['ul', 'ol'])
        let items = ''
        for (let i = 1 + random(3); i > 0; i--) items += `<li${pick(CLASSES)}>${run(0)}</li>`
        return `<${tag}>${items}</${tag}>`
      }
      case 3:
      case 4: {
        let rows = `<thead><tr><th>${run(1)}</th><th>${run(1)}</th></tr></thead><tbody>`
        for (let i = 1 + random(3); i > 0; i--)
          rows += `<tr><td>${run(0)}</td><td>${run(0)}</td></tr>`
        return `<table>${rows}</tbody></table>`
      }
      case 5:
        return `<a href="${pick(HREFS)}"${pick(CLASSES)}>${run(0)}</a>`
      case 6:
        return `<div${pick(CLASSES)}>${run(0)}</div>`
      case 7:
        return `<div class="relative">${SHIKI()}<button aria-label="Copy" class="absolute">${ICON}<span class="sr-only">Copy</span></button></div>`
      case 8:
        return `<blockquote><p>${run(0)}</p></blockquote>`
      case 9:
        return `<dl><dt>${run(1)}</dt><dd>${run(0)}</dd></dl>`
      case 11:
        // rehype-pretty-code's figure: a file name over the code
        return `<figure data-rehype-pretty-code-figure=""><figcaption data-rehype-pretty-code-title="">${pick(WORDS)}.ts</figcaption>${SHIKI()}</figure>`
      case 12:
        // an accordion: the heading's text is its button's
        return `<h3><button type="button" aria-expanded="${pick(['true', 'false'])}" data-state="closed" class="flex">${run(1)}${ICON}</button></h3><div${random(2) ? ' hidden' : ''}>${run(0)}</div>`
      case 13:
        return random(2) ? '<hr>' : `<section><header>${run(1)}</header><p>${run(0)}</p></section>`
      case 10:
        return `<p>${run(0)}</p>${random(3) ? '' : `<link rel="${pick(RELS)}"${pick(LINK_HREFS)}>`}`
      default:
        return `<p${random(4) ? '' : ' class="text-sm"'}>${run(0)}</p>`
    }
  }
  return () => {
    let body = ''
    for (let i = 1 + random(4); i > 0; i--) body += block()
    const main = random(4) ? `<main>${body}</main>` : body
    const lang = pick(['', ' lang="en"', ' lang=""', ' lang="EN"'])
    return `${random(3) ? '<!DOCTYPE html>' : ''}<html${lang}><head>${head()}</head><body>${random(2) ? NAV : ''}${main}</body></html>`
  }
}

// the options a docs site's md() passes, and the plain ones
export const DOCS_OPTIONS: Options[] = [
  { url: 'https://a.example/docs/x' },
  {
    url: 'https://a.example/docs/',
    link: (url) => (url.origin === 'https://a.example' ? `${url.href}.md` : undefined),
  },
  {},
  { url: 'https://a.example/docs/x', extract: 'none' },
]

// a page's markdown on each path, as one string
export const paths = (html: string, options: Options) => {
  forcePath('hast')
  const tree = JSON.stringify(htmlToMarkdown(html, options))
  forcePath('core')
  const core = JSON.stringify(htmlToMarkdown(html, options))
  forcePath(undefined)
  return { tree, core }
}
const differs = (html: string, options: Options) => {
  const { tree, core } = paths(html, options)
  return tree !== core
}

// the smallest page that still differs: drop one token, or an element whole, while it does
const TOKEN = /<!--[\s\S]*?-->|<[^>]*>|[^<]+/g
export const minimize = (html: string, options: Options) => {
  let tokens: string[] = html.match(TOKEN) ?? []
  for (let changed = true; changed;) {
    changed = false
    for (let i = 0; i < tokens.length; i++) {
      const name = /^<([a-zA-Z][\w-]*)/.exec(tokens[i]!)?.[1]
      // the element and what's in it, to its close
      let end = i
      if (name) {
        let depth = 0
        for (let j = i; j < tokens.length; j++) {
          const t = tokens[j]!
          if (new RegExp(`^<${name}[\\s>]`, 'i').test(t)) depth++
          else if (new RegExp(`^</${name}\\s*>`, 'i').test(t) && --depth === 0) {
            end = j
            break
          }
        }
      }
      for (const [from, to] of end > i
        ? [
            [i, end],
            [i, i],
          ]
        : [[i, i]]) {
        const next = [...tokens.slice(0, from!), ...tokens.slice(to! + 1)]
        if (next.length && differs(next.join(''), options)) {
          tokens = next
          changed = true
          break
        }
      }
      // keep an element's tags, drop the tags alone
      if (!changed && end > i) {
        const next = [...tokens.slice(0, i), ...tokens.slice(i + 1, end), ...tokens.slice(end + 1)]
        if (differs(next.join(''), options)) {
          tokens = next
          changed = true
        }
      }
      if (changed) break
    }
  }
  return tokens.join('')
}

if (import.meta.main) {
  const count = Number(process.argv[2]) || 10000
  const seed = Number(process.argv[3]) || 1
  const next = docsPages(seed)
  const found = new Map<string, { options: number; tree: string; core: string; count: number }>()
  for (let i = 0; i < count; i++) {
    const html = next()
    const o = i % DOCS_OPTIONS.length
    if (!differs(html, DOCS_OPTIONS[o]!)) continue
    const small = minimize(html, DOCS_OPTIONS[o]!)
    const seen = found.get(small)
    if (seen) seen.count++
    else found.set(small, { options: o, ...paths(small, DOCS_OPTIONS[o]!), count: 1 })
  }
  console.log(`${count} pages (seed ${seed}), ${found.size} distinct minimized differences`)
  for (const [html, { options, tree, core, count: n }] of found)
    console.log(
      JSON.stringify({ html, options, n, tree: JSON.parse(tree), core: JSON.parse(core) }),
    )
}
