import { attr } from './attr.ts'
import { FLAG, type Element, type Node } from './types.ts'

// what @affordances/md's prune and extract leave of the page, read lazily: kidsOf(el) is an element's children as
// prune leaves them (hidden things gone, empty links named or gone, inline boxes spaced, repeated links once), kept
// for the emit call that asked. nothing is copied unless it changes; an element of text alone isn't kept at all

// emit owns its document and prunes it in place: an element's kids become what prune leaves, once, and pruned says so
// chrome (nav, header, footer, …) is stripped too: the page has no <main>
let stripChrome = false
// whether this page's chrome is stripped: only once it's pruned, as @affordances/md strips it, so what prune reads
// around it (a link's text, a heading's, the spacing) still has it
export const strips = () => stripChrome
export const begin = (strip: boolean) => {
  stripChrome = strip
  byId = undefined
  tabs = undefined
}
// the tabs that label a shown panel (data-affordances-md="show"), on a page with markers: their tablists go, since
// each panel is headed by its tab
let tabs: Set<string> | undefined
// the slots with a fill, and the fill: each is the fill, as block markdown, and what's in it never converts
let fills: Map<Element, string> | undefined
export const setFills = (filled: Map<Element, string>) => {
  fills = filled.size ? filled : undefined
}
export const setTabs = (labels: Set<string> | undefined) => {
  tabs = labels?.size ? labels : undefined
}
// each shown tab panel's heading, as @affordances/md finds its tabs
let headings: Map<Element, string> | undefined
export const setHeadings = (found: Map<Element, string> | undefined) => {
  headings = found
}
let page: Element | undefined
export const setPage = (root: Element) => {
  page = root
  byId = undefined
}
// and all of it let go, once the call that read the page is done
export const endPage = () => {
  page = fills = headings = tabs = byId = undefined
}

// an element prune made, already pruned
export const made = (from: Element, kids: Node[], tag = from.tag): Element => {
  const el: Element = {
    tag,
    attrs: from.attrs,
    flags: from.flags,
    kids,
    up: from.up,
    map: from.map,
    pruned: true,
    code: from.code,
    // a copy of an <AgentText> or a filled slot is still its markdown
    verbatim: from.verbatim,
  }
  return el
}

const CHROME_TAGS = new Set(['nav', 'header', 'footer', 'aside', 'dialog'])
const CHROME_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'complementary'])

// the attributes prune reads, by their flags
const HIDDEN = FLAG.hidden
const ARIA_HIDDEN = FLAG['aria-hidden']
const STYLE = FLAG.style
const ROLE = FLAG.role
const EDITABLE = FLAG.contenteditable
const MARKED = FLAG['data-affordances-md'] | FLAG['data-mode']
const PRUNES = HIDDEN | ARIA_HIDDEN | STYLE | ROLE | EDITABLE | MARKED
const flags = (el: Element): number => el.flags
const mentions = (el: Element) => (el.flags & PRUNES) !== 0
// a marker's mode; on any other element, data-affordances-md says only skip or show (only and the rest are a marker's)
export const marked = (el: Element) => {
  if (el.tag === 'affordances-md') return attr(el, 'data-mode')
  const mode = attr(el, 'data-affordances-md')
  return mode === 'skip' || mode === 'show' ? mode : undefined
}
export const unhidden = (el: Element) => {
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
export const role = (el: Element) => (el.flags & ROLE ? (attr(el, 'role') ?? '') : '')
export const isTablist = (el: Element) => role(el) === 'tablist'
const editor = (el: Element) => {
  const r = role(el)
  if (r === 'textbox' || r === 'searchbox') return true
  const editable = attr(el, 'contenteditable')
  return editable !== undefined && editable !== 'false'
}

// what prune leaves out, with everything in it: what's hidden from people (unless marked for agents), what's marked
// skip, and editors, whose text is what someone typed
// what an attribute source says about being dropped, remembered: highlighted code repeats a few style="color:…"
// sources thousands of times. kept small, and only for what the source alone decides (not affordances-md's tag)
const droppedBy = new Map<string, boolean>()
export const dropped = (el: Element): boolean => {
  if ((el.flags & PRUNES) === 0) return false
  if (el.tag === 'affordances-md') return droppedNow(el)
  let known = droppedBy.get(el.attrs)
  if (known === undefined) {
    if (droppedBy.size > 1024) droppedBy.clear()
    droppedBy.set(el.attrs, (known = droppedNow(el)))
  }
  return known
}
const droppedNow = (el: Element): boolean => {
  const found = flags(el)
  const mode = found & MARKED ? marked(el) : undefined
  if (mode === 'skip') return true
  if (found & (ROLE | EDITABLE) && editor(el)) return true
  if (mode === 'only' || mode === 'show') return false
  return (
    (found & HIDDEN) !== 0 ||
    ((found & ARIA_HIDDEN) !== 0 && attr(el, 'aria-hidden') === 'true') ||
    ((found & STYLE) !== 0 && styleHidden(attr(el, 'style')))
  )
}
export const chrome = (el: Element) => {
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
// the page's <main>: of the landmarks the parser found, the outermost among what prune keeps, a real <main> before a
// role=main
export const findMain = (mains: Element[]): Element | undefined => {
  const kept = mains.filter((el) => !hiddenAbove(el))
  const inside = new Set(kept)
  const outermost = kept.filter((el) => {
    for (let at = el.up; at; at = at.up) if (inside.has(at)) return false
    return true
  })
  return outermost.find((el) => el.tag === 'main') ?? outermost[0]
}

// the page's ids, among what prune keeps, once a link's label needs them
let byId: Map<string, Element> | undefined
const ids = () => {
  if (byId) return byId
  byId = new Map()
  const walk = (parent: Element) => {
    for (const kid of parent.kids) {
      if (typeof kid === 'string' || dropped(kid)) continue
      const id = attr(kid, 'id')
      if (id !== undefined && !byId!.has(id)) byId!.set(id, kid)
      // an <AgentText> says its markdown, never what's inside it
      if (!isText(kid)) walk(kid)
    }
  }
  if (page) walk(page)
  return byId
}

const ASCII_SPACE = /[\t\n\f\r ]+/
export const classes = (el: Element): string[] => {
  const value = attr(el, 'class')
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
export const valueBearing = (el: Element) =>
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
export const words = (el: Element | undefined): string =>
  el && !valueBearing(el)
    ? text(
        made(
          el,
          without(kidsOf(el), (inner) => valueBearing(inner) || inner.tag === 'button'),
        ),
      )
    : ''
// what an icon or avatar link is called without content: its aria-labelledby, aria-label or title
// the ids are looked up only for a link that has an aria-labelledby: gathering them reads every element's id
export const linkLabel = (a: Element, named: () => Map<string, Element> = ids): string => {
  if (a.attrs === '') return ''
  const labelledBy = attr(a, 'aria-labelledby')
  if (labelledBy) {
    const found = named()
    const names = labelledBy
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((id) => found.get(id) ?? [])
      .map(words)
      .filter(Boolean)
      .join(' ')
    if (names) return names
  }
  return (attr(a, 'aria-label') ?? '').trim() || (attr(a, 'title') ?? '').trim()
}

// images with a description, which an agent can read
const described = (node: Node): Element[] => {
  const found: Element[] = []
  const walk = (el: Element) => {
    for (const kid of kidsOf(el)) {
      if (typeof kid === 'string') continue
      if (kid.tag === 'img' && attr(kid, 'alt')) found.push(kid)
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
    if ((kid.tag === 'img' && attr(kid, 'alt')) || hasDescribed(kid)) return true
  }
  return false
}
const nothingToRead = (node: Element) => !toString(node).trim() && !hasDescribed(node)

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
    .map((img) => `${attr(img, 'alt')} ${attr(img, 'src')}`)
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
const hasTag = (el: Element, tag: string): boolean => {
  for (const kid of kidsOf(el))
    if (typeof kid !== 'string' && (kid.tag === tag || hasTag(kid, tag))) return true
  return false
}

// an <AgentText md>: replaced by its markdown, whatever it holds and however it's hidden
export const isText = (el: Element) =>
  el.tag === 'affordances-md' && (el.flags & MARKED) !== 0 && marked(el) === 'text'
// a span or div (as the page flows around it) whose text is the markdown, written as it is
const verbatimOf = (el: Element): Element => {
  const md = attr(el, 'data-md') ?? ''
  const said: Element = {
    tag: attr(el, 'data-block') === undefined ? 'span' : 'div',
    attrs: '',
    flags: 0,
    kids: [md],
    up: el.up,
    map: undefined,
    pruned: true,
    code: undefined,
    verbatim: md,
  }
  return said
}
// a tablist with a tab that labels a shown panel
const shownTablist = (el: Element) => {
  if (!tabs || !isTablist(el)) return false
  const walk = (parent: Element): boolean => {
    for (const kid of parent.kids) {
      if (typeof kid === 'string') continue
      if (role(kid) === 'tab' && tabs!.has(attr(kid, 'id') ?? '')) return true
      if (walk(kid)) return true
    }
    return false
  }
  return walk(el)
}
const fresh = (tag: string, kids: Node[], up: Element | null): Element => ({
  tag,
  attrs: '',
  flags: 0,
  kids,
  up,
  map: undefined,
  pruned: true,
  code: undefined,
  verbatim: undefined,
})
// a shown tab panel, headed by its tab's label
const headed = (panel: Element): Element => {
  const label = headings?.has(panel)
    ? headings.get(panel)!
    : (attr(panel, 'aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .flatMap((id) => ids().get(id) ?? [])
        .filter((tab) => role(tab) === 'tab')
        .map(words)
        .filter(Boolean)
        .join(' ')
  if (!label) return panel
  const heading = fresh('p', [], panel.up)
  heading.kids = [fresh('strong', [label], heading)]
  return made(panel, [heading, ...kidsOf(panel)])
}

// what a child becomes: itself, something prune made of it, or nothing
const pruned = (kid: Element): Element | undefined => {
  if (kid.flags & MARKED && isText(kid)) return verbatimOf(kid)
  const fill = fills?.get(kid)
  // prune reads what's in it, as ever (a link or table around it is judged by it); only conversion leaves it out
  if (fill !== undefined && !dropped(kid)) return { ...made(kid, kidsOf(kid)), verbatim: fill }
  if (dropped(kid)) return undefined
  if (shownTablist(kid)) return undefined
  if (kid.flags & MARKED && marked(kid) === 'show' && role(kid) === 'tabpanel') return headed(kid)
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

// whether text in an element is code, as written: no spacing there
const literal = (el: Element): boolean => {
  let value = el.code
  if (value === undefined)
    el.code = value = el.tag === 'pre' || el.tag === 'code' || (el.up !== null && literal(el.up))
  return value
}

// display classes and styles: laid out side by side (flex, grid), or a box of its own
const LAID_OUT = /^([\w-]+:)*(inline-)?(flex|grid)$/
const BOXED = /^([\w-]+:)*(block|flex|grid)$/
const displays = (el: Element, display: RegExp) =>
  el.attrs !== '' &&
  (classes(el).some((name) => display.test(name)) || styleDisplays(attr(el, 'style'), display))
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
  // each child's word and box, worked out at most once (one pair's right is the next one's left)
  let lastWord = -1
  let leftSaid = ''
  let rightSaid = ''
  let lastBox = -1
  let leftBox = false
  let rightBox = false
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
    // text beside an element: no gap unless a letter or digit meets one, or the element is a box. both are cheap to
    // rule out before reading the element's text: the text's own edge isn't a letter, the element has no class or style
    if (!leftInline || !rightInline) {
      const beside = (leftInline ? right : left) as string
      const edge = beside.charCodeAt(leftInline ? 0 : beside.length - 1)
      const element = (leftInline ? left : right) as Element
      if (
        edge < 128 &&
        !(
          (edge >= 48 && edge <= 57) ||
          (edge >= 65 && edge <= 90) ||
          (edge >= 97 && edge <= 122)
        ) &&
        !(element.flags & (FLAG.class | FLAG.style))
      )
        continue
    }
    let gap: boolean
    if (leftInline && rightInline && edgeLink(left, true) && edgeLink(right, false)) gap = true
    else {
      leftSaid = i > 0 && lastWord === i - 1 ? rightSaid : word(left)
      rightSaid = word(right)
      lastWord = i
      const leftWord = leftSaid
      const rightWord = rightSaid
      const letters = LETTER_END.test(leftWord) && LETTER_START.test(rightWord)
      const both = leftWord !== '' && rightWord !== ''
      if (!letters && !both) continue
      leftBox = i > 0 && lastBox === i - 1 ? rightBox : boxed(left)
      rightBox = boxed(right)
      lastBox = i
      const box = leftBox || rightBox
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
        (attr(previous, 'href') ?? '').trim() === (attr(current, 'href') ?? '').trim() &&
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
  const raw = el.kids
  // only text in it (most elements: a span of code, a link's words): nothing for prune to do, nothing to keep
  if (raw.length === 0 || (raw.length === 1 && typeof raw[0] === 'string')) return raw
  if (el.pruned) return raw
  el.pruned = true
  // in place: what's kept moves down over what's dropped
  let at = 0
  for (let i = 0; i < raw.length; i++) {
    const kid = raw[i]!
    const kept = typeof kid === 'string' ? kid : pruned(kid)
    if (kept !== undefined) raw[at++] = kept
  }
  raw.length = at
  return at > 1 && !literal(el) ? (el.kids = spaced(el, raw)) : raw
}
