import { attr, parseAttrs } from './attr.ts'
import { decode } from './entities.ts'
import { resolveStreamed } from './streamed.ts'
import { CUT, DEPTH, LINES, PLAIN as STRUCTURE } from '../depth.ts'
import { FLAG, flagOf, NEVER, type Document, type Element, type Head, type Node } from './types.ts'

// html to a Document in one scan, as a browser with scripting off reads it. the tokenizer jumps between '<' with
// indexOf, takes raw text (script, style) and attribute values whole, and never builds comments or the doctype. the
// tree builder is the html spec's, as parse5 implements it (the oracle the tests hold this to): insertion modes,
// implied end tags, the adoption agency, foster parenting, foreign content. what NEVER names is still put on the stack
// (the algorithm needs it to know where things end) but never into its parent's kids, its text is never kept, and
// inside svg nothing is kept at all

// what the parser knows of an element beyond the contract: its tag's number, its namespace, and what it keeps
interface El extends Element {
  up: El | null
  id: number
  ns: number
  // what it keeps while the page is parsed: 3 all text, even a dropped element's (inside what the Head reads whole: a
  // foreign title, or json-ld); 2 text; 1 no text (a dropped element); 0 nothing at all (inside svg, where nothing can
  // ever leave). every element but inside svg keeps its children, dropped ones too, until the parse ends: the
  // adoption agency and foster parenting place nodes by them, and the Head is read in their order
  rec: number
  // how many elements are above it, the document's children at 1, as it was put in place (an element the adoption
  // agency, foster parenting or a streamed move puts somewhere else may be deeper now: the parse then counts again)
  depth: number
}

const HTML = 0
const SVG = 1
const MATH = 2

// tag numbers: what the tree builder switches on. unknown tags are 0, and compare by name
const NAMES = (
  'a address annotation-xml applet area article aside audio b base basefont bgsound big blockquote body br button ' +
  'canvas caption center code col colgroup dd desc details dialog dir div dl dt em embed fieldset figcaption figure ' +
  'font footer foreignObject form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe image img ' +
  'input keygen label li link listing main malignmark marquee math menu meta mglyph mi mn mo ms mtext nav nobr ' +
  'noembed noframes noscript object ol optgroup option p param plaintext pre rb rp rt rtc ruby s script search ' +
  'section select small source span strike strong style sub summary sup svg table tbody td template textarea tfoot ' +
  'th thead title tr track tt u ul var video wbr xmp #comment'
).split(' ')
const IDS = new Map(NAMES.map((name, i) => [name, i + 1]))
const T = (name: string) => {
  const id = IDS.get(name)
  if (id === undefined) throw new Error(`no tag ${name}`)
  return id
}
const set = (names: string) => {
  const ids = new Uint8Array(NAMES.length + 1)
  for (const name of names.split(' ')) ids[T(name)] = 1
  return ids
}
// what an element too deep to read keeps the text of: elements that are only structure (the tree pipeline's PLAIN)
const FLAT = set(STRUCTURE.join(' '))
// and of those, the blocks, which start and end a line of that text
const LINE = set(LINES.join(' '))

const A = T('a')
const ADDRESS = T('address')
const ANNOTATION_XML = T('annotation-xml')
const APPLET = T('applet')
const AREA = T('area')
const ARTICLE = T('article')
const ASIDE = T('aside')
const B = T('b')
const BASE = T('base')
const BASEFONT = T('basefont')
const BGSOUND = T('bgsound')
const BIG = T('big')
const BLOCKQUOTE = T('blockquote')
const BODY = T('body')
const BR = T('br')
const BUTTON = T('button')
const CAPTION = T('caption')
const CENTER = T('center')
const CODE = T('code')
const T_DESC = T('desc')
const COL = T('col')
const COLGROUP = T('colgroup')
const DD = T('dd')
const DETAILS = T('details')
const DIALOG = T('dialog')
const DIR = T('dir')
const DIV = T('div')
const DL = T('dl')
const DT = T('dt')
const EM = T('em')
const EMBED = T('embed')
const FIELDSET = T('fieldset')
const FIGCAPTION = T('figcaption')
const FIGURE = T('figure')
const FONT = T('font')
const FOOTER = T('footer')
const FOREIGN_OBJECT = T('foreignObject')
const FORM = T('form')
const FRAME = T('frame')
const FRAMESET = T('frameset')
const H1 = T('h1')
const H2 = T('h2')
const H3 = T('h3')
const H4 = T('h4')
const H5 = T('h5')
const H6 = T('h6')
const HEAD = T('head')
const HEADER = T('header')
const HGROUP = T('hgroup')
const HR = T('hr')
const HTML_TAG = T('html')
const I = T('i')
const IFRAME = T('iframe')
const IMAGE = T('image')
const IMG = T('img')
const INPUT = T('input')
const KEYGEN = T('keygen')
const LI = T('li')
const LINK = T('link')
const LISTING = T('listing')
const MAIN = T('main')
const MALIGNMARK = T('malignmark')
const MARQUEE = T('marquee')
const MATH_TAG = T('math')
const MENU = T('menu')
const META = T('meta')
const MGLYPH = T('mglyph')
const NAV = T('nav')
const NOBR = T('nobr')
const NOEMBED = T('noembed')
const NOFRAMES = T('noframes')
const NOSCRIPT = T('noscript')
const OBJECT = T('object')
const OL = T('ol')
const OPTGROUP = T('optgroup')
const OPTION = T('option')
const P = T('p')
const PARAM = T('param')
const PLAINTEXT = T('plaintext')
const PRE = T('pre')
const RB = T('rb')
const RP = T('rp')
const RT = T('rt')
const RTC = T('rtc')
const RUBY = T('ruby')
const S = T('s')
const SCRIPT = T('script')
const SEARCH = T('search')
const SECTION = T('section')
const SELECT = T('select')
const SMALL = T('small')
const SOURCE = T('source')
const STRIKE = T('strike')
const STRONG = T('strong')
const STYLE = T('style')
const SUMMARY = T('summary')
const SVG_TAG = T('svg')
const TABLE = T('table')
const TBODY = T('tbody')
const TD = T('td')
const TEMPLATE = T('template')
const TEXTAREA = T('textarea')
const TFOOT = T('tfoot')
const TH = T('th')
const THEAD = T('thead')
const TITLE = T('title')
const TR = T('tr')
const TRACK = T('track')
const TT = T('tt')
const U = T('u')
const UL = T('ul')
const WBR = T('wbr')
const XMP = T('xmp')

const DROP = set([...NEVER, '#comment'].join(' '))
// elements the Head is read from
const WATCH = set('html title meta link script')
const SPECIAL_HTML = set(
  'address applet area article aside base basefont bgsound blockquote body br button caption center col colgroup dd ' +
    'details dir div dl dt embed fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header ' +
    'hgroup hr html iframe img input li link listing main marquee menu meta nav noembed noframes noscript object ol p ' +
    'param plaintext pre script section select source style summary table tbody td template textarea tfoot th thead ' +
    'title tr track ul wbr xmp',
)
const SPECIAL_MATH = set('mi mo mn ms mtext annotation-xml')
const SPECIAL_SVG = set('title foreignObject desc')
const HEADINGS = set('h1 h2 h3 h4 h5 h6')
const IMPLIED = set('dd dt li optgroup option p rb rp rt rtc')
const IMPLIED_ALL = set(
  'dd dt li optgroup option p rb rp rt rtc caption colgroup tbody td tfoot th thead tr',
)
const SCOPE = set('applet caption html marquee object table td template th')
const LIST_SCOPE = set('applet caption html marquee object table td template th ol ul')
const BUTTON_SCOPE = set('applet caption html marquee object table td template th button')
const TABLE_CONTEXT = set('table template html')
const TABLE_BODY_CONTEXT = set('tbody tfoot thead template html')
const TABLE_ROW_CONTEXT = set('tr template html')
const CELLS = set('td th')
const FOSTERING = set('table tbody tfoot thead tr')
const TABLE_VOID = set('caption col colgroup tbody td tfoot th thead tr')
const MATH_TEXT = set('mi mo mn ms mtext')
const EXITS_FOREIGN = set(
  'b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta ' +
    'nobr ol p pre ruby s small span strong strike sub sup table tt u ul var',
)
const SVG_TAGS = new Map(
  (
    'altGlyph altGlyphDef altGlyphItem animateColor animateMotion animateTransform clipPath feBlend feColorMatrix ' +
    'feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feFlood ' +
    'feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight ' +
    'feSpecularLighting feSpotLight feTile feTurbulence foreignObject glyphRef linearGradient radialGradient textPath'
  )
    .split(' ')
    .map((name) => [name.toLowerCase(), name]),
)
// foreign attributes parse5 renames to their local name (the oracle writes that name)
const XML_ATTRS = new Map([
  ['xlink:actuate', 'actuate'],
  ['xlink:arcrole', 'arcrole'],
  ['xlink:href', 'href'],
  ['xlink:role', 'role'],
  ['xlink:show', 'show'],
  ['xlink:title', 'title'],
  ['xlink:type', 'type'],
  ['xml:lang', 'lang'],
  ['xml:space', 'space'],
  ['xmlns', 'xmlns'],
  ['xmlns:xlink', 'xlink'],
])

// insertion modes
const INITIAL = 0
const BEFORE_HTML = 1
const BEFORE_HEAD = 2
const IN_HEAD = 3
const IN_HEAD_NOSCRIPT = 4
const AFTER_HEAD = 5
const IN_BODY = 6
const TEXT = 7
const IN_TABLE = 8
const IN_TABLE_TEXT = 9
const IN_CAPTION = 10
const IN_COLUMN_GROUP = 11
const IN_TABLE_BODY = 12
const IN_ROW = 13
const IN_CELL = 14
const IN_SELECT = 15
const IN_SELECT_IN_TABLE = 16
const IN_TEMPLATE = 17
const AFTER_BODY = 18
const IN_FRAMESET = 19
const AFTER_FRAMESET = 20
const AFTER_AFTER_BODY = 21
const AFTER_AFTER_FRAMESET = 22

// tokenizer states the tree builder switches to; the rest live inside the scanning functions
const DATA = 0
const RCDATA = 1
const RAWTEXT = 2
const SCRIPT_DATA = 3
const PLAIN = 4

// the token being processed, for the modes that hand it on
const START = 1
const END = 2
const CHARS = 3
const SPACE = 4
const NUL = 5
const COMMENT = 6
const DOCTYPE = 7
const EOF = 8

// the parse's state: module-level, since a parse runs to completion and the hot paths read it constantly
let html = ''
let n = 0
// the next '&' and '<!--' at or after where they were last looked for (n: none), so neither is searched for twice
let amp = 0
let commentOpen = 0
let tstate = DATA
let rawTag = ''

let doc: El
let stack: El[] = []
let pCount = 0
let tmplCount = 0
// active formatting elements, the most recent last; null is a marker
let afe: (Entry | null)[] = []
let tmplModes: number[] = []
let mode = INITIAL
let origMode = INITIAL
let quirks = false
let framesetOk = true
let foster = false
let skipNL = false
let headEl: El | null = null
let formEl: El | null = null
let htmlEl: El | null = null
let bodyEl: El | null = null
let bodyGone = false
let pending: string[] = []
let pendingText = false
let watched: El[] = []
let mains: El[] = []
// every script element, in any namespace: the flight check reads each one's text
let scripts: El[] = []
// whether the page has a marker, or an element with data-affordances-md
let marked = false
// whether the page has a <template id>, which a streamed boundary or placeholder moves into place through, and an
// instruction template (the external runtime's data-rci, data-rri, data-rsi) to move one
let templated = false
let instructed = false
// whether an instruction template is inside svg, where md-core keeps nothing: the tree pipeline reads it there
let svgInstructed = false
// every element with an id, wherever it is: the streamed moves find a segment by its id, inside svg too
let withIds: El[] = []
// whether an element's name has a # or a . (only an unknown tag can): hast-util-from-parse5 reads one as a
// selector, so <a#x> is a link with id x there, and <script#x> a script
let selector = false
// whether a form is made inside a link or a strikethrough: the tree pipeline splits one around the form's blocks in the
// same pass that converts the form, which md-core's form (converted on its own) doesn't
let formInSplit = false
// whether a form is made inside a table cell: the tree pipeline converts the form with the table around it (a table in
// the form flattened into the cell, the cell's spacing), which md-core's form (converted on its own) doesn't
let formInCell = false
// whether text in what doesn't wrap (a nobr, a nowrap cell) has a comment or a dropped element in it: the tree pipeline
// keeps the whitespace either side of one as two runs, which md-core reads as one text (nowrap: there may be none)
let nowrap = false
let nowrapSplit = false
// whether a cell's rowspan or colspan reads as another number on the tree pipeline: md-core reads it as html does
// (parseInt: "1e3" is 1), hast as a number first where it is one (Number: "1e3" is 1000, "0x10" is 16)
let spanDiffers = false
const spanReads = (value: string | undefined) => {
  if (value === undefined) return false
  const number = Number(value)
  const tree = Number.parseInt(String(value && !Number.isNaN(number) ? number : value), 10) || 1
  return tree !== (Number.parseInt(value, 10) || 1)
}
const nowrapOpen = () => {
  for (let i = stack.length - 1; i >= 0; i--) {
    const open = stack[i]!
    if (open.id === NOBR || ((open.id === TD || open.id === TH) && open.flags & FLAG.nowrap))
      return true
  }
  return false
}
// whether the page has a strikethrough (s, strike, del)
let struck = false
// the elements with a dropped child among their kids, to take out at the end
let pruned = new Set<El>()
// whether a node was put anywhere but after everything before it: then the Head's elements are sorted into tree order
let reordered = false

let tok = 0
let tag = ''
let tid = 0
let tattrs = ''
let tself = false
// the start tag's FLAG bits, read with its attribute names
let tflags = 0
let ttext = ''

interface Entry {
  el: El
  tag: string
  id: number
  attrs: string
  flags: number
}

const lowerAscii = (text: string) =>
  text.replace(/[A-Z\0]/g, (c) =>
    c === '\0' ? '\uFFFD' : String.fromCharCode(c.charCodeAt(0) | 32),
  )
// the tree builder's whitespace, as parse5 has it: a cr only gets this far from &#13;, and isn't
const space = (c: number) => c === 32 || c === 10 || c === 9 || c === 12
const alpha = (c: number) => (c | 32) >= 97 && (c | 32) <= 122
const allSpace = (text: string) => {
  for (let i = 0; i < text.length; i++) if (!space(text.charCodeAt(i))) return false
  return true
}
const quote = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
const serialize = (map: Map<string, string>) => {
  let out = ''
  for (const [name, value] of map) out += ` ${name}="${quote(value)}"`
  return out
}

// tree

const make = (name: string, id: number, ns: number, attrs: string, flags: number): El => {
  const el: El = {
    tag: name,
    attrs,
    flags,
    kids: [],
    up: null,
    map: undefined,
    // the emitter's fields, here so every element has one shape from the start
    pruned: false,
    code: undefined,
    verbatim: undefined,
    id,
    ns,
    rec: ns === SVG ? 0 : DROP[id] ? 1 : 2,
    depth: 0,
  }
  if (flags & FLAG['data-affordances-md'] || (id === 0 && name === 'affordances-md')) marked = true
  if (id === 0 && (name.includes('#') || name.includes('.'))) selector = true
  if (id === S || id === STRIKE || (id === 0 && name === 'del')) struck = true
  if (flags & FLAG.id) withIds.push(el)
  if (id === FORM && !formInSplit)
    for (const open of stack)
      if (open.id === A || open.id === S || open.id === STRIKE || open.tag === 'del')
        formInSplit = true
  if (id === FORM && !formInCell)
    for (const open of stack) if (open.id === TD || open.id === TH) formInCell = true
  if (
    (id === TD || id === TH) &&
    flags & (FLAG.rowspan | FLAG.colspan) &&
    !spanDiffers &&
    (spanReads(attr(el, 'rowspan')) || spanReads(attr(el, 'colspan')))
  )
    spanDiffers = true
  if (id === NOBR || ((id === TD || id === TH) && flags & FLAG.nowrap)) nowrap = true
  else if (nowrap && !nowrapSplit && DROP[id] && nowrapOpen()) nowrapSplit = true
  if (id === TEMPLATE && attrs !== '') {
    if (flags & FLAG.id) templated = true
    // any case: html matches attribute names so
    if (/data-r/i.test(attrs)) instructed = true
  }
  // a main, by tag or by role; which of them end up in the tree is settled at the end
  if (id === MAIN || (flags & FLAG.role && maybe(attrs, 'main') && attr(el, 'role') === 'main'))
    mains.push(el)
  // the Head's elements; of the scripts and links, only those that could be json-ld or the canonical link
  if (WATCH[id]) {
    if (id === SCRIPT) {
      // its text is kept, even inside svg, so it can be checked
      scripts.push(el)
      keepAll(el)
      if (maybe(attrs, 'ld+json') && attr(el, 'type') === 'application/ld+json') watched.push(el)
    } else if (id !== LINK || maybe(attrs, 'canonical')) {
      watched.push(el)
      // a foreign title is read by all the text inside it, even what is in a dropped element
      if (id === TITLE && ns !== HTML) keepAll(el)
    }
  }
  return el
}
const keepAll = (el: El) => {
  el.rec = 3
}
// the current node, kept as the stack changes: the tree builder asks for it constantly
let current: El
const cur = () => current
// whether attributes might say something, before parsing them: the word, or a reference that could spell it
const maybe = (attrs: string, word: string) => attrs.indexOf(word) >= 0 || attrs.indexOf('&') >= 0
const settle = () => {
  current = stack[stack.length - 1] ?? doc
}

const adopted = (parent: El, el: El) => {
  if (parent.rec === 3 && el.rec !== 3) keepAll(el)
  if (DROP[el.id]) pruned.add(parent)
}
// a node's first few children go in arrays made to their size: an empty array grown by push takes room for 16
const addKid = (parent: El, kid: Node) => {
  const kids = parent.kids
  switch (kids.length) {
    case 0:
      parent.kids = [kid]
      return
    default:
      kids.push(kid)
  }
}
// what an element nested DEPTH deep keeps, as the tree pipeline's flattenDeep keeps it: the text inside it, through
// elements that are only structure, with a line between blocks, and the scripts there (json-ld is read after); and
// whether anything else was there (react's boundary comments and what md never reads aside)
const flatText = (nodes: Node[]): [text: string, kept: El[], lost: boolean] => {
  let text = ''
  let lost = false
  const kept: El[] = []
  const line = () => {
    if (!text.endsWith('\n')) text += '\n'
  }
  // each list, where in it, and whether it's a block's
  const todo: [Node[], number, boolean][] = [[nodes, 0, false]]
  while (todo.length) {
    const top = todo[todo.length - 1]!
    const [list, at, block] = top
    if (at === list.length) {
      todo.pop()
      if (block) line()
      continue
    }
    top[1]++
    const node = list[at]!
    if (typeof node === 'string') {
      text += node
      continue
    }
    const el = node as El
    // what's in svg or math md reads nothing of anyway, on either path
    if (el.ns !== HTML || el.tag === '#comment') continue
    if (el.id === BR) line()
    else if (el.id === SCRIPT) kept.push(el)
    else if (FLAT[el.id] === 1 && el.attrs === '') {
      const opens = LINE[el.id] === 1
      if (opens) line()
      todo.push([el.kids, 0, opens])
    } else if (!DROP[el.id]) lost = true
  }
  return [text, kept, lost]
}
// the page with everything nested deeper than md reads as text, as the tree pipeline flattens it, without recursing;
// whether that left anything out. what md never reads (a template, an svg) is left as it is: it leaves the tree with
// everything inside below. and what the parser still holds that's no longer in the tree (the page's mains, and what
// its head is read from) leaves with it
const flatten = (root: El) => {
  let lost = false
  const deep = new Set<El>()
  const scriptsKept = new Set<El>()
  const todo: [El, number][] = [[root, 0]]
  while (todo.length) {
    const [el, depth] = todo.pop()!
    if (depth === DEPTH && el !== root) {
      deep.add(el)
      if (!el.kids.some((kid) => typeof kid !== 'string')) continue
      const [text, kept, left] = flatText(el.kids)
      if (left) lost = true
      for (const script of kept) {
        script.up = el
        scriptsKept.add(script)
      }
      // and they leave the tree once the head is read, as any script does
      if (kept.length) pruned.add(el)
      el.kids = text ? [text, ...kept] : kept
      continue
    }
    for (const kid of el.kids)
      if (typeof kid !== 'string' && !DROP[(kid as El).id]) todo.push([kid as El, depth + 1])
  }
  if (deep.size) {
    const gone = (el: El) => {
      if (scriptsKept.has(el)) return false
      for (let up = el.up; up; up = up.up) if (deep.has(up)) return true
      return false
    }
    watched = watched.filter((el) => !gone(el))
    mains = mains.filter((el) => !gone(el))
  }
  return lost
}
// the deepest element in the tree, as elements were put in place
let deepest = 0
const placed = (parent: El, el: El) => {
  el.depth = parent.depth + 1
  if (el.depth > deepest) deepest = el.depth
}
const appendChild = (parent: El, el: El) => {
  el.up = parent
  if (parent.rec === 0) return
  placed(parent, el)
  adopted(parent, el)
  addKid(parent, el)
}
// where a comment md-core never builds sat: the text after it is a text of its own, as it is in the tree pipeline's
// tree, whose spacing reads each text's own word
let splitIn: El | null = null
let splitAt = -1
const appendText = (parent: El, text: string) => {
  if (parent.rec < 2) return
  const kids = parent.kids
  const last = kids.length - 1
  if (
    last >= 0 &&
    typeof kids[last] === 'string' &&
    (parent !== splitIn || kids.length !== splitAt)
  )
    kids[last] += text
  else addKid(parent, text)
}
const insertBefore = (parent: El, el: El, ref: El) => {
  el.up = parent
  if (parent.rec === 0) return
  placed(parent, el)
  adopted(parent, el)
  reordered = true
  const at = parent.kids.lastIndexOf(ref)
  if (at < 0) addKid(parent, el)
  else parent.kids.splice(at, 0, el)
}
const insertTextBefore = (parent: El, text: string, ref: El) => {
  if (parent.rec < 2) return
  const kids = parent.kids
  const at = kids.lastIndexOf(ref)
  if (at < 0) appendText(parent, text)
  else if (at > 0 && typeof kids[at - 1] === 'string' && (parent !== splitIn || at !== splitAt))
    kids[at - 1] += text
  else kids.splice(at, 0, text)
}
const detach = (el: El) => {
  const parent = el.up
  if (!parent) return
  el.up = null
  const kids = parent.kids
  const at = kids.lastIndexOf(el)
  if (at < 0) return
  kids.splice(at, 1)
  // the text either side is one text again
  if (at > 0 && typeof kids[at - 1] === 'string' && typeof kids[at] === 'string') {
    kids[at - 1] += kids[at] as string
    kids.splice(at, 1)
  }
}

const fosterPlace = (): [El, El | null] => {
  for (let i = stack.length - 1; i >= 0; i--) {
    const el = stack[i]!
    if (el.id === TEMPLATE && el.ns === HTML) return [el, null]
    if (el.id === TABLE) return el.up ? [el.up, el] : [stack[i - 1]!, null]
  }
  return [stack[0]!, null]
}
const fosterElement = (el: El) => {
  const [parent, before] = fosterPlace()
  if (before) insertBefore(parent, el, before)
  else appendChild(parent, el)
}
const attach = (el: El) => {
  const parent = cur()
  if (foster && FOSTERING[parent.id]) fosterElement(el)
  else appendChild(parent, el)
}
const insertText = (text: string) => {
  const parent = cur()
  if (foster && FOSTERING[parent.id]) {
    const [at, before] = fosterPlace()
    if (before) insertTextBefore(at, text, before)
    else appendText(at, text)
  } else appendText(parent, text)
}

// where the last tag starts, and where a page nesting deeper than md reads is cut: at the tag that takes the stack of
// open elements past CUT, so what's before it never nests that deep (-1 until then)
let tagAt = 0
let cutAt = -1
// the stack of open elements
const push = (el: El) => {
  stack.push(el)
  if (stack.length > CUT && cutAt < 0) cutAt = tagAt
  current = el
  if (el.ns === HTML) {
    if (el.id === P) pCount++
    else if (el.id === TEMPLATE) tmplCount++
  }
}
const gone = (el: El) => {
  if (el.ns === HTML) {
    if (el.id === P) pCount--
    else if (el.id === TEMPLATE) tmplCount--
  }
}
const pop = () => {
  const el = stack.pop()
  if (el) gone(el)
  current = stack[stack.length - 1] ?? doc
}
const shortenTo = (length: number) => {
  while (stack.length > length) pop()
}
const removeEl = (el: El) => {
  const at = stack.lastIndexOf(el)
  if (at < 0) return
  stack.splice(at, 1)
  gone(el)
  settle()
}

const insert = (name: string, id: number, ns: number, attrs: string, flags: number) => {
  const el = make(name, id, ns, attrs, flags)
  attach(el)
  push(el)
  return el
}
const insertTok = () => insert(tag, tid, HTML, tattrs, tflags)
const appendTok = () => attach(make(tag, tid, HTML, tattrs, tflags))
const insertFake = (name: string, id: number) => insert(name, id, HTML, '', 0)

const special = (el: El) =>
  (el.ns === HTML ? SPECIAL_HTML : el.ns === MATH ? SPECIAL_MATH : SPECIAL_SVG)[el.id] === 1
const foreignScope = (el: El) => (el.ns === SVG ? SPECIAL_SVG : SPECIAL_MATH)[el.id] === 1

const inScopeOf = (id: number, boundary: Uint8Array) => {
  for (let i = stack.length - 1; i >= 0; i--) {
    const el = stack[i]!
    if (el.ns === HTML) {
      if (el.id === id) return true
      if (boundary[el.id]) return false
    } else if (foreignScope(el)) return false
  }
  return true
}
const inScope = (id: number) => inScopeOf(id, SCOPE)
const pInButtonScope = () => pCount > 0 && inScopeOf(P, BUTTON_SCOPE)
const headingInScope = () => {
  for (let i = stack.length - 1; i >= 0; i--) {
    const el = stack[i]!
    if (el.ns === HTML) {
      if (HEADINGS[el.id]) return true
      if (SCOPE[el.id]) return false
    } else if (foreignScope(el)) return false
  }
  return true
}
const inTableScope = (id: number) => {
  for (let i = stack.length - 1; i >= 0; i--) {
    const el = stack[i]!
    if (el.ns !== HTML) continue
    if (el.id === id) return true
    if (el.id === TABLE || el.id === HTML_TAG) return false
  }
  return true
}
const tableBodyInTableScope = () => {
  for (let i = stack.length - 1; i >= 0; i--) {
    const el = stack[i]!
    if (el.ns !== HTML) continue
    if (el.id === TBODY || el.id === THEAD || el.id === TFOOT) return true
    if (el.id === TABLE || el.id === HTML_TAG) return false
  }
  return true
}
const inSelectScope = (id: number) => {
  for (let i = stack.length - 1; i >= 0; i--) {
    const el = stack[i]!
    if (el.ns !== HTML) continue
    if (el.id === id) return true
    if (el.id !== OPTION && el.id !== OPTGROUP) return false
  }
  return true
}

const impliedEnds = () => {
  while (IMPLIED[cur().id]) pop()
}
const impliedEndsAll = () => {
  while (IMPLIED_ALL[cur().id]) pop()
}
const impliedEndsBut = (id: number) => {
  for (let c = cur(); c.id !== id && IMPLIED_ALL[c.id]; c = cur()) pop()
}
// pops through the last html element with that tag (at the bottom, any), or everything
const popThrough = (id: number) => {
  let i = stack.length - 1
  while (i >= 0 && !(stack[i]!.id === id && (stack[i]!.ns === HTML || i === 0))) i--
  shortenTo(Math.max(i, 0))
}
const popThroughOf = (ids: Uint8Array) => {
  let i = stack.length - 1
  while (i >= 0 && !(ids[stack[i]!.id] && stack[i]!.ns === HTML)) i--
  shortenTo(Math.max(i, 0))
}
const clearBackTo = (ids: Uint8Array) => {
  let i = stack.length - 1
  while (i >= 0 && !(ids[stack[i]!.id] && stack[i]!.ns === HTML)) i--
  shortenTo(i + 1)
}
const closeP = () => {
  impliedEndsBut(P)
  popThrough(P)
}

// active formatting elements
const afeByTag = (name: string) => {
  for (let i = afe.length - 1; i >= 0; i--) {
    const entry = afe[i]!
    if (entry === null) return null
    if (entry.el.tag === name) return entry
  }
  return null
}
const afeOf = (el: El) => {
  for (let i = afe.length - 1; i >= 0; i--) if (afe[i]?.el === el) return afe[i]!
  return undefined
}
const afeRemove = (entry: Entry) => {
  const at = afe.lastIndexOf(entry)
  if (at >= 0) afe.splice(at, 1)
}
const clearToMarker = () => {
  const at = afe.lastIndexOf(null)
  afe.length = at < 0 ? 0 : at
}
const attrsOf = (el: El) => (el.attrs === '' ? EMPTY : (el.map ??= parseAttrs(el.attrs)))
const EMPTY = new Map<string, string>()
// noah's ark: no more than three of the same element since the last marker. ported with parse5's indexing (most
// recent first, removing by indexes taken before any removal), since that is the oracle
const noah = (el: El) => {
  if (afe.length < 3) return
  let same = 0
  for (let i = afe.length - 1; i >= 0 && same < 3; i--) {
    const entry = afe[i]!
    if (entry === null) break
    if (entry.el.tag === el.tag && entry.el.ns === el.ns) same++
  }
  if (same < 3) return
  const own = attrsOf(el)
  const list = afe.toReversed()
  const candidates: number[] = []
  for (let i = 0; i < list.length; i++) {
    const entry = list[i]!
    if (entry === null) break
    if (entry.el.tag === el.tag && entry.el.ns === el.ns && attrsOf(entry.el).size === own.size)
      candidates.push(i)
  }
  if (candidates.length < 3) return
  const lists = candidates.map((i) => attrsOf(list[i]!.el))
  let valid = 0
  for (let c = 0; c < candidates.length; c++) {
    let equal = true
    for (const [name, value] of lists[c]!) if (own.get(name) !== value) equal = false
    if (equal && ++valid >= 3) list.splice(candidates[c]!, 1)
  }
  afe = list.toReversed()
}
const afePush = (el: El) => {
  noah(el)
  afe.push({ el, tag: el.tag, id: el.id, attrs: el.attrs, flags: el.flags })
}
const reconstruct = () => {
  if (afe.length !== 0) rebuild()
}
// whether an element is open: nearly always one of the top few, so those first
const isOpen = (el: El) => {
  const top = stack.length - 1
  return (
    stack[top] === el ||
    stack[top - 1] === el ||
    stack[top - 2] === el ||
    stack.lastIndexOf(el) >= 0
  )
}
const rebuild = () => {
  const length = afe.length
  let i = length - 1
  const last = afe[i]!
  if (last === null || isOpen(last.el)) return
  while (i > 0) {
    const entry = afe[i - 1]!
    if (entry === null || isOpen(entry.el)) break
    i--
  }
  for (; i < length; i++) {
    const entry = afe[i]!
    entry.el = insert(entry.tag, entry.id, entry.el.ns, entry.attrs, entry.flags)
  }
}

// the adoption agency: misnested formatting (<b><p></b>) closed as browsers do
const adoption = () => {
  for (let outer = 0; outer < 8; outer++) {
    const entry = afeByTag(tag)
    if (!entry) {
      genericEndInBody()
      return
    }
    if (stack.lastIndexOf(entry.el) < 0) {
      afeRemove(entry)
      return
    }
    if (!inScope(tid)) return
    const formatting = entry.el
    let furthest: El | null = null
    let at = stack.length - 1
    for (; at >= 0; at--) {
      const el = stack[at]!
      if (el === formatting) break
      if (special(el)) furthest = el
    }
    if (!furthest) {
      shortenTo(Math.max(at, 0))
      afeRemove(entry)
      return
    }
    let bookmark = entry
    let last = furthest
    let next = stack[stack.lastIndexOf(furthest) - 1] ?? null
    for (let inner = 0, node = next; node !== formatting; inner++, node = next) {
      next = stack[stack.lastIndexOf(node!) - 1] ?? null
      const nodeEntry = afeOf(node!)
      const overflow = nodeEntry && inner >= 3
      if (!nodeEntry || overflow) {
        if (overflow) afeRemove(nodeEntry)
        removeEl(node!)
      } else {
        const clone = make(
          nodeEntry.tag,
          nodeEntry.id,
          nodeEntry.el.ns,
          nodeEntry.attrs,
          nodeEntry.flags,
        )
        stack[stack.lastIndexOf(node!)] = clone
        settle()
        nodeEntry.el = clone
        if (last === furthest) bookmark = nodeEntry
        detach(last)
        appendChild(clone, last)
        last = clone
      }
    }
    const common = stack[stack.lastIndexOf(formatting) - 1] ?? null
    detach(last)
    if (common) {
      if (FOSTERING[common.id]) fosterElement(last)
      else appendChild(common, last)
    }
    const clone = make(entry.tag, entry.id, formatting.ns, entry.attrs, entry.flags)
    // the furthest block's children move into the new formatting element
    reordered = true
    clone.kids = furthest.kids
    for (const kid of clone.kids) if (typeof kid !== 'string') kid.up = clone
    if (pruned.has(furthest)) pruned.add(clone)
    furthest.kids = []
    appendChild(furthest, clone)
    const mark = afe.lastIndexOf(bookmark)
    afe.splice(mark + 1, 0, {
      el: clone,
      tag: entry.tag,
      id: entry.id,
      attrs: entry.attrs,
      flags: entry.flags,
    })
    afeRemove(entry)
    removeEl(formatting)
    stack.splice(stack.lastIndexOf(furthest) + 1, 0, clone)
    settle()
  }
}

const resetMode = () => {
  for (let i = stack.length - 1; i >= 0; i--) {
    switch (stack[i]!.id) {
      case TR:
        mode = IN_ROW
        return
      case TBODY:
      case THEAD:
      case TFOOT:
        mode = IN_TABLE_BODY
        return
      case CAPTION:
        mode = IN_CAPTION
        return
      case COLGROUP:
        mode = IN_COLUMN_GROUP
        return
      case TABLE:
        mode = IN_TABLE
        return
      case BODY:
        mode = IN_BODY
        return
      case FRAMESET:
        mode = IN_FRAMESET
        return
      case SELECT:
        mode = IN_SELECT
        for (let j = i - 1; j > 0; j--) {
          const id = stack[j]!.id
          if (id === TEMPLATE) break
          if (id === TABLE) {
            mode = IN_SELECT_IN_TABLE
            break
          }
        }
        return
      case TEMPLATE:
        mode = tmplModes[tmplModes.length - 1]!
        return
      case HTML_TAG:
        mode = headEl ? AFTER_HEAD : BEFORE_HEAD
        return
      case TD:
      case TH:
        if (i > 0) {
          mode = IN_CELL
          return
        }
        break
      case HEAD:
        if (i > 0) {
          mode = IN_HEAD
          return
        }
        break
    }
  }
  mode = IN_BODY
}

// foreign content

const htmlIntegration = (el: El) => {
  if (el.ns === SVG) return el.id === FOREIGN_OBJECT || el.id === T_DESC || el.id === TITLE
  if (el.ns !== MATH || el.id !== ANNOTATION_XML) return false
  const encoding = attr(el, 'encoding')?.toLowerCase()
  return encoding === 'text/html' || encoding === 'application/xhtml+xml'
}
const integration = (el: El) => htmlIntegration(el) || (el.ns === MATH && MATH_TEXT[el.id] === 1)
const inForeign = () => {
  const c = cur()
  return c.ns !== HTML && !integration(c)
}
const foreignStart = () => {
  const c = cur()
  if (c.ns === HTML) return false
  if (tid === SVG_TAG && c.id === ANNOTATION_XML && c.ns === MATH) return false
  return !integration(c) || ((tid === MGLYPH || tid === MALIGNMARK) && !htmlIntegration(c))
}
const popToHtmlOrIntegration = () => {
  for (let c = cur(); c.ns !== HTML && !integration(c); c = cur()) pop()
}
// math attributes as the oracle names them: xlink:href is href
const mathAttrs = (source: string) => {
  if (!/xlink:|xml:|xmlns/i.test(source)) return source
  const map = parseAttrs(source)
  let out = ''
  for (const [name, value] of map) out += ` ${XML_ATTRS.get(name) ?? name}="${quote(value)}"`
  return out
}
// the token's flags, or a renamed source's (xlink:title is title)
const flagsOf = (attrs: string) => {
  if (attrs === tattrs) return tflags
  let flags = 0
  for (const name of parseAttrs(attrs).keys()) flags |= flagOf(name)
  return flags
}
const startInForeign = () => {
  if (
    EXITS_FOREIGN[tid] ||
    (tid === FONT && tattrs !== '' && /color|face|size/i.test(tattrs) && fontExits())
  ) {
    popToHtmlOrIntegration()
    startOutside()
    return
  }
  const ns = cur().ns
  let name = tag
  let id = tid
  let attrs = tattrs
  if (ns === SVG) {
    name = SVG_TAGS.get(tag) ?? tag
    if (name === 'foreignObject') id = FOREIGN_OBJECT
  } else if (attrs !== '') attrs = mathAttrs(attrs)
  // an instruction template in svg, made or not: any spelling, as the tree pipeline reads its attributes
  if (ns === SVG && id === TEMPLATE && attrs !== '' && /data-r/i.test(attrs))
    instructed = svgInstructed = true
  if (!tself) insert(name, id, ns, attrs, flagsOf(attrs))
  // a self-closed svg child is nothing anyone will read, unless the Head reads it, or it has an id a streamed
  // move could find
  else {
    const flags = flagsOf(attrs)
    if (ns !== SVG || WATCH[id] || cur().rec !== 0 || flags & FLAG.id)
      attach(make(name, id, ns, attrs, flags))
  }
}
const fontExits = () => {
  const map = parseAttrs(tattrs)
  return map.has('color') || map.has('face') || map.has('size')
}
const endInForeign = () => {
  if (tid === P || tid === BR) {
    popToHtmlOrIntegration()
    endOutside()
    return
  }
  for (let i = stack.length - 1; i > 0; i--) {
    const el = stack[i]!
    if (el.ns === HTML) {
      endOutside()
      return
    }
    if (el.tag === tag || (el.ns === SVG && el.tag.toLowerCase() === tag)) {
      shortenTo(i)
      return
    }
  }
}

// token dispatch

const dispatch = () => {
  switch (tok) {
    case START:
      return processStart()
    case END:
      return processEnd()
    case CHARS:
      return onChars(ttext)
    case SPACE:
      return onSpace(ttext)
    case NUL:
      return onNul()
    case COMMENT:
      return onComment()
    case DOCTYPE:
      return onDoctype()
    case EOF:
      return onEof()
  }
}
const processStart = () => (foreignStart() ? startInForeign() : startOutside())
const processEnd = () => (cur().ns !== HTML ? endInForeign() : endOutside())

// text from the tokenizer: the common modes take it whole; the rest see it as the tokenizer's runs of whitespace and
// other characters, which they treat apart
const chars = (input: string) => {
  let text = input
  if (skipNL) {
    skipNL = false
    if (text.charCodeAt(0) === 10) {
      text = text.slice(1)
      if (text === '') return
    }
  }
  const c = cur()
  if (c.ns !== HTML && !integration(c)) {
    insertText(text)
    if (framesetOk && !allSpace(text)) framesetOk = false
    return
  }
  switch (mode) {
    case IN_BODY:
    case IN_CAPTION:
    case IN_CELL:
    case IN_TEMPLATE:
      reconstruct()
      insertText(text)
      if (framesetOk && !allSpace(text)) framesetOk = false
      return
    case TEXT:
    case IN_SELECT:
    case IN_SELECT_IN_TABLE:
      insertText(text)
      return
    case IN_TABLE:
    case IN_TABLE_BODY:
    case IN_ROW:
      charsInTable(text, !allSpace(text))
      return
    case IN_TABLE_TEXT:
      pending.push(text)
      if (!pendingText && !allSpace(text)) pendingText = true
      return
  }
  for (let i = 0; i < text.length;) {
    const blank = space(text.charCodeAt(i))
    let j = i + 1
    while (j < text.length && space(text.charCodeAt(j)) === blank) j++
    if (blank) onSpace(text.slice(i, j))
    else onChars(text.slice(i, j))
    i = j
  }
}
const onChars = (text: string) => {
  tok = CHARS
  ttext = text
  if (inForeign()) {
    insertText(text)
    framesetOk = false
    return
  }
  switch (mode) {
    case INITIAL:
      return initialAnything()
    case BEFORE_HTML:
      return beforeHtmlAnything()
    case BEFORE_HEAD:
      return beforeHeadAnything()
    case IN_HEAD:
      return inHeadAnything()
    case IN_HEAD_NOSCRIPT:
      return noscriptAnything()
    case AFTER_HEAD:
      return afterHeadAnything()
    case IN_BODY:
    case IN_CAPTION:
    case IN_CELL:
    case IN_TEMPLATE:
      reconstruct()
      insertText(text)
      framesetOk = false
      return
    case TEXT:
    case IN_SELECT:
    case IN_SELECT_IN_TABLE:
      return insertText(text)
    case IN_TABLE:
    case IN_TABLE_BODY:
    case IN_ROW:
      return charsInTable(text, true)
    case IN_TABLE_TEXT:
      pending.push(text)
      pendingText = true
      return
    case IN_COLUMN_GROUP:
      return columnGroupAnything()
    case AFTER_BODY:
    case AFTER_AFTER_BODY:
      return afterBodyAnything()
  }
}
const onSpace = (text: string) => {
  tok = SPACE
  ttext = text
  if (inForeign()) return insertText(text)
  switch (mode) {
    case IN_HEAD:
    case IN_HEAD_NOSCRIPT:
    case AFTER_HEAD:
    case TEXT:
    case IN_COLUMN_GROUP:
    case IN_SELECT:
    case IN_SELECT_IN_TABLE:
    case IN_FRAMESET:
    case AFTER_FRAMESET:
      return insertText(text)
    case IN_BODY:
    case IN_CAPTION:
    case IN_CELL:
    case IN_TEMPLATE:
    case AFTER_BODY:
    case AFTER_AFTER_BODY:
    case AFTER_AFTER_FRAMESET:
      reconstruct()
      return insertText(text)
    case IN_TABLE:
    case IN_TABLE_BODY:
    case IN_ROW:
      return charsInTable(text, false)
    case IN_TABLE_TEXT:
      pending.push(text)
      return
  }
}
const onNul = () => {
  tok = NUL
  skipNL = false
  if (inForeign()) return insertText('\uFFFD')
  switch (mode) {
    case INITIAL:
      return initialAnything()
    case BEFORE_HTML:
      return beforeHtmlAnything()
    case BEFORE_HEAD:
      return beforeHeadAnything()
    case IN_HEAD:
      return inHeadAnything()
    case IN_HEAD_NOSCRIPT:
      return noscriptAnything()
    case AFTER_HEAD:
      return afterHeadAnything()
    case IN_TABLE:
    case IN_TABLE_BODY:
    case IN_ROW:
      if (FOSTERING[cur().id]) toTableText()
      return
    case IN_COLUMN_GROUP:
      return columnGroupAnything()
    case AFTER_BODY:
    case AFTER_AFTER_BODY:
      return afterBodyAnything()
  }
}
// a comment's data, which only a react boundary's needs: <!--$-->, <!--$?-->, <!--$!--> and <!--/$-->, which the
// streamed moves find a fallback's end by. as an element of its own, dropped once the parse is done; the rest aren't kept
const onComment = (data = '') => {
  tok = COMMENT
  skipNL = false
  if (nowrap && !nowrapSplit && nowrapOpen()) nowrapSplit = true
  if (mode === IN_TABLE_TEXT && cur().ns === HTML) tableTextAnything()
  // where the tree builder inserts a comment: the document before <html> and after the body's end, the html element
  // just after the body, else the current node
  const target =
    mode === INITIAL ||
    mode === BEFORE_HTML ||
    mode === AFTER_AFTER_BODY ||
    mode === AFTER_AFTER_FRAMESET
      ? doc
      : mode === AFTER_BODY
        ? (stack[0] ?? doc)
        : cur()
  if (data.charCodeAt(0) !== 36 && data !== '/$') {
    splitIn = target
    splitAt = target.kids.length
    return
  }
  appendChild(target, make(COMMENT_TAG_NAME, COMMENT_TAG, HTML, data, 0))
}
const COMMENT_TAG_NAME = '#comment'
const COMMENT_TAG = T(COMMENT_TAG_NAME)
let doctypeQuirks = false
const onDoctype = () => {
  tok = DOCTYPE
  skipNL = false
  if (mode === INITIAL) {
    quirks = doctypeQuirks
    mode = BEFORE_HTML
  } else if (mode === IN_TABLE_TEXT) tableTextAnything()
}
const onEof = () => {
  tok = EOF
  switch (mode) {
    case INITIAL:
      return initialAnything()
    case BEFORE_HTML:
      return beforeHtmlAnything()
    case BEFORE_HEAD:
      return beforeHeadAnything()
    case IN_HEAD:
      return inHeadAnything()
    case IN_HEAD_NOSCRIPT:
      return noscriptAnything()
    case AFTER_HEAD:
      return afterHeadAnything()
    case IN_BODY:
    case IN_TABLE:
    case IN_CAPTION:
    case IN_COLUMN_GROUP:
    case IN_TABLE_BODY:
    case IN_ROW:
    case IN_CELL:
    case IN_SELECT:
    case IN_SELECT_IN_TABLE:
      return eofInBody()
    case TEXT:
      pop()
      mode = origMode
      return onEof()
    case IN_TABLE_TEXT:
      return tableTextAnything()
    case IN_TEMPLATE:
      return eofInTemplate()
  }
}
const eofInBody = () => {
  if (tmplModes.length > 0) eofInTemplate()
}
const eofInTemplate = () => {
  if (tmplCount === 0) return
  popThrough(TEMPLATE)
  clearToMarker()
  tmplModes.pop()
  resetMode()
  onEof()
}

// in body, for the modes that hand a token to it directly
const modeInBody = () => {
  switch (tok) {
    case START:
      return startInBody()
    case END:
      return endInBody()
    case CHARS:
      reconstruct()
      insertText(ttext)
      framesetOk = false
      return
    case SPACE:
      reconstruct()
      return insertText(ttext)
    case EOF:
      return eofInBody()
  }
}

const startOutside = () => {
  if (mode === IN_BODY) return startInBody()
  switch (mode) {
    case INITIAL:
      return initialAnything()
    case BEFORE_HTML:
      if (tid === HTML_TAG) {
        htmlEl = insertTok()
        mode = BEFORE_HEAD
      } else beforeHtmlAnything()
      return
    case BEFORE_HEAD:
      if (tid === HTML_TAG) startInBody()
      else if (tid === HEAD) {
        headEl = insertTok()
        mode = IN_HEAD
      } else beforeHeadAnything()
      return
    case IN_HEAD:
      return startInHead()
    case IN_HEAD_NOSCRIPT:
      return startInHeadNoscript()
    case AFTER_HEAD:
      return startAfterHead()
    case IN_BODY:
      return startInBody()
    case IN_TABLE:
      return startInTable()
    case IN_TABLE_TEXT:
      return tableTextAnything()
    case IN_CAPTION:
      return startInCaption()
    case IN_COLUMN_GROUP:
      return startInColumnGroup()
    case IN_TABLE_BODY:
      return startInTableBody()
    case IN_ROW:
      return startInRow()
    case IN_CELL:
      return startInCell()
    case IN_SELECT:
      return startInSelect()
    case IN_SELECT_IN_TABLE:
      return startInSelectInTable()
    case IN_TEMPLATE:
      return startInTemplate()
    case AFTER_BODY:
    case AFTER_AFTER_BODY:
      if (tid === HTML_TAG) startInBody()
      else afterBodyAnything()
      return
    case IN_FRAMESET:
      if (tid === HTML_TAG) startInBody()
      else if (tid === FRAMESET) insertTok()
      else if (tid === FRAME) appendTok()
      else if (tid === NOFRAMES) startInHead()
      return
    case AFTER_FRAMESET:
    case AFTER_AFTER_FRAMESET:
      if (tid === HTML_TAG) startInBody()
      else if (tid === NOFRAMES) startInHead()
      return
  }
}
const endOutside = () => {
  if (mode === IN_BODY) return endInBody()
  switch (mode) {
    case INITIAL:
      return initialAnything()
    case BEFORE_HTML:
      if (tid === HTML_TAG || tid === HEAD || tid === BODY || tid === BR) beforeHtmlAnything()
      return
    case BEFORE_HEAD:
      if (tid === HEAD || tid === BODY || tid === HTML_TAG || tid === BR) beforeHeadAnything()
      return
    case IN_HEAD:
      if (tid === HEAD) {
        pop()
        mode = AFTER_HEAD
      } else if (tid === BODY || tid === BR || tid === HTML_TAG) inHeadAnything()
      else if (tid === TEMPLATE) templateEnd()
      return
    case IN_HEAD_NOSCRIPT:
      if (tid === NOSCRIPT) {
        pop()
        mode = IN_HEAD
      } else if (tid === BR) noscriptAnything()
      return
    case AFTER_HEAD:
      if (tid === BODY || tid === HTML_TAG || tid === BR) afterHeadAnything()
      else if (tid === TEMPLATE) templateEnd()
      return
    case IN_BODY:
      return endInBody()
    case TEXT:
      pop()
      mode = origMode
      return
    case IN_TABLE:
      return endInTable()
    case IN_TABLE_TEXT:
      return tableTextAnything()
    case IN_CAPTION:
      return endInCaption()
    case IN_COLUMN_GROUP:
      return endInColumnGroup()
    case IN_TABLE_BODY:
      return endInTableBody()
    case IN_ROW:
      return endInRow()
    case IN_CELL:
      return endInCell()
    case IN_SELECT:
      return endInSelect()
    case IN_SELECT_IN_TABLE:
      return endInSelectInTable()
    case IN_TEMPLATE:
      if (tid === TEMPLATE) templateEnd()
      return
    case AFTER_BODY:
      if (tid === HTML_TAG) mode = AFTER_AFTER_BODY
      else afterBodyAnything()
      return
    case IN_FRAMESET:
      if (tid === FRAMESET && !(stack.length === 1 && stack[0]!.id === HTML_TAG)) {
        pop()
        if (cur().id !== FRAMESET) mode = AFTER_FRAMESET
      }
      return
    case AFTER_FRAMESET:
      if (tid === HTML_TAG) mode = AFTER_AFTER_FRAMESET
      return
    case AFTER_AFTER_BODY:
      return afterBodyAnything()
  }
}

// "anything else": each mode's way of making what the page left out, then reprocessing the token
const initialAnything = () => {
  quirks = true
  mode = BEFORE_HTML
  dispatch()
}
const beforeHtmlAnything = () => {
  htmlEl = make('html', HTML_TAG, HTML, '', 0)
  appendChild(doc, htmlEl)
  push(htmlEl)
  mode = BEFORE_HEAD
  dispatch()
}
const beforeHeadAnything = () => {
  headEl = insertFake('head', HEAD)
  mode = IN_HEAD
  dispatch()
}
const inHeadAnything = () => {
  pop()
  mode = AFTER_HEAD
  dispatch()
}
const noscriptAnything = () => {
  pop()
  mode = IN_HEAD
  dispatch()
}
const afterHeadAnything = () => {
  const body = insertFake('body', BODY)
  bodyEl ??= body
  mode = IN_BODY
  modeInBody()
}
const afterBodyAnything = () => {
  mode = IN_BODY
  modeInBody()
}
const columnGroupAnything = () => {
  if (cur().id !== COLGROUP) return
  pop()
  mode = IN_TABLE
  dispatch()
}

const textParsing = (state: number) => {
  insertTok()
  tstate = state
  rawTag = tag
  origMode = mode
  mode = TEXT
}
const templateEnd = () => {
  if (tmplCount === 0) return
  impliedEndsAll()
  popThrough(TEMPLATE)
  clearToMarker()
  tmplModes.pop()
  resetMode()
}

const startInHead = (): void => {
  switch (tid) {
    case HTML_TAG:
      return startInBody()
    case BASE:
    case BASEFONT:
    case BGSOUND:
    case LINK:
    case META:
      return appendTok()
    case TITLE:
      return textParsing(RCDATA)
    case NOSCRIPT:
      insertTok()
      mode = IN_HEAD_NOSCRIPT
      return
    case NOFRAMES:
    case STYLE:
      return textParsing(RAWTEXT)
    case SCRIPT:
      return textParsing(SCRIPT_DATA)
    case TEMPLATE:
      insertTok()
      afe.push(null)
      framesetOk = false
      mode = IN_TEMPLATE
      tmplModes.push(IN_TEMPLATE)
      return
    case HEAD:
      return
    default:
      return inHeadAnything()
  }
}
const startInHeadNoscript = () => {
  switch (tid) {
    case HTML_TAG:
      return startInBody()
    case BASEFONT:
    case BGSOUND:
    case HEAD:
    case LINK:
    case META:
    case NOFRAMES:
    case STYLE:
      return startInHead()
    case NOSCRIPT:
      return
    default:
      return noscriptAnything()
  }
}
const startAfterHead = () => {
  switch (tid) {
    case HTML_TAG:
      return startInBody()
    case BODY: {
      const body = insertTok()
      bodyEl ??= body
      framesetOk = false
      mode = IN_BODY
      return
    }
    case FRAMESET:
      insertTok()
      mode = IN_FRAMESET
      return
    case BASE:
    case BASEFONT:
    case BGSOUND:
    case LINK:
    case META:
    case NOFRAMES:
    case SCRIPT:
    case STYLE:
    case TEMPLATE:
    case TITLE:
      push(headEl!)
      startInHead()
      removeEl(headEl!)
      return
    case HEAD:
      return
    default:
      return afterHeadAnything()
  }
}

// a later <html> or <body> adds the attributes the first one didn't have
const adopt = (el: El) => {
  if (tattrs === '') return
  const own = new Map(attrsOf(el))
  let added = false
  for (const [name, value] of parseAttrs(tattrs))
    if (!own.has(name)) {
      own.set(name, value)
      added = true
    }
  if (!added) return
  el.attrs = serialize(own)
  el.map = own
  el.flags |= tflags
  // a role it gains can make it a main (an html element is in the tree when a frameset put the page's own in it)
  if (own.get('role') === 'main' && !mains.includes(el)) mains.push(el)
}
const hiddenInput = () =>
  tattrs !== '' && parseAttrs(tattrs).get('type')?.toLowerCase() === 'hidden'

// most start tags in body are only inserted (the switch's default), or are blocks that close a p first; most end
// tags are blocks, or the generic kind. they skip the long switches
const PLAIN_START = set(
  'span label sub sup var ruby noscript canvas audio video annotation-xml desc malignmark mglyph mi mn mo ms mtext',
)
const BLOCK_START = set(
  'p dl ol ul div dir nav main menu aside center figure footer header hgroup dialog details address article search ' +
    'section summary fieldset blockquote figcaption',
)
const BLOCK_END = set(
  'dl ul ol dir div nav pre main menu aside button center figure footer header hgroup dialog address article details ' +
    'search section summary listing fieldset blockquote figcaption',
)
const SWITCH_END = set(
  'a b i s u em tt big code font nobr small strike strong p li dd dt h1 h2 h3 h4 h5 h6 br body html form applet ' +
    'object marquee template',
)
// end tags in body that do more than pop the current node, even when they name it
const POP_SPECIAL = set(
  'a b i s u em tt big code font nobr small strike strong br body html form applet object marquee template',
)
const startInBody = (): void => {
  if (tid === 0 || PLAIN_START[tid]) {
    reconstruct()
    insertTok()
    return
  }
  if (BLOCK_START[tid]) {
    if (pInButtonScope()) closeP()
    insertTok()
    return
  }
  switch (tid) {
    case I:
    case S:
    case B:
    case U:
    case EM:
    case TT:
    case BIG:
    case CODE:
    case FONT:
    case SMALL:
    case STRIKE:
    case STRONG:
      reconstruct()
      afePush(insertTok())
      return
    case A: {
      const entry = afeByTag('a')
      if (entry) {
        adoption()
        removeEl(entry.el)
        afeRemove(entry)
      }
      reconstruct()
      afePush(insertTok())
      return
    }
    case H1:
    case H2:
    case H3:
    case H4:
    case H5:
    case H6:
      if (pInButtonScope()) closeP()
      if (HEADINGS[cur().id]) pop()
      insertTok()
      return
    case P:
    case DL:
    case OL:
    case UL:
    case DIV:
    case DIR:
    case NAV:
    case MAIN:
    case MENU:
    case ASIDE:
    case CENTER:
    case FIGURE:
    case FOOTER:
    case HEADER:
    case HGROUP:
    case DIALOG:
    case DETAILS:
    case ADDRESS:
    case ARTICLE:
    case SEARCH:
    case SECTION:
    case SUMMARY:
    case FIELDSET:
    case BLOCKQUOTE:
    case FIGCAPTION:
      if (pInButtonScope()) closeP()
      insertTok()
      return
    case LI:
    case DD:
    case DT:
      framesetOk = false
      for (let i = stack.length - 1; i >= 0; i--) {
        const el = stack[i]!
        const id = el.id
        if ((tid === LI && id === LI) || ((tid === DD || tid === DT) && (id === DD || id === DT))) {
          impliedEndsBut(id)
          popThrough(id)
          break
        }
        if (id !== ADDRESS && id !== DIV && id !== P && special(el)) break
      }
      if (pInButtonScope()) closeP()
      insertTok()
      return
    case BR:
    case IMG:
    case WBR:
    case AREA:
    case EMBED:
    case KEYGEN:
      reconstruct()
      appendTok()
      framesetOk = false
      return
    case HR:
      if (pInButtonScope()) closeP()
      appendTok()
      framesetOk = false
      return
    case RB:
    case RTC:
      if (inScope(RUBY)) impliedEnds()
      insertTok()
      return
    case RT:
    case RP:
      if (inScope(RUBY)) impliedEndsBut(RTC)
      insertTok()
      return
    case PRE:
    case LISTING:
      if (pInButtonScope()) closeP()
      insertTok()
      skipNL = true
      framesetOk = false
      return
    case XMP:
      if (pInButtonScope()) closeP()
      reconstruct()
      framesetOk = false
      return textParsing(RAWTEXT)
    case SVG_TAG:
      reconstruct()
      if (tself) attach(make(tag, tid, SVG, tattrs, tflags))
      else insert(tag, tid, SVG, tattrs, tflags)
      return
    case HTML_TAG:
      if (tmplCount === 0) adopt(stack[0]!)
      return
    case BASE:
    case LINK:
    case META:
    case STYLE:
    case TITLE:
    case SCRIPT:
    case BGSOUND:
    case BASEFONT:
    case TEMPLATE:
      return startInHead()
    case BODY: {
      const body = stack.length > 1 && stack[1]!.id === BODY ? stack[1]! : null
      if (body && tmplCount === 0) {
        framesetOk = false
        adopt(body)
      }
      return
    }
    case FORM: {
      const inTemplate = tmplCount > 0
      if (!formEl || inTemplate) {
        if (pInButtonScope()) closeP()
        const el = insertTok()
        if (!inTemplate) formEl = el
      }
      return
    }
    case NOBR:
      reconstruct()
      if (inScope(NOBR)) {
        adoption()
        reconstruct()
      }
      afePush(insertTok())
      return
    case MATH_TAG: {
      reconstruct()
      const attrs = tattrs === '' ? '' : mathAttrs(tattrs)
      if (tself) attach(make(tag, tid, MATH, attrs, flagsOf(attrs)))
      else insert(tag, tid, MATH, attrs, flagsOf(attrs))
      return
    }
    case TABLE:
      if (!quirks && pInButtonScope()) closeP()
      insertTok()
      framesetOk = false
      mode = IN_TABLE
      return
    case INPUT:
      reconstruct()
      appendTok()
      if (!hiddenInput()) framesetOk = false
      return
    case PARAM:
    case TRACK:
    case SOURCE:
      return appendTok()
    case IMAGE:
      tag = 'img'
      tid = IMG
      reconstruct()
      appendTok()
      framesetOk = false
      return
    case BUTTON:
      if (inScope(BUTTON)) {
        impliedEnds()
        popThrough(BUTTON)
      }
      reconstruct()
      insertTok()
      framesetOk = false
      return
    case APPLET:
    case OBJECT:
    case MARQUEE:
      reconstruct()
      insertTok()
      afe.push(null)
      framesetOk = false
      return
    case IFRAME:
      framesetOk = false
      return textParsing(RAWTEXT)
    case SELECT:
      reconstruct()
      insertTok()
      framesetOk = false
      mode =
        mode === IN_TABLE ||
        mode === IN_CAPTION ||
        mode === IN_TABLE_BODY ||
        mode === IN_ROW ||
        mode === IN_CELL
          ? IN_SELECT_IN_TABLE
          : IN_SELECT
      return
    case OPTION:
    case OPTGROUP:
      if (cur().id === OPTION) pop()
      reconstruct()
      insertTok()
      return
    case NOEMBED:
    case NOFRAMES:
      return textParsing(RAWTEXT)
    case FRAMESET: {
      const body = stack.length > 1 && stack[1]!.id === BODY ? stack[1]! : null
      if (framesetOk && body) {
        detach(body)
        bodyGone = true
        shortenTo(1)
        tmplCount = 0
        insertTok()
        mode = IN_FRAMESET
      }
      return
    }
    case TEXTAREA:
      insertTok()
      skipNL = true
      tstate = RCDATA
      rawTag = tag
      origMode = mode
      framesetOk = false
      mode = TEXT
      return
    case PLAINTEXT:
      if (pInButtonScope()) closeP()
      insertTok()
      tstate = PLAIN
      return
    case COL:
    case TH:
    case TD:
    case TR:
    case HEAD:
    case FRAME:
    case TBODY:
    case TFOOT:
    case THEAD:
    case CAPTION:
    case COLGROUP:
      return
    default:
      // noscript too: with scripting off it is an ordinary element
      reconstruct()
      insertTok()
  }
}

const genericEndInBody = () => {
  for (let i = stack.length - 1; i > 0; i--) {
    const el = stack[i]!
    if (tid === el.id && (tid !== 0 || el.tag === tag)) {
      impliedEndsBut(tid)
      if (stack.length - 1 >= i) shortenTo(i)
      return
    }
    if (special(el)) return
  }
}
const endInBody = () => {
  if (BLOCK_END[tid]) {
    if (inScope(tid)) {
      impliedEnds()
      popThrough(tid)
    }
    return
  }
  if (!SWITCH_END[tid]) return genericEndInBody()
  switch (tid) {
    case A:
    case B:
    case I:
    case S:
    case U:
    case EM:
    case TT:
    case BIG:
    case CODE:
    case FONT:
    case NOBR:
    case SMALL:
    case STRIKE:
    case STRONG:
      return adoption()
    case P:
      if (!pInButtonScope()) insertFake('p', P)
      return closeP()
    case DL:
    case UL:
    case OL:
    case DIR:
    case DIV:
    case NAV:
    case PRE:
    case MAIN:
    case MENU:
    case ASIDE:
    case BUTTON:
    case CENTER:
    case FIGURE:
    case FOOTER:
    case HEADER:
    case HGROUP:
    case DIALOG:
    case ADDRESS:
    case ARTICLE:
    case DETAILS:
    case SEARCH:
    case SECTION:
    case SUMMARY:
    case LISTING:
    case FIELDSET:
    case BLOCKQUOTE:
    case FIGCAPTION:
      if (inScope(tid)) {
        impliedEnds()
        popThrough(tid)
      }
      return
    case LI:
      if (inScopeOf(LI, LIST_SCOPE)) {
        impliedEndsBut(LI)
        popThrough(LI)
      }
      return
    case DD:
    case DT:
      if (inScope(tid)) {
        impliedEndsBut(tid)
        popThrough(tid)
      }
      return
    case H1:
    case H2:
    case H3:
    case H4:
    case H5:
    case H6:
      if (headingInScope()) {
        impliedEnds()
        popThroughOf(HEADINGS)
      }
      return
    case BR:
      reconstruct()
      insertFake('br', BR)
      pop()
      framesetOk = false
      return
    case BODY:
      if (inScope(BODY)) mode = AFTER_BODY
      return
    case HTML_TAG:
      if (inScope(BODY)) {
        mode = AFTER_BODY
        endOutside()
      }
      return
    case FORM: {
      const inTemplate = tmplCount > 0
      const el = formEl
      if (!inTemplate) formEl = null
      if ((el || inTemplate) && inScope(FORM)) {
        impliedEnds()
        if (inTemplate) popThrough(FORM)
        else if (el) removeEl(el)
      }
      return
    }
    case APPLET:
    case OBJECT:
    case MARQUEE:
      if (inScope(tid)) {
        impliedEnds()
        popThrough(tid)
        clearToMarker()
      }
      return
    case TEMPLATE:
      return templateEnd()
    default:
      return genericEndInBody()
  }
}

// tables

const tokenInTable = () => {
  const saved = foster
  foster = true
  modeInBody()
  foster = saved
}
const toTableText = () => {
  pending = []
  pendingText = false
  origMode = mode
  mode = IN_TABLE_TEXT
}
const charsInTable = (text: string, nonSpace: boolean) => {
  if (FOSTERING[cur().id]) {
    toTableText()
    pending.push(text)
    pendingText = nonSpace
    return
  }
  const saved = foster
  foster = true
  reconstruct()
  insertText(text)
  if (nonSpace) framesetOk = false
  foster = saved
}
// the table's pending text goes in (fostered out of the table if any of it isn't whitespace), then the token goes on
const tableTextAnything = () => {
  const list = pending
  pending = []
  if (pendingText) {
    const saved = foster
    foster = true
    for (const text of list) {
      reconstruct()
      insertText(text)
    }
    framesetOk = false
    foster = saved
  } else for (const text of list) insertText(text)
  mode = origMode
  dispatch()
}

const startInTable = (): void => {
  switch (tid) {
    case TD:
    case TH:
    case TR:
      clearBackTo(TABLE_CONTEXT)
      insertFake('tbody', TBODY)
      mode = IN_TABLE_BODY
      return startInTableBody()
    case STYLE:
    case SCRIPT:
    case TEMPLATE:
      return startInHead()
    case COL:
      clearBackTo(TABLE_CONTEXT)
      insertFake('colgroup', COLGROUP)
      mode = IN_COLUMN_GROUP
      return startInColumnGroup()
    case FORM:
      if (!formEl && tmplCount === 0) {
        formEl = insertTok()
        pop()
      }
      return
    case TABLE:
      if (inTableScope(TABLE)) {
        popThrough(TABLE)
        resetMode()
        processStart()
      }
      return
    case TBODY:
    case TFOOT:
    case THEAD:
      clearBackTo(TABLE_CONTEXT)
      insertTok()
      mode = IN_TABLE_BODY
      return
    case INPUT:
      if (hiddenInput()) appendTok()
      else tokenInTable()
      return
    case CAPTION:
      clearBackTo(TABLE_CONTEXT)
      afe.push(null)
      insertTok()
      mode = IN_CAPTION
      return
    case COLGROUP:
      clearBackTo(TABLE_CONTEXT)
      insertTok()
      mode = IN_COLUMN_GROUP
      return
    default:
      return tokenInTable()
  }
}
const endInTable = () => {
  switch (tid) {
    case TABLE:
      if (inTableScope(TABLE)) {
        popThrough(TABLE)
        resetMode()
      }
      return
    case TEMPLATE:
      return templateEnd()
    case BODY:
    case CAPTION:
    case COL:
    case COLGROUP:
    case HTML_TAG:
    case TBODY:
    case TD:
    case TFOOT:
    case TH:
    case THEAD:
    case TR:
      return
    default:
      return tokenInTable()
  }
}
const startInCaption = () => {
  if (!TABLE_VOID[tid]) return startInBody()
  if (!inTableScope(CAPTION)) return
  impliedEnds()
  popThrough(CAPTION)
  clearToMarker()
  mode = IN_TABLE
  startInTable()
}
const endInCaption = () => {
  switch (tid) {
    case CAPTION:
    case TABLE:
      if (inTableScope(CAPTION)) {
        impliedEnds()
        popThrough(CAPTION)
        clearToMarker()
        mode = IN_TABLE
        if (tid === TABLE) endInTable()
      }
      return
    case BODY:
    case COL:
    case COLGROUP:
    case HTML_TAG:
    case TBODY:
    case TD:
    case TFOOT:
    case TH:
    case THEAD:
    case TR:
      return
    default:
      return endInBody()
  }
}
const startInColumnGroup = () => {
  if (tid === HTML_TAG) startInBody()
  else if (tid === COL) appendTok()
  else if (tid === TEMPLATE) startInHead()
  else columnGroupAnything()
}
const endInColumnGroup = () => {
  if (tid === COLGROUP) {
    if (cur().id === COLGROUP) {
      pop()
      mode = IN_TABLE
    }
  } else if (tid === TEMPLATE) templateEnd()
  else if (tid !== COL) columnGroupAnything()
}
const startInTableBody = (): void => {
  switch (tid) {
    case TR:
      clearBackTo(TABLE_BODY_CONTEXT)
      insertTok()
      mode = IN_ROW
      return
    case TH:
    case TD:
      clearBackTo(TABLE_BODY_CONTEXT)
      insertFake('tr', TR)
      mode = IN_ROW
      return startInRow()
    case CAPTION:
    case COL:
    case COLGROUP:
    case TBODY:
    case TFOOT:
    case THEAD:
      if (tableBodyInTableScope()) {
        clearBackTo(TABLE_BODY_CONTEXT)
        pop()
        mode = IN_TABLE
        startInTable()
      }
      return
    default:
      return startInTable()
  }
}
const endInTableBody = () => {
  switch (tid) {
    case TBODY:
    case TFOOT:
    case THEAD:
      if (inTableScope(tid)) {
        clearBackTo(TABLE_BODY_CONTEXT)
        pop()
        mode = IN_TABLE
      }
      return
    case TABLE:
      if (tableBodyInTableScope()) {
        clearBackTo(TABLE_BODY_CONTEXT)
        pop()
        mode = IN_TABLE
        endInTable()
      }
      return
    case BODY:
    case CAPTION:
    case COL:
    case COLGROUP:
    case HTML_TAG:
    case TD:
    case TH:
    case TR:
      return
    default:
      return endInTable()
  }
}
const startInRow = (): void => {
  switch (tid) {
    case TH:
    case TD:
      clearBackTo(TABLE_ROW_CONTEXT)
      insertTok()
      mode = IN_CELL
      afe.push(null)
      return
    case CAPTION:
    case COL:
    case COLGROUP:
    case TBODY:
    case TFOOT:
    case THEAD:
    case TR:
      if (inTableScope(TR)) {
        clearBackTo(TABLE_ROW_CONTEXT)
        pop()
        mode = IN_TABLE_BODY
        startInTableBody()
      }
      return
    default:
      return startInTable()
  }
}
const endInRow = () => {
  switch (tid) {
    case TR:
      if (inTableScope(TR)) {
        clearBackTo(TABLE_ROW_CONTEXT)
        pop()
        mode = IN_TABLE_BODY
      }
      return
    case TABLE:
      if (inTableScope(TR)) {
        clearBackTo(TABLE_ROW_CONTEXT)
        pop()
        mode = IN_TABLE_BODY
        endInTableBody()
      }
      return
    case TBODY:
    case TFOOT:
    case THEAD:
      if (inTableScope(tid) || inTableScope(TR)) {
        clearBackTo(TABLE_ROW_CONTEXT)
        pop()
        mode = IN_TABLE_BODY
        endInTableBody()
      }
      return
    case BODY:
    case CAPTION:
    case COL:
    case COLGROUP:
    case HTML_TAG:
    case TD:
    case TH:
      return
    default:
      return endInTable()
  }
}
const closeCell = () => {
  impliedEnds()
  popThroughOf(CELLS)
  clearToMarker()
  mode = IN_ROW
}
const startInCell = () => {
  if (!TABLE_VOID[tid]) return startInBody()
  if (inTableScope(TD) || inTableScope(TH)) {
    closeCell()
    startInRow()
  }
}
const endInCell = () => {
  switch (tid) {
    case TD:
    case TH:
      if (inTableScope(tid)) {
        impliedEnds()
        popThrough(tid)
        clearToMarker()
        mode = IN_ROW
      }
      return
    case TABLE:
    case TBODY:
    case TFOOT:
    case THEAD:
    case TR:
      if (inTableScope(tid)) {
        closeCell()
        endInRow()
      }
      return
    case BODY:
    case CAPTION:
    case COL:
    case COLGROUP:
    case HTML_TAG:
      return
    default:
      return endInBody()
  }
}

// select and template

const startInSelect = () => {
  switch (tid) {
    case HTML_TAG:
      return startInBody()
    case OPTION:
      if (cur().id === OPTION) pop()
      insertTok()
      return
    case OPTGROUP:
      if (cur().id === OPTION) pop()
      if (cur().id === OPTGROUP) pop()
      insertTok()
      return
    case HR:
      if (cur().id === OPTION) pop()
      if (cur().id === OPTGROUP) pop()
      appendTok()
      return
    case INPUT:
    case KEYGEN:
    case TEXTAREA:
    case SELECT:
      if (inSelectScope(SELECT)) {
        popThrough(SELECT)
        resetMode()
        if (tid !== SELECT) processStart()
      }
      return
    case SCRIPT:
    case TEMPLATE:
      return startInHead()
  }
}
const endInSelect = () => {
  switch (tid) {
    case OPTGROUP:
      if (stack.length > 1 && cur().id === OPTION && stack[stack.length - 2]!.id === OPTGROUP) pop()
      if (cur().id === OPTGROUP) pop()
      return
    case OPTION:
      if (cur().id === OPTION) pop()
      return
    case SELECT:
      if (inSelectScope(SELECT)) {
        popThrough(SELECT)
        resetMode()
      }
      return
    case TEMPLATE:
      return templateEnd()
  }
}
const SELECT_TABLE = set('caption table tbody tfoot thead tr td th')
const startInSelectInTable = () => {
  if (!SELECT_TABLE[tid]) return startInSelect()
  popThrough(SELECT)
  resetMode()
  processStart()
}
const endInSelectInTable = () => {
  if (!SELECT_TABLE[tid]) return endInSelect()
  if (!inTableScope(tid)) return
  popThrough(SELECT)
  resetMode()
  skipNL = false
  processEnd()
}
const startInTemplate = () => {
  let next: number
  switch (tid) {
    case BASE:
    case BASEFONT:
    case BGSOUND:
    case LINK:
    case META:
    case NOFRAMES:
    case SCRIPT:
    case STYLE:
    case TEMPLATE:
    case TITLE:
      return startInHead()
    case CAPTION:
    case COLGROUP:
    case TBODY:
    case TFOOT:
    case THEAD:
      next = IN_TABLE
      break
    case COL:
      next = IN_COLUMN_GROUP
      break
    case TR:
      next = IN_TABLE_BODY
      break
    case TD:
    case TH:
      next = IN_ROW
      break
    default:
      next = IN_BODY
  }
  tmplModes[tmplModes.length - 1] = next
  mode = next
  if (next === IN_TABLE) startInTable()
  else if (next === IN_COLUMN_GROUP) startInColumnGroup()
  else if (next === IN_TABLE_BODY) startInTableBody()
  else if (next === IN_ROW) startInRow()
  else startInBody()
}

// tokenizer

// what the tag states stop at: 1 whitespace, 2 '/', 4 '>', 8 '='; 16 what a tag name folds (ascii upper case, and a
// nul, which is U+FFFD)
const STOPS = new Uint8Array(65536)
STOPS[32] = STOPS[10] = STOPS[9] = STOPS[12] = 1
STOPS[47] = 2
STOPS[62] = 4
STOPS[61] = 8
for (let c = 65; c <= 90; c++) STOPS[c] = 16
STOPS[0] = 16
// tag names in a small direct-mapped cache: a page uses a few dozen names, read again without a slice or a hash
const NAME_CACHE: string[] = Array.from({ length: 256 }, () => '')
const ID_CACHE = new Int32Array(256)
// a tag's name from `from` (a letter) to whitespace, '/' or '>': sets tag and tid, and returns where it ends
const readName = (from: number) => {
  const h = html
  const length = n
  const stops = STOPS
  let i = from + 1
  let fold = 0
  for (; i < length; i++) {
    const stop = stops[h.charCodeAt(i)]!
    if (stop & 7) break
    fold |= stop
  }
  const first = h.charCodeAt(from)
  if (fold & 16 || first <= 90) {
    tag = lowerAscii(h.slice(from, i))
    tid = IDS.get(tag) ?? 0
    return i
  }
  const size = i - from
  const key = (first * 7 + size * 31 + h.charCodeAt(i - 1)) & 255
  const cached = NAME_CACHE[key]!
  let k = cached.length === size ? 1 : size
  while (k < size && h.charCodeAt(from + k) === cached.charCodeAt(k)) k++
  if (k === size && cached.length === size && cached.charCodeAt(0) === first) {
    tag = cached
    tid = ID_CACHE[key]!
    return i
  }
  tid = IDS.get(h.slice(from, i)) ?? 0
  // a known name is the table's own string; the page's slices are not kept past the parse
  tag = tid ? NAMES[tid - 1]! : h.slice(from, i)
  NAME_CACHE[key] = tag
  ID_CACHE[key] = tid
  return i
}
// the attribute states from just after a tag's name to its '>', which only a quoted value can hold: where the tag
// ends (after the '>'), or -1 when the page ends first (and the tag is dropped). sets tself, attrsEnd, and named to
// whether any attribute started
let attrsEnd = 0
let named = false
// FLAG's names by a hash the attribute loop keeps as it reads a name (each character lowered with |32, which leaves
// '-'; a cr, which it would also make '-', is gone by now): 10 is a multiplier that gives each of them its own slot
// of 64, and a hit is then checked letter by letter, so any name can land anywhere without a false flag
const FLAG_NAMES: string[] = []
const FLAG_BITS: number[] = []
const FLAG_SLOT = new Int8Array(64).fill(-1)
for (const [name, bit] of Object.entries(FLAG)) {
  let hash = 0
  for (let k = 0; k < name.length; k++) hash = (hash * 10 + name.charCodeAt(k)) | 0
  const slot = (hash ^ name.length) & 63
  if (FLAG_SLOT[slot] !== -1) throw new Error(`flag hash collides: ${name}`)
  FLAG_SLOT[slot] = FLAG_NAMES.length
  FLAG_NAMES.push(name)
  FLAG_BITS.push(bit)
}
const flagMatch = (at: number, from: number, to: number) => {
  const name = FLAG_NAMES[at]!
  if (name.length !== to - from) return 0
  const h = html
  for (let k = 0; k < name.length; k++)
    if ((h.charCodeAt(from + k) | 32) !== name.charCodeAt(k)) return 0
  return FLAG_BITS[at]!
}
const tagEnd = (from: number): number => {
  const h = html
  const length = n
  const stops = STOPS
  named = false
  tflags = 0
  let i = from
  let c = h.charCodeAt(i)
  for (;;) {
    // before a name
    while (stops[c] === 1) c = h.charCodeAt(++i)
    if (c === 62) {
      attrsEnd = i
      tself = false
      return i + 1
    }
    if (c === 47) {
      // a '/' right before the '>' self-closes; anything else is read again as before a name
      c = h.charCodeAt(++i)
      if (c === 62) {
        attrsEnd = i
        tself = true
        return i + 1
      }
      continue
    }
    if (i >= length) return -1
    // a name, whose first character may be '='
    named = true
    const name = i
    let hash = c | 32
    c = h.charCodeAt(++i)
    while (i < length && (stops[c]! & 15) === 0) {
      hash = (hash * 10 + (c | 32)) | 0
      c = h.charCodeAt(++i)
    }
    if (i >= length) return -1
    const flag = FLAG_SLOT[(hash ^ (i - name)) & 63]!
    if (flag >= 0) tflags |= flagMatch(flag, name, i)
    while (stops[c] === 1) c = h.charCodeAt(++i)
    // no '=': what follows reads the same as before a name
    if (c !== 61) continue
    c = h.charCodeAt(++i)
    while (stops[c] === 1) c = h.charCodeAt(++i)
    if (c === 34 || c === 39) {
      const close = h.indexOf(c === 34 ? '"' : "'", i + 1)
      if (close < 0) return -1
      i = close + 1
      c = h.charCodeAt(i)
      continue
    }
    if (c === 62) continue
    while ((stops[c]! & 5) === 0) {
      if (i >= length) return -1
      c = h.charCodeAt(++i)
    }
  }
}

// a nul is rare, and indexOf is slow to look for one in a two-byte string (and can't stop at the text's end): by
// hand, over the page itself
const hasNul = (from: number, to: number) => {
  const h = html
  for (let i = from; i < to; i++) if (h.charCodeAt(i) === 0) return true
  return false
}
// text in the data state: references decoded, and nuls (rare) handed on one by one
// whether the page has this name at `at` (short names: by hand beats a startsWith call)
const same = (name: string, at: number) => {
  const h = html
  for (let k = 0; k < name.length; k++)
    if (h.charCodeAt(at + k) !== name.charCodeAt(k)) return false
  return true
}
// the range of the page the tokenizer just read whole on its way to a '<', finding no nul
let cleanFrom = -1
let clean = -1
// whether the text before the last </> ended in a nul, whose run goes on into the next text
let nulJoin = false
const dataText = (from: number, to: number) => {
  const join = nulJoin
  nulJoin = false
  if (to <= from) return
  // inside svg text goes nowhere, and only could say the page has content (framesetOk)
  if (current.rec === 0 && !framesetOk && !integration(current)) return
  let text = html.slice(from, to)
  if (amp < from) amp = html.indexOf('&', from) >>> 0
  if (amp < to) text = decode(text)
  if (
    !(clean === to && cleanFrom === from) &&
    (to - from > 24 ? text.indexOf('\0') >= 0 : hasNul(from, to)) &&
    !(current.rec === 0 && !framesetOk)
  ) {
    // a run of nuls is one token, as the tokenizer emits them (in foreign content, one U+FFFD for the run)
    for (let i = 0; i < text.length;) {
      let j = i
      if (text.charCodeAt(i) === 0) {
        while (text.charCodeAt(j) === 0) j++
        if (i > 0 || !join) onNul()
      } else {
        while (j < text.length && text.charCodeAt(j) !== 0) j++
        chars(text.slice(i, j))
      }
      i = j
    }
    return
  }
  // the common case: text in body, into an html element (what chars would do, minus its dispatch)
  if (mode === IN_BODY && current.ns === HTML && !skipNL && !foster) {
    if (afe.length !== 0) rebuild()
    appendText(current, text)
    if (framesetOk && !allSpace(text)) framesetOk = false
    return
  }
  chars(text)
}
// text in raw text, rcdata, script data and plaintext: nuls are U+FFFD
const rawText = (from: number, to: number, refs: boolean) => {
  if (to <= from) return
  // nothing reads a dropped element's text
  if (cur().rec < 2) return
  let text = html.slice(from, to)
  if (refs) text = decode(text)
  if (text.indexOf('\0') >= 0) text = text.replaceAll('\0', '\uFFFD')
  chars(text)
}

// the common case first: in body, with an html current node, an ordinary element is reconstructed into and inserted,
// and an end tag that names the current node (and isn't one in body treats specially) pops it. both are what the
// general dispatch would do, minus the dispatch
const emitStart = (from: number, to: number) => {
  tattrs = named ? html.slice(from, to) : ''
  tok = START
  skipNL = false
  if (mode === IN_BODY && current.ns === HTML) {
    if (tid === 0 || PLAIN_START[tid]) {
      if (afe.length !== 0) rebuild()
      insertTok()
      return
    }
    if (BLOCK_START[tid]) {
      if (pInButtonScope()) closeP()
      insertTok()
      return
    }
  }
  processStart()
}
const emitEnd = () => {
  tok = END
  skipNL = false
  const open = current
  if (
    mode === IN_BODY &&
    open.ns === HTML &&
    open.id === tid &&
    open.tag === tag &&
    !POP_SPECIAL[tid]
  ) {
    pop()
    return
  }
  processEnd()
}

// the end of a raw text element's text: where its end tag's '<' is, or -1
const matches = (at: number, name: string) => {
  for (let k = 0; k < name.length; k++)
    if ((html.charCodeAt(at + k) | 32) !== name.charCodeAt(k)) return false
  const c = html.charCodeAt(at + name.length)
  return c === 32 || c === 62 || c === 47 || c === 10 || c === 9 || c === 12
}
const rawEnd = (from: number) => {
  for (let at = html.indexOf('</', from); at >= 0; at = html.indexOf('</', at + 2))
    if (matches(at + 2, rawTag)) return at
  return -1
}
// a script ends at its first </script unless a <!-- comes first: then the script data escaped states decide
const scriptEnd = (from: number) => {
  let i = from
  for (;;) {
    const end = rawEnd(i)
    if (commentOpen < i) commentOpen = html.indexOf('<!--', i) >>> 0
    if (commentOpen >= n || (end >= 0 && commentOpen > end)) return end
    i = commentOpen + 4
    // escaped: 1, its dash 2, dash dash 3; double escaped: 4, 5, 6
    let st = 3
    for (; i < n; i++) {
      const c = html.charCodeAt(i)
      if (st <= 3) {
        if (c === 45) st = st === 1 ? 2 : 3
        else if (c === 60) {
          if (html.charCodeAt(i + 1) === 47) {
            if (matches(i + 2, 'script')) return i
            i++
          } else if (matches(i + 1, 'script')) {
            i += 7
            st = 4
            continue
          }
          st = 1
        } else if (c === 62 && st === 3) break
        else st = 1
      } else if (c === 45) st = st === 4 ? 5 : 6
      else if (c === 60) {
        if (html.charCodeAt(i + 1) === 47 && matches(i + 2, 'script')) {
          i += 8
          st = 1
          continue
        }
        st = 4
      } else if (c === 62 && st === 6) break
      else st = 4
    }
    if (i >= n) return -1
    // back in plain script data after the '>'
    i++
  }
}

// a doctype's text between '<!doctype' and its '>': whether it puts the page in quirks mode
const QUIRKS_PREFIXES = (
  '+//silmaril//dtd html pro v0r11 19970101//|-//as//dtd html 3.0 aswedit + extensions//|' +
  '-//advasoft ltd//dtd html 3.0 aswedit + extensions//|-//ietf//dtd html 2.0 level 1//|' +
  '-//ietf//dtd html 2.0 level 2//|-//ietf//dtd html 2.0 strict level 1//|-//ietf//dtd html 2.0 strict level 2//|' +
  '-//ietf//dtd html 2.0 strict//|-//ietf//dtd html 2.0//|-//ietf//dtd html 2.1e//|-//ietf//dtd html 3.0//|' +
  '-//ietf//dtd html 3.2 final//|-//ietf//dtd html 3.2//|-//ietf//dtd html 3//|-//ietf//dtd html level 0//|' +
  '-//ietf//dtd html level 1//|-//ietf//dtd html level 2//|-//ietf//dtd html level 3//|' +
  '-//ietf//dtd html strict level 0//|-//ietf//dtd html strict level 1//|-//ietf//dtd html strict level 2//|' +
  '-//ietf//dtd html strict level 3//|-//ietf//dtd html strict//|-//ietf//dtd html//|' +
  '-//metrius//dtd metrius presentational//|-//microsoft//dtd internet explorer 2.0 html strict//|' +
  '-//microsoft//dtd internet explorer 2.0 html//|-//microsoft//dtd internet explorer 2.0 tables//|' +
  '-//microsoft//dtd internet explorer 3.0 html strict//|-//microsoft//dtd internet explorer 3.0 html//|' +
  '-//microsoft//dtd internet explorer 3.0 tables//|-//netscape comm. corp.//dtd html//|' +
  "-//netscape comm. corp.//dtd strict html//|-//o'reilly and associates//dtd html 2.0//|" +
  "-//o'reilly and associates//dtd html extended 1.0//|-//o'reilly and associates//dtd html extended relaxed 1.0//|" +
  '-//sq//dtd html 2.0 hotmetal + extensions//|' +
  '-//softquad software//dtd hotmetal pro 6.0::19990601::extensions to html 4.0//|' +
  '-//softquad//dtd hotmetal pro 4.0::19971010::extensions to html 4.0//|-//spyglass//dtd html 2.0 extended//|' +
  '-//sun microsystems corp.//dtd hotjava html//|-//sun microsystems corp.//dtd hotjava strict html//|' +
  '-//w3c//dtd html 3 1995-03-24//|-//w3c//dtd html 3.2 draft//|-//w3c//dtd html 3.2 final//|-//w3c//dtd html 3.2//|' +
  '-//w3c//dtd html 3.2s draft//|-//w3c//dtd html 4.0 frameset//|-//w3c//dtd html 4.0 transitional//|' +
  '-//w3c//dtd html experimental 19960712//|-//w3c//dtd html experimental 970421//|-//w3c//dtd w3 html//|' +
  '-//w3o//dtd w3 html 3.0//|-//webtechs//dtd mozilla html 2.0//|-//webtechs//dtd mozilla html//'
).split('|')
const QUIRKS_NO_SYSTEM = [
  ...QUIRKS_PREFIXES,
  '-//w3c//dtd html 4.01 frameset//',
  '-//w3c//dtd html 4.01 transitional//',
]
const QUIRKS_IDS = new Set([
  '-//w3o//dtd w3 html strict 3.0//en//',
  '-/w3c/dtd html 4.0 transitional/en',
  'html',
])
const quirksOf = (name: string, publicId: string | null, systemId: string | null) => {
  if (name !== 'html') return true
  if (
    systemId !== null &&
    systemId.toLowerCase() === 'http://www.ibm.com/data/dtd/v11/ibmxhtml1-transitional.dtd'
  )
    return true
  if (publicId === null) return false
  const id = publicId.toLowerCase()
  if (QUIRKS_IDS.has(id)) return true
  return (systemId === null ? QUIRKS_NO_SYSTEM : QUIRKS_PREFIXES).some((prefix) =>
    id.startsWith(prefix),
  )
}
const doctypeIsQuirks = (text: string, eof: boolean) => {
  const length = text.length
  let i = 0
  const skip = () => {
    while (i < length && space(text.charCodeAt(i))) i++
  }
  skip()
  if (i >= length) return true
  const start = i
  while (i < length && !space(text.charCodeAt(i))) i++
  const name = lowerAscii(text.slice(start, i))
  skip()
  if (i >= length) return eof || quirksOf(name, null, null)
  const keyword = text.slice(i, i + 6).toLowerCase()
  if (keyword !== 'public' && keyword !== 'system') return true
  i += 6
  // a quoted identifier; null when what follows isn't one (the doctype is then bogus and forces quirks)
  const id = () => {
    skip()
    const q = text.charCodeAt(i)
    if (q !== 34 && q !== 39) return null
    const close = text.indexOf(q === 34 ? '"' : "'", i + 1)
    if (close < 0) return null
    const value = text.slice(i + 1, close).replaceAll('\0', '\uFFFD')
    i = close + 1
    return value
  }
  let publicId: string | null = null
  let systemId: string | null
  if (keyword === 'public') {
    publicId = id()
    if (publicId === null) return true
    skip()
    if (i >= length) return eof || quirksOf(name, publicId, null)
    systemId = id()
    if (systemId === null) return true
  } else {
    systemId = id()
    if (systemId === null) return true
  }
  skip()
  // anything after the system identifier makes a bogus doctype, but one that keeps what it read
  if (i >= length && eof) return true
  return quirksOf(name, publicId, systemId)
}

// after '<!': a comment, the doctype, cdata (in foreign content) or a bogus comment. where it ends
const markup = (i: number) => {
  if (html.charCodeAt(i) === 45 && html.charCodeAt(i + 1) === 45) {
    const end = commentEnd(i + 2)
    onComment(commentData(i + 2, end))
    return end
  }
  if (html.slice(i, i + 7).toLowerCase() === 'doctype') {
    const close = html.indexOf('>', i + 7)
    doctypeQuirks = doctypeIsQuirks(html.slice(i + 7, close < 0 ? n : close), close < 0)
    onDoctype()
    return close < 0 ? n : close + 1
  }
  if (html.startsWith('[CDATA[', i) && inForeign()) {
    const close = html.indexOf(']]>', i + 7)
    let text = html.slice(i + 7, close < 0 ? n : close)
    if (text.indexOf('\0') >= 0) text = text.replace(/\0+/g, '\uFFFD')
    if (text) chars(text)
    return close < 0 ? n : close + 3
  }
  const end = bogusEnd(i)
  onComment(bogusData(i, end))
  return end
}
const bogusEnd = (i: number) => {
  const close = html.indexOf('>', i)
  return close < 0 ? n : close + 1
}
// a comment's data from just after '<!--' to where it ends: none for <!--> and <!--->, else up to its --> or --!>,
// or to the end of the page, without the dashes (and !) the tokenizer was holding there
const commentData = (from: number, end: number) => {
  let data: string
  if (end === from + 1 || (end === from + 2 && html.charCodeAt(from) === 45)) data = ''
  else if (end < n || html.endsWith('-->') || html.endsWith('--!>'))
    data = html.slice(from, end - (html.charCodeAt(end - 2) === 33 ? 4 : 3))
  else {
    data = html.slice(from, n)
    data = data.endsWith('--!')
      ? data.slice(0, -3)
      : data.endsWith('--')
        ? data.slice(0, -2)
        : data.endsWith('-')
          ? data.slice(0, -1)
          : data
  }
  return data.indexOf('\0') >= 0 ? data.replaceAll('\0', '\uFFFD') : data
}
// a bogus comment's data: to its '>', or to the end of the page
const bogusData = (from: number, end: number) => {
  const data = html.slice(from, end === n && html.charCodeAt(n - 1) !== 62 ? n : end - 1)
  return data.indexOf('\0') >= 0 ? data.replaceAll('\0', '\uFFFD') : data
}
// a comment from just after '<!--': <!--> and <!---> end at once, then the first --> or --!>
const commentEnd = (i: number) => {
  if (html.charCodeAt(i) === 62) return i + 1
  if (html.charCodeAt(i) === 45 && html.charCodeAt(i + 1) === 62) return i + 2
  for (let at = html.indexOf('--', i); at >= 0; at = html.indexOf('--', at + 1)) {
    const c = html.charCodeAt(at + 2)
    if (c === 62) return at + 3
    if (c === 33 && html.charCodeAt(at + 3) === 62) return at + 4
  }
  return n
}

const tokenize = () => {
  const h = html
  const length = n
  let pos = 0
  // where the text not yet handed on starts: a '<' that starts nothing is text, and joins it
  let from = 0
  while (pos < length) {
    // past the cut, nothing more is read: the page is parsed again up to it
    if (cutAt >= 0) return
    if (tstate !== DATA) {
      if (tstate === PLAIN) {
        rawText(pos, length, false)
        return
      }
      const at = tstate === SCRIPT_DATA ? scriptEnd(pos) : rawEnd(pos)
      rawText(pos, at < 0 ? length : at, tstate === RCDATA)
      if (at < 0) return
      const end = tagEnd(at + 2 + rawTag.length)
      if (end < 0) return
      tstate = DATA
      tag = rawTag
      tid = IDS.get(rawTag) ?? 0
      emitEnd()
      pos = from = end
      continue
    }
    // the next '<' is often a few characters on: by hand that far, then indexOf
    // (a text read whole on the way, with no nul, needn't be read for one again)
    let lt = pos
    let c = 0
    const stop = pos + 8 < length ? pos + 8 : length
    while (lt < stop && (c = h.charCodeAt(lt)) !== 60 && c !== 0) lt++
    if (lt < stop && c === 60) {
      cleanFrom = pos
      clean = lt
    } else {
      clean = -1
      lt = h.indexOf('<', lt)
    }
    if (lt < 0) break
    c = h.charCodeAt(lt + 1)
    if (alpha(c)) {
      const to = readName(lt + 1)
      const end = tagEnd(to)
      dataText(from, lt)
      if (end < 0) return
      tagAt = lt
      emitStart(to, attrsEnd)
      pos = from = end
    } else if (c === 47) {
      const next = h.charCodeAt(lt + 2)
      if (alpha(next)) {
        // an end tag mostly closes the current node: its name read against that one, without a scan
        const open = current.tag
        let to = lt + 2 + open.length
        const after = h.charCodeAt(to)
        if (
          current.ns !== SVG &&
          (after === 62 ||
            after === 32 ||
            after === 47 ||
            after === 10 ||
            after === 9 ||
            after === 12) &&
          same(open, lt + 2)
        ) {
          tag = open
          tid = current.id
        } else to = readName(lt + 2)
        const end = tagEnd(to)
        dataText(from, lt)
        if (end < 0) return
        emitEnd()
        pos = from = end
      } else if (next === 62) {
        // </> is nothing at all: not even the end of a run of nuls either side of it
        const join = lt > from ? h.charCodeAt(lt - 1) === 0 : nulJoin
        dataText(from, lt)
        nulJoin = join
        pos = from = lt + 3
      } else if (lt + 2 >= length) pos = length
      else {
        dataText(from, lt)
        onComment()
        pos = from = bogusEnd(lt + 2)
      }
    } else if (c === 33) {
      dataText(from, lt)
      pos = from = markup(lt + 2)
    } else if (c === 63) {
      dataText(from, lt)
      onComment()
      pos = from = bogusEnd(lt + 1)
    } else pos = lt + 1
  }
  if (tstate === DATA) dataText(from, length)
}

// the Head, read from the elements watched as they were made: where each ended up, by the oracle's rules
// an html template's content is a fragment of its own, outside the element's text
const textOf = (el: El): string => {
  let out = ''
  for (const kid of el.kids)
    if (typeof kid === 'string') out += kid
    else if ((kid as El).id !== TEMPLATE || (kid as El).ns !== HTML) out += textOf(kid as El)
  return out
}
// where an element is in tree order: its child indexes from the root. inside svg nothing is kept, so an element there
// is where its nearest kept ancestor is (and after it, in the order made, which inside svg is tree order)
const position = (el: El) => {
  const path: number[] = []
  for (let x = el, up = el.up; up; x = up, up = up.up) {
    const at = up.kids.lastIndexOf(x)
    if (at < 0) path.length = 0
    else path.push(at)
  }
  return path.toReversed()
}
const treeOrder = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length && i < b.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
  return a.length - b.length
}
const readHead = (): Head => {
  const head: Head = { meta: new Map(), jsonLd: [] }
  let headTitle: string | undefined
  let anyTitle: string | undefined
  // made in tree order, unless something was inserted before or moved
  let order = watched
  if (reordered) {
    const places = new Map(watched.map((el) => [el, position(el)]))
    order = watched.toSorted((a, b) => treeOrder(places.get(a)!, places.get(b)!))
  }
  for (const el of order) {
    // in the document (not in a template's content, or a body a frameset threw out), and in what
    let inHead = false
    let inSvg = false
    let top: El = el
    let inside = true
    for (let up = el.up; up; top = up, up = up.up) {
      if (up.id === TEMPLATE && up.ns === HTML) inside = false
      if (up.tag === 'head') inHead = true
      else if (up.tag === 'svg') inSvg = true
    }
    if (!inside || top !== doc) continue
    if (el.tag === 'title') {
      if (inSvg) continue
      if (inHead) headTitle ??= textOf(el)
      anyTitle ??= textOf(el)
    } else if (el.tag === 'link') {
      if (inHead && attr(el, 'rel') === 'canonical') head.canonical ??= attr(el, 'href')
    } else if (el.tag === 'html' && el.ns === HTML) head.lang ??= attr(el, 'lang') || undefined
    else if (el.tag === 'meta') {
      for (const kind of ['name', 'property']) {
        const value = attr(el, kind)
        const key = `${kind} ${value}`
        if (value !== undefined && !head.meta.has(key))
          head.meta.set(key, attr(el, 'content') ?? '')
      }
    } else if (el.tag === 'script') {
      const value = textOf(el).trim()
      if (value) head.jsonLd.push(value)
    }
  }
  head.title = (headTitle ?? anyTitle)?.trim() || undefined
  return head
}

// each script's own text (its text children, not what's in an element inside it, which svg allows), for the scripts
// in the document: not in a template's content, or a body a frameset threw out
const readScripts = (): string[] =>
  scripts.flatMap((el) => {
    let top: El = el
    for (let up = el.up; up; top = up, up = up.up)
      if (up.id === TEMPLATE && up.ns === HTML) return []
    if (top !== doc) return []
    let text = ''
    for (const kid of el.kids) if (typeof kid === 'string') text += kid
    return [text]
  })

// whether an element is in the document as the tree pipeline's walk finds it: not in an html template's content (the
// walk doesn't go there), not in a body a frameset threw out
const inDocument = (el: El) => {
  let top: El = el
  for (let up = el.up; up; top = up, up = up.up)
    if (up.id === TEMPLATE && up.ns === HTML) return false
  return top === doc
}
const inTreeOrder = (els: El[]) => {
  if (!reordered || els.length < 2) return els
  const places = new Map(els.map((el) => [el, position(el)]))
  return els.toSorted((a, b) => treeOrder(places.get(a)!, places.get(b)!))
}
const moveStreamed = () => {
  // what the parser kept out of the tree, which the tree pipeline has: what's inside svg
  const reachable = new Set<El>()
  // without recursing: a page can nest deeper than the stack goes
  const unwalked: El[] = [doc]
  while (unwalked.length)
    for (const kid of unwalked.pop()!.kids)
      if (typeof kid !== 'string') {
        reachable.add(kid as El)
        if (!((kid as El).id === TEMPLATE && (kid as El).ns === HTML)) unwalked.push(kid as El)
      }
  const svgIds = new Set<string>()
  let svgTemplate = false
  for (const el of withIds)
    if (!reachable.has(el) && inDocument(el)) {
      svgIds.add(attr(el, 'id') ?? '')
      if (el.id === TEMPLATE) svgTemplate = true
    }
  const why = resolveStreamed({
    root: doc,
    // in tree order, which foster parenting and the adoption agency can make other than the order they were made in
    scripts: inTreeOrder(scripts.filter(inDocument)),
    textOf: (el) => textOf(el as El),
    content: (el) => (el as El).id === TEMPLATE && (el as El).ns === HTML,
    keeps: (el) => (el as El).rec >= 2,
    svgIds,
    svgTemplate,
    svgInstructed,
  })
  // what moved is in tree order no longer the order it was made in
  reordered = true
  return why
}

// the mains in the root's tree (under it, and in nothing dropped), in tree order
const readMains = (root: El) => {
  const found: El[] = []
  for (const el of mains) {
    let up: El | null = el
    while (up && up !== root && !DROP[up.id]) up = up.up
    if (up === root && el !== root) found.push(el)
  }
  if (found.length < 2) return found
  const places = new Map(found.map((el) => [el, position(el)]))
  return found.toSorted((a, b) => treeOrder(places.get(a)!, places.get(b)!))
}

// moves: false gives the tree as built, before react's streamed moves (the parser's own tests, against parse5)
// for tests: what sees the document once the streamed moves are made, before anything walks it, with the elements the
// parser still holds (its mains, scripts, and what has an id), which a move can leave outside the document (a test
// checks there that no move made a loop, in steps, and stops the parse if one did)
let afterMoves: ((doc: Element, held: Element[]) => void) | undefined
export const onMoved = (check: ((doc: Element, held: Element[]) => void) | undefined) => {
  afterMoves = check
}
// a page as md-core reads it. nothing of it outlives the call, read or thrown: the document holds what's read
export const parse = (input: string, nonce?: string, moves = true): Document => {
  try {
    return parsing(input, nonce, moves)
  } finally {
    letGo()
  }
}
const parsing = (input: string, nonce: string | undefined, moves: boolean): Document => {
  html = input.indexOf('\r') < 0 ? input : input.replace(/\r\n?/g, '\n')
  n = html.length
  tstate = DATA
  rawTag = ''
  doc = make('#root', 0, HTML, '', 0)
  stack = []
  current = doc
  pCount = 0
  tmplCount = 0
  afe = []
  tmplModes = []
  mode = INITIAL
  origMode = INITIAL
  quirks = false
  framesetOk = true
  foster = false
  skipNL = false
  headEl = formEl = htmlEl = bodyEl = null
  bodyGone = false
  pending = []
  pendingText = false
  watched = []
  mains = []
  scripts = []
  marked = false
  templated = false
  instructed = false
  svgInstructed = false
  withIds = []
  selector = false
  struck = false
  formInSplit = false
  formInCell = false
  nowrap = false
  nowrapSplit = false
  spanDiffers = false
  pruned.clear()
  splitIn = null
  splitAt = -1
  reordered = false
  deepest = 0
  tagAt = 0
  cutAt = -1
  tok = 0
  // found when first needed
  amp = -1
  commentOpen = -1
  tokenize()
  onEof()
  const scriptTexts = readScripts()
  // a swapped flight push's nonce is only for the flight check: what else reads a script's text (a json-ld block, a
  // foreign title) reads it empty, as the page reads without its flight data
  if (nonce)
    for (const el of scripts) {
      let text = ''
      for (const kid of el.kids) if (typeof kid === 'string') text += kid
      if (text === nonce) el.kids = el.kids.filter((kid) => typeof kid !== 'string')
    }
  // react's streamed boundaries moved into place, as the tree pipeline moves them, before anything reads the page
  // (next streams a dynamic page's metadata into the body): or why md-core can't
  // only a page with an instruction can move anything: a template's, or a script's $RC, $RR or $RS
  const moving =
    templated && moves && (instructed || scripts.some((el) => textOf(el).includes('$R')))
  const streamed = moving ? moveStreamed() : undefined
  afterMoves?.(doc, [...mains, ...scripts, ...withIds])
  // a page nested deeper than md reads is read as text there, as the tree pipeline reads it, once its flight data is
  // checked and its boundaries are moved (which read the whole page) and before anything else reads it. what was moved,
  // or put in place after something was made, may be deeper than it was made: then it's walked to find out
  const lost = (deepest > DEPTH || reordered || moving) && flatten(doc)
  const head = readHead()
  // the dropped elements leave the tree, and the text either side of one stays two texts, as the tree pipeline's prune
  // leaves them
  for (const el of pruned)
    el.kids = el.kids.filter((kid) => typeof kid === 'string' || !DROP[(kid as El).id])
  const root = bodyEl && !bodyGone ? bodyEl : doc
  const document: Document = {
    root,
    head,
    mains: readMains(root),
    scripts: scriptTexts,
    marked,
    streamed,
    selector,
    struck,
    formInSplit,
    formInCell,
    nowrapSplit,
    spanDiffers,
    cut: cutAt < 0 ? undefined : cutAt,
    lost,
  }
  root.tag = '#root'
  root.up = null
  return document
}
// the page let go: the tree holds slices of it, not the parse's state
const letGo = () => {
  html = tag = tattrs = ttext = ''
  NAME_CACHE.fill('')
  stack = []
  afe = []
  watched = []
  withIds = []
  mains = []
  scripts = []
  pruned.clear()
  splitIn = null
  pending = []
  current = doc = headEl = formEl = htmlEl = bodyEl = null as unknown as El
}
