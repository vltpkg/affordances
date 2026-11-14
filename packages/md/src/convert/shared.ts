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

// whether a table is written as a grid: GFM pads each row to the widest and fills each spanned cell's span with empty
// cells, down the rows there are, so a rowspan of thousands down thousands of rows (or one wide row over many short
// ones) makes a grid quadratic in what the page wrote. a grid is written while it stays within GRID_FACTOR times the
// table's cells, and GRID_SPARE more; past that, the table is its cells in row order, as text. counted from each row's
// cells as [colspan, rowspan] (each `parseInt || 1`, as the grid reads them), before anything is built
const GRID_FACTOR = 4
const GRID_SPARE = 64
export const gridFits = (rows: [colSpan: number, rowSpan: number][][]) => {
  let cells = 0
  let columns = 1
  // the empty cells each row gains: those of its own colspans, and those its rows above span down into it, kept as
  // where each of those starts and stops
  const own = Array.from({ length: rows.length }, () => 0)
  const down = Array.from({ length: rows.length + 1 }, () => 0)
  let spanned = 0
  for (let row = 0; row < rows.length; row++) {
    for (const [colSpan, rowSpan] of rows[row]!) {
      if ((colSpan > 1 || rowSpan > 1) && colSpan >= 1 && rowSpan >= 1) {
        own[row]! += colSpan - 1
        down[row + 1]! += colSpan
        down[Math.min(row + rowSpan, rows.length)]! -= colSpan
      }
    }
    cells += rows[row]!.length
    spanned += down[row]!
    columns = Math.max(columns, rows[row]!.length + own[row]! + spanned)
  }
  return rows.length * columns <= GRID_FACTOR * cells + GRID_SPARE
}

// the children of the parents react's streamed moves splice, as linked lists while the moves are made: a move then
// costs what it takes out and puts in, where finding its place and splicing the array cost the whole list, quadratic
// in boundaries in one parent. each list is written back to its parent's array, in place, once the moves are done
type Slot<N> = {
  node: N
  next: Slot<N> | undefined
  prev: Slot<N> | undefined
  head: Slot<N> | undefined
  out: boolean
}
export class Spliced<P extends object, N> {
  readonly #kids: (parent: P) => N[]
  // each parent's list, by an empty slot before its first child
  readonly #lists = new Map<P, Slot<N>>()
  // each element's slot (a text is never looked for)
  readonly #slots = new Map<N, Slot<N>>()
  constructor(kids: (parent: P) => N[]) {
    this.#kids = kids
  }
  #list(parent: P) {
    let head = this.#lists.get(parent)
    if (head === undefined) {
      head = { node: undefined as N, next: undefined, prev: undefined, head: undefined, out: false }
      this.#lists.set(parent, head)
      let last = head
      for (const node of this.#kids(parent)) last = this.#after(head, last, node)
    }
    return head
  }
  #after(head: Slot<N>, slot: Slot<N>, node: N): Slot<N> {
    const made: Slot<N> = { node, next: slot.next, prev: slot, head, out: false }
    if (slot.next) slot.next.prev = made
    slot.next = made
    if (typeof node === 'object' && node !== null) this.#slots.set(node, made)
    return made
  }
  // where a node is among its parent's children, or undefined where it isn't (a move took it out)
  find(parent: P, node: N): Slot<N> | undefined {
    const head = this.#list(parent)
    const slot = this.#slots.get(node)
    return slot && !slot.out && slot.head === head ? slot : undefined
  }
  // a parent's children as they are now
  kids(parent: P): N[] {
    const head = this.#lists.get(parent)
    if (head === undefined) return [...this.#kids(parent)]
    const kids: N[] = []
    for (let slot = head.next; slot; slot = slot.next) kids.push(slot.node)
    return kids
  }
  // the children from one up to another (or the end) taken out, and these put in their place
  take(from: Slot<N>, to: Slot<N> | undefined, put: N[]) {
    const head = from.head!
    const before = from.prev!
    for (let slot: Slot<N> | undefined = from; slot && slot !== to; slot = slot.next)
      slot.out = true
    before.next = to
    if (to) to.prev = before
    let last = before
    for (const node of put) last = this.#after(head, last, node)
  }
  // a parent left with no children: the caller empties its array
  clear(parent: P) {
    const head = this.#lists.get(parent)
    if (head === undefined) return
    for (let slot = head.next; slot; slot = slot.next) slot.out = true
    head.next = undefined
  }
  // whether a node is among its parent's children, once the moves are done
  has(parent: P, node: N) {
    const head = this.#lists.get(parent)
    return head === undefined
      ? this.#kids(parent).includes(node)
      : this.find(parent, node) !== undefined
  }
  // each list written back to its parent
  done() {
    for (const [parent, head] of this.#lists) {
      const kids = this.#kids(parent)
      kids.length = 0
      for (let slot = head.next; slot; slot = slot.next) kids.push(slot.node)
    }
  }
}
