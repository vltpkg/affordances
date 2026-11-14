// what md's two paths need the same, the tree pipeline (index.ts) and md-core (core/), so they can't drift apart.
// md-core imports this, never index.ts

// page chrome: what a page wraps its content in, by tag or role
export const CHROME_TAGS = new Set(['nav', 'header', 'footer', 'aside', 'dialog'])
export const CHROME_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'complementary'])

// a code point a css escape names, or U+FFFD where css reads one instead: zero, a surrogate, or past the last code point
const codePoint = (hex: string) => {
  const code = Number.parseInt(hex, 16)
  return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
    ? '\ufffd'
    : String.fromCodePoint(code)
}
// a style attribute as css reads it: comments gone, escapes (n\one, \6e one) decoded
const cssText = (style: string) =>
  style
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, '')
    .replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?|\\([^\n0-9a-f])/gi, (_, hex: string, char: string) =>
      hex ? codePoint(hex) : char,
    )
// a style attribute's declarations as [property, value], lowercased, without !important
export type Declarations = [property: string, value: string][]
export const declarations = (style: string): Declarations =>
  cssText(style)
    .split(';')
    .map((declaration) => {
      const [property = '', value = ''] = declaration
        .split(':')
        .map((part) => part.trim().toLowerCase())
      return [property, value.replace(/\s*!\s*important$/, '')]
    })
// display: none, visibility: hidden or content-visibility: hidden in a style attribute, however it's spaced, cased,
// commented, escaped or marked !important. opacity: 0 isn't hidden: motion libraries render it on the server as the
// first frame of an entrance animation, so it would drop content people see a moment later
export const hides = (style: Declarations) =>
  style.some(
    ([property, keyword]) =>
      (property === 'display' && keyword === 'none') ||
      (property === 'visibility' && (keyword === 'hidden' || keyword === 'collapse')) ||
      (property === 'content-visibility' && keyword === 'hidden'),
  )

export const INLINE = new Set([
  'a',
  'span',
  'code',
  'strong',
  'em',
  'b',
  'i',
  'small',
  'time',
  'abbr',
])
// in a flex or grid container every child is its own box, bare text too, so a text node beside an element is
// laid out apart from it (configure<span>vlt</span> reads configure vlt). outside one, text beside an element is
// the same run of text (un<em>believ</em>able)
// (display: flex in a style, or tailwind's flex, inline-grid, md:flex)
export const LAID_OUT = /^([\w-]+:)*(inline-)?(flex|grid)$/
// an inline element made a box of its own (tailwind's block, flex or grid, or the same display) sits on its own line
// or in its own box, so it's apart from what's beside it whatever the characters: a cell's <span class="block">yarn
// (zpm)</span><span class="block">6.0.0</span> reads yarn (zpm) 6.0.0
export const BOXED = /^([\w-]+:)*(block|flex|grid)$/

// headers and summaries whose text is a button's (<th><button>Name</button></th>, a sortable column; <h3><button
// aria-expanded>Shipping</button></h3>, an accordion): with no text outside the buttons, the buttons' text is theirs
export const LABEL_HOSTS = new Set([
  'th',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'caption',
  'summary',
  'dt',
])

// elements that carry a value (a textarea's text, a select's options), which never leaves the page as a name
export const VALUED = new Set([
  'input',
  'select',
  'option',
  'optgroup',
  'textarea',
  'datalist',
  'output',
  'meter',
  'progress',
])
// a control whose text is a value, not a name: what someone typed or picked (an input, a select's options, a textarea,
// a contenteditable or role=textbox editor), or what a widget shows (output, meter, progress, a slider)
export const VALUE_ROLES = new Set(['spinbutton', 'slider'])

// the schemes a link or an image may keep, as a browser reads its url
export const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])
export const IMAGE_SCHEMES = new Set(['http:', 'https:'])

export const HTML_NS = 'http://www.w3.org/1999/xhtml'

// a heading's text from its pieces, a url shown as itself being null: without the url, nor the brackets right around it
const BRACKETS: Record<string, string> = { '(': ')', '[': ']', '<': '>' }
export const unbracketed = (pieces: (string | null)[]) => {
  pieces.forEach((piece, n) => {
    if (piece !== null) return
    const before = pieces[n - 1]
    const after = pieces[n + 1]
    const open = typeof before === 'string' ? /[([<]\s*$/.exec(before)?.[0] : undefined
    const close = typeof after === 'string' ? /^\s*([)\]>])/.exec(after) : undefined
    if (open && close && close[1] === BRACKETS[open.trim()]) {
      pieces[n - 1] = before!.slice(0, -open.length)
      pieces[n + 1] = after!.slice(close[0].length)
    }
  })
  return pieces.join('').replace(/\s+/g, ' ').trim() || undefined
}

// frontmatter, the handler's for a markdown.ts page too
export const yaml = (data: Record<string, string | undefined>) => {
  const lines = Object.entries(data).flatMap(([key, value]) =>
    value ? [`${key}: ${JSON.stringify(value)}`] : [],
  )
  return lines.length ? `---\n${lines.join('\n')}\n---\n\n` : ''
}

// the page's canonical, if it's an http(s) url that fits in a Link header: never one with a , or ; that would end the
// header's value early (URL already encodes <, >, quotes and whitespace)
export const canonicalOf = (href: string | undefined, base: string | undefined) => {
  if (!href) return undefined
  try {
    const url = new URL(href, base)
    return /^https?:$/.test(url.protocol) && !/[,;]/.test(url.href) ? url.href : undefined
  } catch {
    return undefined
  }
}

// a fence longer than any run of backticks in what it holds, so text that isn't valid json can't close it
export const fenced = (lang: string, value: string) => {
  const fence = '`'.repeat(Math.max(3, ...(value.match(/`+/g) ?? []).map((run) => run.length + 1)))
  return `${fence}${lang}\n${value}\n${fence}`
}
export const pretty = (raw: string) => {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

// text with its whitespace collapsed
export const collapsed = (value: string) => value.replace(/\s+/g, ' ').trim()
// what a site's title template puts between a page's name and the rest ("Cart · Acme", "Acme | Cart"). a colon isn't
// one: "Cart: details" says more than "Cart"
export const TITLE_SEPARATORS = '·|–—-'
// text as a regular expression that matches it literally
export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// the page's title: its <title>, or its h1 when the <title> is the h1 and the site's name in a template, the h1 on
// either side, a separator between, with whitespace around it. any other <title> is the page's own, as written
export const pageTitle = (title: string | undefined, h1: string | undefined) => {
  const said = title === undefined ? undefined : collapsed(title)
  if (!said || !h1) return title
  const name = escapeRegExp(h1)
  const separator = ` [${TITLE_SEPARATORS}] `
  return new RegExp(`^${name}${separator}\\S|\\S${separator}${name}$`).test(said) ? h1 : title
}
