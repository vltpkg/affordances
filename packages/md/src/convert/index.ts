import type { Element, ElementContent, Nodes as HastNodes, Root as HastRoot } from 'hast'
import type {
  Html,
  List,
  ListItem,
  Nodes as MdastNodes,
  Paragraph,
  PhrasingContent,
  Root as MdastRoot,
  TableCell,
} from 'mdast'
import { fromHtml } from 'hast-util-from-html'
import { select, selectAll } from 'hast-util-select'
import { defaultHandlers, toMdast, type Handle } from 'hast-util-to-mdast'
import { toString } from 'hast-util-to-string'
import { gfmToMarkdown } from 'mdast-util-gfm'
import { toMarkdown } from 'mdast-util-to-markdown'
import { parse, postprocess, preprocess } from 'micromark'
import { gfm } from 'micromark-extension-gfm'
import { decodeString } from 'micromark-util-decode-string'
import { normalizeIdentifier } from 'micromark-util-normalize-identifier'
import { visit } from 'unist-util-visit'

export type Handlers = Record<string, Handle>

export type Options = {
  // base for absolutizing links and images, usually the page's url
  url?: string
  // 'auto': markers, then <main>, then the body minus its chrome; 'none': the whole body
  extract?: 'auto' | 'none' | ((tree: HastRoot) => HastRoot)
  frontmatter?: boolean
  jsonLd?: boolean
  handlers?: Handlers
  // another url for a link once it's absolute, e.g. the linked page's markdown twin; undefined keeps it. not called
  // for images or a link to a #fragment of the page itself
  link?: (url: URL) => string | undefined
  // markdown for each <AgentSlot name>, in place of its children. a name the page renders more than once fills nothing
  slots?: Record<string, string>
}

// url: the page's canonical url (or the one given), for a Link header
export type Result = { markdown: string; title?: string; url?: string; tokens: number }

// never content, whatever the page says
// (form controls stay until conversion: the form summary and task-list items read them, then handlers drop them)
const ALWAYS_DROP = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'link',
  'meta',
  'head',
  'object',
  'embed',
  'audio',
  'video',
  'source',
])
const CHROME =
  'nav, header, footer, aside, dialog, [role=navigation], [role=banner], [role=contentinfo], [role=complementary], [aria-hidden=true], [hidden]'

const isElement = (node: unknown): node is Element => (node as Element)?.type === 'element'
const mode = (node: Element) =>
  node.tagName === 'affordances-md'
    ? String(node.properties.dataMode ?? '')
    : node.properties.dataAffordancesMd === 'skip' || node.properties.dataAffordancesMd === 'show'
      ? node.properties.dataAffordancesMd
      : undefined
// what's kept though it's hidden from people: <AgentOnly>, and what people can open on the page (a tab panel, an
// accordion's content) marked data-affordances-md="show"
const unhidden = (node: Element) => mode(node) === 'only' || mode(node) === 'show'

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
type Declarations = [property: string, value: string][]
const declarations = (node: Element): Declarations =>
  node.properties.style === undefined
    ? []
    : cssText(String(node.properties.style))
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
const styleHidden = (style: Declarations) =>
  style.some(
    ([property, keyword]) =>
      (property === 'display' && keyword === 'none') ||
      (property === 'visibility' && (keyword === 'hidden' || keyword === 'collapse')) ||
      (property === 'content-visibility' && keyword === 'hidden'),
  )

// what an icon or avatar link (an image without alt) is called. a link reads its own content first, so this is only
// the name it has without any: its aria-labelledby, aria-label or title
const linkLabel = (a: Element, byId: Ids) =>
  accessibleName(a, { byId: typeof byId === 'function' ? byId() : byId }, false)
// the page's ids, or how to find them only once a link needs them
type Ids = Map<string, Element> | (() => Map<string, Element>)

const described = (node: Element) => selectAll('img[alt]:not([alt=""])', node)

// what a link renders as: its text, else its described images, else its label
const linkText = (a: Element, byId: Ids) =>
  text(a) ||
  described(a)
    .map((img) => `${img.properties.alt} ${img.properties.src}`)
    .join(' ') ||
  linkLabel(a, byId)

// a skeleton table (placeholder cells waiting on data): no cell has anything to read, or a header with text sits
// over body rows that are all empty, | | Status | | | over an empty row. the header is the thead's rows, or without
// one a first row of only th cells; a table of header rows alone is kept
// a row's own cells; a nested table's are inside them, and in their text
const cells = (row: Element, tags = ['td', 'th']) =>
  row.children.filter((cell): cell is Element => isElement(cell) && tags.includes(cell.tagName))
const emptyRow = (row: Element) =>
  cells(row).every((cell) => !text(cell) && !described(cell).length)
const skeleton = (table: Element) => {
  // its rows, and those in a thead, in one walk
  const rows: Element[] = []
  const header = new Set<Element>()
  const walk = (parent: Element, inHead: boolean) => {
    for (const child of parent.children) {
      if (!isElement(child)) continue
      if (child.tagName === 'tr') {
        rows.push(child)
        if (inHead) header.add(child)
      }
      walk(child, inHead || child.tagName === 'thead')
    }
  }
  walk(table, false)
  const first = rows[0]
  if (!header.size && first && !cells(first, ['td']).length) header.add(first)
  const body = rows.filter((row) => !header.has(row))
  return rows.every(emptyRow) || (body.length > 0 && body.every(emptyRow))
}

// inline elements a page lays out side by side with css gaps, <span>express</span><span>5.3.0</span>; with no text
// between, they get a space. html can't tell a css gap from a split word, so the space goes only where a letter or
// digit meets another ($48 stays whole); links side by side are always separate, even inside a wrapper each
// (<span><a/></span><span><a/></span>, an avatar stack)
const INLINE = new Set(['a', 'span', 'code', 'strong', 'em', 'b', 'i', 'small', 'time', 'abbr'])
const isInline = (node: ElementContent | undefined): node is Element =>
  isElement(node) && INLINE.has(node.tagName)
const isBlank = (node: ElementContent | undefined) => node?.type === 'text' && !node.value.trim()
// in a flex or grid container every child is its own box, bare text too, so a text node beside an element is
// laid out apart from it (configure<span>vlt</span> reads configure vlt). outside one, text beside an element is
// the same run of text (un<em>believ</em>able)
// (display: flex in a style, or tailwind's flex, inline-grid, md:flex)
const LAID_OUT = /^([\w-]+:)*(inline-)?(flex|grid)$/
// whether an element's class or display style is one of these displays
const displays = (node: Element, style: Declarations, display: RegExp) =>
  [node.properties.className].flat().some((name) => display.test(String(name ?? ''))) ||
  style.some(([property, value]) => property === 'display' && display.test(value))
const laidOut = (node: HastRoot | Element, style: Declarations) =>
  isElement(node) && displays(node, style, LAID_OUT)
// an inline element made a box of its own (tailwind's block, flex or grid, or the same display) sits on its own line
// or in its own box, so it's apart from what's beside it whatever the characters: a cell's <span class="block">yarn
// (zpm)</span><span class="block">6.0.0</span> reads yarn (zpm) 6.0.0. single characters still stay together, as
// below: a ticker stacks its digits in boxes, and $ beside 48 is a price
const BOXED = /^([\w-]+:)*(block|flex|grid)$/
const boxed = (node: ElementContent | undefined, style: Declarations = []) =>
  isInline(node) && displays(node, style, BOXED)
// a run of one-character elements is one word split for styling or animation (H e l l o, an odometer's 1 2 3), so
// two words are only spaced when both are longer
const word = (node: ElementContent | undefined) => {
  const text = isInline(node) ? toString(node).trim() : node?.type === 'text' ? node.value : ''
  return [...text.trim()].length > 1 ? text : ''
}
// a block with nothing to read: no text, no described image
const emptyBlock = (node: Element) =>
  !INLINE.has(node.tagName) &&
  node.tagName !== 'img' &&
  node.tagName !== 'br' &&
  !toString(node).trim() &&
  !described(node).length
// the link an inline element starts or ends with: itself, or the first or last thing in it
const edgeLink = (node: ElementContent | undefined, end: boolean): Element | undefined => {
  if (!isInline(node)) return
  if (node.tagName === 'a') return node
  const inside = node.children.filter((child) => !isBlank(child))
  return edgeLink(end ? inside.at(-1) : inside[0], end)
}
// the one link an inline element is: itself, or a wrapper with nothing else in it
const soleLink = (node: ElementContent | undefined): Element | undefined => {
  if (!isInline(node)) return
  if (node.tagName === 'a') return node
  const inside = node.children.filter((child) => !isBlank(child))
  return inside.length === 1 ? soleLink(inside[0]) : undefined
}
const spaced = (
  left: ElementContent,
  right: ElementContent | undefined,
  leftWord: string,
  rightWord: string,
  items: boolean,
  boxes: boolean,
) =>
  (isInline(left) || ((items || boxes) && left.type === 'text')) &&
  (isInline(right) || ((items || boxes) && right?.type === 'text')) &&
  (isInline(left) || isInline(right)) &&
  ((!!edgeLink(left, true) && !!edgeLink(right, false)) ||
    (/[\p{L}\p{N}]$/u.test(leftWord) && /^[\p{L}\p{N}]/u.test(rightWord)) ||
    (boxes && leftWord !== '' && rightWord !== ''))

// headers and summaries whose text is a button's (<th><button>Name</button></th>, a sortable column; <h3><button
// aria-expanded>Shipping</button></h3>, an accordion): with no text outside the buttons, the buttons' text is theirs
const LABEL_HOSTS = new Set(['th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'caption', 'summary', 'dt'])

// what an aria-labelledby can name: the first element with an id, as getElementById finds it, among what prune keeps.
// one inside something hidden from people (display: none, hidden, aria-hidden, <AgentSkip>, <noscript>) or replaced
// by an <AgentText> never names anything, so a name can't carry hidden text out
const ids = (root: HastRoot | Element) => {
  const byId = new Map<string, Element>()
  const walk = (parent: HastRoot | Element) => {
    for (const child of parent.children) {
      if (!isElement(child) || dropped(child)) continue
      const id = child.properties.id
      if (id !== undefined && !byId.has(String(id))) byId.set(String(id), child)
      if (mode(child) !== 'text') walk(child)
    }
  }
  walk(root)
  return byId
}
// what prune leaves out, with everything in it. an editor (contenteditable, role=textbox) is a field like a textarea:
// its text is what someone typed, which never leaves the page
const dropped = (el: Element, style = declarations(el)) =>
  ALWAYS_DROP.has(el.tagName) ||
  mode(el) === 'skip' ||
  editor(el) ||
  (!unhidden(el) &&
    ((el.properties.hidden !== undefined && el.properties.hidden !== false) ||
      String(el.properties.ariaHidden) === 'true' ||
      styleHidden(style)))

// drop what never belongs (scripts, controls, comments) and apply skip/text/only markers, in place. code is
// left as written: a highlighter's tokens are adjacent spans
// markdown from a marker, emitted verbatim by the span and div handlers. the text child keeps whitespace around it
// significant (an empty span would let it collapse)
const markdownOf = (md: string, block: boolean): Element => ({
  type: 'element',
  tagName: block ? 'div' : 'span',
  properties: { dataAffordancesMdText: md },
  children: [{ type: 'text', value: md }],
})

const prune = (parent: HastRoot | Element, literal = false) => {
  let byId: Map<string, Element> | undefined
  let tabs: Set<string> | undefined
  const page: Pruning = {
    byId: () => (byId ??= ids(parent)),
    tabs: () =>
      (tabs ??= new Set(selectAll('[data-affordances-md=show]', parent).flatMap(labelledBy))),
  }
  pruneWith(parent, page, literal)
}
// what prune reads from the whole page, once it needs it: its ids, and the tabs that label a shown panel
type Pruning = { byId: () => Map<string, Element>; tabs: () => Set<string> }
// a tablist whose panels are shown: each panel is headed by its tab, so the tabs aren't said again
const shownTablist = (el: Element, page: Pruning) =>
  String(el.properties.role) === 'tablist' &&
  selectAll('[role=tab]', el).some((tab) => page.tabs().has(String(tab.properties.id ?? '')))
// with the page, and the parent's style already parsed
const pruneWith = (
  parent: HastRoot | Element,
  page: Pruning,
  literal: boolean,
  style: Declarations = [],
) => {
  const { byId } = page
  // each child's style, parsed once, for its own prune and for the spacing below
  const styles = new Map<ElementContent, Declarations>()
  parent.children = parent.children.flatMap((child): ElementContent[] => {
    if (child.type === 'comment' || child.type === 'doctype') return []
    if (!isElement(child)) return [child as ElementContent]
    if (ALWAYS_DROP.has(child.tagName)) return []
    // only an <AgentText> flattened below is emitted verbatim; the page's own attribute is just an attribute
    delete child.properties.dataAffordancesMdText
    const m = mode(child)
    if (m === 'skip') return []
    if (m === 'text') {
      // a span or div, so whitespace around it follows the page's inline/block flow; emitted verbatim below
      const block = child.properties.dataBlock !== undefined && child.properties.dataBlock !== false
      return [markdownOf(String(child.properties.dataMd ?? ''), block)]
    }
    if (unhidden(child)) {
      const { hidden: _, ...properties } = child.properties
      child.properties = properties
    }
    if (shownTablist(child, page)) return []
    const childStyle = declarations(child)
    styles.set(child, childStyle)
    // hidden from people means hidden from agents, unless it was marked for them
    if (dropped(child, childStyle)) return []
    pruneWith(
      child,
      page,
      literal || child.tagName === 'pre' || child.tagName === 'code',
      childStyle,
    )
    // a shown tab panel is headed by its tab's label
    if (m === 'show' && String(child.properties.role) === 'tabpanel') {
      const label = idrefs(child, byId())
        .filter((tab) => String(tab.properties.role) === 'tab')
        .map(words)
        .filter(Boolean)
        .join(' ')
      if (label)
        child.children.unshift({
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [
            {
              type: 'element',
              tagName: 'strong',
              properties: {},
              children: [{ type: 'text', value: label }],
            },
          ],
        })
    }
    // a link with nothing to read (no text, no described image) reads as its label, and has it before the spacing
    // below, so it's spaced like text; without one it's gone, and leaves no gap
    // a link's text is its name, so what carries a value in it (a meter, an editor) isn't. a block in it with nothing
    // to read (an avatar's empty fallback <div>) is gone too: it would make the link a block, and two links side by
    // side would lose the space between them
    if (child.tagName === 'a')
      child.children = without(child, (inner) => valueBearing(inner) || emptyBlock(inner)).children
    if (child.tagName === 'a' && !toString(child).trim() && !described(child).length) {
      const label = linkLabel(child, byId)
      if (!label) return []
      child.children = [{ type: 'text', value: label }]
    }
    if (
      LABEL_HOSTS.has(child.tagName) &&
      !text(without(child, (inner) => inner.tagName === 'button'))
    )
      // read as its name, so without what carries a value
      child.children = unwrap(without(child, valueBearing), 'button').children
    if (child.tagName === 'table' && skeleton(child)) return []
    return [child]
  })
  if (literal || parent.children.length < 2) return
  const children = parent.children as ElementContent[]
  // each child's word once, not once per neighbour
  const items = laidOut(parent, style)
  const childWords = children.map(word)
  const childBoxes = children.map((child) => boxed(child, styles.get(child)))
  parent.children = children.flatMap((child, i): ElementContent[] =>
    spaced(
      child,
      children[i + 1],
      childWords[i]!,
      childWords[i + 1] ?? '',
      items,
      childBoxes[i]! || !!childBoxes[i + 1],
    )
      ? [child, { type: 'text', value: ' ' }]
      : [child],
  )
  // a run of the same link, only whitespace between (six avatars labelled alike, each maybe in a wrapper), reads as one
  parent.children = (parent.children as ElementContent[]).reduce<ElementContent[]>(
    (kept, child) => {
      const current = soleLink(child)
      if (current) {
        let at = kept.length
        while (isBlank(kept[at - 1])) at--
        const previous = soleLink(kept[at - 1])
        if (
          previous &&
          String(previous.properties.href ?? '').trim() ===
            String(current.properties.href ?? '').trim() &&
          linkText(previous, byId) === linkText(current, byId)
        ) {
          kept.length = at
          return kept
        }
      }
      kept.push(child)
      return kept
    },
    [],
  )
}

// react streams each resolved <Suspense> boundary after the shell, hidden, with an instruction that moves it into
// place: $RC("B:1","S:1") (or $RR, with its stylesheets) puts a segment where the boundary's fallback is, and
// $RS("S:2","P:1") puts one where a placeholder is. with an external runtime the same instructions are templates:
// data-rci, data-rri, data-rsi. ids are hex (B:a comes after B:9) and can carry a prefix, and a segment is a hidden
// div, or the table, tbody, tr or svg its content needs. $RX, a boundary the server gave up on, keeps its fallback.
// make the same moves, so streamed content counts. the page's scripts come from the same walk, before any move
const resolveStreamed = (tree: HastRoot) => {
  // one walk: the instructions, every id, each element's parent, and the scripts
  const scripts: Element[] = []
  const instructions: Element[] = []
  const templates: Element[] = []
  const byId = new Map<string, Element>()
  const parents = new Map<ElementContent, HastRoot | Element>()
  visit(tree, 'element', (node, _, parent) => {
    if (parent) parents.set(node, parent as HastRoot | Element)
    const id = node.properties.id
    if (id != null) byId.set(String(id), node)
    if (node.tagName === 'script') scripts.push(node)
    if (node.tagName !== 'template') return
    if (id != null) templates.push(node)
    if (node.properties.dataBid != null || node.properties.dataPid != null) instructions.push(node)
  })
  const boundaries = new Map<string, string>()
  const placeholders = new Map<string, string>()
  for (const script of scripts)
    for (const [, kind, a, b] of toString(script).matchAll(/\$R([CRS])\("([^"]+)","([^"]+)"/g))
      if (kind === 'S') placeholders.set(b!, a!)
      else boundaries.set(a!, b!)
  for (const template of instructions) {
    const { dataBid, dataPid, dataSid, dataRci, dataRri, dataRsi } = template.properties
    if ((dataRci != null || dataRri != null) && dataBid != null)
      boundaries.set(String(dataBid), String(dataSid))
    if (dataRsi != null && dataPid != null) placeholders.set(String(dataPid), String(dataSid))
  }
  const resolve = () => {
    if (!boundaries.size && !placeholders.size) return
    // in document order, once: a segment's own templates (nested boundaries) move with it, and are reached after it
    for (const template of templates) {
      const id = String(template.properties.id)
      const boundary = boundaries.has(id)
      const segment = byId.get((boundary ? boundaries : placeholders).get(id) ?? '')
      const parent = parents.get(template)
      // a template inside a fallback that was already replaced is gone
      const start = parent ? parent.children.indexOf(template) : -1
      if (!segment || !parent || start < 0) continue
      // a boundary's fallback runs from its template to the boundary's closing <!--/$-->; a placeholder is the
      // template alone
      let end = start + 1
      if (boundary)
        for (let depth = 0; end < parent.children.length; end++) {
          const node = parent.children[end]!
          if (node.type !== 'comment') continue
          if (node.value.startsWith('$')) depth++
          else if (node.value === '/$' && depth-- === 0) break
        }
      for (const child of segment.children) parents.set(child, parent)
      parent.children.splice(start, end - start, ...segment.children)
      segment.children = []
    }
  }
  return { scripts, resolve }
}

// the elements that are, in page order, with none inside another: one walk that stops at each
const outermost = (root: HastRoot, is: (el: Element) => boolean) => {
  const found: Element[] = []
  const walk = (parent: HastRoot | Element) => {
    for (const child of parent.children)
      if (isElement(child)) {
        if (is(child)) found.push(child)
        else walk(child)
      }
  }
  walk(root)
  return found
}
const extract = (body: HastRoot, how: Options['extract']): HastRoot => {
  if (typeof how === 'function') return how(body)
  if (how === 'none') return body
  // a main inside another main is already part of it
  const outer = outermost(
    body,
    (el) => el.tagName === 'affordances-md' && el.properties.dataMode === 'main',
  )
  if (outer.length) return { type: 'root', children: outer }
  // the outermost landmark, so a <main> or role=main in a comment inside it never replaces it; among several, a real
  // <main> before a [role=main], since a role survives sanitizers that keep attributes
  const landmarks = outermost(body, (el) => el.tagName === 'main' || el.properties.role === 'main')
  const main = landmarks.find((m) => m.tagName === 'main') ?? landmarks[0]
  if (main) return { type: 'root', children: [main] }
  // the page has no landmark: take the body and drop its chrome, but keep what was marked for agents
  const chrome = new Set(selectAll(CHROME, body).filter((el) => !unhidden(el)))
  const strip = (parent: HastRoot | Element) => {
    const kept = (parent.children as ElementContent[]).filter(
      (child) => !(isElement(child) && chrome.has(child)),
    )
    parent.children = kept
    for (const child of kept) if (isElement(child)) strip(child)
  }
  strip(body)
  return body
}

// <AgentSlot name>s where they reach the markdown, after prune and extract, so one inside <AgentSkip>, hidden, or
// outside <AgentMain> never counts and its fill never runs. only the outermost: a slot's children are the people's
// version of what its fill says, so a slot inside one is never filled, and its fill never runs either
const slotMarkers = (parent: HastRoot | Element, found: Element[] = []) => {
  for (const child of parent.children)
    if (isElement(child)) {
      if (mode(child) === 'slot') found.push(child)
      else slotMarkers(child, found)
    }
  return found
}

// set on a slot a fill can go to: a property no attribute parses to, so a page can't forge it
const FILLABLE = 'affordancesSlot'

// next's flight data (self.__next_f pushes: the payload the client hydrates from and, with partialPrefetching, a
// second render to prefetch from) is most of a big page's bytes and none of what it says. flightStripper takes each
// push out as the page streams, reading it for its error rows: a push is the text of a script element, as parse5 would
// find one, so a <script in a comment, an attribute, raw text or rcdata, a <template> or another script is never taken
// for one. only the script's text is swapped, for a nonce (hex and dashes), so even a mistaken swap can't end the context
// it's in. after parsing, every nonce must be a script's whole text and no script may still hold a push, or the swaps
// can't be trusted
const CALL = String.raw`\s*(?:\(self\.__next_f\s*=\s*self\.__next_f\s*\|\|\s*\[\]\)|self\.__next_f)\.push\(`
const PUSH = new RegExp(String.raw`^${CALL}([\s\S]*)\)\s*;?\s*$`)
// a script that starts like a push is one, read or not: one that doesn't end like one can't be read
const PUSHED = new RegExp(String.raw`^${CALL}`)

// the html tokenizer's raw text (rawtext and rcdata) elements: their text runs to their own end tag. noscript isn't
// one: the page is parsed with scripting off, as hast-util-from-html parses it
const RAW = new Set(['style', 'xmp', 'iframe', 'noembed', 'noframes', 'title', 'textarea'])
// a start tag that ends foreign content (svg, math) and is an html element again
const BREAKOUT = new Set(
  'b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var'.split(
    ' ',
  ),
)
// a foreign element whose content is html: svg's foreignObject, desc and title, math's text elements, and an
// annotation-xml that says it's html
const INTEGRATION = {
  svg: new Set(['foreignobject', 'desc', 'title']),
  math: new Set(['mi', 'mo', 'mn', 'ms', 'mtext']),
}
const space = (char: string | undefined) =>
  char === ' ' || char === '\n' || char === '\t' || char === '\f' || char === '\r'
const alpha = (char: string | undefined) => !!char && /[a-z]/i.test(char)
const lower = (text: string) =>
  /[A-Z]/.test(text) ? text.replace(/[A-Z]+/g, (upper) => upper.toLowerCase()) : text
// a script's end tag, or (in its escaped text) what changes how its text is read
const SCRIPT_DATA = /<\/script(?=[\t\n\f\r />])|<!--/gi
const SCRIPT_ESCAPED = /<\/script(?=[\t\n\f\r />])|<script(?=[\t\n\f\r />])|-->/gi
const SCRIPT_DOUBLE = /<\/script(?=[\t\n\f\r />])|-->/gi
// the longest lookahead any state needs: <!DOCTYPE, <![CDATA[, </script and the character after it
const LOOKAHEAD = 10
// a whole tag in html content, as the tokenizer reads it, in one step: its name, then attributes (a quote starts a value
// only after a name and =, as in the tokenizer, and nothing outside a quoted value can hold >), to its >. each part
// takes all it can, so it never backtracks into another reading. anything else (a quote that hasn't closed yet, an
// attribute starting with =) goes the long way
const TAG = new RegExp(
  String.raw`([a-zA-Z][^\t\n\f\r />]*)(?:[\t\n\f\r /]+(?![\t\n\f\r /])|[^\t\n\f\r />=]+(?![^\t\n\f\r />=])(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"[^"]*"|'[^']*'|[^\t\n\f\r >"']+(?![^\t\n\f\r >])))?)*>`,
  'y',
)
const NAME_RUN = /[^\t\n\f\r />=]+/y
const VALUE_RUN = /[^\t\n\f\r >]+/y
const SPACE_RUN = /[\t\n\f\r ]+/y

type Foreign = { name: string; ns: 'svg' | 'math'; html: boolean }
type State =
  | 'data'
  | 'tagName'
  | 'attributes'
  | 'commentStart'
  | 'comment'
  | 'bogus'
  | 'cdata'
  | 'raw'
  | 'script'
  | 'foreignScript'
  | 'plaintext'
type Attribute =
  | 'before'
  | 'name'
  | 'after'
  | 'beforeValue'
  | 'dq'
  | 'sq'
  | 'unquoted'
  | 'afterValue'
  | 'slash'

// what a push said: its error rows' digests, and whether any push or error row couldn't be read
export type Swapped = { nonce: string; count: number; errors: string[]; unreadable: boolean }
export const flightStripper = () => {
  const nonce = crypto.randomUUID()
  const rows = rowScanner()
  let count = 0
  let carry = ''
  let state: State = 'data'
  // the tag being read: its name (lowercased, the first 32 characters), end or start, self-closing, its attributes'
  // names, and annotation-xml's encoding
  let name = ''
  let end = false
  let selfClosing = false
  let attribute: Attribute = 'before'
  let attributeName = ''
  let attributes = new Set<string>()
  let encoding = ''
  // the raw text element being read, a script's text so far (held, since it's swapped whole or given back whole), and
  // where in its escapes the script's text is
  let raw = ''
  let script: string[] = []
  let escape: 'data' | 'escaped' | 'double' = 'data'
  let dashed = false
  // the open foreign elements, and how many templates are open: a script in a template's content isn't in the page
  const foreign: Foreign[] = []
  let templates = 0
  const inForeign = () => foreign.length > 0 && !foreign.at(-1)!.html
  // a script element's text is complete: a push (not in a template) is swapped for the nonce, anything else is given
  // back as it was
  const ended = (out: string[]) => {
    const text = script.join('')
    script = []
    if (templates || !PUSHED.test(text)) return void out.push(text)
    const push = PUSH.exec(text)?.[1]
    if (push === undefined) rows.unreadable()
    else rows.push(push)
    count += 1
    out.push(nonce)
  }
  const startTag = () => {
    if (inForeign()) {
      if (
        BREAKOUT.has(name) ||
        (name === 'font' && ['color', 'face', 'size'].some((a) => attributes.has(a)))
      )
        while (foreign.length && !foreign.at(-1)!.html) foreign.pop()
      else {
        if (name === 'script' && !selfClosing) return 'foreignScript'
        if (!selfClosing) {
          const ns = name === 'svg' ? 'svg' : name === 'math' ? 'math' : foreign.at(-1)!.ns
          const html =
            INTEGRATION[ns].has(name) ||
            (ns === 'math' &&
              name === 'annotation-xml' &&
              /^(text\/html|application\/xhtml\+xml)$/.test(lower(encoding)))
          foreign.push({ name, ns, html })
        }
        return 'data'
      }
    }
    if ((name === 'svg' || name === 'math') && !selfClosing) {
      foreign.push({ name, ns: name, html: false })
      return 'data'
    }
    if (name === 'template') templates += 1
    if (name === 'script') {
      escape = 'data'
      return 'script'
    }
    if (RAW.has(name)) {
      raw = name
      return 'raw'
    }
    return name === 'plaintext' ? 'plaintext' : 'data'
  }
  const endTag = () => {
    if (inForeign() && (name === 'br' || name === 'p'))
      while (foreign.length && !foreign.at(-1)!.html) foreign.pop()
    if (inForeign()) {
      // the nearest open foreign element of that name, up to the html around it
      for (let at = foreign.length - 1; at >= 0 && !foreign[at]!.html; at -= 1)
        if (foreign[at]!.name === name) {
          foreign.length = at
          break
        }
      return
    }
    if (foreign.length && foreign.at(-1)!.name === name) foreign.pop()
    else if (name === 'template' && templates) templates -= 1
  }
  const run = (text: string, final: boolean) => {
    const buffer = carry + text
    carry = ''
    const out: string[] = []
    const n = buffer.length
    let i = 0
    // not enough left to decide: keep the rest for the next chunk (always a few characters), or at the end, go on
    const short = (need: number) => !final && n - i < need
    while (i < n) {
      if (state === 'data') {
        const lt = buffer.indexOf('<', i)
        if (lt < 0) {
          out.push(buffer.slice(i))
          i = n
          break
        }
        out.push(buffer.slice(i, lt))
        i = lt
        if (short(LOOKAHEAD)) break
        const next = buffer[i + 1]
        // a whole tag in html content at once, when it's all here (html ignores self-closing but on svg and math)
        const at = next === '/' ? i + 2 : i + 1
        if (!inForeign() && alpha(buffer[at])) {
          TAG.lastIndex = at
          const tag = TAG.exec(buffer)
          // svg and math go the long way, since only theirs can be self-closing (<svg/> opens no foreign content)
          if (tag && !/^(svg|math)$/i.test(tag[1]!)) {
            out.push(buffer.slice(i, TAG.lastIndex))
            i = TAG.lastIndex
            ;[name, end, selfClosing] = [lower(tag[1]!.slice(0, 32)), next === '/', false]
            state = end ? (endTag(), 'data') : startTag()
            if (state === 'script' || state === 'foreignScript') script = []
            continue
          }
        }
        if (alpha(next)) {
          out.push('<')
          i += 1
          ;[state, name, end, selfClosing, attributes, encoding] = [
            'tagName',
            '',
            false,
            false,
            new Set(),
            '',
          ]
        } else if (next === '/') {
          const after = buffer[i + 2]
          if (alpha(after)) {
            out.push('</')
            i += 2
            ;[state, name, end, selfClosing, attributes, encoding] = [
              'tagName',
              '',
              true,
              false,
              new Set(),
              '',
            ]
          } else if (after === '>') {
            out.push('</>')
            i += 3
          } else {
            out.push('</')
            i += 2
            state = after === undefined ? 'data' : 'bogus'
          }
        } else if (next === '!') {
          const head = buffer.slice(i, i + 9)
          if (head.startsWith('<!--')) {
            out.push('<!--')
            i += 4
            state = 'commentStart'
          } else if (lower(head) === '<!doctype' || (head === '<![CDATA[' && inForeign())) {
            out.push(head)
            i += 9
            state = head === '<![CDATA[' ? 'cdata' : 'bogus'
          } else {
            out.push('<!')
            i += 2
            state = 'bogus'
          }
        } else if (next === '?') {
          out.push('<?')
          i += 2
          state = 'bogus'
        } else {
          out.push('<')
          i += 1
        }
      } else if (state === 'tagName') {
        let at = i
        while (at < n && !space(buffer[at]) && buffer[at] !== '/' && buffer[at] !== '>') at += 1
        if (name.length < 32) name += lower(buffer.slice(i, Math.min(at, i + 32 - name.length)))
        out.push(buffer.slice(i, at))
        i = at
        if (i < n) [state, attribute] = ['attributes', 'before']
      } else if (state === 'attributes') {
        // runs of a name, an unquoted value or spaces in one step: most of a page's tags are attributes
        const runOf =
          attribute === 'name'
            ? NAME_RUN
            : attribute === 'unquoted'
              ? VALUE_RUN
              : attribute === 'before' || attribute === 'after' || attribute === 'beforeValue'
                ? SPACE_RUN
                : undefined
        if (runOf) {
          runOf.lastIndex = i
          const found = runOf.exec(buffer)
          if (found) {
            const taken = found[0]
            if (attribute === 'name' && attributeName.length < 32)
              attributeName += lower(taken.slice(0, 32))
            else if (
              attribute === 'unquoted' &&
              attributeName === 'encoding' &&
              encoding.length < 32
            )
              encoding += taken.slice(0, 32)
            out.push(taken)
            i += taken.length
            continue
          }
        }
        const char = buffer[i]!
        if (attribute === 'dq' || attribute === 'sq') {
          const quote = buffer.indexOf(attribute === 'dq' ? '"' : "'", i)
          const stop = quote < 0 ? n : quote
          if (attributeName === 'encoding' && encoding.length < 32)
            encoding += buffer.slice(i, Math.min(stop, i + 32))
          out.push(buffer.slice(i, quote < 0 ? n : quote + 1))
          i = quote < 0 ? n : quote + 1
          if (quote >= 0) attribute = 'afterValue'
          continue
        }
        out.push(char)
        i += 1
        if (char === '>') {
          if (attribute === 'name') attributes.add(attributeName)
          if (attribute === 'slash') selfClosing = true
          state = end ? (endTag(), 'data') : startTag()
          if (state === 'script' || state === 'foreignScript') script = []
          continue
        }
        if (attribute === 'before' || attribute === 'after') {
          if (space(char)) continue
          if (char === '/') attribute = 'slash'
          else if (char === '=' && attribute === 'after') attribute = 'beforeValue'
          else [attribute, attributeName] = ['name', lower(char)]
        } else if (attribute === 'name') {
          if (space(char) || char === '/' || char === '=') {
            attributes.add(attributeName)
            attribute = char === '=' ? 'beforeValue' : char === '/' ? 'slash' : 'after'
          } else if (attributeName.length < 32) attributeName += lower(char)
        } else if (attribute === 'beforeValue') {
          if (space(char)) continue
          if (char === '"') attribute = 'dq'
          else if (char === "'") attribute = 'sq'
          else {
            attribute = 'unquoted'
            if (attributeName === 'encoding') encoding = char
          }
        } else if (attribute === 'unquoted') {
          if (space(char)) attribute = 'before'
          else if (attributeName === 'encoding' && encoding.length < 32) encoding += char
        } else if (attribute === 'afterValue') {
          if (space(char)) attribute = 'before'
          else if (char === '/') attribute = 'slash'
          else [attribute, attributeName] = ['name', lower(char)]
        } else if (attribute === 'slash') {
          // a / right before > is self-closing (above); anything else is read again as before an attribute
          if (char === '/') attribute = 'slash'
          else if (space(char)) attribute = 'before'
          else [attribute, attributeName] = ['name', lower(char)]
        }
      } else if (state === 'commentStart') {
        if (short(2)) break
        // <!--> and <!---> end at once
        const shut = buffer[i] === '>' ? 1 : buffer.startsWith('->', i) ? 2 : 0
        out.push(buffer.slice(i, i + shut))
        i += shut
        state = shut ? 'data' : 'comment'
      } else if (state === 'comment') {
        const dashes = buffer.indexOf('--', i)
        if (dashes < 0 || (!final && dashes + 4 > n)) {
          const keep = dashes < 0 ? Math.max(i, n - 1) : dashes
          out.push(buffer.slice(i, keep))
          i = keep
          if (!final) break
          out.push(buffer.slice(i))
          i = n
          break
        }
        const close = buffer[dashes + 2] === '>' ? 3 : buffer.startsWith('!>', dashes + 2) ? 4 : 0
        out.push(buffer.slice(i, close ? dashes + close : dashes + 1))
        i = close ? dashes + close : dashes + 1
        if (close) state = 'data'
      } else if (state === 'bogus' || state === 'cdata') {
        const stop = buffer.indexOf(state === 'bogus' ? '>' : ']]>', i)
        const keep =
          stop >= 0
            ? stop + (state === 'bogus' ? 1 : 3)
            : final || state === 'bogus'
              ? n
              : Math.max(i, n - 2)
        out.push(buffer.slice(i, keep))
        i = keep
        if (stop >= 0) state = 'data'
        else if (!final && state === 'cdata') break
      } else if (state === 'raw') {
        const close = buffer.indexOf('</', i)
        if (close < 0) {
          out.push(buffer.slice(i, Math.max(i, n - 1)))
          i = Math.max(i, n - 1)
          if (final) {
            out.push(buffer.slice(i))
            i = n
          }
          break
        }
        out.push(buffer.slice(i, close))
        i = close
        if (short(raw.length + 3)) break
        if (
          lower(buffer.slice(i + 2, i + 2 + raw.length)) === raw &&
          /[\t\n\f\r />]/.test(buffer[i + 2 + raw.length] ?? '')
        )
          state = 'data'
        else {
          out.push('</')
          i += 2
        }
      } else if (state === 'script') {
        if (dashed) {
          // right after <!--, more dashes then > (<!-->, <!--->) end the escape it started
          while (i < n && buffer[i] === '-') script.push(buffer[i++]!)
          if (i === n && !final) break
          dashed = false
          if (buffer[i] === '>') {
            script.push('>')
            i += 1
            escape = 'data'
          }
          continue
        }
        const pattern =
          escape === 'data' ? SCRIPT_DATA : escape === 'escaped' ? SCRIPT_ESCAPED : SCRIPT_DOUBLE
        pattern.lastIndex = i
        const found = pattern.exec(buffer)
        // a match may be cut off by the chunk's end, or need the character after it: wait for more
        if (!final && (!found || found.index > n - LOOKAHEAD)) {
          const keep = Math.max(i, Math.min(found?.index ?? n, n - LOOKAHEAD))
          script.push(buffer.slice(i, keep))
          i = keep
          break
        }
        if (!found) {
          // the page ended inside the script: what it held is given back as it was
          script.push(buffer.slice(i))
          out.push(script.join(''))
          script = []
          i = n
          break
        }
        script.push(buffer.slice(i, found.index))
        i = found.index
        const match = lower(found[0])
        if (match === '</script' && escape !== 'double') {
          ended(out)
          state = 'data'
        } else {
          script.push(found[0])
          i += found[0].length
          if (match === '<!--') [escape, dashed] = ['escaped', true]
          else if (match === '-->') escape = 'data'
          else escape = match === '<script' ? 'double' : 'escaped'
        }
      } else if (state === 'foreignScript') {
        // an svg or math script's text is read as text: it's a push only if nothing but text comes before its end tag
        const lt = buffer.indexOf('<', i)
        if (lt < 0) {
          script.push(buffer.slice(i))
          i = n
          break
        }
        script.push(buffer.slice(i, lt))
        i = lt
        if (short(LOOKAHEAD)) break
        if (
          /^<\/script[\t\n\f\r />]/i.test(buffer.slice(i, i + 9)) ||
          (final && /^<\/script$/i.test(buffer.slice(i)))
        )
          ended(out)
        else {
          out.push(script.join(''))
          script = []
        }
        state = 'data'
      } else {
        out.push(buffer.slice(i))
        i = n
      }
    }
    carry = buffer.slice(i)
    if (final && carry) {
      out.push(carry)
      carry = ''
    }
    if (final && script.length) {
      out.push(script.join(''))
      script = []
    }
    return out.join('')
  }
  return {
    write: (text: string) => run(text, false),
    end: () => run('', true),
    swapped: (): Swapped => ({ nonce, count, ...rows.errors() }),
  }
}

// why a page's swapped flight data can't be trusted: a nonce that didn't parse as a script's whole text, a push left
// in a script (a swap the stripper missed), or a push or error row that can't be read
export class FlightDataError extends Error {
  readonly reason: 'count' | 'unswapped' | 'push' | 'row'
  constructor(reason: FlightDataError['reason']) {
    super(`the page's flight data can't be read (${reason})`)
    this.name = 'FlightDataError'
    this.reason = reason
  }
}
// a script's own text: an svg script can hold elements, and another script's text isn't its own
const scriptText = (script: Element) =>
  script.children.map((child) => (child.type === 'text' ? child.value : '')).join('')
const untrusted = (scripts: Element[], swapped: Swapped): FlightDataError['reason'] | undefined => {
  let count = 0
  for (const script of scripts) {
    const text = scriptText(script)
    if (text === swapped.nonce) count += 1
    else if (PUSHED.test(text)) return 'unswapped'
  }
  if (count !== swapped.count) return 'count'
  return swapped.unreadable ? 'push' : undefined
}

// the digests of the error rows (<id>:E{"digest":…}) in a page's flight data, read as react's client reads the stream:
// next's [1, text] and [3, base64] pushes are its bytes, in order, and each row is an id, a tag, then either a length
// and that many bytes (a long string, a typed array) or everything to the next newline. a row's bytes are skipped by
// their length, so a page's own long text (a readme, which react sends raw in a T row) can't pass for a row, and only
// an error row's are kept, so its memory is one row at most. a push or an error row that can't be read is unreadable
const LENGTH_TAGS = new Set([...'TAOobUSsLlGgMmV'].map((tag) => tag.charCodeAt(0)))
const ROW_CAP = 65_536
const hex = (byte: number) => (byte > 96 ? byte - 87 : byte - 48)
const fromBase64 = (base64: string) => {
  const decode = (Uint8Array as { fromBase64?: (text: string) => Uint8Array }).fromBase64
  if (decode) return decode(base64)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
const rowScanner = () => {
  const digests: string[] = []
  let state: 'id' | 'tag' | 'length' | 'skip' | 'line' = 'id'
  let size = 0
  let row: Uint8Array[] | undefined
  let held = 0
  let unreadable = false
  const ended = (complete: boolean) => {
    if (!row) return
    const bytes = new Uint8Array(held)
    let at = 0
    for (const part of row) {
      bytes.set(part, at)
      at += part.length
    }
    row = undefined
    // an error row cut off where the page ended is still an error, one that can't say which
    if (!complete) return void digests.push('')
    if (held > ROW_CAP) return void (unreadable = true)
    try {
      const said = JSON.parse(new TextDecoder().decode(bytes)) as { digest?: unknown }
      digests.push(typeof said?.digest === 'string' ? said.digest : '')
    } catch {
      unreadable = true
    }
  }
  const keep = (bytes: Uint8Array) => {
    if (!row || held > ROW_CAP) return
    row.push(bytes.slice())
    held += bytes.length
  }
  // a push's bytes: what's skipped (a long row's bytes, a row that isn't an error) is jumped over, never stepped through
  const scan = (bytes: Uint8Array) => {
    for (let i = 0; i < bytes.length;) {
      if (state === 'id') {
        const colon = bytes.indexOf(58, i)
        if (colon < 0) return
        state = 'tag'
        i = colon + 1
      } else if (state === 'tag') {
        const tag = bytes[i]!
        i += 1
        if (LENGTH_TAGS.has(tag)) {
          state = 'length'
          size = 0
          continue
        }
        // a capital letter (and #, r, x) is a tag of its own; anything else starts a model row
        const tagged = (tag > 64 && tag < 91) || tag === 35 || tag === 114 || tag === 120
        ;[row, held] = [tag === 69 ? [] : undefined, 0]
        state = !tagged && tag === 10 ? 'id' : 'line'
      } else if (state === 'length') {
        const byte = bytes[i]!
        i += 1
        if (byte === 44) state = size ? 'skip' : 'id'
        else size = (size << 4) | hex(byte)
      } else if (state === 'skip') {
        const take = Math.min(size, bytes.length - i)
        size -= take
        i += take
        if (!size) state = 'id'
      } else {
        const newline = bytes.indexOf(10, i)
        const end = newline < 0 ? bytes.length : newline
        keep(bytes.subarray(i, end))
        if (newline < 0) return
        ended(true)
        state = 'id'
        i = newline + 1
      }
    }
  }
  return {
    push: (push: string) => {
      let value: unknown
      try {
        value = JSON.parse(push)
      } catch {
        unreadable = true
        return
      }
      if (!Array.isArray(value)) unreadable = true
      else if (value[0] === 1 && typeof value[1] === 'string')
        scan(new TextEncoder().encode(value[1]))
      else if (value[0] === 3 && typeof value[1] === 'string') {
        try {
          scan(fromBase64(value[1]))
        } catch {
          unreadable = true
        }
      }
    },
    unreadable: () => void (unreadable = true),
    errors: () => {
      if (state === 'line') ended(false)
      state = 'id'
      return { errors: digests, unreadable }
    },
  }
}

// a page's html with its flight pushes taken out, parsed: the tree and the error rows' digests, or why they can't be
// trusted
const strippedTree = (html: string, swapped: Swapped) => {
  const tree = fromHtml(html)
  const streamed = resolveStreamed(tree)
  const reason = untrusted(streamed.scripts, swapped)
  return { tree, streamed, reason }
}

// the part of the page that becomes markdown; prunes the body in place, so read the head first
const contentOf = (tree: HastRoot, how: Options['extract']) => {
  const bodyElement = select('body', tree)
  const body: HastRoot = {
    type: 'root',
    children: bodyElement ? bodyElement.children : tree.children,
  }
  prune(body)
  return extract(body, how ?? 'auto')
}

const CONTROLS = new Set([
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

// which element contains which, within one form
const parents = (root: Element) => {
  const map = new Map<Element, Element>()
  const walk = (node: Element) => {
    for (const child of node.children)
      if (isElement(child)) {
        map.set(child, node)
        walk(child)
      }
  }
  walk(root)
  return map
}

// an element's ancestors within the form, nearest first
const ancestors = (node: Element, up: Map<Element, Element>) => {
  const found: Element[] = []
  for (let at = up.get(node); at; at = up.get(at)) found.push(at)
  return found
}
const closest = (node: Element, tag: string, up: Map<Element, Element>) =>
  ancestors(node, up).find((at) => at.tagName === tag)
const closestRole = (node: Element, role: string, up: Map<Element, Element>) =>
  ancestors(node, up).find((at) => String(at.properties.role) === role)

const text = (node: Element | undefined) => (node ? toString(node).replace(/\s+/g, ' ').trim() : '')

// an element without the descendants drop picks, or with those of one tag replaced by what's in them
const without = (el: Element, drop: (child: Element) => boolean): Element => ({
  ...el,
  children: el.children.flatMap((child): ElementContent[] =>
    isElement(child) ? (drop(child) ? [] : [without(child, drop)]) : [child],
  ),
})
const unwrap = (el: Element, tag: string): Element => ({
  ...el,
  children: el.children.flatMap((child): ElementContent[] =>
    isElement(child)
      ? child.tagName === tag
        ? unwrap(child, tag).children
        : [unwrap(child, tag)]
      : [child],
  ),
})

// elements that carry a value (a textarea's text, a select's options), which never leaves the page as a name
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
// a control whose text is a value, not a name: what someone typed or picked (an input, a select's options, a textarea,
// a contenteditable or role=textbox editor), or what a widget shows (output, meter, progress, a slider)
const VALUE_ROLES = new Set(['spinbutton', 'slider'])
const valueBearing = (el: Element) =>
  VALUED.has(el.tagName) || VALUE_ROLES.has(String(el.properties.role ?? '')) || editor(el)
const editor = (el: Element) =>
  ['textbox', 'searchbox'].includes(String(el.properties.role ?? '')) ||
  (el.properties.contentEditable !== undefined && String(el.properties.contentEditable) !== 'false')
// a name's words: what the element says, without the controls in it (their text is a value, or another control's
// label) or what's never content. a value-bearing element says nothing as a name
const words = (node: Element | undefined): string =>
  node && !valueBearing(node)
    ? text(
        without(
          node,
          (child) =>
            valueBearing(child) || child.tagName === 'button' || ALWAYS_DROP.has(child.tagName),
        ),
      )
    : ''

// the elements an aria-labelledby names, in its order; an id that isn't on the page is skipped
// the ids an aria-labelledby names, in order; none when it's missing or empty, never ''
const labelledBy = (node: Element) =>
  [node.properties.ariaLabelledBy ?? []].flat().join(' ').split(/\s+/).filter(Boolean)
const idrefs = (node: Element, byId: Map<string, Element>) =>
  labelledBy(node).flatMap((id) => byId.get(id) ?? [])

// what a screen reader calls an element, in its order: what its aria-labelledby names, its native label (a
// <label for>, the label around it, a fieldset's legend), its aria-label, its own words for a control named by its
// content (a link, button, switch, checkbox, radio or toggle; never a combobox, whose content is its value), then its
// title. each is read through words(), so no value is ever a name. labels: a form's <label for>s by id
type Naming = {
  byId: Map<string, Element>
  up?: Map<Element, Element>
  labels?: () => Map<string, Element>
}
const accessibleName = (el: Element | undefined, naming: Naming, content = true): string => {
  if (!el) return ''
  const { byId, up, labels } = naming
  const id = el.properties.id
  return (
    idrefs(el, byId).map(words).filter(Boolean).join(' ') ||
    (id !== undefined && labels ? words(labels().get(String(id))) : '') ||
    (up ? words(closest(el, 'label', up)) : '') ||
    (el.tagName === 'fieldset' ? words(select('legend', el) ?? undefined) : '') ||
    String(el.properties.ariaLabel ?? '').trim() ||
    (content && namedByContent(el) ? words(el) : '') ||
    String(el.properties.title ?? '').trim()
  )
}
const CONTENT_ROLES = new Set(['link', 'button', 'switch', 'checkbox', 'radio'])
const namedByContent = (el: Element) =>
  el.tagName === 'a' ||
  (el.tagName === 'button' && String(el.properties.role ?? '') !== 'combobox') ||
  CONTENT_ROLES.has(String(el.properties.role ?? '')) ||
  el.properties.ariaPressed !== undefined

// a control made of aria, as shadcn and radix render them: a switch or checkbox is a <button role="switch"
// aria-checked>, a toggle a <button aria-pressed>, a radio group's items <button role="radio">, and a select's
// trigger a <button role="combobox"> showing the value. radix's native mirror of each is aria-hidden, so prune
// dropped it and it's never counted twice
const ARIA_FIELDS =
  '[role=switch], [role=checkbox], [role=radio], [role=combobox], button[aria-pressed]'
const ROLES = new Set(['switch', 'checkbox', 'radio', 'combobox'])
const roleOf = (field: Element) => {
  if (['input', 'select', 'textarea'].includes(field.tagName)) return
  const role = String(field.properties.role ?? '')
  return ROLES.has(role) ? role : field.properties.ariaPressed !== undefined ? 'toggle' : undefined
}
// a choice's state: true, false or mixed, from checked or from aria-checked or aria-pressed
const stateOf = (field: Element) =>
  roleOf(field)
    ? String(field.properties.ariaChecked ?? field.properties.ariaPressed ?? 'false')
    : String(Boolean(field.properties.checked))
const unavailable = (field: Element) =>
  Boolean(field.properties.disabled) || String(field.properties.ariaDisabled) === 'true'

// a field's label is its accessible name. a placeholder is an example of what to type, and a name is the server's:
// neither is the label
const labelOf = (field: Element, naming: Naming) => accessibleName(field, naming)

// an input's type, which html reads in any case (type="Password" is a password), an aria control's role (a
// combobox is a select), or the field's tag
const typeOf = (field: Element) =>
  field.tagName === 'input'
    ? String(field.properties.type ?? 'text').toLowerCase() || 'text'
    : roleOf(field) === 'combobox'
      ? 'select'
      : (roleOf(field) ?? field.tagName)

// a field that looks like it holds a secret
// a field's name as words joined by _: cardNumber, card-number and card_number are all card_number, a number is a word
// of its own (cvv2 is cvv_2), and accents go (Contraseña is contrasena)
const nameWords = (name: string) =>
  name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/(?<=[a-zA-Z])(?=[0-9])|(?<=[0-9])(?=[a-zA-Z])/g, '_')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
// what a secret is called, as whole words, so pin isn't spinner or opinion. token, secret, password and the like may
// end a compound (authtoken), never start one (tokenizer). cc_ is autocomplete's card fields (cc-number, cc-csc, …),
// not an email's cc
const ALWAYS = [
  '[a-z0-9]*(secret|passw(or)?d|pwd|passcode|passphrase|apikey|privatekey|signingkey)s?',
  'cvv|cvc|csc|ssn|social_security|pincode|jwt|csrf|xsrf|dsn|bearer|credentials?|iban',
  // what a request authenticates with: its authorization header, a cookie, a session id, a signature
  'authorization|cookies?|sids?|signatures?',
  'cc_(num(ber)?|csc|exp(_month|_year)?|type|name|given_name|additional_name|family_name)',
  'ccnum|card_?num(ber)?|credit_card|one_time_code|account_number|routing_number',
  // any key (api_key, service_role_key, a bare key) but the ones that aren't secrets: a public key, a database's
  // primary, foreign, sort or partition key, a musical key, key features
  '(?<!(public|primary|foreign|sort|partition|music|musical)_)keys?(?!_features?(_|$))',
  // urls that carry their own credentials
  '(database|db|connection|conn)_(url|uri|string)|webhook_(url|uri)',
  // password in german, spanish (contraseña), french, dutch, portuguese, turkish (şifre), polish, czech, swedish,
  // norwegian, danish, finnish, hungarian, vietnamese and indonesian
  'passwort|kennwort|contrasena|mot_de_passe|wachtwoord|senha|sifre|haslo|heslo|losenord|passord|adgangskode|salasana',
  'jelszo|mat_khau|kata_sandi',
]
// what a secret is called when it ends the name, has a number or version, or names the secret itself: pin, user_pin,
// pin1, pin_v2 and pin code, but not pin to top; token and access_token, but not token name; otp, but not otp
// enabled; session and session id, but not session title
const HEAD = '[a-z0-9]*tokens?|pin|otp|totp|mfa|2_fa|seed|mnemonic|pw|pass|session'
// what a secret is: recovery phrase, verification code, security answer, but not recovery email
const QUALIFIER = 'recovery|backup|verification|security|two_factor|auth|reset|access'
const NOUN =
  'codes?|numbers?|num|ids?|keys?|tokens?|phrases?|words?|value|secrets?|pins?|cookies?|answers?'
const SECRET = new RegExp(
  `(^|_)(${ALWAYS.join('|')})(_|$)|(^|_)(${HEAD})(?=$|_(v_)?[0-9]|_(${NOUN})(_|$))|(^|_)(${QUALIFIER})_(${NOUN})(_|$)`,
)
// password in scripts nameWords can't spell: russian and ukrainian, chinese, japanese, korean, arabic, hebrew, thai,
// hindi and greek
const SECRET_WORDS =
  /пароль|密码|密碼|口令|パスワード|暗証番号|비밀번호|암호|كلمة المرور|كلمة السر|סיסמ|รหัสผ่าน|पासवर्ड|κωδικος προσβασης|συνθηματικο/
// a value that is a secret whatever its field says: a url with a user and password in it (postgres://user:pass@host),
// a bearer token, or a jwt (its header, base64url json, always starts eyJ)
const CREDENTIALED = /\/\/[^/\s@]*:[^/\s@]*@|^\s*bearer\s+\S/i
const JWT = /^\s*eyJ[\w-]*\.[\w-]*\.[\w-]*\s*$/
// by its name, id or autocomplete, or by what it says to people: its label, aria-label or placeholder
// (<label>API key <input name="k">)
const secret = (field: Element, label: string) =>
  typeOf(field) === 'password' ||
  [field.properties.name, field.properties.id, field.properties.autoComplete, label]
    .concat(field.properties.ariaLabel, field.properties.placeholder)
    .map((said) => String(said ?? ''))
    .some(
      (said) =>
        SECRET.test(nameWords(said)) ||
        [said, said.normalize('NFD').replace(/\p{M}/gu, '')].some((form) =>
          SECRET_WORDS.test(form.toLowerCase()),
        ),
    ) ||
  [CREDENTIALED, JWT].some((shape) => shape.test(valueOf(field)))

// a field's current value as the page rendered it: an input's value, a textarea's text, a select's chosen options
// (the first, when a single select marks none)
const valueOf = (field: Element) => {
  // a select's trigger shows its value, or its placeholder (data-placeholder) when nothing is chosen; a toggle's
  // value is its state
  if (roleOf(field))
    return roleOf(field) === 'combobox' && field.properties.dataPlaceholder === undefined
      ? text(field)
      : ''
  if (field.tagName === 'textarea') return text(field)
  if (field.tagName === 'select') {
    const options = selectAll('option', field)
    const chosen = options.filter((option) => option.properties.selected)
    const shown = chosen.length || field.properties.multiple ? chosen : options.slice(0, 1)
    return shown.map(text).filter(Boolean).join(', ')
  }
  return ['file', 'checkbox', 'radio'].includes(typeOf(field))
    ? ''
    : String(field.properties.value ?? '').trim()
}

// a form becomes what it asks for, in its place among whatever else it says (a card's title, hints, errors);
// values, hidden fields and tokens never leave the page (a choice's selected/unavailable state is the page's, so that
// stays). a form marked data-affordances-md="values" (a settings page, where the values are the content) also gives
// each field's value and each toggle's state, but never a hidden field's, a password's, or one that looks like a
// secret
type Line = [label: string, value?: string]
// what has a state of its own, given as on, off or mixed
const TOGGLES = new Set(['switch', 'toggle', 'checkbox', 'radio'])
const form: Handle = (state, node) => {
  const values = node.properties.dataAffordancesMd === 'values'
  const up = parents(node)
  const byId = state.elementById
  // the form's <label for>s by id, the first for each, read only once a field needs one
  let forLabels: Map<string, Element> | undefined
  const labels = () => {
    if (!forLabels) {
      forLabels = new Map()
      for (const label of selectAll('label', node)) {
        const id = String(label.properties.htmlFor ?? '')
        if (id && !forLabels.has(id)) forLabels.set(id, label)
      }
    }
    return forLabels
  }
  const naming: Naming = { byId, up, labels }
  const fields = selectAll(`input, select, textarea, ${ARIA_FIELDS}`, node).filter(
    (field) => !['hidden', 'submit', 'button', 'reset', 'image'].includes(typeOf(field)),
  )
  // fields in document order, each line kept with the field it's for; radios and checkboxes sharing a name are one
  // choice, labelled by their fieldset, and so are the radio buttons of one radiogroup. a group's line goes with its
  // first choice, in the order groups first appear
  const lines = new Map<Element, Line>()
  const groups = new Map<unknown, Element[]>()
  for (const field of fields) {
    const type = typeOf(field)
    const name = String(field.properties.name ?? '')
    const group =
      roleOf(field) === 'radio'
        ? (closestRole(field, 'radiogroup', up) ?? field)
        : !roleOf(field) && (type === 'radio' || type === 'checkbox') && name
          ? `name:${name}`
          : undefined
    if (group !== undefined) {
      const choices = groups.get(group)
      if (choices) choices.push(field)
      else groups.set(group, [field])
      continue
    }
    const label = labelOf(field, naming)
    if (!label) continue
    const entry = type === 'text' ? label : `${label} (${type})`
    const on = stateOf(field)
    if (values && TOGGLES.has(type))
      lines.set(field, [entry, on === 'true' ? 'on' : on === 'mixed' ? 'mixed' : 'off'])
    else {
      const value = values && !secret(field, label) ? valueOf(field) : ''
      lines.set(field, value ? [entry, value] : [entry])
    }
  }
  for (const choices of groups.values()) {
    // a group with no legend or aria name lists its options alone
    const name =
      accessibleName(closestRole(choices[0]!, 'radiogroup', up), { byId }) ||
      accessibleName(closest(choices[0]!, 'fieldset', up), { byId })
    // an option without a label is left out: its value is the server's, and values never leave the page
    const options = choices.flatMap((choice) => {
      const label = labelOf(choice, naming)
      if (!label) return []
      const flags = [
        stateOf(choice) === 'true' && 'selected',
        unavailable(choice) && 'unavailable',
      ].filter(Boolean)
      return [flags.length ? `${label} (${flags.join(', ')})` : label]
    })
    if (options.length)
      lines.set(choices[0]!, [name ? `${name}: ${options.join(', ')}` : options.join(', ')])
  }

  // each line under every element that holds its field, in document order, so the walk below finds an element's
  // lines without scanning them all
  const under = new Map<Element, Line[]>()
  for (const [field, line] of lines)
    for (const at of [field, ...ancestors(field, up)]) {
      if (at === node) break
      const held = under.get(at)
      if (held) held.push(line)
      else under.set(at, [line])
    }
  const lineHolder = (el: Element) => lines.has(el) || CONTROLS.has(el.tagName)
  // walk the form in document order: what holds no field is prose, and a field (or the label or control around it)
  // is its line. a table or definition list keeps its shape, with each field's line where the field is
  const parts: (ElementContent | Line)[] = []
  const walk = (el: Element) => {
    for (const child of el.children) {
      const held = isElement(child) ? under.get(child) : undefined
      if (!isElement(child) || !held) parts.push(child)
      else if (lineHolder(child)) parts.push(...held)
      else if (SHAPED.has(child.tagName)) parts.push(inPlace(child))
      else walk(child)
    }
  }
  // a shaped element with its fields (or the labels and controls around them) swapped for their lines, as text
  const inPlace = (el: Element): Element => ({
    ...el,
    children: el.children.flatMap((child): ElementContent[] => {
      const held = isElement(child) ? under.get(child) : undefined
      if (!isElement(child) || !held) return [child]
      if (!lineHolder(child)) return [inPlace(child)]
      return held.flatMap(([label, value], i): ElementContent[] => [
        ...(i ? [{ type: 'text' as const, value: ', ' }] : []),
        { type: 'element', tagName: FIELD_LINE, properties: { label, value }, children: [] },
      ])
    }),
  })
  walk(node)

  // everything that isn't a control or a label still says something: hints, stock, errors
  const prose = (children: ElementContent[]) =>
    state.toFlow(
      state.all(
        without({ type: 'element', tagName: 'div', properties: {}, children }, (inner) =>
          CONTROLS.has(inner.tagName),
        ),
      ),
    )
  const list = (items: Line[]): List => ({
    type: 'list',
    ordered: false,
    spread: false,
    children: items.map((line): ListItem => ({
      type: 'listItem',
      spread: false,
      children: [{ type: 'paragraph', children: lineText(line) }],
    })),
  })
  // consecutive lines are one list, unless prose that says something comes between
  const out: MdastNodes[] = []
  let run: ElementContent[] = []
  let items: Line[] = []
  for (const part of [...parts, undefined]) {
    if (part !== undefined && !Array.isArray(part)) {
      run.push(part)
      continue
    }
    const flow = prose(run)
    run = []
    if (flow.length && items.length) {
      out.push(list(items))
      items = []
    }
    out.push(...flow)
    if (part) items.push(part)
    else if (items.length) out.push(list(items))
  }
  if (!lines.size) return out as never

  // the form's name: its aria-label or aria-labelledby, unless what it names is in the form and says it in place (a
  // label or legend doesn't: the walk reads those as controls). a form without one has no title: what it says (a
  // heading, a card's title) is already there
  const named = idrefs(node, byId).some(
    (el) =>
      up.has(el) &&
      !CONTROLS.has(el.tagName) &&
      !ancestors(el, up).some((at) => CONTROLS.has(at.tagName)),
  )
  const title = named ? '' : accessibleName(node, { byId }, false)
  return [
    ...(title
      ? [
          {
            type: 'paragraph',
            children: [{ type: 'strong', children: [{ type: 'text', value: title }] }],
          },
        ]
      : []),
    ...out,
  ] as never
}

// a field's line as markdown text: its label, and its value
const lineText = ([label, value]: Line): PhrasingContent[] => [
  { type: 'text', value: value ? `${label}: ${value}` : label },
]
// elements whose shape is their content: a form's fields in one are written where they are, not listed after it
const SHAPED = new Set(['table', 'dl'])
// a field's line written in place: a tag name no page can have, since html lowercases tag names
const FIELD_LINE = 'fieldLine'
const fieldLine: Handle = (_, node) =>
  lineText([
    String(node.properties.label),
    node.properties.value === undefined ? undefined : String(node.properties.value),
  ]) as never

// a url's scheme as a browser reads it: new URL drops the tabs, newlines and controls that hide java\nscript:.
// a relative url is the page's own, so it's http(s) whatever the base
const scheme = (url: string) => {
  try {
    return new URL(url, 'https://relative.invalid/').protocol
  } catch {
    return undefined
  }
}
const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const IMAGE_SCHEMES = new Set(['http:', 'https:'])

const link: Handle = (state, node, parent) => {
  const href = String(node.properties.href ?? '').trim()
  const children = state.all(node) as PhrasingContent[]
  if (!href || href === '#' || !LINK_SCHEMES.has(scheme(href) ?? '')) return children
  // a heading's link to its own anchor (the usual self-link) is the heading, not a link
  if (href.startsWith('#') && isElement(parent) && /^h[1-6]$/.test(parent.tagName)) return children
  const title = (node.properties.title as string) ?? null
  if (!children.some((child) => child.type !== 'text' || child.value.trim())) {
    // an icon or avatar link reads as its label; prune dropped those without one
    const name = linkLabel(node, state.elementById)
    if (!name) return
    return { type: 'link', url: href, title, children: [{ type: 'text', value: name }] }
  }
  return { type: 'link', url: href, title, children }
}

const img: Handle = (_, node) => {
  const alt = String(node.properties.alt ?? '').trim()
  // no alt is decorative or undescribed; either way it tells an agent nothing
  if (!alt || !node.properties.src || !IMAGE_SCHEMES.has(scheme(String(node.properties.src)) ?? ''))
    return
  return {
    type: 'image',
    url: String(node.properties.src),
    alt,
    title: (node.properties.title as string) ?? null,
  }
}

const details: Handle = (state, node) => {
  const summary = node.children.find((c) => isElement(c) && c.tagName === 'summary') as
    | Element
    | undefined
  const rest = { ...node, children: node.children.filter((c) => c !== summary) }
  const head: MdastNodes[] = summary
    ? [
        {
          type: 'paragraph',
          children: [{ type: 'strong', children: state.all(summary) as PhrasingContent[] }],
        },
      ]
    : []
  return [...head, ...state.toFlow(state.all(rest))] as never
}

const BLOCKS = new Set([
  'paragraph',
  'heading',
  'list',
  'blockquote',
  'code',
  'table',
  'thematicBreak',
])
// **term**: definition, one paragraph per pair (html lets each pair sit in its own <div>)
const dl: Handle = (state, node) => {
  const out: MdastNodes[] = []
  let terms: PhrasingContent[][] = []
  const pairs = node.children.flatMap((child) =>
    isElement(child) && child.tagName === 'div' ? child.children : [child],
  )
  for (const child of pairs) {
    if (!isElement(child)) continue
    if (child.tagName === 'dt') terms.push(state.all(child) as PhrasingContent[])
    else if (child.tagName === 'dd') {
      // a term that says nothing (a form's label, which the field's line says) leaves the definition on its own
      const strong = terms
        .filter((term) => term.some((part) => part.type !== 'text' || part.value.trim()))
        .flatMap((t, i): PhrasingContent[] => [
          ...(i ? [{ type: 'text' as const, value: ', ' }] : []),
          { type: 'strong', children: t },
        ])
      const lead: PhrasingContent[] = [
        ...strong,
        ...(strong.length ? [{ type: 'text' as const, value: ': ' }] : []),
      ]
      // a definition with blocks in it (a list, paragraphs) keeps them as blocks: the term leads the text before the
      // first one, or stands alone before it. one that's a run of text (a form's field line too) is the term's paragraph
      const first: Paragraph = { type: 'paragraph', children: [...lead] }
      const flow: MdastNodes[] = [first]
      // loose text joins the paragraph still open, the term's until a block (a paragraph too) closes it
      let open: Paragraph | undefined = first
      for (const part of state.all(child) as MdastNodes[]) {
        if (part.type === 'paragraph' && open === first && first.children.length === lead.length) {
          first.children.push(...part.children)
          open = undefined
        } else if (BLOCKS.has(part.type)) {
          flow.push(part)
          open = undefined
        } else if (open) open.children.push(part as PhrasingContent)
        else flow.push((open = { type: 'paragraph', children: [part as PhrasingContent] }))
      }
      out.push(...flow.filter((block) => block.type !== 'paragraph' || block.children.length))
      terms = []
    }
  }
  return out as never
}

// a cell is one line, so blocks laid out in it (<div>s, <p>s, which no css gap spaces) are separated by a space
// instead of run together: <td><div>1,542</div><div>1,533–1,550</div></td> reads 1,542 1,533–1,550
// a part of a cell that already ends in a space (a field line's "Qty: ") needs no other
const endsSpaced = (last: MdastNodes | undefined) => last?.type === 'text' && /\s$/.test(last.value)
const oneLine: Handle = (state, node) => {
  const result = defaultHandlers.td(state, node) as TableCell
  if (!result.children.some((child) => (child as MdastNodes).type === 'paragraph')) return result
  // runs of inline content, and each paragraph's content, are one part each; other blocks are left as they are
  const parts: MdastNodes[][] = []
  let run: MdastNodes[] = []
  for (const child of result.children as MdastNodes[]) {
    if (child.type !== 'paragraph') {
      run.push(child)
      continue
    }
    parts.push(run, child.children)
    run = []
  }
  parts.push(run)
  const said = parts.filter((part) => part.some(says))
  result.children = said.flatMap((part, i) => [
    ...(i && !endsSpaced(said[i - 1]!.at(-1)) ? [{ type: 'text' as const, value: ' ' }] : []),
    ...part,
  ]) as PhrasingContent[]
  return result
}

const wrap =
  (tag: string): Handle =>
  (state, node) =>
    [
      { type: 'html', value: `<${tag}>` },
      ...(state.all(node) as PhrasingContent[]),
      { type: 'html', value: `</${tag}>` },
    ] as never

// markdown from a marker (<AgentText md>, a slot's fill): verbatim, flagged so its links are resolved and a block one
// is lifted out of the paragraph or heading it's in. an inline one also says it's a span, so hast-util-to-mdast keeps
// it in its paragraph or link (<a><AgentText/></a> is a link) instead of splitting it like a block would
type Marked = 'inline' | 'block'
const markerMarkdown = (value: string, as: Marked): Html => ({
  type: 'html',
  value,
  data: { affordancesMd: as, ...(as === 'inline' && { hName: 'span' }) } as never,
})
const markedAs = (node: MdastNodes) =>
  node.type === 'html'
    ? (node.data as { affordancesMd?: Marked } | undefined)?.affordancesMd
    : undefined

// <AgentText md="…">, flattened by prune()
const verbatim =
  (fallback: Handle): Handle =>
  (state, node, parent) =>
    node.properties.dataAffordancesMdText === undefined
      ? fallback(state, node, parent)
      : (markerMarkdown(
          String(node.properties.dataAffordancesMdText),
          node.tagName === 'span' ? 'inline' : 'block',
        ) as never)

// a code block's language: a language-* class on its <code>, or where highlighters put it instead: data-language on
// the <code> or <pre> (rehype-pretty-code, expressive code), or a language-* class on the <pre> (prism)
const classLanguage = (el: Element | undefined) =>
  [el?.properties.className]
    .flat()
    .map(String)
    .find((name) => name.startsWith('language-'))
    ?.slice('language-'.length)
const languageOf = (pre: Element) => {
  const code = pre.children.find((child) => isElement(child) && child.tagName === 'code') as
    | Element
    | undefined
  const said = [code?.properties.dataLanguage, pre.properties.dataLanguage]
    .map((language) => String(language ?? '').trim())
    .find(Boolean)
  return (classLanguage(code) ?? said ?? classLanguage(pre))?.split(/\s/)[0] || null
}
// <pre data-title="route.ts"> keeps its title as fence meta: ```ts title="route.ts"
const pre: Handle = (state, node) => {
  const result = defaultHandlers.pre(state, node) as
    | { type: string; lang?: string | null; meta?: string | null }
    | undefined
  if (result?.type !== 'code') return result as never
  result.lang = languageOf(node)
  const title = node.properties.dataTitle
  if (title) result.meta = `title=${JSON.stringify(String(title))}`
  return result as never
}
// a code block's title where highlighters put it, outside the <pre>: a figcaption before it in its figure
// (rehype-pretty-code, fumadocs, expressive code) or data-title on what holds it. it's the fence's title, so the
// figcaption isn't said again; one after the code is a caption, and stays. a fence's title needs its language, so
// without one it stays where it is (fumadocs gives one with rehype-code's addLanguageClass)
const titled =
  (fallback: Handle): Handle =>
  (state, node, parent) => {
    // only a figure, or what has a data-title, can title its code; anything else is walked no further
    if (node.tagName !== 'figure' && node.properties.dataTitle === undefined)
      return fallback(state, node, parent)
    const [code, ...more] = selectAll('pre', node)
    if (!code || more.length || code.properties.dataTitle || !languageOf(code))
      return fallback(state, node, parent)
    const order = selectAll('figcaption, pre', node)
    const caption =
      node.tagName === 'figure'
        ? order.slice(0, order.indexOf(code)).find((el) => el.tagName === 'figcaption')
        : undefined
    const title = text(caption) || String(node.properties.dataTitle ?? '').trim()
    if (!title) return fallback(state, node, parent)
    const swap = (el: Element): Element => ({
      ...el,
      children: el.children.flatMap((child): ElementContent[] =>
        child === caption
          ? []
          : child === code
            ? [{ ...code, properties: { ...code.properties, dataTitle: title } }]
            : isElement(child)
              ? [swap(child)]
              : [child],
      ),
    })
    return fallback(state, swap(node), parent)
  }

const handlers: Handlers = {
  form,
  [FIELD_LINE]: fieldLine,
  pre,
  a: link,
  img,
  details,
  dl,
  td: oneLine,
  th: oneLine,
  sup: wrap('sup'),
  sub: wrap('sub'),
  span: verbatim(defaultHandlers.span),
  div: verbatim(titled(defaultHandlers.div)),
  figure: titled(defaultHandlers.figure),
  // values and placeholders are the user's, not the page's; task-list checkboxes are read by the li handler
  input: () => undefined,
  select: () => undefined,
  textarea: () => undefined,
  button: () => undefined,
}

// gfm escapes @, www. and https: (tj\@acme.dev) only so text doesn't become a link to itself, which reads the same, so
// text goes without them. a heading keeps them: a heading's url shown as itself isn't part of a page's title (headingOf)
const GFM = gfmToMarkdown()
for (const extension of GFM.extensions ?? [])
  if (extension.unsafe?.some((pattern) => pattern.character === '@'))
    extension.unsafe = extension.unsafe.map((pattern) => ({
      ...pattern,
      inConstruct: 'headingAtx',
    }))

// a link's url once it's absolute, then through the link hook; undefined when it can't be resolved
const resolve = (url: string, base: string, relink: Options['link'], image: boolean) => {
  try {
    const absolute = new URL(url, base)
    return (!image && !url.startsWith('#') && relink?.(absolute)) || absolute.href
  } catch {
    return undefined
  }
}

// links and images made absolute, and marker markdown's links with them; whether there was marker markdown
const absolutize = (tree: MdastRoot, base: string | undefined, relink: Options['link']) => {
  // a definition an image refers to (![alt][id], from a custom handler) is an image's url, so it's never relinked
  const images = new Set<string>()
  if (base)
    visit(tree, 'imageReference', (node) => {
      images.add(node.identifier)
    })
  let marked = false
  visit(tree, (node) => {
    if (markedAs(node)) {
      marked = true
      if (base) (node as Html).value = relinkMarkdown((node as Html).value, base, relink)
      return
    }
    if (!base || (node.type !== 'link' && node.type !== 'image' && node.type !== 'definition'))
      return
    const image =
      node.type === 'image' || (node.type === 'definition' && images.has(node.identifier))
    // what can't be resolved stays as written
    node.url = resolve(node.url, base, relink, image) ?? node.url
  })
  return marked
}

// a table cell is one line: marker markdown in one keeps its line breaks as <br> and its pipes escaped, so it doesn't
// end the table or add columns. it's inline there, so it's never lifted out of the cell
const inCells = (tree: MdastRoot) =>
  visit(tree, 'tableCell', (cell) =>
    visit(cell, 'html', (node) => {
      if (!markedAs(node)) return
      node.value = node.value
        .trim()
        .replace(/(?<!\\)((?:\\\\)*)\|/g, '$1\\|')
        .replace(/[ \t]*\n\s*/g, '<br>')
      node.data = { ...node.data, affordancesMd: 'inline' } as never
    }),
  )

// a block of marker markdown inside a paragraph or heading (<h1>Package <AgentSlot/></h1>), or inside a link or
// emphasis in one, is its own block: it's lifted out, between what was on either side of it
type Phrasing = MdastNodes & { children: MdastNodes[] }
const hasBlock = (node: MdastNodes): boolean =>
  markedAs(node) === 'block' || ('children' in node && node.children.some(hasBlock))
const says = (node: MdastNodes): boolean =>
  node.type === 'text'
    ? Boolean(node.value.trim())
    : !('children' in node) || node.children.some(says)
// the text at one end of a node, where its whitespace meets a lifted block
const edge = (node: MdastNodes | undefined, end: boolean): { value: string } | undefined =>
  node?.type === 'text'
    ? node
    : node && 'children' in node
      ? edge(end ? node.children.at(-1) : node.children[0], end)
      : undefined
const lifted = (node: Phrasing): MdastNodes[] => {
  const out: MdastNodes[] = []
  let side: Phrasing = { ...node, children: [] }
  const close = () => {
    const first = edge(side, false)
    if (first && out.length) first.value = first.value.trimStart()
    if (says(side)) out.push(side)
    side = { ...node, children: [] }
  }
  for (const child of node.children)
    for (const part of 'children' in child && hasBlock(child) ? lifted(child as Phrasing) : [child])
      if (markedAs(part) === 'block') {
        const last = edge(side, true)
        if (last) last.value = last.value.trimEnd()
        close()
        out.push(part)
      } else side.children.push(part)
  close()
  return out
}
const liftBlocks = (tree: MdastRoot) =>
  visit(tree, (node, index, parent) => {
    if ((node.type !== 'paragraph' && node.type !== 'heading') || !parent || index === undefined)
      return
    if (!hasBlock(node)) return 'skip'
    const parts = lifted(node as Phrasing)
    parent.children.splice(index, 1, ...(parts as never[]))
    return index + parts.length
  })

const SYNTAX = { extensions: [gfm()] }
// a destination as markdown writes it: bare, or in <…> when it has what the bare form would need escaped
const destination = (url: string) =>
  /[\s()<>\\]/.test(url) ? `<${url.replace(/[<>\\]/g, '\\$&')}>` : url
const escaped = (value: string) => value.replace(/[\\[\]*_`<>]/g, '\\$&')

// an autolink's token, and what its text needs in front to be its url
const AUTOLINKS = new Map([
  ['autolinkProtocol', ''],
  ['autolinkEmail', 'mailto:'],
  ['literalAutolinkHttp', ''],
  ['literalAutolinkWww', 'http://'],
  ['literalAutolinkEmail', 'mailto:'],
])

type Frame = {
  type: string
  label?: string
  reference?: string
  resource?: boolean
  url?: string
  at?: number
}

// FB-4: markdown a marker carries (<AgentText md>, a slot's fill) gets what page links get: each link, autolink and
// definition made absolute, then the link hook; an image only absolute, like a page image. only each url's own source
// changes, so the rest stays as the app wrote it. raw html in it is left alone. llms.txt's intros use it too
export const relinkMarkdown = (markdown: string, base: string, relink: Options['link']) => {
  // nothing that could be a link: a destination or definition needs ], an autolink <, @, www. or ://
  if (!/[\]<@]|www\.|:\/\//.test(markdown)) return markdown
  const events = postprocess(
    parse(SYNTAX)
      .document()
      .write(preprocess()(markdown, undefined, true)),
  )
  const source = (token: { start: { offset: number }; end: { offset: number } }) =>
    markdown.slice(token.start.offset, token.end.offset)
  // definitions an image reference uses (![alt][id]) are image urls, so they're never relinked
  const images = new Set<string>()
  const frames: Frame[] = []
  for (const [kind, token] of markdown.includes('![') ? events : []) {
    if (token.type === 'image' || token.type === 'link') {
      if (kind === 'enter') frames.push({ type: token.type })
      else {
        const frame = frames.pop()!
        if (frame.type === 'image' && !frame.resource)
          images.add(normalizeIdentifier(frame.reference ?? frame.label ?? '').toLowerCase())
      }
    } else if (kind === 'enter' && frames.length) {
      const frame = frames.at(-1)!
      if (token.type === 'labelText') frame.label ??= source(token)
      if (token.type === 'referenceString') frame.reference = source(token)
      if (token.type === 'resource') frame.resource = true
    }
  }
  const edits: { start: number; end: number; value: string }[] = []
  // a link's destination, a definition's, or a whole autolink: what's being rewritten, and whether it's an image's
  const open: Frame[] = []
  let definition: string | undefined
  for (const [kind, token] of events) {
    const { type } = token
    if (type === 'image' || type === 'link') {
      if (kind === 'enter') open.push({ type })
      else open.pop()
      continue
    }
    if (type === 'definitionLabelString' && kind === 'enter') definition = source(token)
    if (type === 'resourceDestination' || type === 'definitionDestination') {
      if (kind === 'enter') {
        open.push({ type, at: token.start.offset })
        continue
      }
      const frame = open.pop()!
      const image =
        type === 'definitionDestination'
          ? images.has(normalizeIdentifier(definition ?? '').toLowerCase())
          : open.at(-1)?.type === 'image'
      const url = frame.url
      const next = url && resolve(url, base, relink, image)
      if (url && next && next !== url)
        edits.push({ start: frame.at!, end: token.end.offset, value: destination(next) })
      continue
    }
    if (kind !== 'enter') continue
    if (type === 'resourceDestinationString' || type === 'definitionDestinationString') {
      const frame = open.at(-1)
      if (frame) frame.url = decodeString(source(token))
      continue
    }
    // an autolink is already absolute: it changes only if the link hook gives it another url, and then reads as a
    // link whose text is what was written. never inside another link, which it would nest in
    const prefix = AUTOLINKS.get(type)
    if (prefix === undefined || open.length) continue
    const written = source(token)
    let absolute: URL
    try {
      absolute = new URL(prefix + written, base)
    } catch {
      continue
    }
    const next = relink?.(absolute)
    // <…> takes its brackets with it
    const bracketed = type === 'autolinkProtocol' || type === 'autolinkEmail' ? 1 : 0
    if (next && next !== absolute.href)
      edits.push({
        start: token.start.offset - bracketed,
        end: token.end.offset + bracketed,
        value: `[${escaped(written)}](${destination(next)})`,
      })
  }
  // one pass, so a fill with thousands of links costs its length, not its length per link
  const parts: string[] = []
  let at = 0
  for (const edit of edits.toSorted((a, b) => a.start - b.start)) {
    parts.push(markdown.slice(at, edit.start), edit.value)
    at = edit.end
  }
  parts.push(markdown.slice(at))
  return parts.join('')
}

// the containers a heading inside isn't the page's (a list item, a quote), and what a heading's text leaves out: a
// link's destination and an image
const CONTAINERS = new Set(['blockQuote', 'listOrdered', 'listUnordered'])
const UNSHOWN = new Set(['resource', 'image', 'autolink', 'literalAutolink'])
const BRACKETS: Record<string, string> = { '(': ')', '[': ']', '<': '>' }
// the markdown's first # heading, outside any container and outside code, as markdown parses it: where it starts and
// ends, and its text as a reader sees it, without a url it shows as itself (an autolink, a bare url) or the brackets
// right around one. a page's heading is near its top, so it's parsed as far as the first line that can be one (# and a
// space, or # alone); if that isn't one (it's in code or a container), the whole markdown is parsed once
const H1_LINE = /^ {0,3}#(?=[ \t]|$)/m
export const headingOf = (markdown: string) => {
  const at = markdown.search(H1_LINE)
  if (at < 0) return undefined
  const end = markdown.indexOf('\n', at)
  return (
    headingIn(end < 0 ? markdown : markdown.slice(0, end)) ??
    (end < 0 ? undefined : headingIn(markdown))
  )
}
// the first # heading outside any container in this markdown, parsed whole
const headingIn = (source: string) => {
  const events = postprocess(
    parse(SYNTAX)
      .document()
      .write(preprocess()(source, undefined, true)),
  )
  let depth = 0
  for (let i = 0; i < events.length; i++) {
    const [kind, token] = events[i]!
    if (CONTAINERS.has(token.type)) depth += kind === 'enter' ? 1 : -1
    if (kind !== 'enter' || token.type !== 'atxHeading' || depth) continue
    // its # sequence comes right after it, so the search starts there
    let sequence: typeof token | undefined
    for (let j = i + 1; j < events.length && !sequence; j++)
      if (events[j]![1].type === 'atxHeadingSequence') sequence = events[j]![1]
    if (!sequence || sequence.end.offset - sequence.start.offset !== 1) continue
    // its text: the data inside, a url shown as itself dropped, with the brackets right around one
    const pieces: (string | null)[] = []
    let hidden = 0
    for (let j = i + 1; j < events.length; j++) {
      const [k, t] = events[j]!
      if (t.type === 'atxHeading') break
      if (UNSHOWN.has(t.type)) {
        hidden += k === 'enter' ? 1 : -1
        if (k === 'exit' && !hidden && t.type !== 'resource' && t.type !== 'image')
          pieces.push(null)
        continue
      }
      if (k !== 'enter' || hidden) continue
      const written = source.slice(t.start.offset, t.end.offset)
      if (t.type === 'data' || t.type === 'codeTextData' || t.type === 'htmlText')
        pieces.push(written)
      else if (t.type === 'characterEscapeValue') pieces.push(written)
      else if (t.type === 'characterReference') pieces.push(decodeString(written))
      else if (t.type === 'codeTextPadding' || t.type === 'whitespace') pieces.push(' ')
    }
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
    const shown = pieces.join('').replace(/\s+/g, ' ').trim()
    return { start: token.start.offset, end: token.end.offset, text: shown || undefined }
  }
  return undefined
}

// frontmatter, the handler's for a markdown.ts page too
export const yaml = (data: Record<string, string | undefined>) => {
  const lines = Object.entries(data).flatMap(([key, value]) =>
    value ? [`${key}: ${JSON.stringify(value)}`] : [],
  )
  return lines.length ? `---\n${lines.join('\n')}\n---\n\n` : ''
}

const firstTitle = (node: HastRoot | Element): Element | undefined => {
  for (const child of node.children) {
    if (!isElement(child) || child.tagName === 'svg') continue
    if (child.tagName === 'title') return child
    const found = firstTitle(child)
    if (found) return found
  }
}

// the page's canonical, if it's an http(s) url that fits in a Link header: only the <head>'s, since content in the
// body (a comment, a sanitized post) can carry a <link> too, and never one with a , or ; that would end the header's value
// early (URL already encodes <, >, quotes and whitespace)
const canonicalOf = (href: string | undefined, base: string | undefined) => {
  if (!href) return undefined
  try {
    const url = new URL(href, base)
    return /^https?:$/.test(url.protocol) && !/[,;]/.test(url.href) ? url.href : undefined
  } catch {
    return undefined
  }
}

// what a control-flow digest says (next 16.3 and 16.4's http-access-fallback and redirect-error), thrown in a
// markdown.ts or written as a flight error row: an http status, a redirect, or undefined for any other digest
export const fromDigest = (
  digest: string,
):
  | { status: 404 | 403 | 401 }
  | { status: 301 | 302 | 303 | 307 | 308; location: string }
  | undefined => {
  const parts = digest.split(';')
  if (parts[0] === 'NEXT_HTTP_ERROR_FALLBACK' && /^40[134]$/.test(parts[1] ?? ''))
    return { status: Number(parts[1]) as 404 | 403 | 401 }
  // NEXT_REDIRECT;replace;/url;307; (the url may hold a ;)
  const status = Number(parts.at(-2))
  if (parts[0] !== 'NEXT_REDIRECT' || ![301, 302, 303, 307, 308].includes(status)) return undefined
  return { status: status as 301 | 302 | 303 | 307 | 308, location: parts.slice(2, -2).join(';') }
}

// the head, in one walk of the page: the <head>'s first <title> and canonical, and wherever they are (next streams a
// dynamic page's metadata into the body) the first meta of each name or property, the root's lang and the json-ld
const head = (tree: HastRoot, base: string | undefined) => {
  let title: Element | undefined
  let canonical: Element | undefined
  let root: Element | undefined
  const metas = new Map<string, Element>()
  const jsonLd: string[] = []
  const walk = (parent: HastRoot | Element, inHead: boolean) => {
    for (const child of parent.children) {
      if (!isElement(child)) continue
      const { tagName, properties } = child
      if (tagName === 'title' && inHead) title ??= child
      else if (tagName === 'link' && inHead && [properties.rel].flat().join(' ') === 'canonical')
        canonical ??= child
      else if (tagName === 'html') root ??= child
      else if (tagName === 'meta') {
        for (const key of [`name ${properties.name}`, `property ${properties.property}`])
          if (!metas.has(key)) metas.set(key, child)
      } else if (tagName === 'script' && properties.type === 'application/ld+json') {
        const value = toString(child).trim()
        if (value) jsonLd.push(value)
      }
      walk(child, inHead || tagName === 'head')
    }
  }
  walk(tree, false)
  const meta = (key: string) => String(metas.get(key)?.properties.content ?? '').trim() || undefined
  // an svg's <title> isn't the page's
  title ??= firstTitle(tree)
  return {
    title: (title && toString(title).trim()) || meta('property og:title'),
    description: meta('name description') ?? meta('property og:description'),
    canonical: canonicalOf(String(canonical?.properties.href ?? ''), base),
    image: meta('property og:image'),
    lang: String(root?.properties.lang ?? '') || undefined,
    jsonLd,
  }
}

// a fence longer than any run of backticks in what it holds, so text that isn't valid json can't close it
const fenced = (lang: string, value: string) => {
  const fence = '`'.repeat(Math.max(3, ...(value.match(/`+/g) ?? []).map((run) => run.length + 1)))
  return `${fence}${lang}\n${value}\n${fence}`
}

const pretty = (raw: string) => {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

// a page read once: its slots, a redirect or http error streamed into it, and its markdown with whatever fills them.
// the handler reads the page, runs the fills, then converts, without parsing it twice
export type Page = {
  slots: SlotNames
  redirect?: Redirect
  fallback?: Fallback
  // the digest of each error row in the page's flight data ('' for one without, or flight data that can't be read):
  // a boundary that caught an error (error.tsx), next's control flow, or anything else that kept part of the page out.
  // never react's <!--$!--> or $RX in the html, which a boundary that renders in the browser by design (dynamic with
  // ssr: false, useSearchParams) writes too
  errors: string[]
  markdown: (slots?: Record<string, string>) => Result
}
// the <AgentSlot> names that reach the markdown, in page order: the ones a fill can go to, and those the page renders
// more than once, which are filled nowhere
export type SlotNames = { unique: string[]; duplicate: string[] }
export type Redirect = { status: 307 | 308; location: string }
export type Fallback = { status: 401 | 403 | 404 }

export const readPage = (html: string, options: Options = {}): Page => {
  const strip = flightStripper()
  const lean = strip.write(html) + strip.end()
  const swapped = strip.swapped()
  const { tree, streamed, reason } = strippedTree(lean, swapped)
  if (!reason) {
    streamed.resolve()
    return readTree({ tree, errors: swapped.errors }, options)
  }
  // swaps that can't be trusted: the page as sent, as parse5 reads it, and an error of its own (private, never a status)
  const sent = fromHtml(html)
  resolveStreamed(sent).resolve()
  return readTree({ tree: sent, errors: [''] }, options)
}

// a page whose flight pushes flightStripper took out as it streamed. the page as sent is gone, so swaps that can't be
// trusted throw: the handler answers 502, and a caller that forgets to catch it fails closed too. not part of the
// package's api: only the handler, which did the stripping, says a page was
export const readStreamed = (html: string, swapped: Swapped, options: Options = {}): Page => {
  const { tree, streamed, reason } = strippedTree(html, swapped)
  if (reason) throw new FlightDataError(reason)
  streamed.resolve()
  return readTree({ tree, errors: swapped.errors }, options)
}

const readTree = (
  { tree, errors }: { tree: HastRoot; errors: string[] },
  options: Options,
): Page => {
  const meta = head(tree, options.url)
  // a redirect() or notFound() next streamed into the page: the first error row that's one of next's control flow
  const control = errors.map(fromDigest).find((said) => said !== undefined)
  const content = contentOf(tree, options.extract)
  // a name rendered twice fills neither copy: one of them may be a forgery in user content, and there's no telling which
  const markers = slotMarkers(content)
  const counts = new Map<string, number>()
  for (const marker of markers) {
    const name = String(marker.properties.dataName ?? '')
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  for (const marker of markers) {
    const name = String(marker.properties.dataName ?? '')
    if (counts.get(name) === 1) marker.properties[FILLABLE] = name
  }
  const names = [...counts]
  return {
    slots: {
      unique: names.flatMap(([name, count]) => (count === 1 ? [name] : [])),
      duplicate: names.flatMap(([name, count]) => (count > 1 ? [name] : [])),
    },
    errors,
    ...(control &&
      ('location' in control
        ? (control.status === 307 || control.status === 308) && {
            redirect: { status: control.status, location: control.location },
          }
        : { fallback: control })),
    // the page itself is left as it is, so it can be converted again with other fills
    markdown: (slots) => {
      const fillOf = (node: Element) => {
        const name = node.properties[FILLABLE]
        const md =
          typeof name === 'string' && slots && Object.hasOwn(slots, name) ? slots[name] : undefined
        return typeof md === 'string' ? md : undefined
      }
      // markers stay plain wrappers, except a slot with a fill: its children give way to the fill, as a block
      const marker: Handle = (state, node) => {
        const md = fillOf(node)
        return (md === undefined ? state.all(node) : markerMarkdown(md, 'block')) as never
      }
      // so a filled slot's children are left out before converting, which copies and walks all of what it's given:
      // a slot's fallback (a skeleton, last night's table) can be most of a page
      const filled = new Set(markers.filter((node) => fillOf(node) !== undefined))
      const mdast = toMdast((filled.size ? emptied(content, filled) : content) as HastNodes, {
        handlers: { ...handlers, 'affordances-md': marker, ...options.handlers },
      }) as MdastRoot
      const url = meta.canonical ?? options.url
      if (absolutize(mdast, options.url ?? meta.canonical, options.link)) {
        inCells(mdast)
        liftBlocks(mdast)
      }
      return finish(mdast, meta, url, options)
    },
  }
}

// a copy of a tree with these elements' children gone, sharing every part that doesn't hold one
const emptied = <T extends HastRoot | Element>(node: T, empty: Set<Element>): T => {
  if (isElement(node) && empty.has(node)) return { ...node, children: [] }
  let changed = false
  const children = node.children.map((child) => {
    if (!isElement(child)) return child
    const copy = emptied(child, empty)
    if (copy !== child) changed = true
    return copy
  })
  return changed ? { ...node, children } : node
}

// what a site's title template puts between a page's name and the rest ("Cart · Acme", "Acme | Cart"). a colon isn't
// one: "Cart: details" says more than "Cart"
const TITLE_SEPARATORS = '·|–—-'
const escapedRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// the page's title: its <title>, or its h1 when the <title> is the h1 and the site's name in a template, the h1 on
// either side, a separator between, with whitespace around it. any other <title> is the page's own, as written
const titleOf = (title: string | undefined, h1: string | undefined) => {
  const said = title?.replace(/\s+/g, ' ').trim()
  if (!said || !h1) return title
  const name = escapedRegExp(h1)
  const separator = ` [${TITLE_SEPARATORS}] `
  return new RegExp(`^${name}${separator}\\S|\\S${separator}${name}$`).test(said) ? h1 : title
}

// the page's markdown; slots fills its <AgentSlot>s
export const htmlToMarkdown = (html: string, options: Options = {}): Result =>
  readPage(html, options).markdown(options.slots)

// a node's text as written, and text with its whitespace collapsed
const textOf = (node: MdastNodes): string =>
  'value' in node ? node.value : 'children' in node ? node.children.map(textOf).join('') : ''
const collapsed = (value: string) => value.replace(/\s+/g, ' ').trim()

const finish = (
  mdast: MdastRoot,
  meta: ReturnType<typeof head>,
  url: string | undefined,
  options: Options,
): Result => {
  const { frontmatter = true, jsonLd = true } = options
  // the page's own h1 is its title; without one, the <title> stands in
  const hasH1 = mdast.children.some((node) => node.type === 'heading' && node.depth === 1)
  if (!hasH1 && meta.title)
    mdast.children.unshift({
      type: 'heading',
      depth: 1,
      children: [{ type: 'text', value: meta.title }],
    })
  // a page that renders its description under its h1 says it twice, once in the frontmatter: the block right after
  // the h1 goes when its text is exactly the description
  const h1 = mdast.children.findIndex((node) => node.type === 'heading' && node.depth === 1)
  const next = mdast.children[h1 + 1]
  if (
    frontmatter &&
    meta.description &&
    next &&
    collapsed(textOf(next)) === collapsed(meta.description)
  )
    mdast.children.splice(h1 + 1, 1)

  let output = toMarkdown(mdast, {
    extensions: [GFM],
    bullet: '-',
    emphasis: '_',
    rule: '-',
    fences: true,
  })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const title = hasH1 ? titleOf(meta.title, headingOf(output)?.text) : meta.title
  if (jsonLd && meta.jsonLd.length)
    output += `\n\n${meta.jsonLd.map((raw) => fenced('json', pretty(raw))).join('\n\n')}`

  const markdown =
    (frontmatter
      ? yaml({
          title,
          description: meta.description,
          url,
          image: meta.image,
          lang: meta.lang,
        })
      : '') + `${output}\n`
  return { markdown, title, url, tokens: Math.ceil(markdown.length / 4) }
}
