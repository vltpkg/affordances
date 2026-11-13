import {
  BREAK,
  CODE,
  DELETE,
  EMPHASIS,
  HEADING,
  HTML,
  IMAGE,
  INLINE_CODE,
  directItems,
  type DItem,
  type DList,
  isPhrasing,
  renderBlock,
  setext,
  LINK,
  LIST,
  LIST_ITEM,
  Md,
  PARAGRAPH,
  ROOT,
  STRONG,
  TABLE,
  TABLE_CELL,
  TABLE_ROW,
  TEXT,
  THEMATIC_BREAK,
  BLOCKQUOTE,
} from './emit-markdown.ts'
import { attr } from './attr.ts'
import { classes, kidsOf, linkLabel, text } from './emit-prune.ts'
import { FLAG, type Element, type Node, type Options } from './types.ts'

// the page's content as the emitter's tree, as hast-util-to-mdast (MIT, Titus Wormer) converts it with
// @affordances/md's handlers. whitespace is collapsed on the way, as hast-util-minify-whitespace would before: the
// state it carries from one text to the next (`before`), and what comes after an element, are threaded through the walk

// whitespace, as css lays it out
const BLOCKS = new Set(
  'address article aside blockquote body br caption center col colgroup dd dialog dir div dl dt figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html legend li listing main menu nav ol optgroup option p plaintext pre section summary table tbody td tfoot th thead tr ul wbr xmp'.split(
    ' ',
  ),
)
// what has content of its own, so whitespace beside it counts
const CONTENT = new Set(
  'audio canvas embed iframe img math object picture svg video button input select textarea'.split(
    ' ',
  ),
)
const SKIPPABLE = new Set(
  'area base basefont dialog datalist head link meta noembed noframes param rp script source style template track title'.split(
    ' ',
  ),
)
const NORMAL = 0
const NOWRAP = 1
const PRE = 2

// the whitespace walk's state: whether whitespace at the start of the next text says nothing, whether it does at the
// end of the element being converted, and how whitespace is laid out there
let before: boolean | undefined
let after: boolean | undefined
let mode = NORMAL

const whitespaceOf = (el: Element, current: number) => {
  switch (el.tag) {
    case 'listing':
    case 'plaintext':
    case 'xmp':
      return PRE
    case 'nobr':
      return NOWRAP
    case 'pre':
      return PRE
    case 'td':
    case 'th':
      return el.flags & FLAG.nowrap ? NOWRAP : current
    case 'textarea':
      return PRE
  }
  return current
}

const blank = (value: string) => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code !== 32 && code !== 9 && code !== 10 && code !== 12 && code !== 13) return false
  }
  return true
}
// runs of whitespace as one space
const SPREAD = /[\t\n\v\f\r]| {2}/
const collapse = (value: string) =>
  SPREAD.test(value) ? value.replace(/[\t\n\v\f\r ]+/g, ' ') : value

// whether whitespace at the end of nodes[index] says nothing: a block comes next (true), or content (false)
const collapsableAfter = (
  nodes: Node[],
  index: number,
  end: boolean | undefined,
): boolean | undefined => {
  while (++index < nodes.length) {
    const node = nodes[index]!
    if (typeof node === 'string') {
      if (!blank(node)) return false
      continue
    }
    if (CONTENT.has(node.tag)) return false
    if (BLOCKS.has(node.tag)) return true
    if (!SKIPPABLE.has(node.tag)) {
      const result = collapsableAfter(kidsOf(node), -1, undefined)
      if (result !== undefined) return result
    }
  }
  return end
}

// a text as whitespace leaves it, or undefined when nothing's left
const minified = (value: string, nodes: Node[], index: number): string | undefined => {
  if (mode !== NORMAL) {
    before = false
    return mode === NOWRAP ? collapse(value) : value
  }
  value = collapse(value)
  let start = 0
  let end = value.length
  let strip = false
  if (before && value.charCodeAt(0) === 32) start++
  if (start !== end && value.charCodeAt(end - 1) === 32) {
    if (collapsableAfter(nodes, index, after)) end--
    else strip = true
  }
  if (start === end) return undefined
  before = strip
  return start === 0 && end === value.length ? value : value.slice(start, end)
}

// an element's whitespace: set up for what's in it, then what it leaves for what follows
const enterElement = (el: Element, nodes: Node[], index: number) => {
  const block = BLOCKS.has(el.tag)
  const end = block ? true : collapsableAfter(nodes, index, after)
  const saved = { after, mode }
  before = block || before
  after = end
  mode = whitespaceOf(el, mode)
  return saved
}
const exitElement = (el: Element, saved: { after: boolean | undefined; mode: number }) => {
  const strip = Boolean(before || after)
  after = saved.after
  mode = saved.mode
  before = CONTENT.has(el.tag) ? false : strip
}
// an element whose children are converted on their own, as if in place: a block, so the same whatever's beside it
const asBlock = <T>(el: Element, convert: () => T): T => {
  const saved = { after, mode }
  before = true
  after = true
  mode = whitespaceOf(el, mode)
  const result = convert()
  after = saved.after
  mode = saved.mode
  before = true
  return result
}

// what a conversion needs from the page and the options
let base: string | undefined
let relink: Options['link']
// a table's cells are a table's: one inside is its text
let inTable = false
// elements left out where they are (a details' summary, a figure's caption made the code's title), and controls
// left out of a form's prose
let skips = new Set<Element>()
let controls = 0
let titledCode: Element | undefined
let titledAs = ''
export const startConvert = (options: Options, page: string | undefined) => {
  fast = (options as { fast?: boolean }).fast !== false
  base = page
  relink = options.link
  inTable = false
  skips = new Set()
  controls = 0
  titledCode = undefined
  nested = 0
  before = undefined
  after = undefined
  mode = NORMAL
  urls.clear()
  setBase(page)
}

const node = (type: number, kids?: Md[], value?: string) => new Md(type, kids, value)
const textNode = (value: string) => new Md(TEXT, undefined, value)
// a text that may hold a line ending (one not collapsed: preformatted, or from an attribute), flagged in its depth
const unsafeText = (value: string) => {
  const made = new Md(TEXT, undefined, value)
  made.depth = 1
  return made
}
const pushOne = (out: Md[], result: Md) => {
  const last = out[out.length - 1]
  if (result.type === TEXT && last !== undefined && last.type === TEXT) {
    last.value += result.value
    last.depth |= result.depth
  } else out.push(result)
}
const push = (out: Md[], results: Md[]) => {
  for (let i = 0; i < results.length; i++) pushOne(out, results[i]!)
}

// an element's children, converted, appended to out
export const all = (parent: Element, out: Md[] = []): Md[] => {
  const kids = kidsOf(parent)
  // whether what's converted here lands in a flow (root, blockquote, list item) as it is: every element between here
  // and the nearest one is a flow element, or one whose children are its parent's (a span, a custom element). only
  // there is a block written as a flow writes it
  const savedFlow = flow
  flow = flow && (FLOWS.has(parent.tag) || ((INFO.get(parent.tag) ?? 0) & KIND_MASK) === PASS)
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i]!
    if (typeof kid === 'string') {
      const collapsed = mode === NORMAL ? 0 : 1
      const value = minified(kid, kids, i)
      if (value === undefined) continue
      const last = out[out.length - 1]
      if (last !== undefined && last.type === TEXT) {
        last.value += value
        last.depth |= collapsed
      } else {
        const fresh = new Md(TEXT, undefined, value)
        fresh.depth = collapsed
        out.push(fresh)
      }
      continue
    }
    if (skips.size !== 0 && skips.has(kid)) {
      before = true
      continue
    }
    // whitespace in it: a block's edges say nothing; an inline element's end says what follows it says
    const info = INFO.get(kid.tag) ?? 0
    const kind = info & KIND_MASK
    const block = (info & IS_BLOCK) !== 0
    const savedAfter = after
    const savedMode = mode
    const end = block ? true : collapsableAfter(kids, i, after)
    if (block) before = true
    after = end
    if (info & IS_SPACED) mode = whitespaceOf(kid, mode)
    let result: Md | Md[] | undefined
    if (controls !== 0 && CONTROL_TAGS.has(kid.tag)) result = walkOnly(kid)
    else if (kind === PASS && !(kid.flags & FLAG['data-mdast'])) all(kid, out)
    else if (
      flow &&
      fast &&
      (kind === PARAGRAPH_TAG || kind === HEADING_TAG) &&
      controls === 0 &&
      !inTable &&
      skips.size === 0 &&
      mode === NORMAL &&
      (result = fastBlock(kid, kind)) !== DECLINED
    ) {
      // written by the fast path (or nothing, for a paragraph with nothing in it)
    } else if (
      flow &&
      fast &&
      kind === LIST_TAG &&
      nested === 0 &&
      controls === 0 &&
      !inTable &&
      skips.size === 0 &&
      mode === NORMAL &&
      (result = directList(kid)) !== DECLINED
    ) {
      // a list of inline items and the lists in them, written as it's read
    } else {
      // a block the fast path declined starts again where it started: at a block's edge
      if (block) before = true
      result = one(kid, kind, parent)
    }
    const strip = before || end
    after = savedAfter
    mode = savedMode
    before = info & IS_CONTENT ? false : Boolean(strip)
    if (result === undefined) continue
    if (result instanceof Md) pushOne(out, result)
    else push(out, result)
  }
  flow = savedFlow
  return out
}
// the whitespace an element leaves, without what it says
const walkOnly = (el: Element): undefined => {
  if (!BLOCKS.has(el.tag) && !CONTENT.has(el.tag)) all(el)
  return undefined
}
const CONTROL_TAGS = new Set([
  'input',
  'select',
  'textarea',
  'button',
  'label',
  'legend',
  'option',
  'datalist',
  'output',
])

// what each tag becomes, as hast-util-to-mdast's handlers (and @affordances/md's) say
const PASS = 0
const IGNORE = 1
const FLOW = 2
const PARAGRAPH_TAG = 3
const HEADING_TAG = 4
const LINK_TAG = 5
const IMAGE_TAG = 6
const BREAK_TAG = 7
const RULE = 8
const WBR = 9
const STRONG_TAG = 10
const QUOTE = 11
const LIST_TAG = 12
const ITEM = 13
const DEFINITIONS = 14
const CODE_BLOCK = 15
const TABLE_TAG = 16
const ROW = 17
const CELL = 18
const Q = 19
const RAW = 20
const DETAILS = 21
const TITLED = 22
const FORM = 23
const CODE_TAG = 24
const EMPHASIS_TAG = 25
const DELETE_TAG = 26
const KIND = new Map<string, number>()
const kinds = (kind: number, tags: string) => {
  for (const tag of tags.split(' ')) KIND.set(tag, kind)
}
kinds(
  IGNORE,
  'applet area basefont bgsound caption col colgroup command content datalist dialog element embed frame frameset isindex keygen link math menu menuitem meta nextid noembed noframes optgroup option param script shadow source spacer style svg template title track input select textarea button base',
)
kinds(
  FLOW,
  'address article aside body center fieldset figcaption footer header hgroup html legend main multicol nav picture section',
)
kinds(PARAGRAPH_TAG, 'p summary')
kinds(HEADING_TAG, 'h1 h2 h3 h4 h5 h6')
kinds(LINK_TAG, 'a')
kinds(IMAGE_TAG, 'img image')
kinds(BREAK_TAG, 'br')
kinds(RULE, 'hr')
kinds(WBR, 'wbr')
kinds(STRONG_TAG, 'b strong')
kinds(QUOTE, 'blockquote')
kinds(LIST_TAG, 'ul ol dir')
kinds(ITEM, 'li dt dd')
kinds(DEFINITIONS, 'dl')
kinds(CODE_BLOCK, 'pre listing plaintext xmp')
kinds(TABLE_TAG, 'table')
kinds(ROW, 'tr')
kinds(CELL, 'td th')
kinds(Q, 'q')
kinds(RAW, 'sup sub')
kinds(DETAILS, 'details')
kinds(TITLED, 'div figure')
kinds(FORM, 'form')
kinds(CODE_TAG, 'code kbd samp tt var')
kinds(EMPHASIS_TAG, 'em i mark u')
kinds(DELETE_TAG, 'del s strike')
// with each tag's kind, how whitespace sees it: a block, content, or an element with whitespace of its own
const KIND_MASK = 255
const IS_BLOCK = 256
const IS_CONTENT = 512
const IS_SPACED = 1024
const INFO = new Map<string, number>()
for (const tag of new Set([...KIND.keys(), ...BLOCKS, ...CONTENT, 'nobr', 'textarea']))
  INFO.set(
    tag,
    (KIND.get(tag) ?? PASS) |
      (BLOCKS.has(tag) ? IS_BLOCK : 0) |
      (CONTENT.has(tag) ? IS_CONTENT : 0) |
      (['pre', 'listing', 'plaintext', 'xmp', 'td', 'th', 'nobr', 'textarea'].includes(tag)
        ? IS_SPACED
        : 0),
  )

const one = (el: Element, kind: number, parent: Element): Md | Md[] | undefined => {
  if (el.flags & FLAG['data-mdast'] && attr(el, 'data-mdast') === 'ignore') return walkOnly(el)
  switch (kind) {
    case PASS:
      return all(el)
    case IGNORE:
      return walkOnly(el)
    case FLOW:
      return toFlow(all(el))
    case PARAGRAPH_TAG: {
      const kids = dropBreaks(all(el))
      return kids.length ? node(PARAGRAPH, kids) : undefined
    }
    case HEADING_TAG: {
      const heading = node(HEADING, dropBreaks(all(el)))
      heading.depth = el.tag.charCodeAt(1) - 48
      return heading
    }
    case LINK_TAG:
      return link(el, parent)
    case IMAGE_TAG:
      return image(el)
    case BREAK_TAG:
      return node(BREAK)
    case RULE:
      return node(THEMATIC_BREAK)
    case WBR:
      return textNode('\u200B')
    case STRONG_TAG:
      return node(STRONG, all(el))
    case QUOTE: {
      nested++
      const quote = node(BLOCKQUOTE, toFlow(all(el)))
      nested--
      return quote
    }
    case LIST_TAG:
      return list(el)
    case ITEM:
      return listItem(el)
    case DEFINITIONS:
      return definitions(el)
    case CODE_BLOCK:
      return code(el)
    case TABLE_TAG:
      return table(el)
    case ROW:
      return node(TABLE_ROW, specific(all(el), TABLE_CELL))
    case CELL:
      return cell(el)
    case Q: {
      const contents = all(el)
      const head = contents[0]
      const tail = contents[contents.length - 1]
      if (head?.type === TEXT) head.value = '"' + head.value
      else contents.unshift(textNode('"'))
      if (tail?.type === TEXT) tail.value += '"'
      else contents.push(textNode('"'))
      return contents
    }
    case RAW:
      return [
        node(HTML, undefined, `<${el.tag}>`),
        ...all(el),
        node(HTML, undefined, `</${el.tag}>`),
      ]
    case DETAILS:
      return details(el)
    case TITLED:
      return titled(el)
    case FORM:
      return form(el)
    case CODE_TAG:
      return node(INLINE_CODE, undefined, toText(el))
    case EMPHASIS_TAG:
      return node(EMPHASIS, all(el))
    case DELETE_TAG:
      return node(DELETE, all(el))
  }
  return all(el)
}

const dropBreaks = (nodes: Md[]) => {
  let start = 0
  let end = nodes.length
  while (start < end && nodes[start]!.type === BREAK) start++
  while (end > start && nodes[end - 1]!.type === BREAK) end--
  return start === 0 && end === nodes.length ? nodes : nodes.slice(start, end)
}

// flow content: runs of phrasing become paragraphs; a link or deletion holding blocks is pushed inside each block
const LEAVES = new Set([TEXT, INLINE_CODE, BREAK, IMAGE, HTML, CODE, THEMATIC_BREAK])
const wrapNeeded = (nodes: Md[]): boolean => {
  for (const item of nodes)
    if (!isPhrasing(item) || (item.kids.length && wrapNeeded(item.kids))) return true
  return false
}
const clone = (from: Md): Md => {
  const copy = new Md(from.type, [], from.value)
  copy.url = from.url
  copy.title = from.title
  copy.lang = from.lang
  copy.meta = from.meta
  copy.depth = from.depth
  copy.ordered = from.ordered
  copy.spread = from.spread
  copy.checked = from.checked
  copy.align = from.align && [...from.align]
  copy.rowSpan = from.rowSpan
  copy.colSpan = from.colSpan
  return copy
}
const flatten = (nodes: Md[]): Md[] => {
  let out: Md[] | undefined
  for (let i = 0; i < nodes.length; i++) {
    const item = nodes[i]!
    if ((item.type === DELETE || item.type === LINK) && wrapNeeded(item.kids)) {
      out ??= nodes.slice(0, i)
      out.push(...split(item))
    } else out?.push(item)
  }
  return out ?? nodes
}
const split = (parent: Md): Md[] =>
  runs(
    parent.kids,
    (run) => {
      const copy = clone(parent)
      copy.kids = run
      return [copy]
    },
    (child) => {
      if (!LEAVES.has(child.type)) {
        const outer = clone(parent)
        const inner = clone(child)
        outer.kids = child.kids
        inner.kids.push(outer)
        return inner
      }
      return clone(child)
    },
  )
const runs = (nodes: Md[], onPhrasing: (run: Md[]) => Md[], onOther: (item: Md) => Md): Md[] => {
  const flat = flatten(nodes)
  const result: Md[] = []
  // a run of phrasing is a slice of what's given, from start to the block after it
  let start = -1
  const close = (end: number) => {
    const made = onPhrasing(start === 0 && end === flat.length ? flat : flat.slice(start, end))
    for (let k = 0; k < made.length; k++) result.push(made[k]!)
    start = -1
  }
  for (let i = 0; i < flat.length; i++) {
    const item = flat[i]!
    if (isPhrasing(item)) {
      if (start < 0) start = i
    } else {
      if (start >= 0) close(i)
      result.push(onOther(item))
    }
  }
  if (start >= 0) close(flat.length)
  return result
}
const whitespaceOnly = (value: string) => /^[ \t\n\f\r]*$/.test(value)
const toFlow = (nodes: Md[]): Md[] =>
  runs(
    nodes,
    (run) =>
      run.every((item) => item.type === TEXT && whitespaceOnly(item.value))
        ? []
        : [node(PARAGRAPH, dropBreaks(run))],
    (item) => item,
  )
const rootKids = (nodes: Md[]) => (wrapNeeded(nodes) ? toFlow(nodes) : nodes)

// children of one type, with what isn't one moved into the next (or the last)
const specific = (nodes: Md[], type: number): Md[] => {
  const results: Md[] = []
  let queue: Md[] = []
  for (const item of nodes) {
    if (item.type === type) {
      if (queue.length) {
        item.kids.unshift(...queue)
        queue = []
      }
      results.push(item)
    } else queue.push(item)
  }
  if (queue.length) {
    let last = results[results.length - 1]
    if (!last) results.push((last = node(type)))
    last.kids.push(...queue)
  }
  return results
}

// urls: what a browser makes of an href, read without parsing when it's a shape a browser leaves as written (a
// #fragment, an /absolute/path, an http(s) url with a plain host) and made only of characters it never escapes
const urls = new Map<string, URL | null>()
const parse = (url: string, against: string): URL | null => {
  let parsed = urls.get(url)
  if (parsed === undefined) {
    try {
      parsed = new URL(url, against)
    } catch {
      parsed = null
    }
    urls.set(url, parsed)
  }
  return parsed
}
// characters no part of an http(s) url escapes (no dot segment either: those are resolved)
const PLAIN = /^[A-Za-z0-9\-._~!$&()*+,;=:@%/?#]*$/
const DOT_SEGMENT = /\/\.|%2e/i
const HTTP = /^(https?):\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.?)(?=[/?#]|$)/
const NUMERIC_LABEL = /(?:^|\.)(?:0x[0-9a-f]*|\d+)\.?$/
// the shape an href is, when it's one of those: 'fragment', 'path', or an http url's length up to its path
// the last url shaped: a link's url is shaped twice in a row (its scheme, then its resolution)
let shapedUrl = ''
let shaped: 'fragment' | 'path' | number | undefined
const shape = (url: string): 'fragment' | 'path' | number | undefined => {
  if (url !== shapedUrl) {
    shapedUrl = url
    shaped = shapeOf(url)
  }
  return shaped
}
const shapeOf = (url: string): 'fragment' | 'path' | number | undefined => {
  const head = url.charCodeAt(0)
  if (head === 35) return PLAIN.test(url) && url.indexOf('#', 1) < 0 ? 'fragment' : undefined
  if (head === 47) {
    if (url.charCodeAt(1) === 47 || !PLAIN.test(url) || DOT_SEGMENT.test(url)) return undefined
    return 'path'
  }
  if (head !== 104) return undefined
  const match = HTTP.exec(url)
  if (!match || NUMERIC_LABEL.test(match[2]!)) return undefined
  if (!PLAIN.test(url) || DOT_SEGMENT.test(url.slice(match[0].length))) return undefined
  return match[0].length
}
const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const IMAGE_SCHEMES = new Set(['http:', 'https:'])
// whether a url's scheme is one of these, as a browser reads it; a relative url is the page's own, http(s)
const RELATIVE = 'https://relative.invalid/'
const allowed = (url: string, schemes: Set<string>) => {
  if (shape(url) !== undefined) return true
  let scheme: string | undefined
  try {
    scheme = new URL(url, RELATIVE).protocol
  } catch {
    return false
  }
  return schemes.has(scheme)
}
// the page's url, as the shapes above need it
let baseHref = ''
let baseOrigin = ''
let plainBase = false
const setBase = (page: string | undefined) => {
  plainBase = false
  if (!page) return
  try {
    const url = new URL(page)
    baseHref = url.href.split('#')[0]!
    baseOrigin = url.protocol + '//' + url.host
    plainBase =
      (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch {
    // a base that isn't a url leaves links as written
  }
}
// a link's url once it's absolute, then through the link hook
const resolve = (url: string, image: boolean) => {
  if (!base) return url
  let href: string | undefined
  const kind = plainBase ? shape(url) : undefined
  if (kind === 'fragment') href = baseHref + url
  else if (kind === 'path') href = baseOrigin + url
  else if (typeof kind === 'number')
    href =
      kind === url.length
        ? url + '/'
        : url.charCodeAt(kind) === 47
          ? url
          : url.slice(0, kind) + '/' + url.slice(kind)
  else {
    const absolute = parse(url, base)
    if (!absolute) return url
    href = absolute.href
  }
  if (!image && relink && !url.startsWith('#')) {
    const swapped = relink(new URL(href))
    if (swapped) return swapped
  }
  return href
}

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const link = (el: Element, parent: Element) => {
  const href = (attr(el, 'href') ?? '').trim()
  const children = all(el)
  if (!href || href === '#' || !allowed(href, LINK_SCHEMES)) return children
  // a heading's link to its own anchor is the heading
  if (href.startsWith('#') && HEADINGS.has(parent.tag)) return children
  const result = node(LINK, children)
  result.url = resolve(href, false)
  result.title = el.flags & FLAG.title ? (attr(el, 'title') ?? null) : null
  // an icon or avatar link reads as its label
  if (!children.some((child) => child.type !== TEXT || child.value.trim())) {
    const name = linkLabel(el)
    if (!name) return undefined
    result.kids = [unsafeText(name)]
  }
  return result
}

const image = (el: Element) => {
  const alt = (attr(el, 'alt') ?? '').trim()
  const src = attr(el, 'src')
  if (!alt || !src || !allowed(src, IMAGE_SCHEMES)) return undefined
  const result = node(IMAGE, undefined, alt)
  result.url = resolve(src, true)
  result.title = el.flags & FLAG.title ? (attr(el, 'title') ?? null) : null
  return result
}

// the first child that isn't whitespace the walk drops
const firstKid = (el: Element): Node | undefined => {
  for (const kid of kidsOf(el))
    if (typeof kid !== 'string' || !/^[\t\n\v\f\r ]*$/.test(kid)) return kid
  return undefined
}
const checkbox = (kid: Node | undefined): Element | undefined => {
  if (kid === undefined || typeof kid === 'string') return undefined
  if (kid.tag === 'input') {
    const type = attr(kid, 'type')
    return type === 'checkbox' || type === 'radio' ? kid : undefined
  }
  return kid.tag === 'p' ? checkbox(firstKid(kid)) : undefined
}
// hast-util-phrasing's elements
const PHRASING_TAGS = new Set(
  'a abbr area b bdi bdo br button cite code data datalist del dfn em i input ins kbd keygen label map mark meter noscript output progress q ruby s samp script select small span strong sub sup template textarea time u var wbr audio canvas embed iframe img math object picture svg video'.split(
    ' ',
  ),
)
// whether an item is loose: a <p>, or a second block, at any depth
const spreadOut = (el: Element): boolean => {
  let seenFlow = false
  for (const kid of kidsOf(el)) {
    if (typeof kid === 'string' || PHRASING_TAGS.has(kid.tag)) continue
    if (kid.tag === 'p' || seenFlow || spreadOut(kid)) return true
    seenFlow = true
  }
  return false
}
const listItem = (el: Element) => {
  const box = checkbox(firstKid(el))
  const item = node(LIST_ITEM)
  item.checked = box ? attr(box, 'checked') !== undefined : null
  item.spread = spreadOut(el)
  nested++
  item.kids = toFlow(all(el))
  nested--
  return item
}
const list = (el: Element) => {
  const result = node(LIST, specific(all(el), LIST_ITEM))
  result.ordered = el.tag === 'ol'
  if (result.ordered) result.depth = startOf(el)
  result.spread = result.kids.length > 1 && result.kids.some((item) => item.spread)
  return result
}

// an ordered list's first number, as hast reads its start: a number when it is one, and 0 is no start
const startOf = (el: Element) => {
  const start = attr(el, 'start')
  const value =
    start !== undefined && start !== '' && !Number.isNaN(Number(start)) ? Number(start) : start
  return value ? Number.parseInt(String(value), 10) : 1
}

// **term**: definition, one paragraph per pair
const FLOW_TYPES = new Set([PARAGRAPH, HEADING, LIST, BLOCKQUOTE, CODE, TABLE, THEMATIC_BREAK])
const says = (item: Md): boolean =>
  item.type === TEXT ? item.value.trim() !== '' : LEAVES.has(item.type) || item.kids.some(says)
const definitions = (el: Element) => {
  const out: Md[] = []
  let terms: Md[][] = []
  const pairs = kidsOf(el).flatMap((kid) =>
    typeof kid !== 'string' && kid.tag === 'div' ? kidsOf(kid) : [kid],
  )
  for (const kid of pairs) {
    if (typeof kid === 'string') continue
    if (kid.tag === 'dt') terms.push(asBlock(kid, () => all(kid)))
    else if (kid.tag === 'dd') {
      const strong: Md[] = []
      for (const term of terms.filter((parts) =>
        parts.some((part) => part.type !== TEXT || part.value.trim()),
      )) {
        if (strong.length) strong.push(textNode(', '))
        strong.push(node(STRONG, term))
      }
      const lead = strong.length ? [...strong, textNode(': ')] : strong
      const first = node(PARAGRAPH, [...lead])
      const flow: Md[] = [first]
      let open: Md | undefined = first
      for (const part of asBlock(kid, () => all(kid))) {
        if (part.type === PARAGRAPH && open === first && first.kids.length === lead.length) {
          first.kids.push(...part.kids)
          open = undefined
        } else if (FLOW_TYPES.has(part.type)) {
          flow.push(part)
          open = undefined
        } else if (open) open.kids.push(part)
        else flow.push((open = node(PARAGRAPH, [part])))
      }
      out.push(...flow.filter((block) => block.type !== PARAGRAPH || block.kids.length))
      terms = []
    }
  }
  return out
}

const details = (el: Element) => {
  const summary = kidsOf(el).find(
    (kid): kid is Element => typeof kid !== 'string' && kid.tag === 'summary',
  )
  const head: Md[] = []
  if (summary) {
    const inherited = before
    head.push(
      node(PARAGRAPH, [
        node(
          STRONG,
          asBlock(summary, () => all(summary)),
        ),
      ]),
    )
    before = inherited
    skips.add(summary)
  }
  const rest = all(el)
  if (summary) skips.delete(summary)
  return [...head, ...toFlow(rest)]
}

// a form says what it says, without its controls (the field summary is @affordances/md's alone, for now)
const form = (el: Element) => {
  controls++
  const flow = toFlow(all(el))
  controls--
  return flow
}

// a code block's language: a language-* class on its <code>, data-language on it or the <pre>, or a class on the <pre>
const classLanguage = (el: Element | undefined) =>
  el &&
  classes(el)
    .find((name) => name.startsWith('language-'))
    ?.slice('language-'.length)
const codeOf = (pre: Element) =>
  kidsOf(pre).find((kid): kid is Element => typeof kid !== 'string' && kid.tag === 'code')
const languageOf = (pre: Element) => {
  const inner = codeOf(pre)
  const said = [inner && attr(inner, 'data-language'), attr(pre, 'data-language')]
    .map((language) => (language ?? '').trim())
    .find(Boolean)
  return (classLanguage(inner) ?? said ?? classLanguage(pre))?.split(/\s/)[0] || null
}
const code = (el: Element) => {
  const result = node(CODE, undefined, toText(el).replace(/[\r\n]+$/, ''))
  if (el.tag !== 'pre') return result
  result.lang = languageOf(el)
  const title = el === titledCode ? titledAs : attr(el, 'data-title')
  if (title) result.meta = `title=${JSON.stringify(title)}`
  return result
}
// a code block's title where highlighters put it: a figcaption before it in its figure, or data-title on what holds it
const descendants = (el: Element, found: Element[], tags: Set<string>) => {
  for (const kid of kidsOf(el))
    if (typeof kid !== 'string') {
      if (tags.has(kid.tag)) found.push(kid)
      descendants(kid, found, tags)
    }
  return found
}
const PRE_TAGS = new Set(['pre'])
const CAPTION_OR_PRE = new Set(['figcaption', 'pre'])
const titled = (el: Element) => {
  const flow = () => toFlow(all(el))
  if (el.tag !== 'figure' && !(el.flags & FLAG['data-title'])) return flow()
  // one walk: the code blocks, and the captions among them in order
  const order = descendants(el, [], el.tag === 'figure' ? CAPTION_OR_PRE : PRE_TAGS)
  const [pre, ...more] = order.filter((at) => at.tag === 'pre')
  if (!pre || more.length || attr(pre, 'data-title') || pre === titledCode || !languageOf(pre))
    return flow()
  const caption =
    el.tag === 'figure'
      ? order.slice(0, order.indexOf(pre)).find((at) => at.tag === 'figcaption')
      : undefined
  const title = text(caption) || (attr(el, 'data-title') ?? '').trim()
  if (!title) return flow()
  const saved = titledCode
  const savedAs = titledAs
  titledCode = pre
  titledAs = title
  if (caption) skips.add(caption)
  const result = flow()
  if (caption) skips.delete(caption)
  titledCode = saved
  titledAs = savedAs
  return result
}

// a cell is one line: blocks in it are separated by a space
const cell = (el: Element) => {
  const result = node(TABLE_CELL, all(el))
  if (el.flags & (FLAG.rowspan | FLAG.colspan)) {
    const rowSpan = attr(el, 'rowspan')
    const colSpan = attr(el, 'colspan')
    if (rowSpan) result.rowSpan = Number.parseInt(rowSpan, 10) || 1
    if (colSpan) result.colSpan = Number.parseInt(colSpan, 10) || 1
  }
  if (!result.kids.some((kid) => kid.type === PARAGRAPH)) return result
  const parts: Md[][] = []
  let run: Md[] = []
  for (const kid of result.kids) {
    if (kid.type !== PARAGRAPH) {
      run.push(kid)
      continue
    }
    parts.push(run, kid.kids)
    run = []
  }
  parts.push(run)
  const said = parts.filter((part) => part.some(says))
  const kids: Md[] = []
  said.forEach((part, i) => {
    const last = i ? said[i - 1]!.at(-1) : undefined
    if (i && !(last?.type === TEXT && /\s$/.test(last.value))) kids.push(textNode(' '))
    kids.push(...part)
  })
  result.kids = kids
  return result
}

const table = (el: Element): Md => {
  if (inTable) return unsafeText(toText(el))
  inTable = true
  const { align, headless } = inspect(el)
  const rows = specific(all(el), TABLE_ROW)
  if (headless) rows.unshift(node(TABLE_ROW))
  for (const row of rows) row.kids = specific(row.kids, TABLE_CELL)
  let columns = 1
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const cells = rows[rowIndex]!.kids
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
      const at = cells[cellIndex]!
      const colSpan = at.colSpan || 1
      const rowSpan = at.rowSpan || 1
      if (colSpan > 1 || rowSpan > 1) {
        for (let other = rowIndex; other < rowIndex + rowSpan; other++) {
          for (let col = cellIndex; col < cellIndex + colSpan; col++) {
            if (!rows[other]) break
            const added = other !== rowIndex || col !== cellIndex ? [node(TABLE_CELL)] : []
            rows[other]!.kids.splice(col, 0, ...added)
          }
        }
      }
      at.colSpan = 0
      at.rowSpan = 0
    }
    if (cells.length > columns) columns = cells.length
  }
  for (const row of rows) while (row.kids.length < columns) row.kids.push(node(TABLE_CELL))
  while (align.length < columns) align.push(null)
  inTable = false
  const result = node(TABLE, rows)
  result.align = align
  return result
}
const inspect = (el: Element) => {
  const align: (string | null)[] = [null]
  let headless = true
  let rowIndex = 0
  let cellIndex = 0
  const walk = (parent: Element) => {
    for (const kid of kidsOf(parent)) {
      if (typeof kid === 'string') continue
      if (kid.tag === 'table') continue
      if (kid.tag === 'th' || kid.tag === 'td') {
        if (!align[cellIndex]) {
          const value = (kid.flags & FLAG.align && attr(kid, 'align')) || null
          if (value === 'center' || value === 'left' || value === 'right' || value === null)
            align[cellIndex] = value
        }
        if (headless && rowIndex < 2 && kid.tag === 'th') headless = false
        cellIndex++
      } else if (kid.tag === 'thead') headless = false
      else if (kid.tag === 'tr') {
        rowIndex++
        cellIndex = 0
      }
      walk(kid)
    }
  }
  walk(el)
  return { align, headless }
}

// an element's text as a browser renders it (hast-util-to-text, MIT, Titus Wormer), over text the whitespace walk
// has already collapsed: code, a code block, a table in a table
const BLOCK_OR_CAPTION = new Set(
  'address article aside blockquote body caption center dd dialog dir dl dt div figure figcaption footer form h1 h2 h3 h4 h5 h6 header hgroup hr html legend li listing main menu nav ol p plaintext pre section ul xmp'.split(
    ' ',
  ),
)
const NOT_RENDERED = new Set([
  'datalist',
  'head',
  'noembed',
  'noframes',
  'noscript',
  'rp',
  'script',
  'style',
  'template',
  'title',
])
const TABLE_PARTS = new Set([
  'caption',
  'col',
  'colgroup',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
])
const ROW_GROUPS = new Set(['tbody', 'tfoot', 'thead'])
type Piece = string | number
const isBr = (kid: Node | undefined) =>
  kid !== undefined && typeof kid !== 'string' && kid.tag === 'br'
const isRow = (kid: Node) => typeof kid !== 'string' && kid.tag === 'tr'
const isCell = (kid: Node) => typeof kid !== 'string' && (kid.tag === 'td' || kid.tag === 'th')
const rowOrGroupWithRow = (kid: Node) =>
  typeof kid !== 'string' &&
  (kid.tag === 'tr' || (ROW_GROUPS.has(kid.tag) && kidsOf(kid).some(isRow)))
const afterIn = (kids: Node[], index: number, test: (kid: Node) => boolean) => {
  while (++index < kids.length) if (test(kids[index]!)) return true
  return false
}
const inTableTag = (tag: string) => tag === 'table' || ROW_GROUPS.has(tag)

export const toText = (el: Element): string => {
  // the pieces are joined as they come (hast-util-to-text joins them after): what's joined so far, and the most line
  // endings asked for since the last text (-1: none yet since one; undefined: no text yet)
  const savedJoined = joined
  const savedCount = count
  joined = ''
  count = undefined
  const block = BLOCK_OR_CAPTION.has(el.tag)
  const normal = whitespaceOf(el, NORMAL) === NORMAL
  const kids = kidsOf(el)
  const isTable = el.tag === 'table'
  for (let i = 0; i < kids.length; i++) {
    const next = kids[i + 1]
    collect(
      kids,
      i,
      el,
      i ? undefined : block,
      next ? isBr(next) : block,
      isTable ? afterIn(kids, i, rowOrGroupWithRow) : undefined,
      normal,
    )
  }
  const result = joined
  joined = savedJoined
  count = savedCount
  return result
}
let joined = ''
let count: number | undefined
// one piece of the text: a number asks for that many line endings before the next text
const piece = (value: Piece) => {
  if (typeof value === 'number') {
    if (count !== undefined && value > count) count = value
  } else if (value) {
    if (count !== undefined && count > -1) joined += '\n'.repeat(count) || ' '
    count = -1
    joined += value
  }
}
type Break = boolean | number | string | undefined
const collect = (
  kids: Node[],
  index: number,
  parent: Element,
  breakBefore: Break,
  breakAfter: Break,
  rowAfter: boolean | undefined,
  normal: boolean,
) => {
  const kid = kids[index]!
  if (typeof kid === 'string') {
    // preformatted text is as written, and what's beside it doesn't matter
    const value = mode === PRE ? kid : minified(kid, kids, index)
    if (value === undefined) return
    if (
      blank(value) &&
      (parent.tag === 'table' || parent.tag === 'tr' || ROW_GROUPS.has(parent.tag))
    ) {
      const previous = kids[index - 1]
      const following = kids[index + 1]
      if (
        (!previous || (typeof previous !== 'string' && TABLE_PARTS.has(previous.tag))) &&
        (!following || (typeof following !== 'string' && TABLE_PARTS.has(following.tag)))
      )
        return
    }
    if (normal) collectText(value, breakBefore, breakAfter)
    else piece(value)
    return
  }
  if (mode === PRE) {
    collectElement(kid, index, kids, rowAfter, normal)
    return
  }
  const saved = enterElement(kid, kids, index)
  collectElement(kid, index, kids, rowAfter, normal)
  exitElement(kid, saved)
}
const collectElement = (
  el: Element,
  position: number,
  siblings: Node[],
  rowAfter: boolean | undefined,
  inherited: boolean,
) => {
  const normal = inherited && whitespaceOf(el, NORMAL) === NORMAL
  if (NOT_RENDERED.has(el.tag) || (el.tag === 'dialog' && attr(el, 'open') === undefined)) {
    walkOnly(el)
    return
  }
  let prefix: number | undefined
  let suffix: number | string | undefined
  if (el.tag === 'br') suffix = '\n'
  else if (el.tag === 'tr' && (rowAfter || afterIn(siblings, position, isRow))) suffix = '\n'
  else if (el.tag === 'p') {
    prefix = 2
    suffix = 2
  } else if (BLOCK_OR_CAPTION.has(el.tag)) {
    prefix = 1
    suffix = 1
  }
  if (prefix) piece(prefix)
  const kids = kidsOf(el)
  const tableish = inTableTag(el.tag)
  const isTable = el.tag === 'table'
  for (let i = 0; i < kids.length; i++) {
    const next = kids[i + 1]
    collect(
      kids,
      i,
      el,
      i ? undefined : prefix,
      next ? isBr(next) : suffix,
      tableish ? (isTable ? afterIn(kids, i, rowOrGroupWithRow) : rowAfter) : undefined,
      normal,
    )
  }
  if (isCell(el) && afterIn(siblings, position, isCell)) piece('\t')
  if (suffix) piece(suffix)
}
const BIDI_TEST = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/
// toText of an inline element holding one text, already collapsed
const toTextOfOne = (value: string) => {
  const savedJoined = joined
  const savedCount = count
  joined = ''
  count = undefined
  collectText(value, false, false)
  const result = joined
  joined = savedJoined
  count = savedCount
  return result
}
const BIDI = /[؜‎‏‪-‮⁦-⁩]/g
const collectText = (value: string, breakBefore: Break, breakAfter: Break) => {
  const lines: string[] = []
  let start = 0
  while (start <= value.length) {
    const found = value.indexOf('\n', start)
    const end = found < 0 ? value.length : found
    lines.push(
      trimAndCollapse(
        value.slice(start, end).replace(BIDI, ''),
        start === 0 ? breakBefore : true,
        end === value.length ? breakAfter : true,
      ),
    )
    start = end + 1
  }
  let join: number | undefined
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    if (
      line.charCodeAt(line.length - 1) === 0x200b ||
      (index < lines.length - 1 && lines[index + 1]!.charCodeAt(0) === 0x200b)
    ) {
      piece(line)
      join = undefined
    } else if (line) {
      if (typeof join === 'number') piece(join)
      piece(line)
      join = 0
    } else if (index === 0 || index === lines.length - 1) piece(0)
  }
}
const trimAndCollapse = (value: string, breakBefore: unknown, breakAfter: unknown) => {
  const result: string[] = []
  const spaces = /[\t ]+/g
  let start = 0
  let end: number | undefined
  while (start < value.length) {
    spaces.lastIndex = start
    const match = spaces.exec(value)
    end = match ? match.index : value.length
    if (!start && !end && match && !breakBefore) result.push('')
    if (start !== end) result.push(value.slice(start, end))
    start = match ? end + match[0].length : end
  }
  if (start !== end && !breakAfter) result.push('')
  return result.join(' ')
}

// the walk over the content's root, as hast-util-to-mdast's root handler: wrapped when it holds blocks
export const convertRoot = (root: Element): Md => {
  flow = true
  before = true
  after = true
  mode = NORMAL
  return node(ROOT, rootKids(all(root)))
}

// the fast path: a paragraph or heading of plain inline content (text, strong, emphasis, code, links, breaks, spans)
// is converted by a walk that knows only those, and written straight away. anything else declines it, and it's
// converted as before. it makes the same tree one() would (finish and the joins read it), so the gate is simply
// that the markdown is the same with it and without it (emit's second argument takes fast: false)
let fast = true
let flow = false
const FLOWS = new Set([
  '#root',
  ...'address article aside body center fieldset figcaption footer header hgroup html legend main multicol nav picture section div figure blockquote li details form'.split(
    ' ',
  ),
])
const DECLINED = null as unknown as Md
// how the fast path fared, for the reports: blocks written, and declined by the tag that stopped them
export const fastStats = { taken: 0, lists: 0, declined: new Map<string, number>() }
const decline = (why: string) => {
  fastStats.declined.set(why, (fastStats.declined.get(why) ?? 0) + 1)
  return false
}
const fastBlock = (el: Element, kind: number): Md | undefined => {
  const out: Md[] = []
  const savedAfter = after
  if (!fastInline(el, el, out)) {
    // what a declined block leaves is set back, so it's converted as if it had never been tried
    after = savedAfter
    return DECLINED
  }
  const kids = dropBreaks(out)
  let block: Md
  if (kind === PARAGRAPH_TAG) {
    if (!kids.length) return undefined
    block = node(PARAGRAPH, kids)
  } else {
    block = node(HEADING, kids)
    block.depth = el.tag.charCodeAt(1) - 48
    // a heading with a line break is written setext style, which joins read from its children: the slow way
    if (setext(block)) {
      decline('setext heading')
      return DECLINED
    }
  }
  block.raw = renderBlock(block)
  fastStats.taken++
  // only its markdown is kept: what's built for it goes now, and the element stands in for it if it's ever read
  block.kids = []
  block.el = el
  return block
}
// a block the fast path wrote, converted the slow way, for what reads its children (finish: the description and
// the title read the blocks at the top)
export const materialize = (block: Md): Md => {
  if (block.raw === null || block.el === null) return block
  const savedFast = fast
  fast = false
  before = true
  after = true
  mode = NORMAL
  const el = block.el
  const made = one(el, (INFO.get(el.tag) ?? 0) & KIND_MASK, el.up ?? el)
  fast = savedFast
  return made instanceof Md ? made : block
}
// an element's inline children into out, as all() converts them, or false at the first thing it doesn't know
const fastInline = (parent: Element, heading: Element, out: Md[]): boolean => {
  const kids = kidsOf(parent)
  return fastRun(kids, 0, kids.length, parent, heading, out)
}
// the same for kids[from, to), with what comes after them read as all() would (a list after a run of an item's text)
const fastRun = (
  kids: Node[],
  from: number,
  to: number,
  parent: Element,
  heading: Element,
  out: Md[],
): boolean => {
  for (let i = from; i < to; i++) {
    const kid = kids[i]!
    if (typeof kid === 'string') {
      const value = minified(kid, kids, i)
      if (value === undefined) continue
      const last = out[out.length - 1]
      if (last !== undefined && last.type === TEXT) last.value += value
      else out.push(new Md(TEXT, undefined, value))
      continue
    }
    const tag = kid.tag
    if (kid.flags & FLAG['data-mdast']) return decline('data-mdast')
    const isBreak = tag === 'br'
    const savedAfter = after
    const end = isBreak ? true : collapsableAfter(kids, i, after)
    if (isBreak) before = true
    after = end
    let ok = true
    switch (tag) {
      case 'span':
        ok = fastInline(kid, heading, out)
        break
      case 'strong':
      case 'b':
      case 'em':
      case 'i': {
        const inner: Md[] = []
        ok = fastInline(kid, heading, inner)
        if (ok) out.push(node(tag === 'strong' || tag === 'b' ? STRONG : EMPHASIS, inner))
        break
      }
      case 'code': {
        // code of one text is that text as whitespace leaves it (toText's trims are already done), unless it has
        // bidi controls, which toText strips
        const inner = kidsOf(kid)
        let value: string
        if (inner.length === 1 && typeof inner[0] === 'string') {
          value = minified(inner[0], inner, 0) ?? ''
          if (BIDI_TEST.test(value)) value = toTextOfOne(value)
        } else value = toText(kid)
        out.push(node(INLINE_CODE, undefined, value))
        break
      }
      case 'br':
        out.push(node(BREAK))
        break
      case 'a':
        ok = fastLink(kid, parent === heading && HEADINGS.has(heading.tag), out)
        break
      default:
        ok = decline(`<${tag}>`)
    }
    if (!ok) return false
    const strip = before || end
    after = savedAfter
    before = Boolean(strip)
  }
  return true
}
// a link as link() converts it: unwrapped when it goes nowhere (or to its heading's own anchor)
const fastLink = (el: Element, inHeading: boolean, out: Md[]): boolean => {
  const href = (attr(el, 'href') ?? '').trim()
  const children: Md[] = []
  if (!fastInline(el, el, children)) return false
  if (
    !href ||
    href === '#' ||
    !allowed(href, LINK_SCHEMES) ||
    (href.startsWith('#') && inHeading)
  ) {
    push(out, children)
    return true
  }
  // a link with nothing to read is named by its label: the slow way
  if (!children.some((child) => child.type !== TEXT || child.value.trim()))
    return decline('link named by its label')
  const result = node(LINK, children)
  result.url = resolve(href, false)
  result.title = el.flags & FLAG.title ? (attr(el, 'title') ?? null) : null
  out.push(result)
  return true
}

// how deep in list items and blockquotes the walk is: a list at the top of a flow (0) is written on its own, since
// its bullet depends only on whether a list came right before it
let nested = 0
// the direct path for a list: items of inline content and the lists in them, read in one walk into a DList (each
// paragraph written as its run of text closes) and written by directItems, as list() and listItem() would convert
// them and the serializer write them. anything else declines it before anything is kept
const directList = (el: Element): Md | undefined => {
  const savedBefore = before
  const savedAfter = after
  const read = readList(el)
  // a first item that opens with a list reads the bullet of the list before this one: the slow way
  const first = read?.items[0]
  if (!read || (first!.blocks.length !== 0 && typeof first!.blocks[0] !== 'string')) {
    before = savedBefore
    after = savedAfter
    decline(read ? 'list first in its first item' : 'list')
    return DECLINED
  }
  before = true
  after = savedAfter
  const result = node(LIST)
  result.ordered = read.ordered
  result.depth = read.start
  result.spread = read.spread
  result.raw = directItems(read).join('\0')
  result.el = el
  fastStats.taken++
  fastStats.lists++
  return result
}
const readList = (el: Element): DList | null => {
  if (el.flags & FLAG['data-mdast']) return null
  const kids = kidsOf(el)
  const items: DItem[] = []
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i]!
    // whitespace between items is nothing; anything else moves into an item, the slow way
    if (typeof kid === 'string') {
      if (!blank(kid)) return null
      continue
    }
    if (kid.tag !== 'li' || kid.flags & FLAG['data-mdast']) return null
    const item = readItem(kid)
    if (!item) return null
    items.push(item)
  }
  if (!items.length) return null
  const ordered = el.tag === 'ol'
  let spread = false
  if (items.length > 1) for (let i = 0; i < items.length && !spread; i++) spread = items[i]!.spread
  return { ordered, start: ordered ? startOf(el) : 0, spread, items }
}
// an item: runs of inline content, each a paragraph, and the lists between them. an item is a block, so what's in it
// starts and ends at its edges, and so does each list in it
const readItem = (li: Element): DItem | null => {
  before = true
  after = true
  const kids = kidsOf(li)
  const blocks: (string | DList)[] = []
  let from = 0
  for (let i = 0; i <= kids.length; i++) {
    const kid = kids[i]
    const isList =
      kid !== undefined &&
      typeof kid !== 'string' &&
      (kid.tag === 'ul' || kid.tag === 'ol' || kid.tag === 'dir')
    if (i < kids.length && !isList) continue
    if (from < i) {
      const out: Md[] = []
      if (!fastRun(kids, from, i, li, li, out)) return null
      // toFlow: a run of whitespace alone is no paragraph
      for (let k = 0; k < out.length; k++) {
        const part = out[k]!
        if (part.type !== TEXT || !whitespaceOnly(part.value)) {
          blocks.push(renderBlock(node(PARAGRAPH, dropBreaks(out))))
          break
        }
      }
    }
    if (isList) {
      const inner = readList(kid as Element)
      if (!inner) return null
      blocks.push(inner)
      before = true
      after = true
    }
    from = i + 1
  }
  return { spread: spreadOut(li), blocks }
}
