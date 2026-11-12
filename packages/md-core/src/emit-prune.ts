import { decode } from './entities.ts'
import type { Element, Node } from './types.ts'

// what @affordances/md's prune and extract leave of the page, read lazily: kidsOf(el) is an element's children as
// prune leaves them (hidden things gone, empty links named or gone, inline boxes spaced, repeated links once), cached
// on the element for the emit call that asked. nothing is copied unless it changes

// the cache, on the element itself: the pruned children and the emit call they're for
// pk, pe: the pruned children and the emit call they're for; lv, le: whether it's code, and for which call; pf: the
// attribute names it has that anything here reads (-1 before they're read)
type Pruned = Element & {
  pk?: Node[] | undefined
  pe?: number
  lv?: boolean
  le?: number
  pf?: number
}
// the cache's fields, added at once and in one order, so every element the parser made has one shape after
const touch = (el: Pruned) => {
  if (el.pe === undefined) {
    el.pk = undefined
    el.pe = -1
    el.lv = false
    el.le = -1
    el.pf = -1
  }
}
let epoch = 0
// chrome (nav, header, footer, …) is stripped too: the page has no <main>
let stripChrome = false
export const begin = (strip: boolean) => {
  epoch++
  stripChrome = strip
  byId = undefined
}
let page: Element | undefined
export const setPage = (root: Element) => {
  page = root
  byId = undefined
}

// an element prune made, already pruned
export const made = (from: Element, kids: Node[], tag = from.tag): Element => {
  const el: Pruned = {
    tag,
    attrs: from.attrs,
    kids,
    up: from.up,
    map: from.map,
    pk: kids,
    pe: epoch,
    lv: false,
    le: -1,
    pf: (from as Pruned).pf ?? -1,
  }
  return el
}

const CHROME_TAGS = new Set(['nav', 'header', 'footer', 'aside', 'dialog'])
const CHROME_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'complementary'])

// the attribute names an element has, of those read here: one scan of its attributes, ever. most elements have
// none of them, and the scan is far cheaper than parsing every element's attributes
const HIDDEN = 1
const ARIA_HIDDEN = 2
const STYLE = 4
const ROLE = 8
const EDITABLE = 16
const MARKED = 32
export const MDAST = 64
export const DATA_TITLE = 128
export const NOWRAP = 256
export const TITLE = 512
export const SPAN = 1024
export const ALIGN = 2048
const PRUNES = HIDDEN | ARIA_HIDDEN | STYLE | ROLE | EDITABLE | MARKED
const space = (code: number) =>
  code === 32 || code === 9 || code === 10 || code === 12 || code === 13
// whether the name at start is this word: compared by hand, first character first (most names aren't ours)
const is = (s: string, start: number, word: string) => {
  for (let k = 0; k < word.length; k++)
    if (s.charCodeAt(start + k) !== word.charCodeAt(k)) return false
  return true
}
const named = (s: string, start: number, length: number) => {
  const head = s.charCodeAt(start)
  switch (length) {
    case 4:
      return head === 114 && is(s, start, 'role') ? ROLE : 0
    case 5:
      return head === 115 && is(s, start, 'style')
        ? STYLE
        : head === 116 && is(s, start, 'title')
          ? TITLE
          : head === 97 && is(s, start, 'align')
            ? ALIGN
            : 0
    case 7:
      return (head === 114 && is(s, start, 'rowspan')) || (head === 99 && is(s, start, 'colspan'))
        ? SPAN
        : 0
    case 6:
      return head === 104 && is(s, start, 'hidden')
        ? HIDDEN
        : head === 110 && is(s, start, 'nowrap')
          ? NOWRAP
          : 0
    case 9:
      return head === 100 && is(s, start, 'data-mode') ? MARKED : 0
    case 10:
      return head !== 100
        ? 0
        : is(s, start, 'data-mdast')
          ? MDAST
          : is(s, start, 'data-title')
            ? DATA_TITLE
            : 0
    case 11:
      return head === 97 && is(s, start, 'aria-hidden') ? ARIA_HIDDEN : 0
    case 15:
      return head === 99 && is(s, start, 'contenteditable') ? EDITABLE : 0
    case 19:
      return head === 100 && is(s, start, 'data-affordances-md') ? MARKED : 0
  }
  return 0
}
// the attribute names, as the tokenizer reads them, jumping over quoted values (most of the string); names as
// written in lowercase, as pages write them
const scan = (s: string) => {
  const n = s.length
  let found = 0
  let i = 0
  while (i < n) {
    let c = s.charCodeAt(i)
    while (space(c) || c === 47) c = s.charCodeAt(++i)
    if (i >= n) break
    const start = i
    if (c === 61) i++
    while (i < n) {
      c = s.charCodeAt(i)
      if (space(c) || c === 47 || c === 61) break
      i++
    }
    found |= named(s, start, i - start)
    while (space(c)) c = s.charCodeAt(++i)
    if (c === 61) {
      c = s.charCodeAt(++i)
      while (space(c)) c = s.charCodeAt(++i)
      if (c === 34 || c === 39) {
        const end = s.indexOf(c === 34 ? '"' : "'", i + 1)
        i = end < 0 ? n : end + 1
      } else while (i < n && !space(s.charCodeAt(i))) i++
    }
  }
  return found
}
// one attribute's value, as read() reads it (decoded; '' without a value; the first of a repeated name), without
// parsing the rest: a scan to its name. names as written in lowercase, as with the scan above
export const read = (el: Element, name: string): string | undefined => {
  if (el.map !== undefined) return el.map.get(name)
  const s = el.attrs
  const n = s.length
  let i = 0
  while (i < n) {
    let c = s.charCodeAt(i)
    while (space(c) || c === 47) c = s.charCodeAt(++i)
    if (i >= n) break
    const start = i
    if (c === 61) i++
    while (i < n) {
      c = s.charCodeAt(i)
      if (space(c) || c === 47 || c === 61) break
      i++
    }
    const match = i - start === name.length && is(s, start, name)
    while (space(c)) c = s.charCodeAt(++i)
    let value = ''
    if (c === 61) {
      c = s.charCodeAt(++i)
      while (space(c)) c = s.charCodeAt(++i)
      if (c === 34 || c === 39) {
        const end = s.indexOf(c === 34 ? '"' : "'", i + 1)
        if (match) value = s.slice(i + 1, end < 0 ? n : end)
        i = end < 0 ? n : end + 1
      } else {
        const from = i
        while (i < n && !space(s.charCodeAt(i))) i++
        if (match) value = s.slice(from, i)
      }
    }
    if (match) return decode(value, true)
  }
  return undefined
}
export const flags = (el: Element): number => {
  if (el.attrs === '') return 0
  const cached = el as Pruned
  touch(cached)
  if (cached.pf! < 0) cached.pf = scan(el.attrs)
  return cached.pf!
}
const mentions = (el: Element) => (flags(el) & PRUNES) !== 0
const marked = (el: Element) =>
  el.tag === 'affordances-md' ? read(el, 'data-mode') : read(el, 'data-affordances-md')
const unhidden = (el: Element) => {
  const mode = flags(el) & MARKED ? marked(el) : undefined
  return mode === 'only' || mode === 'show'
}

// a style attribute's declarations as [property, value], lowercased, without !important
const codePoint = (hex: string) => {
  const code = Number.parseInt(hex, 16)
  return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
    ? '\ufffd'
    : String.fromCodePoint(code)
}
const cssText = (style: string) =>
  style
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, '')
    .replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?|\\([^\n0-9a-f])/gi, (_, hex: string, char: string) =>
      hex ? codePoint(hex) : char,
    )
type Declarations = [property: string, value: string][]
const declarations = (style: string): Declarations =>
  cssText(style)
    .split(';')
    .map((declaration) => {
      const [property = '', value = ''] = declaration
        .split(':')
        .map((part) => part.trim().toLowerCase())
      return [property, value.replace(/\s*!\s*important$/, '')]
    })
// display: none, visibility: hidden or content-visibility: hidden, however it's written; a style that can't say
// any of it (no such keyword, no escape, no comment) isn't parsed
const HIDING = /none|hidden|collapse|[\\/]/i
const styleHidden = (style: string | undefined) =>
  style !== undefined &&
  HIDING.test(style) &&
  declarations(style).some(
    ([property, keyword]) =>
      (property === 'display' && keyword === 'none') ||
      (property === 'visibility' && (keyword === 'hidden' || keyword === 'collapse')) ||
      (property === 'content-visibility' && keyword === 'hidden'),
  )
// whether a style's display is one of these
const DISPLAY = /display|[\\/]/i
const styleDisplays = (style: string | undefined, display: RegExp) =>
  style !== undefined &&
  DISPLAY.test(style) &&
  declarations(style).some(([property, value]) => property === 'display' && display.test(value))
export const role = (el: Element) => read(el, 'role') ?? ''
const editor = (el: Element) => {
  const r = role(el)
  if (r === 'textbox' || r === 'searchbox') return true
  const editable = read(el, 'contenteditable')
  return editable !== undefined && editable !== 'false'
}

// what prune leaves out, with everything in it: what's hidden from people (unless marked for agents), what's marked
// skip, and editors, whose text is what someone typed
const dropped = (el: Element): boolean => {
  const found = flags(el)
  if ((found & PRUNES) === 0) return false
  const mode = found & MARKED ? marked(el) : undefined
  if (mode === 'skip') return true
  if (found & (ROLE | EDITABLE) && editor(el)) return true
  if (mode === 'only' || mode === 'show') return false
  return (
    (found & HIDDEN) !== 0 ||
    ((found & ARIA_HIDDEN) !== 0 && read(el, 'aria-hidden') === 'true') ||
    ((found & STYLE) !== 0 && styleHidden(read(el, 'style')))
  )
}
const chrome = (el: Element) => {
  const maybe = mentions(el)
  return (
    (CHROME_TAGS.has(el.tag) || (maybe && CHROME_ROLES.has(role(el)))) && !(maybe && unhidden(el))
  )
}

// whether prune drops an element or what holds it
const hiddenAbove = (el: Element) => {
  for (let at: Element | null = el; at; at = at.up) if (dropped(at)) return true
  return false
}
// the page's <main>: the outermost, a real <main> before a role=main, among what prune keeps. the walk reads tags
// alone, and asks whether a landmark it finds is hidden only then
export const findMain = (root: Element): Element | undefined => {
  let byRole: Element | undefined
  const walk = (parent: Element): Element | undefined => {
    for (const kid of parent.kids) {
      if (typeof kid === 'string') continue
      if (kid.tag === 'main') {
        if (!hiddenAbove(kid)) return kid
        continue
      }
      if (
        kid.attrs !== '' &&
        kid.attrs.indexOf('main') >= 0 &&
        flags(kid) & ROLE &&
        role(kid) === 'main'
      ) {
        if (!hiddenAbove(kid)) byRole ??= kid
        continue
      }
      const found = walk(kid)
      if (found) return found
    }
    return undefined
  }
  return walk(root) ?? byRole
}

// the page's ids, among what prune keeps, once a link's label needs them
let byId: Map<string, Element> | undefined
const ids = () => {
  if (byId) return byId
  byId = new Map()
  const walk = (parent: Element) => {
    for (const kid of parent.kids) {
      if (typeof kid === 'string' || dropped(kid)) continue
      const id = read(kid, 'id')
      if (id !== undefined && !byId!.has(id)) byId!.set(id, kid)
      walk(kid)
    }
  }
  if (page) walk(page)
  return byId
}

const ASCII_SPACE = /[\t\n\f\r ]+/
export const classes = (el: Element): string[] => {
  const value = read(el, 'class')
  return value ? value.split(ASCII_SPACE).filter(Boolean) : []
}

// an element's text, as hast-util-to-string reads it: every text in it, as written
export const toString = (node: Node): string => {
  if (typeof node === 'string') return node
  let text = ''
  for (const kid of kidsOf(node)) text += typeof kid === 'string' ? kid : toString(kid)
  return text
}
export const text = (node: Node | undefined) =>
  node === undefined ? '' : toString(node).replace(/\s+/g, ' ').trim()

const VALUED = new Set([
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
const VALUE_ROLES = new Set(['spinbutton', 'slider'])
// a control whose text is a value, not a name
const valueBearing = (el: Element) =>
  VALUED.has(el.tag) || (mentions(el) && (VALUE_ROLES.has(role(el)) || editor(el)))

// children without the descendants drop picks, at any depth; the same array when nothing goes
const without = (kids: Node[], drop: (el: Element) => boolean): Node[] => {
  let out: Node[] | undefined
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i]!
    if (typeof kid === 'string') {
      out?.push(kid)
      continue
    }
    if (drop(kid)) {
      out ??= kids.slice(0, i)
      continue
    }
    const inner = kidsOf(kid)
    const kept = without(inner, drop)
    if (kept !== inner) {
      out ??= kids.slice(0, i)
      out.push(made(kid, kept))
    } else out?.push(kid)
  }
  return out ?? kids
}
// children with elements of one tag replaced by what's in them, at any depth
const unwrap = (kids: Node[], tag: string): Node[] =>
  kids.flatMap((kid): Node[] =>
    typeof kid === 'string'
      ? [kid]
      : kid.tag === tag
        ? unwrap(kidsOf(kid), tag)
        : [made(kid, unwrap(kidsOf(kid), tag))],
  )

// a name's words: what an element says, without its controls or what's never content
const words = (el: Element | undefined): string =>
  el && !valueBearing(el)
    ? text(
        made(
          el,
          without(kidsOf(el), (inner) => valueBearing(inner) || inner.tag === 'button'),
        ),
      )
    : ''
// what an icon or avatar link is called without content: its aria-labelledby, aria-label or title
export const linkLabel = (a: Element): string => {
  if (a.attrs === '') return ''
  const labelledBy = read(a, 'aria-labelledby')
  if (labelledBy) {
    const names = labelledBy
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((id) => ids().get(id) ?? [])
      .map(words)
      .filter(Boolean)
      .join(' ')
    if (names) return names
  }
  return (read(a, 'aria-label') ?? '').trim() || (read(a, 'title') ?? '').trim()
}

// images with a description, which an agent can read
const described = (node: Node): Element[] => {
  const found: Element[] = []
  const walk = (el: Element) => {
    for (const kid of kidsOf(el)) {
      if (typeof kid === 'string') continue
      if (kid.tag === 'img' && read(kid, 'alt')) found.push(kid)
      walk(kid)
    }
  }
  if (typeof node !== 'string') walk(node)
  return found
}
const hasDescribed = (node: Node): boolean => {
  if (typeof node === 'string') return false
  for (const kid of kidsOf(node)) {
    if (typeof kid === 'string') continue
    if ((kid.tag === 'img' && read(kid, 'alt')) || hasDescribed(kid)) return true
  }
  return false
}
const nothingToRead = (node: Element) => !toString(node).trim() && !hasDescribed(node)

const INLINE = new Set(['a', 'span', 'code', 'strong', 'em', 'b', 'i', 'small', 'time', 'abbr'])
const isInline = (node: Node | undefined): node is Element =>
  node !== undefined && typeof node !== 'string' && INLINE.has(node.tag)
const isBlank = (node: Node | undefined) => typeof node === 'string' && !node.trim()
const emptyBlock = (el: Element) =>
  !INLINE.has(el.tag) && el.tag !== 'img' && el.tag !== 'br' && nothingToRead(el)
const linkDrop = (el: Element) => valueBearing(el) || emptyBlock(el)

// links and the text it renders as: its text, else its described images, else its label
const linkText = (a: Element) =>
  text(a) ||
  described(a)
    .map((img) => `${read(img, 'alt')} ${read(img, 'src')}`)
    .join(' ') ||
  linkLabel(a)

// a skeleton table (placeholder cells waiting on data): nothing to read in any cell, or a header over empty rows
const cellsOf = (row: Element, tags: Set<string>) =>
  kidsOf(row).filter((cell): cell is Element => typeof cell !== 'string' && tags.has(cell.tag))
const CELLS = new Set(['td', 'th'])
const TD = new Set(['td'])
const emptyRow = (row: Element) =>
  cellsOf(row, CELLS).every((cell) => !text(cell) && !hasDescribed(cell))
const skeleton = (table: Element) => {
  const rows: Element[] = []
  const header = new Set<Element>()
  const walk = (parent: Element, inHead: boolean) => {
    for (const kid of kidsOf(parent)) {
      if (typeof kid === 'string') continue
      if (kid.tag === 'tr') {
        rows.push(kid)
        if (inHead) header.add(kid)
      }
      walk(kid, inHead || kid.tag === 'thead')
    }
  }
  walk(table, false)
  const first = rows[0]
  if (!header.size && first && !cellsOf(first, TD).length) header.add(first)
  const body = rows.filter((row) => !header.has(row))
  return rows.every(emptyRow) || (body.length > 0 && body.every(emptyRow))
}

// headers and summaries whose text is a button's read as the button's text
const LABEL_HOSTS = new Set(['th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'caption', 'summary', 'dt'])
const hasTag = (el: Element, tag: string): boolean => {
  for (const kid of kidsOf(el))
    if (typeof kid !== 'string' && (kid.tag === tag || hasTag(kid, tag))) return true
  return false
}

// what a child becomes: itself, something prune made of it, or nothing
const pruned = (kid: Element): Element | undefined => {
  if (dropped(kid) || (stripChrome && chrome(kid))) return undefined
  if (kid.tag === 'a') {
    const inner = kidsOf(kid)
    const kept = without(inner, linkDrop)
    let link = kept === inner ? kid : made(kid, kept)
    if (nothingToRead(link)) {
      const label = linkLabel(kid)
      if (!label) return undefined
      link = made(kid, [label])
    }
    return link
  }
  if (LABEL_HOSTS.has(kid.tag)) {
    const inner = kidsOf(kid)
    const buttons = hasTag(kid, 'button')
    if (
      buttons
        ? text(
            made(
              kid,
              without(inner, (el) => el.tag === 'button'),
            ),
          )
        : text(kid)
    )
      return kid
    // read as its name, so without what carries a value
    const kept = without(inner, valueBearing)
    if (buttons) return made(kid, unwrap(kept, 'button'))
    return kept === inner ? kid : made(kid, kept)
  }
  if (kid.tag === 'table' && skeleton(kid)) return undefined
  return kid
}

// whether text in an element is code, as written: no spacing there. cached with the children, 1 or 2
const literal = (el: Element): boolean => {
  const cached = el as Pruned
  touch(cached)
  if (cached.le === epoch) return cached.lv!
  const value = el.tag === 'pre' || el.tag === 'code' || (el.up !== null && literal(el.up))
  cached.le = epoch
  cached.lv = value
  return value
}

// display classes and styles: laid out side by side (flex, grid), or a box of its own
const LAID_OUT = /^([\w-]+:)*(inline-)?(flex|grid)$/
const BOXED = /^([\w-]+:)*(block|flex|grid)$/
const displays = (el: Element, display: RegExp) =>
  el.attrs !== '' &&
  (classes(el).some((name) => display.test(name)) || styleDisplays(read(el, 'style'), display))
const BOXISH = /block|flex|grid|display|\\/
const boxed = (node: Node | undefined) =>
  isInline(node) && BOXISH.test(node.attrs) && displays(node, BOXED)
// a run of one-character elements is one word split for styling, so only longer words are spaced
const word = (node: Node | undefined) => {
  const said = isInline(node) ? toString(node).trim() : typeof node === 'string' ? node : ''
  return longer(said) ? said : ''
}
// more than one character, counting code points
const longer = (said: string) => {
  const trimmed = said.trim()
  if (trimmed.length !== 2) return trimmed.length > 2
  const head = trimmed.charCodeAt(0)
  const tail = trimmed.charCodeAt(1)
  return !(head >= 0xd800 && head <= 0xdbff && tail >= 0xdc00 && tail <= 0xdfff)
}
const edgeLink = (node: Node | undefined, end: boolean): Element | undefined => {
  if (!isInline(node)) return undefined
  if (node.tag === 'a') return node
  const inside = kidsOf(node).filter((kid) => !isBlank(kid))
  return edgeLink(end ? inside.at(-1) : inside[0], end)
}
const soleLink = (node: Node | undefined): Element | undefined => {
  if (!isInline(node)) return undefined
  if (node.tag === 'a') return node
  const inside = kidsOf(node).filter((kid) => !isBlank(kid))
  return inside.length === 1 ? soleLink(inside[0]) : undefined
}
const LETTER_END = /[\p{L}\p{N}]$/u
const LETTER_START = /^[\p{L}\p{N}]/u

// inline boxes side by side with no text between get a space where a word meets a word (or a link a link, or a box
// anything); then a run of the same link reads once
const spaced = (parent: Element, kids: Node[]): Node[] => {
  let out: Node[] | undefined
  let items: boolean | undefined
  const said: (string | undefined)[] = []
  const boxes: (boolean | undefined)[] = []
  const wordAt = (i: number) => (said[i] ??= word(kids[i]))
  const boxedAt = (i: number) => (boxes[i] ??= boxed(kids[i]))
  let inlines = 0
  for (let i = 0; i < kids.length; i++) {
    const left = kids[i]!
    const right = kids[i + 1]
    const leftInline = isInline(left)
    if (leftInline) inlines++
    out?.push(left)
    if (right === undefined) break
    const rightInline = isInline(right)
    if (!leftInline && !rightInline) continue
    if ((!leftInline && typeof left !== 'string') || (!rightInline && typeof right !== 'string'))
      continue
    let gap: boolean
    if (leftInline && rightInline && edgeLink(left, true) && edgeLink(right, false)) gap = true
    else {
      const leftWord = wordAt(i)
      const rightWord = wordAt(i + 1)
      const letters = LETTER_END.test(leftWord) && LETTER_START.test(rightWord)
      const both = leftWord !== '' && rightWord !== ''
      if (!letters && !both) continue
      const box = boxedAt(i) || boxedAt(i + 1)
      gap = letters || (box && both)
      // text beside an element is a box of its own only in a flex or grid container, or beside a box
      if (gap && !(leftInline && rightInline)) gap = box || (items ??= displays(parent, LAID_OUT))
    }
    if (gap) {
      out ??= kids.slice(0, i + 1)
      out.push(' ')
    }
  }
  let result = out ?? kids
  if (inlines < 2) return result
  // a run of the same link, only whitespace between, reads as one
  let kept: Node[] | undefined
  for (let i = 0; i < result.length; i++) {
    const child = result[i]!
    const current = soleLink(child)
    if (current) {
      const list = kept ?? result
      let at = kept ? kept.length : i
      while (at > 0 && isBlank(list[at - 1])) at--
      const previous = soleLink(list[at - 1])
      if (
        previous &&
        (read(previous, 'href') ?? '').trim() === (read(current, 'href') ?? '').trim() &&
        linkText(previous) === linkText(current)
      ) {
        kept ??= result.slice(0, i)
        kept.length = at
        continue
      }
    }
    kept?.push(child)
  }
  result = kept ?? result
  return result
}

// an element's children as prune leaves them
export const kidsOf = (el: Element): Node[] => {
  const cached = el as Pruned
  if (cached.pe === epoch) return cached.pk!
  touch(cached)
  const raw = el.kids
  let out: Node[] | undefined
  for (let i = 0; i < raw.length; i++) {
    const kid = raw[i]!
    if (typeof kid === 'string') {
      out?.push(kid)
      continue
    }
    const kept = pruned(kid)
    if (kept !== kid) out ??= raw.slice(0, i)
    if (out && kept) out.push(kept)
  }
  let kids = out ?? raw
  if (kids.length > 1 && !literal(el)) kids = spaced(el, kids)
  cached.pk = kids
  cached.pe = epoch
  return kids
}
