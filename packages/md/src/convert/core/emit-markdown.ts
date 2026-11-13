import type { Element } from './types.ts'
// markdown from the emitter's lean tree, written the way mdast-util-to-markdown (MIT, Titus Wormer) writes an mdast
// tree with @affordances/md's options: bullet -, emphasis _, strong *, rule -, fenced code, and gfm (tables, task
// lists, strikethrough, autolink literals with their escapes kept to headings). its rules are ported one for one, over
// a construct bitmask instead of a stack of names, with a fast path for text that needs no escape

// node types: the phrasing ones are TEXT and up, so phrasing is a comparison
export const ROOT = 0
export const PARAGRAPH = 1
export const HEADING = 2
export const THEMATIC_BREAK = 3
export const BLOCKQUOTE = 4
export const LIST = 5
export const LIST_ITEM = 6
export const CODE = 7
export const TABLE = 8
export const TABLE_ROW = 9
export const TABLE_CELL = 10
export const HTML = 11
export const TEXT = 12
export const EMPHASIS = 13
export const STRONG = 14
export const DELETE = 15
export const INLINE_CODE = 16
export const BREAK = 17
export const LINK = 18
export const IMAGE = 19

// what never has children shares one empty list (never pushed to), so a text costs no array
const NO_KIDS: Md[] = []
const LEAF: boolean[] = []
for (const type of [TEXT, INLINE_CODE, BREAK, IMAGE, HTML, CODE, THEMATIC_BREAK]) LEAF[type] = true
// a node with no children in mdast
export const isLeaf = (node: Md) => LEAF[node.type] === true
// one shape for every node, so the walks over them stay monomorphic
export const MARKED_INLINE = 1
export const MARKED_BLOCK = 2

export class Md {
  type: number
  kids: Md[]
  // text, code, inline code, html; an image's alt
  value: string
  url: string
  title: string | null
  lang: string | null
  meta: string | null
  // a heading's depth, an ordered list's start; for html, whether it's a marker's markdown (an <AgentText>, a slot's
  // fill): MARKED_INLINE or MARKED_BLOCK, else 0
  depth: number
  ordered: boolean
  spread: boolean
  checked: boolean | null
  align: (string | null)[] | null
  rowSpan: number
  colSpan: number
  // its kids have been tidied (tidy below), which happens once, just before anything reads them
  clean: boolean
  // a block the fast path wrote already (emit-convert's fast): its markdown, as handle() would write it in a flow
  raw: string | null
  // and the element it was written from, to convert again the slow way if its children are ever asked for
  el: Element | null
  constructor(type: number, kids: Md[] = LEAF[type] ? NO_KIDS : [], value = '') {
    this.type = type
    this.kids = kids
    this.value = value
    this.url = ''
    this.title = null
    this.lang = null
    this.meta = null
    this.depth = 0
    this.ordered = false
    this.spread = false
    this.checked = null
    this.align = null
    this.rowSpan = 0
    this.colSpan = 0
    this.clean = false
    this.raw = null
    this.el = null
  }
}

// as hast-util-to-mdast's wrap reads it: mdast's phrasing, and a marker's inline markdown, which says it's a span
export const isPhrasing = (node: Md) =>
  node.type >= TEXT || (node.type === HTML && node.depth === MARKED_INLINE)

// what hast-util-to-mdast does last, to each node's children: adjacent texts as one, the line ending's spaces, a
// paragraph's (heading's, root's) outer spaces, and empty texts gone. it depends on nothing but the node's own
// children, so it's done to each node when its children are first read, while they're at hand, not in a pass of its own
const edgeSpace = (char: number) => char === 32 || char === 9
export const tidy = (parent: Md): Md[] => {
  const kids = parent.kids
  if (parent.clean) return kids
  parent.clean = true
  const type = parent.type
  const trims = type === PARAGRAPH || type === HEADING || type === ROOT
  for (let index = 0; index < kids.length; index++) {
    const item = kids[index]!
    if (item.type !== TEXT) continue
    const previous = kids[index - 1]
    if (previous?.type === TEXT) {
      previous.value += item.value
      previous.depth |= item.depth
      kids.splice(index, 1)
      index -= 2
      continue
    }
    let value = item.value
    if (item.depth !== 0 && (value.includes('\n') || value.includes('\r')))
      value = value.replace(/[\t ]*(\r?\n|\r)[\t ]*/, '$1')
    if (trims) {
      if (index === 0 && edgeSpace(value.charCodeAt(0))) value = value.replace(/^[\t ]+/, '')
      if (index === kids.length - 1 && edgeSpace(value.charCodeAt(value.length - 1)))
        value = value.replace(/[\t ]+$/, '')
    }
    item.value = value
    if (!value) {
      kids.splice(index, 1)
      index--
    }
  }
  return kids
}
// a node tidied all the way down, for what reads a whole subtree before it's written (a heading's setext test)
const tidyDeep = (node: Md) => {
  for (const kid of tidy(node)) if (kid.kids.length) tidyDeep(kid)
}

// constructs, as bits
const PHRASING = 1
const HEADING_ATX = 2
const LABEL = 4
const REFERENCE = 8
const AUTOLINK = 16
const DESTINATION_LITERAL = 32
const DESTINATION_RAW = 64
const TITLE_QUOTE = 128
const TITLE_APOSTROPHE = 256
const LANG_GRAVE = 512
const LANG_TILDE = 1024
const META_GRAVE = 2048
const META_TILDE = 4096
const TABLE_CELL_BIT = 8192
const LINK_BIT = 16384
const IMAGE_BIT = 32768
const STRIKETHROUGH = 65536
const BITS: Record<string, number> = {
  phrasing: PHRASING,
  headingAtx: HEADING_ATX,
  label: LABEL,
  reference: REFERENCE,
  autolink: AUTOLINK,
  destinationLiteral: DESTINATION_LITERAL,
  destinationRaw: DESTINATION_RAW,
  titleQuote: TITLE_QUOTE,
  titleApostrophe: TITLE_APOSTROPHE,
  codeFencedLangGraveAccent: LANG_GRAVE,
  codeFencedLangTilde: LANG_TILDE,
  codeFencedMetaGraveAccent: META_GRAVE,
  codeFencedMetaTilde: META_TILDE,
  tableCell: TABLE_CELL_BIT,
  link: LINK_BIT,
  image: IMAGE_BIT,
  strikethrough: STRIKETHROUGH,
}
const maskOf = (names: string[] | string | undefined) =>
  [names ?? []].flat().reduce((mask, name) => mask | (BITS[name] ?? 0), 0)

type Unsafe = {
  character: string
  inConstruct?: string | string[]
  notInConstruct?: string[]
  before?: string
  after?: string
  atBreak?: boolean
}
const FULL_PHRASING_SPANS = [
  'autolink',
  'destinationLiteral',
  'destinationRaw',
  'reference',
  'titleQuote',
  'titleApostrophe',
]
const LANG_META = [
  'codeFencedLangGraveAccent',
  'codeFencedLangTilde',
  'codeFencedMetaGraveAccent',
  'codeFencedMetaTilde',
]
// mdast-util-to-markdown's unsafe patterns, then gfm's: autolink literals (made heading-only, as @affordances/md
// does), footnotes, strikethrough, tables and task lists
const UNSAFE: Unsafe[] = [
  { character: '\t', after: '[\\r\\n]', inConstruct: 'phrasing' },
  { character: '\t', before: '[\\r\\n]', inConstruct: 'phrasing' },
  { character: '\t', inConstruct: ['codeFencedLangGraveAccent', 'codeFencedLangTilde'] },
  { character: '\r', inConstruct: [...LANG_META, 'destinationLiteral', 'headingAtx'] },
  { character: '\n', inConstruct: [...LANG_META, 'destinationLiteral', 'headingAtx'] },
  { character: '\r', before: '[\\r\\n]', inConstruct: 'phrasing' },
  { character: '\r', after: '\\r', inConstruct: 'phrasing' },
  { character: '\n', before: '\\n', inConstruct: 'phrasing' },
  { character: '\n', after: '[\\r\\n]', inConstruct: 'phrasing' },
  { character: ' ', after: '[\\r\\n]', inConstruct: 'phrasing' },
  { character: ' ', before: '[\\r\\n]', inConstruct: 'phrasing' },
  { character: ' ', inConstruct: ['codeFencedLangGraveAccent', 'codeFencedLangTilde'] },
  { character: '!', after: '\\[', inConstruct: 'phrasing', notInConstruct: FULL_PHRASING_SPANS },
  { character: '"', inConstruct: 'titleQuote' },
  { atBreak: true, character: '#' },
  { character: '#', inConstruct: 'headingAtx', after: '(?:[\r\n]|$)' },
  {
    character: '&',
    after: '[#A-Za-z]',
    inConstruct: [
      ...LANG_META,
      'destinationLiteral',
      'destinationRaw',
      'phrasing',
      'titleApostrophe',
      'titleQuote',
    ],
  },
  { character: "'", inConstruct: 'titleApostrophe' },
  { character: '(', inConstruct: 'destinationRaw' },
  { before: '\\]', character: '(', inConstruct: 'phrasing', notInConstruct: FULL_PHRASING_SPANS },
  { atBreak: true, before: '\\d+', character: ')' },
  { character: ')', inConstruct: 'destinationRaw' },
  { atBreak: true, character: '*', after: '(?:[ \t\r\n*])' },
  { character: '*', inConstruct: 'phrasing', notInConstruct: FULL_PHRASING_SPANS },
  { atBreak: true, character: '+', after: '(?:[ \t\r\n])' },
  { atBreak: true, character: '-', after: '(?:[ \t\r\n-])' },
  { atBreak: true, before: '\\d+', character: '.', after: '(?:[ \t\r\n]|$)' },
  { atBreak: true, character: '<', after: '[!/?A-Za-z]' },
  {
    character: '<',
    after: '[!/?A-Za-z]',
    inConstruct: 'phrasing',
    notInConstruct: FULL_PHRASING_SPANS,
  },
  { character: '<', inConstruct: 'destinationLiteral' },
  { atBreak: true, character: '=' },
  { atBreak: true, character: '>' },
  { character: '>', inConstruct: 'destinationLiteral' },
  { atBreak: true, character: '[' },
  { character: '[', inConstruct: 'phrasing', notInConstruct: FULL_PHRASING_SPANS },
  { character: '[', inConstruct: ['label', 'reference'] },
  { character: '\\', after: '[\\r\\n]', inConstruct: 'phrasing' },
  { character: ']', inConstruct: ['label', 'reference'] },
  { atBreak: true, character: '_' },
  { character: '_', inConstruct: 'phrasing', notInConstruct: FULL_PHRASING_SPANS },
  { atBreak: true, character: '`' },
  { character: '`', inConstruct: ['codeFencedLangGraveAccent', 'codeFencedMetaGraveAccent'] },
  { character: '`', inConstruct: 'phrasing', notInConstruct: FULL_PHRASING_SPANS },
  { atBreak: true, character: '~' },
  { character: '<', inConstruct: 'autolink' },
  { character: '>', inConstruct: 'autolink' },
  { character: '\u007F', inConstruct: 'autolink' },
  ...Array.from({ length: 33 }, (_, code) => ({
    character: String.fromCharCode(code),
    inConstruct: 'autolink',
  })),
  // gfm autolink literals, kept to headings
  {
    character: '@',
    before: '[+\\-.\\w]',
    after: '[\\-.\\w]',
    inConstruct: 'headingAtx',
    notInConstruct: ['autolink', 'link', 'image', 'label'],
  },
  {
    character: '.',
    before: '[Ww]',
    after: '[\\-.\\w]',
    inConstruct: 'headingAtx',
    notInConstruct: ['autolink', 'link', 'image', 'label'],
  },
  {
    character: ':',
    before: '[ps]',
    after: '\\/',
    inConstruct: 'headingAtx',
    notInConstruct: ['autolink', 'link', 'image', 'label'],
  },
  // footnotes
  { character: '[', inConstruct: ['label', 'phrasing', 'reference'] },
  // strikethrough
  {
    character: '~',
    inConstruct: 'phrasing',
    notInConstruct: [
      'autolink',
      'destinationLiteral',
      'destinationRaw',
      'reference',
      'titleQuote',
      'titleApostrophe',
    ],
  },
  // tables
  { character: '\r', inConstruct: 'tableCell' },
  { character: '\n', inConstruct: 'tableCell' },
  { atBreak: true, character: '|', after: '[\t :-]' },
  { character: '|', inConstruct: 'tableCell' },
  { atBreak: true, character: ':', after: '-' },
  { atBreak: true, character: '-', after: '[:|-]' },
  // task lists
  { atBreak: true, character: '-', after: '[:|-]' },
]

type Pattern = {
  character: string
  in: number
  notIn: number
  // matches only next to a line ending: never in a value without one
  newline: boolean
  // whether it has a before (or is atBreak), or an after
  before: boolean
  after: boolean
  regex: RegExp
  // the before and after as sets of ascii codes, when each is one character of a class (null: none, or not that)
  beforeSet: Uint8Array | null
  afterSet: Uint8Array | null
  simple: boolean
}
// a pattern's one-character class as a set of ascii codes; undefined when it isn't one (\d+, $, …). nothing past
// ascii is in any of them, as the regexes have no u flag and name ascii classes only
const charSet = (source: string | undefined): Uint8Array | null | undefined => {
  if (source === undefined) return null
  if (/[+*$|]/.test(source.replace(/\\./g, ''))) return undefined
  const regex = new RegExp(`^(?:${source})$`)
  if (regex.test('é') || regex.test('ab')) return undefined
  const set = new Uint8Array(128)
  for (let code = 0; code < 128; code++) if (regex.test(String.fromCharCode(code))) set[code] = 1
  return set
}
const NEWLINE_ONLY = new Set(['[\\r\\n]', '\\n', '\\r'])
const PATTERNS: Pattern[] = UNSAFE.map((pattern) => {
  const before =
    (pattern.atBreak ? '[\\r\\n][\\t ]*' : '') + (pattern.before ? `(?:${pattern.before})` : '')
  return {
    character: pattern.character,
    // no inConstruct: always in scope
    in: pattern.inConstruct === undefined ? -1 : maskOf(pattern.inConstruct),
    notIn: maskOf(pattern.notInConstruct),
    newline:
      Boolean(pattern.atBreak) ||
      NEWLINE_ONLY.has(pattern.before ?? '') ||
      NEWLINE_ONLY.has(pattern.after ?? ''),
    before: 'before' in pattern || Boolean(pattern.atBreak),
    after: 'after' in pattern,
    beforeSet: charSet(pattern.before) ?? null,
    afterSet: charSet(pattern.after) ?? null,
    simple:
      !pattern.atBreak &&
      charSet(pattern.before) !== undefined &&
      charSet(pattern.after) !== undefined,
    regex: new RegExp(
      (before ? `(${before})` : '') +
        (/[$()*+.?[\\\]^{|}]/.test(pattern.character) ? '\\' : '') +
        pattern.character +
        (pattern.after ? `(?:${pattern.after})` : ''),
      'g',
    ),
  }
})

// the patterns in scope for a set of constructs, and a test for text that none of them (or a backslash) can touch
type Scope = {
  patterns: Pattern[]
  special: RegExp
  bareNewline: boolean
  // for the scan: each ascii character's patterns (those that need no line ending), when all are one character on
  // either side; undefined where a pattern's regex could swallow a neighbour another match needs (headings)
  byChar: (Pattern[] | undefined)[] | undefined
}
const scopes = new Map<number, Scope>()
// the last scope asked for: text after text is usually in the same constructs
let lastMask = -1
let lastScope: Scope | undefined
const scopeOf = (mask: number): Scope => {
  if (mask === lastMask) return lastScope!
  let scope = scopes.get(mask)
  if (scope) {
    lastMask = mask
    lastScope = scope
    return scope
  }
  const patterns = PATTERNS.filter(
    (pattern) => (pattern.in === -1 || (pattern.in & mask) !== 0) && (pattern.notIn & mask) === 0,
  )
  const chars = new Set(['\\'])
  for (const pattern of patterns) if (!pattern.newline) chars.add(pattern.character)
  const set = [...chars]
    .map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .join('')
  let byChar: (Pattern[] | undefined)[] | undefined = []
  if ((mask & HEADING_ATX) !== 0) byChar = undefined
  for (const pattern of patterns) {
    if (pattern.newline || !byChar) continue
    const code = pattern.character.charCodeAt(0)
    if (!pattern.simple || code >= 128) byChar = undefined
    else (byChar[code] ??= []).push(pattern)
  }
  scope = {
    patterns,
    byChar,
    special: new RegExp(`[${set}\\r\\n]`),
    bareNewline: patterns.some(
      (pattern) => pattern.character === '\n' && !pattern.before && !pattern.after,
    ),
  }
  scopes.set(mask, scope)
  return scope
}

// the serializer's state: the constructs it's in, as names (the list handler reads them) and as a mask
let stack: string[] = []
let masks: number[] = []
let mask = 0
let indexStack: number[] = []
let bulletCurrent: string | undefined
let bulletLastUsed: string | undefined
const enter = (name: string) => {
  stack.push(name)
  masks.push(mask)
  mask |= BITS[name] ?? 0
}
const exit = () => {
  stack.pop()
  mask = masks.pop()!
}

// micromark's classes: 1 whitespace, 2 punctuation, 0 anything else (a letter, a digit, a lone surrogate)
const PUNCTUATION = /[\p{P}\p{S}]/u
const WHITESPACE = /\s/
const classes = new Uint8Array(128)
for (let code = 0; code < 128; code++) {
  const char = String.fromCharCode(code)
  classes[code] = code === 32 || WHITESPACE.test(char) ? 1 : PUNCTUATION.test(char) ? 2 : 0
}
const classify = (code: number): number => {
  if (code !== code) return 0
  if (code < 128) return classes[code]!
  const char = String.fromCharCode(code)
  return WHITESPACE.test(char) ? 1 : PUNCTUATION.test(char) ? 2 : 0
}

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/
const reference = (code: number) => `&#x${code.toString(16).toUpperCase()};`
// a string's first and last code points
const high = (code: number) => code >= 0xd800 && code <= 0xdbff
const low = (code: number) => code >= 0xdc00 && code <= 0xdfff
const firstCharacter = (value: string) =>
  high(value.charCodeAt(0)) && low(value.charCodeAt(1)) ? value.slice(0, 2) : value.charAt(0)
const lastCharacter = (value: string) => {
  const n = value.length
  return n > 1 && low(value.charCodeAt(n - 1)) && high(value.charCodeAt(n - 2))
    ? value.slice(-2)
    : value.charAt(n - 1)
}
const isNewline = (code: number) => code === 10 || code === 13

const escapeBackslashes = (value: string, after: string) => {
  if (value.indexOf('\\') < 0 && after.indexOf('\\') < 0) return value
  const expression = /\\(?=[!-/:-@[-`{-~])/g
  const whole = value + after
  const results: string[] = []
  let start = 0
  let match
  while ((match = expression.exec(whole))) {
    if (start !== match.index) results.push(value.slice(start, match.index))
    results.push('\\')
    start = match.index
  }
  results.push(value.slice(start))
  return results.join('')
}

// text made safe to write between before and after in the current constructs: mdast-util-to-markdown's safe()
// whether what safe() last wrote ends with its input's last character (so that's what follows it), when it isn't
// the input itself
let endsAsInput = false
const safe = (input: string, before: string, after: string, encode = ''): string => {
  endsAsInput = false
  if (input === '') return escapeBackslashes(input, after)
  const scope = scopeOf(mask)
  // the fast path: nothing a pattern could match, and no line ending beside the text to start a construct
  if (!scope.special.test(input)) {
    const head = input.charCodeAt(0)
    const tail = input.charCodeAt(input.length - 1)
    const lineBefore = before !== '' && isNewline(before.charCodeAt(before.length - 1))
    const lineAfter = after !== '' && isNewline(after.charCodeAt(0))
    if (
      !(lineBefore && atLineStart(input, head)) &&
      !(lineAfter && (tail === 32 || tail === 9 || tail === 35)) &&
      !(after === '' && tail === 46)
    )
      return input
  }
  return scope.byChar && scannable(input, before, after)
    ? scanSafe(scope.byChar, input, before, after, encode)
    : slowSafe(scope, input, before, after, encode)
}
// whether no pattern that needs a line ending can match: none in the text, and none beside it that the text's
// edges could use
const scannable = (input: string, before: string, after: string) => {
  if (/[\r\n]/.test(input)) return false
  if (
    before !== '' &&
    isNewline(before.charCodeAt(before.length - 1)) &&
    atLineStart(input, input.charCodeAt(0))
  )
    return false
  if (after !== '' && isNewline(after.charCodeAt(0))) {
    const tail = input.charCodeAt(input.length - 1)
    if (tail === 32 || tail === 9 || tail === 92) return false
  }
  return true
}
const sidesOf = (pattern: Pattern) => (pattern.before ? 1 : 0) | (pattern.after ? 2 : 0)
// safe() as one pass over the text: each character's patterns asked of its neighbours, then the same rules as
// slowSafe. only for text no line ending can reach (scannable), in a scope with one-character patterns
// what the patterns say of the character at i: -1 nothing matches; else 1 if every match there had a before, | 2 if
// every one had an after
const matchAt = (
  byChar: (Pattern[] | undefined)[],
  input: string,
  i: number,
  previous: number,
  next: number,
) => {
  const code = input.charCodeAt(i)
  if (code >= 128) return -1
  const list = byChar[code]
  if (list === undefined) return -1
  let bits = -1
  for (let k = 0; k < list.length; k++) {
    const pattern = list[k]!
    if (pattern.beforeSet) {
      const b = i ? input.charCodeAt(i - 1) : previous
      if (b < 0 || b >= 128 || pattern.beforeSet[b] !== 1) continue
    }
    if (pattern.afterSet) {
      const a = i + 1 < input.length ? input.charCodeAt(i + 1) : next
      if (a < 0 || a >= 128 || pattern.afterSet[a] !== 1) continue
    }
    bits = bits < 0 ? sidesOf(pattern) : bits & sidesOf(pattern)
  }
  return bits
}
export const scanSafe = (
  byChar: (Pattern[] | undefined)[],
  input: string,
  before: string,
  after: string,
  encode: string,
) => {
  const n = input.length
  const previous = before === '' ? -1 : before.charCodeAt(before.length - 1)
  const next = after === '' ? -1 : after.charCodeAt(0)
  // a backslash only needs doubling before punctuation, and only if there is one
  const slashes = input.indexOf('\\') >= 0
  let result = ''
  let start = 0
  for (let i = 0; i < n; i++) {
    const info = matchAt(byChar, input, i, previous, next)
    if (info < 0) continue
    // an intraword underscore run (snake_case) needs no escape
    if (input.charCodeAt(i) === 95 && (i > 0 || before !== '')) {
      const back = i ? input.charCodeAt(i - 1) : previous
      if (classify(back) === 0 && !(i === 1 && (previous === 42 || previous === 95))) {
        let sequenceEnd = i + 1
        while (sequenceEnd < n && input.charCodeAt(sequenceEnd) === 95) sequenceEnd++
        let all = true
        for (let k = i + 1; k < sequenceEnd && all; k++)
          all = matchAt(byChar, input, k, previous, next) >= 0
        if (
          all &&
          (sequenceEnd < n || after !== '') &&
          classify(sequenceEnd < n ? input.charCodeAt(sequenceEnd) : next) === 0 &&
          !(sequenceEnd === n - 1 && (next === 42 || next === 95))
        ) {
          i = sequenceEnd - 1
          continue
        }
      }
    }
    // escaping what follows (or precedes) is enough
    if (
      (info & 2 && i + 1 < n && matchAt(byChar, input, i + 1, previous, next) === 0) ||
      (info & 1 && i > 0 && matchAt(byChar, input, i - 1, previous, next) === 0)
    )
      continue
    if (start !== i)
      result += slashes ? escapeBackslashes(input.slice(start, i), '\\') : input.slice(start, i)
    start = i + 1
    const char = input.charAt(i)
    result +=
      ASCII_PUNCTUATION.test(char) && !encode.includes(char)
        ? '\\' + char
        : reference(input.charCodeAt(i))
  }
  const tail = slashes || after.indexOf('\\') >= 0
  if (start === 0) return tail ? escapeBackslashes(input, after) : input
  const rest = start < n ? input.slice(start) : ''
  // the text's own last character ends what's written, unless an escape does
  endsAsInput = rest !== '' && !tail
  return result + (tail ? escapeBackslashes(rest, after) : rest)
}
// the slow path, for tests: safe() by the regexes, whatever the text
export const regexSafe = (
  names: string[],
  input: string,
  before: string,
  after: string,
  encode = '',
) => slowSafe(scopeOf(maskOf(names)), input, before, after, encode)
export const scannedSafe = (
  names: string[],
  input: string,
  before: string,
  after: string,
  encode = '',
) => {
  const scope = scopeOf(maskOf(names))
  return scope.byChar && scannable(input, before, after)
    ? scanSafe(scope.byChar, input, before, after, encode)
    : undefined
}
// what can start a construct at the start of a line: an atBreak pattern's character, a digit (an ordered list), or
// whitespace
const LINE_START = new Uint8Array(128)
for (const char of '#)*+-.<=>[_`~|: \t0123456789') LINE_START[char.charCodeAt(0)] = 1
const atLineStart = (input: string, head: number) =>
  head < 128 && LINE_START[head] === 1 && input !== ''

const slowSafe = (scope: Scope, input: string, before: string, after: string, encode: string) => {
  // what came before matters only from its last line ending (atBreak), or as one character
  if (before.length > 1) {
    const line = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'))
    before = line >= 0 ? before.slice(line) : before.slice(-1)
  }
  const value = before + input + after
  const offset = before.length
  const end = value.length - after.length
  const hasNewline = /[\r\n]/.test(value)
  const positions: number[] = []
  // per position matched: whether every pattern there had a before (1), an after (2)
  const infos = new Map<number, number>()
  for (const pattern of scope.patterns) {
    if (pattern.newline && !hasNewline) continue
    if (input.indexOf(pattern.character) < 0) continue
    const expression = pattern.regex
    expression.lastIndex = 0
    const sides = (pattern.before ? 1 : 0) | (pattern.after ? 2 : 0)
    let match
    while ((match = expression.exec(value))) {
      const position = match.index + (pattern.before ? match[1]!.length : 0)
      const info = infos.get(position)
      if (info === undefined) {
        positions.push(position)
        infos.set(position, sides)
      } else infos.set(position, info & sides)
    }
  }
  if (!positions.length) return escapeBackslashes(input, after)
  positions.sort((a, b) => a - b)
  const result: string[] = []
  let start = offset
  for (let index = 0; index < positions.length; index++) {
    const position = positions[index]!
    if (position < start || position >= end) continue
    // an intraword underscore run (snake_case) needs no escape
    if (
      value.charCodeAt(position) === 95 &&
      position > 0 &&
      classify(value.charCodeAt(position - 1)) === 0 &&
      !infos.has(position - 1) &&
      !(position - 1 === offset && /[*_]/.test(value.charAt(offset - 1)))
    ) {
      let sequenceEnd = position + 1
      while (sequenceEnd < end && value.charCodeAt(sequenceEnd) === 95) sequenceEnd++
      const skip = sequenceEnd - position - 1
      if (
        positions[index + skip] === sequenceEnd - 1 &&
        sequenceEnd < value.length &&
        classify(value.charCodeAt(sequenceEnd)) === 0 &&
        !infos.has(sequenceEnd) &&
        !(sequenceEnd === end - 1 && /[*_]/.test(value.charAt(end)))
      ) {
        index += skip
        continue
      }
    }
    const info = infos.get(position)!
    // escaping what follows (or precedes) is enough
    if (
      (position + 1 < end &&
        positions[index + 1] === position + 1 &&
        info & 2 &&
        infos.get(position + 1) === 0) ||
      (position - 1 >= offset &&
        positions[index - 1] === position - 1 &&
        info & 1 &&
        infos.get(position - 1) === 0)
    )
      continue
    if (start !== position) result.push(escapeBackslashes(value.slice(start, position), '\\'))
    start = position + 1
    const char = value.charAt(position)
    result.push(
      ASCII_PUNCTUATION.test(char) && !encode.includes(char)
        ? '\\' + char
        : reference(value.charCodeAt(position)),
    )
  }
  result.push(escapeBackslashes(value.slice(start, end), after))
  return result.join('')
}

// emphasis, strong and strikethrough: attention whose markers are chosen once the run around them is known
type Attention = { children: Item[]; sequences: string[] }
type Item = string | Attention
type Token = { value: string; attention: Attention | undefined }

const attentionItem = (node: Md): Attention => {
  const [construct, sequences] =
    node.type === EMPHASIS
      ? ['emphasis', EMPHASIS_SEQUENCES]
      : node.type === STRONG
        ? ['strong', STRONG_SEQUENCES]
        : ['strikethrough', DELETE_SEQUENCES]
  const sequence = sequences[0]!
  enter(construct)
  const children = phrasing(node, sequence, sequence)
  exit()
  return { children, sequences }
}
const EMPHASIS_SEQUENCES = ['_', '*']
const STRONG_SEQUENCES = ['**', '__']
const DELETE_SEQUENCES = ['~~', '~']
const isAttention = (node: Md) =>
  node.type === EMPHASIS || node.type === STRONG || node.type === DELETE

const encodeEdge = (tokens: Token[], start: boolean) => {
  const token = tokens[start ? 0 : tokens.length - 1]
  if (!token || token.attention) return
  const character = start ? firstCharacter(token.value) : lastCharacter(token.value)
  const ref = reference(character.codePointAt(0)!)
  if (start) token.value = ref + token.value.slice(character.length)
  else {
    let value = token.value.slice(0, token.value.length - character.length)
    let escapes = 0
    while (value.charCodeAt(value.length - 1 - escapes) === 92) escapes++
    if (escapes % 2) value += '\\'
    token.value = value + ref
  }
}

const encodeInfo = (outside: number, inside: number, marker: string) => {
  const outsideKind = classify(outside)
  const insideKind = classify(inside)
  if (outsideKind === 0)
    return insideKind === 0 ? (marker === '_' ? BOTH : NEITHER) : insideKind === 1 ? BOTH : OUTSIDE
  if (outsideKind === 1) return insideKind === 1 ? BOTH : NEITHER
  return insideKind === 1 ? INSIDE : NEITHER
}
const BOTH = { inside: true, outside: true }
const NEITHER = { inside: false, outside: false }
const OUTSIDE = { inside: false, outside: true }
const INSIDE = { inside: true, outside: false }

const render = (
  items: Item[],
  chosen: Map<Attention, string>,
  before: string,
  after: string,
): Token[] => {
  const tokens: Token[] = []
  let encodeAfter: string | undefined
  let previous = lastCharacter(before)
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    if (typeof item === 'string') {
      const token: Token = { value: item, attention: undefined }
      if (encodeAfter && encodeAfter === firstCharacter(item)) encodeEdge([token], true)
      encodeAfter = undefined
      tokens.push(token)
      if (token.value) previous = lastCharacter(token.value)
      continue
    }
    const sequence = chosen.get(item) || item.sequences[0]!
    const marker = sequence.charAt(0)
    const next = items[index + 1]
    const outsideBefore = previous
    const outsideAfter = firstCharacter(
      next === undefined
        ? after
        : typeof next === 'string'
          ? next
          : chosen.get(next) || next.sequences[0]!,
    )
    const inside = render(item.children, chosen, sequence, sequence)
    const head = inside.length > 0 ? inside[0]!.value : ''
    const open = encodeInfo(
      outsideBefore.charCodeAt(outsideBefore.length - 1),
      head.charCodeAt(0),
      marker,
    )
    if (open.inside) encodeEdge(inside, true)
    const tail = inside.length > 0 ? lastCharacter(inside[inside.length - 1]!.value) : ''
    const close = encodeInfo(outsideAfter.charCodeAt(0), tail.charCodeAt(tail.length - 1), marker)
    if (close.inside) encodeEdge(inside, false)
    if (open.outside && outsideBefore !== '\n' && outsideBefore !== '\r') encodeEdge(tokens, false)
    if (close.outside) encodeAfter = outsideAfter
    tokens.push({ value: sequence, attention: item }, ...inside, {
      value: sequence,
      attention: item,
    })
    previous = sequence.charAt(sequence.length - 1)
  }
  return tokens
}

type Run = {
  tokens: Token[]
  markers: Token[]
  start: number
  end: number
  open: boolean
  close: boolean
  split: boolean
}
const STRICT = new Map([
  ['*', false],
  ['_', true],
])
const check = (tokens: Token[], before: string, after: string) => {
  const runs: Run[] = []
  const wrong = new Map<Token, Token[]>()
  const runOf = new Map<Token, Run>()
  let index = 0
  while (index < tokens.length) {
    if (!tokens[index]!.attention) {
      index++
      continue
    }
    const marker = tokens[index]!.value.charAt(0)
    const strict = STRICT.get(marker)
    let end = index + 1
    while (end < tokens.length && tokens[end]!.attention && tokens[end]!.value.charAt(0) === marker)
      end++
    const head = index ? tokens[index - 1]!.value : before
    const previous = classify(head.charCodeAt(head.length - 1))
    const next = classify((end < tokens.length ? tokens[end]!.value : after).charCodeAt(0))
    const open = !next || (next === 2 && Boolean(previous))
    const close = !previous || (previous === 2 && Boolean(next))
    const run: Run = {
      tokens: tokens.slice(index, end),
      markers: [],
      start: 0,
      end: 0,
      open: strict ? open && (Boolean(previous) || !close) : open,
      close: strict ? close && (Boolean(next) || !open) : close,
      split: strict !== undefined,
    }
    for (const token of run.tokens) {
      wrong.set(token, [...run.tokens])
      runOf.set(token, run)
      let size = token.value.length
      while (size--) run.markers.push(token)
    }
    run.end = run.markers.length
    runs.push(run)
    index = end
  }
  pair(runs, wrong)
  for (index = 0; index < tokens.length; index++) {
    const involved = wrong.get(tokens[index]!)
    if (involved) return { attention: candidates(tokens, involved, runOf), index }
  }
  return undefined
}

const candidates = (tokens: Token[], involved: Token[], runOf: Map<Token, Run>) => {
  const related = new Set<Attention>()
  for (const token of tokens) {
    const siblings = runOf.get(token)
    if (siblings && token.attention && involved.some((d) => d.attention === token.attention))
      for (const sibling of siblings.tokens) related.add(sibling.attention!)
  }
  const ordered: Attention[] = []
  for (const token of tokens)
    if (token.attention && related.delete(token.attention)) ordered.push(token.attention)
  ordered.reverse()
  return ordered
}

const pair = (runs: Run[], wrong: Map<Token, Token[]>) => {
  const openersByMarker = new Map<string, Run[]>()
  for (const closer of runs) {
    const marker = closer.tokens[0]!.value.charAt(0)
    let openers = openersByMarker.get(marker)
    if (!openers) openersByMarker.set(marker, (openers = []))
    let open = closer.close ? openers.length : 0
    while (open-- && closer.start < closer.end) {
      const opener = openers[open]!
      const openerSize = opener.end - opener.start
      const closerSize = closer.end - closer.start
      if (
        closer.split
          ? (opener.close || closer.open) && closerSize % 3 && !((openerSize + closerSize) % 3)
          : openerSize !== opener.markers.length || openerSize !== closerSize
      )
        continue
      const size = closer.split ? (openerSize > 1 && closerSize > 1 ? 2 : 1) : closerSize
      const opening = opener.markers.slice(opener.end - size, opener.end)
      const closing = closer.markers.slice(closer.start, closer.start + size)
      const openToken = opening[0]!
      const closeToken = closing[0]!
      if (
        openToken === opening[size - 1] &&
        openToken.value.length === size &&
        closeToken === closing[size - 1] &&
        closeToken.value.length === size &&
        openToken.attention === closeToken.attention
      ) {
        wrong.delete(openToken)
        wrong.delete(closeToken)
      } else {
        const involved = [...new Set([...opening, ...closing])]
        for (const token of involved) {
          const list = wrong.get(token)
          if (list) list.push(...involved)
        }
      }
      opener.end -= size
      closer.start += size
      if (opener.start === opener.end) openers.splice(open, 1)
      open = openers.length
    }
    if (closer.open && closer.start < closer.end) openers.push(closer)
  }
}

const improve = (
  items: Item[],
  chosen: Map<Attention, string>,
  mistake: { attention: Attention[]; index: number },
  before: string,
  after: string,
) => {
  for (const attention of mistake.attention) {
    const current = chosen.get(attention) || attention.sequences[0]
    for (const sequence of attention.sequences) {
      if (sequence === current) continue
      const trial = new Map(chosen)
      trial.set(attention, sequence)
      const tokens = render(items, trial, before, after)
      const next = check(tokens, before, after)
      if (!next || next.index > mistake.index) return { chosen: trial, mistake: next, tokens }
    }
  }
  return undefined
}

// whether check() would find nothing wrong, answered without its bookkeeping for the usual shape: every attention
// run a single sequence, properly nested, each opener able to open and each closer to close. false means "ask check"
const pending: Attention[][] = [[], [], []]
const stackOf = (marker: number) => pending[marker === 42 ? 0 : marker === 95 ? 1 : 2]!
const fastValid = (tokens: Token[], before: string, after: string): boolean => {
  pending[0]!.length = 0
  pending[1]!.length = 0
  pending[2]!.length = 0
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    if (!token.attention) continue
    const marker = token.value.charCodeAt(0)
    const left = index > 0 ? tokens[index - 1]! : undefined
    const right = index + 1 < tokens.length ? tokens[index + 1]! : undefined
    // a run of more than one sequence is check's to read
    if (left?.attention && left.value.charCodeAt(0) === marker) return false
    if (right?.attention && right.value.charCodeAt(0) === marker) return false
    const head = left ? left.value : before
    const previous = classify(head.charCodeAt(head.length - 1))
    const next = classify((right ? right.value : after).charCodeAt(0))
    let open = !next || (next === 2 && Boolean(previous))
    let close = !previous || (previous === 2 && Boolean(next))
    if (marker === 95) {
      const opens = open && (Boolean(previous) || !close)
      close = close && (Boolean(next) || !open)
      open = opens
    }
    const opened = stackOf(marker)
    if (opened[opened.length - 1] === token.attention) {
      if (!close) return false
      opened.pop()
    } else {
      if (!open || (close && opened.length)) return false
      opened.push(token.attention)
    }
  }
  return !pending[0]!.length && !pending[1]!.length && !pending[2]!.length
}
// for tests: whether fastValid and check agree on these items
export const attentionAgrees = (items: Item[], before: string, after: string) => {
  const tokens = render(items, new Map(), before, after)
  return !fastValid(tokens, before, after) || check(tokens, before, after) === undefined
}
export type { Attention, Item }

const serialize = (items: Item[], before: string, after: string) => {
  let plain = true
  for (const item of items)
    if (typeof item !== 'string') {
      plain = false
      break
    }
  if (plain) return items.join('')
  let chosen = new Map<Attention, string>()
  const initial = render(items, chosen, before, after)
  if (fastValid(initial, before, after)) {
    let joined = ''
    for (let i = 0; i < initial.length; i++) joined += initial[i]!.value
    return joined
  }
  let tokens = initial
  let mistake = check(tokens, before, after)
  while (mistake) {
    const next = improve(items, chosen, mistake, before, after)
    if (!next) {
      tokens = initial
      break
    }
    chosen = next.chosen
    tokens = next.tokens
    mistake = next.mistake
  }
  let result = ''
  for (const token of tokens) result += token.value
  return result
}

// the first character a node writes, for the text before it
const peek = (node: Md, parent: Md): string => {
  switch (node.type) {
    case EMPHASIS:
      return '_'
    case STRONG:
      return '*'
    case DELETE:
      return '~'
    case LINK:
      return autolinked(node) ? '<' : '['
    case IMAGE:
      return '!'
    case INLINE_CODE:
      return '`'
    case HTML:
      return '<'
    case TEXT: {
      // a text's first character is written as it is unless a pattern can escape it there: only its own character
      // and the one after it can say
      const value = node.value
      const head = value.charCodeAt(0)
      if (
        value !== '' &&
        !scopeOf(mask).special.test(value.charAt(0)) &&
        !((head === 32 || head === 9) && isNewline(value.charCodeAt(1)))
      )
        return firstCharacter(value)
      return firstCharacter(handle(node, parent, '', ''))
    }
    default:
      return firstCharacter(handle(node, parent, '', ''))
  }
}

const phrasing = (parent: Md, before: string, after: string): Item[] => {
  const kids = tidy(parent)
  const results: Item[] = []
  indexStack.push(-1)
  for (let index = 0; index < kids.length; index++) {
    const child = kids[index]!
    indexStack[indexStack.length - 1] = index
    const next = index + 1 < kids.length ? firstCharacter(peek(kids[index + 1]!, parent)) : after
    if (isAttention(child)) {
      const item = attentionItem(child)
      results.push(item)
      before = lastCharacter(item.sequences[0]!)
    } else {
      const value = handle(child, parent, before, next)
      if (!value) continue
      results.push(value)
      // what a link, an image or inline code ends with is known, without reading what was written
      before =
        child.type === LINK
          ? autolinked(child)
            ? '>'
            : ')'
          : child.type === IMAGE
            ? ')'
            : child.type === INLINE_CODE
              ? '`'
              : child.type === TEXT && (value === child.value || endsAsInput)
                ? lastCharacter(child.value)
                : lastCharacter(value)
    }
  }
  indexStack.pop()
  return results
}
const containerPhrasing = (parent: Md, before: string, after: string) =>
  serialize(phrasing(parent, before, after), before, after)

const containerFlow = (parent: Md): string => {
  const kids = tidy(parent)
  let result = ''
  indexStack.push(-1)
  for (let index = 0; index < kids.length; index++) {
    const child = kids[index]!
    indexStack[indexStack.length - 1] = index
    result += handle(child, parent, '\n', '\n')
    if (child.type !== LIST) bulletLastUsed = undefined
    if (index < kids.length - 1) result += between(child, kids[index + 1]!, parent)
  }
  indexStack.pop()
  return result
}

// the blank line between two blocks, or a single line ending in a tight list
const between = (left: Md, right: Md, parent: Md) => {
  if (parent.type !== LIST && parent.type !== LIST_ITEM) return '\n\n'
  if (parent.spread) return '\n\n'
  if (left.type === HTML) {
    const kind = htmlKind(left.value)
    if (kind === undefined || kind === 6 || kind === 7) return '\n\n'
  }
  if (left.type === BLOCKQUOTE && right.type === BLOCKQUOTE) return '\n\n'
  if (
    left.type === PARAGRAPH &&
    right.type === LIST &&
    ((right.ordered && right.depth !== 1) ||
      (tidy(right).length > 0 && tidy(right.kids[0]!).length === 0))
  )
    return '\n\n'
  if (left.type === PARAGRAPH && right.type === THEMATIC_BREAK) return '\n\n'
  let tail = left
  while (
    (tail.type === BLOCKQUOTE || tail.type === LIST || tail.type === LIST_ITEM) &&
    tail.kids.length > 0
  )
    tail = tail.kids[tail.kids.length - 1]!
  if (tail.type !== PARAGRAPH) return '\n'
  if (right.type === HTML) {
    const kind = htmlKind(right.value)
    if (kind === undefined || kind === 7) return '\n\n'
  }
  if (
    (left.type === PARAGRAPH || left !== tail) &&
    ((right.type === HEADING && setext(right)) || right.type === PARAGRAPH)
  )
    return '\n\n'
  return '\n'
}

// micromark's html block kinds, as far as what the emitter writes needs: <sup> and <sub> are kind 7
const htmlKind = (value: string): number | undefined => {
  if (value.charCodeAt(0) !== 60) return undefined
  const closing = value.charCodeAt(1) === 47
  const name = /^[a-z][a-z0-9-]*/i.exec(value.slice(closing ? 2 : 1))?.[0]?.toLowerCase()
  if (!name) return undefined
  return HTML_BLOCK_NAMES.has(name) ? 6 : 7
}
const HTML_BLOCK_NAMES = new Set(
  'address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul'.split(
    ' ',
  ),
)

// a node's text, as mdast-util-to-string reads it (image alts too)
const toText = (node: Md): string => {
  if (node.type === TEXT || node.type === INLINE_CODE || node.type === HTML || node.type === CODE)
    return node.value
  if (node.type === IMAGE) return node.value
  let text = ''
  for (const kid of node.kids) text += toText(kid)
  return text
}

const hasBreak = (node: Md): boolean => {
  for (const kid of node.kids) {
    if (kid.type === BREAK) return true
    if (
      (kid.type === TEXT || kid.type === INLINE_CODE || kid.type === HTML) &&
      /[\r\n]/.test(kid.value)
    )
      return true
    if (hasBreak(kid)) return true
  }
  return false
}
// a heading written setext style: an h1 or h2 that holds a line break
export const setext = (node: Md) => {
  if (node.depth >= 3) return false
  tidyDeep(node)
  return toText(node) !== '' && hasBreak(node)
}

// a link written <like this>: its text is its url. worked out once, kept in its depth (1 no, 2 yes)
const autolinked = (node: Md) => {
  if (node.depth === 0) node.depth = isAutolink(node) ? 2 : 1
  return node.depth === 2
}
const isAutolink = (node: Md) => {
  tidy(node)
  if (node.title || !node.url || node.kids.length !== 1 || node.kids[0]!.type !== TEXT) return false
  const raw = node.kids[0]!.value
  return (
    (raw === node.url || 'mailto:' + raw === node.url) &&
    /^[a-z][+\-.a-z]+:/i.test(node.url) &&
    !/[\0- <>\u007F]/.test(node.url)
  )
}

const indentLines = (
  value: string,
  map: (line: string, index: number, blank: boolean) => string,
) => {
  const eol = /\r?\n|\r/g
  let result = ''
  let start = 0
  let line = 0
  let match
  while ((match = eol.exec(value))) {
    const text = value.slice(start, match.index)
    result += map(text, line, !text) + match[0]
    start = match.index + match[0].length
    line++
  }
  const text = value.slice(start)
  return result + map(text, line, !text)
}

const ENCLOSE = /[\0- \u007F]/

const handle = (node: Md, parent: Md | undefined, before: string, after: string): string => {
  switch (node.type) {
    case TEXT:
      return safe(node.value, before, after)
    case PARAGRAPH: {
      if (node.raw !== null) return node.raw
      enter('paragraph')
      enter('phrasing')
      const value = containerPhrasing(node, before, after)
      exit()
      exit()
      return value
    }
    case HEADING:
      return node.raw !== null ? node.raw : heading(node)
    case ROOT: {
      if (!tidy(node).some(isPhrasing)) return containerFlow(node)
      enter('phrasing')
      const value = containerPhrasing(node, before, after)
      exit()
      return value
    }
    case THEMATIC_BREAK:
      return '---'
    case BLOCKQUOTE: {
      enter('blockquote')
      const value = indentLines(containerFlow(node), (line, _, blank) =>
        blank ? '>' + line : '> ' + line,
      )
      exit()
      return value
    }
    case LIST:
      return node.raw !== null ? directListText(node, parent) : list(node, parent)
    case LIST_ITEM:
      return listItem(node, parent)
    case CODE:
      return code(node)
    case TABLE:
      return table(node)
    case TABLE_ROW: {
      enter('table')
      const row = rowData(node)
      exit()
      const value = markdownTable([row], node.align ?? [])
      return value.slice(0, value.indexOf('\n'))
    }
    case TABLE_CELL:
      return cell(node)
    case HTML:
      return node.value
    case EMPHASIS:
    case STRONG:
    case DELETE: {
      // outside phrasing (a peek, say): attention on its own
      enter('phrasing')
      const value = serialize([attentionItem(node)], before, after)
      exit()
      return value
    }
    case INLINE_CODE:
      return inlineCode(node)
    case BREAK:
      return scopeOf(mask).bareNewline ? (/[\t ]/.test(before) ? '' : ' ') : '\\\n'
    case LINK:
      return link(node, before)
    case IMAGE:
      return image(node)
  }
  return ''
}

const heading = (node: Md) => {
  const rank = Math.max(Math.min(6, node.depth || 1), 1)
  if (setext(node)) {
    enter('headingSetext')
    enter('phrasing')
    const value = containerPhrasing(node, '\n', '\n')
    exit()
    exit()
    return (
      value +
      '\n' +
      (rank === 1 ? '=' : '-').repeat(
        value.length - (Math.max(value.lastIndexOf('\r'), value.lastIndexOf('\n')) + 1),
      )
    )
  }
  const sequence = '#'.repeat(rank)
  enter('headingAtx')
  enter('phrasing')
  let value = containerPhrasing(node, '# ', '\n')
  const head = value.charCodeAt(0)
  if (head === 9 || head === 32) value = reference(head) + value.slice(1)
  value = value ? sequence + ' ' + value : sequence
  exit()
  exit()
  return value
}

const list = (node: Md, parent: Md | undefined) => {
  for (const item of tidy(node)) tidy(item)
  enter('list')
  const saved = bulletCurrent
  let bullet = node.ordered ? '.' : '-'
  const other = node.ordered ? ')' : '*'
  let different = parent && bulletLastUsed ? bullet === bulletLastUsed : false
  if (!node.ordered) {
    const first = node.kids[0]
    const n = stack.length
    const at = indexStack.length
    if (
      first &&
      !first.kids[0] &&
      stack[n - 1] === 'list' &&
      stack[n - 2] === 'listItem' &&
      stack[n - 3] === 'list' &&
      stack[n - 4] === 'listItem' &&
      indexStack[at - 1] === 0 &&
      indexStack[at - 2] === 0 &&
      indexStack[at - 3] === 0
    )
      different = true
    // the rule is - too, so an item that starts with a rule needs the other bullet
    if (first)
      for (const item of node.kids)
        if (item.type === LIST_ITEM && item.kids[0]?.type === THEMATIC_BREAK) {
          different = true
          break
        }
  }
  if (different) bullet = other
  bulletCurrent = bullet
  const value = containerFlow(node)
  bulletLastUsed = bullet
  bulletCurrent = saved
  exit()
  return value
}

// a list the direct path read (emit-convert's directList): its items and the lists in them, written as list(),
// listItem(), containerFlow() and between() write a tight or loose list of paragraphs. a paragraph is its markdown
export type DList = { ordered: boolean; start: number; spread: boolean; items: DItem[] }
export type DItem = { spread: boolean; blocks: (string | DList)[] }
// bulletLastUsed, as it is while a direct list's items are written
let lastUsed: string | undefined
// each item of a list at the top of a flow, written: its own bullet is the serializer's, once it knows what's before
// it. a first item opening with a list never gets here, so what came before the list matters to nothing in it
export const directItems = (top: DList): string[] => {
  const items: string[] = []
  for (let i = 0; i < top.items.length; i++) {
    lastUsed = undefined
    items.push(itemText(top.items[i]!, 1, i, true))
  }
  return items
}
// an item's blocks and the line endings between them, as containerFlow() writes a list item's
const itemText = (item: DItem, level: number, index: number, listFirst: boolean): string => {
  const blocks = item.blocks
  let value = ''
  for (let k = 0; k < blocks.length; k++) {
    const block = blocks[k]!
    if (typeof block === 'string') {
      value += block
      lastUsed = undefined
    } else
      value += listText(
        block,
        level + 1,
        k === 0,
        level + 1 >= 3 &&
          k === 0 &&
          index === 0 &&
          listFirst &&
          block.items[0]!.blocks.length === 0,
      )
    if (k < blocks.length - 1) value += itemBetween(item, block, blocks[k + 1]!)
  }
  return value
}
// a list in an item, as list() writes it: the other bullet after a list right before it, or when it's the first of
// three lists each opening the one before with an empty item (the stack and index test there)
const listText = (nest: DList, level: number, first: boolean, emptyChain: boolean): string => {
  let bullet = nest.ordered ? '.' : '-'
  if (lastUsed ? bullet === lastUsed : false) bullet = nest.ordered ? ')' : '*'
  else if (!nest.ordered && emptyChain) bullet = '*'
  let value = ''
  for (let i = 0; i < nest.items.length; i++) {
    const marker = nest.ordered ? (nest.start > -1 ? nest.start : 1) + i + bullet : bullet
    value += bulleted(itemText(nest.items[i]!, level, i, first), marker)
    lastUsed = undefined
    if (i < nest.items.length - 1) value += nest.spread ? '\n\n' : '\n'
  }
  lastUsed = bullet
  return value
}
// between() for two blocks in an item
const itemBetween = (item: DItem, left: string | DList, right: string | DList) => {
  if (item.spread) return '\n\n'
  if (
    typeof left === 'string' &&
    typeof right !== 'string' &&
    ((right.ordered && right.start !== 1) || right.items[0]!.blocks.length === 0)
  )
    return '\n\n'
  // what left ends with, down through the lists in it
  let tail: string | DList | DItem = left
  while (typeof tail !== 'string') {
    if ('items' in tail) tail = tail.items[tail.items.length - 1]!
    else if (tail.blocks.length) tail = tail.blocks[tail.blocks.length - 1]!
    else return '\n'
  }
  return typeof right === 'string' ? '\n\n' : '\n'
}
// an item's text under its bullet, as listItem()'s indentLines: the bullet on the first line, the rest padded
// under it, blank lines left blank
const bulleted = (content: string, marker: string) => {
  if (content === '') return marker
  if (content.indexOf('\n') < 0 && content.indexOf('\r') < 0) return marker + ' ' + content
  const pad = ' '.repeat(marker.length + 1)
  return indentLines(content, (line, index, blank) =>
    index ? (blank ? '' : pad) + line : (blank ? marker : marker + ' ') + line,
  )
}
// the top list, once its bullet is known: the other one after a list right before it in the same flow
const directListText = (node: Md, parent: Md | undefined) => {
  const bullet = node.ordered
    ? parent && bulletLastUsed === '.'
      ? ')'
      : '.'
    : parent && bulletLastUsed === '-'
      ? '*'
      : '-'
  const items = node.raw!.split('\0')
  let value = ''
  for (let i = 0; i < items.length; i++) {
    if (i) value += node.spread ? '\n\n' : '\n'
    value += bulleted(
      items[i]!,
      node.ordered ? (node.depth > -1 ? node.depth : 1) + i + bullet : bullet,
    )
  }
  bulletLastUsed = bullet
  return value
}

const listItem = (node: Md, parent: Md | undefined) => {
  let bullet = bulletCurrent || '-'
  if (parent && parent.type === LIST && parent.ordered)
    bullet = (parent.depth > -1 ? parent.depth : 1) + parent.kids.indexOf(node) + bullet
  const size = bullet.length + 1
  enter('listItem')
  const pad = ' '.repeat(size)
  let value = indentLines(containerFlow(node), (line, index, blank) =>
    index ? (blank ? '' : pad) + line : (blank ? bullet : bullet + ' ') + line,
  )
  exit()
  // a task list item
  if (typeof node.checked === 'boolean' && node.kids[0]?.type === PARAGRAPH)
    value = value.replace(
      /^(?:[*+-]|\d+\.)([\r\n]| {1,3})/,
      (whole) => whole + (node.checked ? '[x] ' : '[ ] '),
    )
  return value
}

const longestStreak = (value: string, substring: string) => {
  let index = value.indexOf(substring)
  let expected = index
  let count = 0
  let max = 0
  while (index !== -1) {
    if (index === expected) {
      if (++count > max) max = count
    } else count = 1
    expected = index + substring.length
    index = value.indexOf(substring, expected)
  }
  return max
}

const code = (node: Md) => {
  const raw = node.value
  const sequence = '`'.repeat(Math.max(longestStreak(raw, '`') + 1, 3))
  enter('codeFenced')
  let value = sequence
  if (node.lang) {
    enter('codeFencedLangGraveAccent')
    value += safe(node.lang, value, ' ', '`')
    exit()
  }
  if (node.lang && node.meta) {
    enter('codeFencedMetaGraveAccent')
    value += ' '
    value += safe(node.meta, value, '\n', '`')
    exit()
  }
  value += '\n'
  if (raw) value += raw + '\n'
  value += sequence
  exit()
  return value
}

const inlineCode = (node: Md) => {
  let value = node.value
  let sequence = '`'
  if (value.indexOf('`') >= 0)
    while (new RegExp('(^|[^`])' + sequence + '([^`]|$)').test(value)) sequence += '`'
  if (
    /[^\n\r ]/.test(value) &&
    ((/^[\n\r ]/.test(value) && /[\n\r ]$/.test(value)) || /^`|`$/.test(value))
  )
    value = ' ' + value + ' '
  // a line ending that would start a construct is a space instead
  if (/[\r\n]/.test(value))
    for (const pattern of PATTERNS) {
      if (!UNSAFE[PATTERNS.indexOf(pattern)]!.atBreak) continue
      const expression = pattern.regex
      expression.lastIndex = 0
      let match
      while ((match = expression.exec(value))) {
        let position = match.index
        if (value.charCodeAt(position) === 10 && value.charCodeAt(position - 1) === 13) position--
        value = value.slice(0, position) + ' ' + value.slice(match.index + 1)
      }
    }
  value = sequence + value + sequence
  // in a table, a pipe would end the cell
  if ((mask & TABLE_CELL_BIT) !== 0) value = value.replace(/\|/g, '\\$&')
  return value
}

const destination = (url: string, value: string, title: string | undefined, enclose: boolean) => {
  if ((!url && typeof title === 'string') || enclose) {
    enter('destinationLiteral')
    const out = '<' + safe(url, value + '<', '>') + '>'
    exit()
    return out
  }
  enter('destinationRaw')
  const out = safe(url, value, typeof title === 'string' ? ' ' : ')')
  exit()
  return out
}
const titled = (title: string | undefined, value: string) => {
  if (typeof title !== 'string') return ''
  enter('titleQuote')
  const out = ' "' + safe(title, value + ' "', '"') + '"'
  exit()
  return out
}

const link = (node: Md, before: string) => {
  if (autolinked(node)) {
    const savedStack = stack
    const savedMask = mask
    stack = stack.filter((name) => name !== 'phrasing')
    mask &= ~PHRASING
    enter('autolink')
    const value = '<' + containerPhrasing(node, '<', '>') + '>'
    exit()
    stack = savedStack
    mask = savedMask
    return value
  }
  enter('link')
  enter('label')
  const text = containerPhrasing(node, '[', '](')
  exit()
  let value = '[' + text + ']('
  const enclose = ENCLOSE.test(node.url)
  const last = before.charAt(before.length - 1)
  let title = node.title || undefined
  // text that reads as a definition ([x]: …) at the start of a line gets an empty title, so it isn't one
  if (!title && !enclose && (last === '\n' || last === '\r')) {
    let index = 0
    while (index < text.length && text.charCodeAt(index) !== 93)
      index += text.charCodeAt(index) === 92 ? 2 : 1
    if (text.charCodeAt(index + 1) === 58) title = ''
  }
  value += destination(node.url, value, title, enclose)
  value += titled(title, value)
  value += ')'
  exit()
  return value
}

const image = (node: Md) => {
  enter('image')
  enter('label')
  let value = '![' + safe(node.value, '![', ']') + ']('
  exit()
  const title = node.title || undefined
  if ((!node.url && title) || ENCLOSE.test(node.url)) {
    enter('destinationLiteral')
    value += '<' + safe(node.url, value + '<', '>') + '>'
    exit()
  } else {
    enter('destinationRaw')
    value += safe(node.url, value, title ? ' ' : ')')
    exit()
  }
  value += titled(title, value)
  value += ')'
  exit()
  return value
}

const cell = (node: Md) => {
  enter('tableCell')
  enter('phrasing')
  const value = containerPhrasing(node, '|', '|')
  exit()
  exit()
  return value
}
const rowData = (row: Md) => {
  enter('tableRow')
  const cells: string[] = []
  for (const kid of row.kids) cells.push(cell(kid))
  exit()
  return cells
}
const table = (node: Md) => {
  enter('table')
  const matrix: string[][] = []
  for (const row of node.kids) matrix.push(rowData(row))
  exit()
  return markdownTable(matrix, node.align ?? [])
}

// markdown-table (MIT, Titus Wormer) as gfm configures it: padded cells, delimiters aligned
const markdownTable = (matrix: string[][], align: (string | null)[]) => {
  const longest: number[] = []
  let most = 0
  for (const row of matrix) {
    if (row.length > most) most = row.length
    for (let column = 0; column < row.length; column++) {
      const size = row[column]!.length
      if (longest[column] === undefined || size > longest[column]!) longest[column] = size
    }
  }
  const alignments: number[] = []
  for (let column = 0; column < most; column++) {
    const value = align[column]
    const kind = typeof value === 'string' ? value.codePointAt(0) : 0
    alignments[column] =
      kind === 67 || kind === 99
        ? 99
        : kind === 76 || kind === 108
          ? 108
          : kind === 82 || kind === 114
            ? 114
            : 0
  }
  const delimiters: string[] = []
  const delimiterSizes: number[] = []
  for (let column = 0; column < most; column++) {
    const kind = alignments[column]
    const before = kind === 99 || kind === 108 ? ':' : ''
    const after = kind === 99 || kind === 114 ? ':' : ''
    let size = Math.max(1, longest[column]! - before.length - after.length)
    const value = before + '-'.repeat(size) + after
    size = before.length + size + after.length
    if (size > longest[column]!) longest[column] = size
    delimiterSizes[column] = size
    delimiters[column] = value
  }
  const rows = matrix.length ? [matrix[0]!, delimiters, ...matrix.slice(1)] : [delimiters]
  const lines: string[] = []
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!
    let line = ''
    for (let column = 0; column < most; column++) {
      const value = row[column] ?? ''
      const own = index === 1 ? delimiterSizes[column]! : value.length
      const size = longest[column]! - own
      const kind = alignments[column]
      let before = ''
      let after = ''
      if (kind === 114) before = ' '.repeat(size)
      else if (kind === 99) {
        if (size % 2) {
          before = ' '.repeat(size / 2 + 0.5)
          after = ' '.repeat(size / 2 - 0.5)
        } else before = after = ' '.repeat(size / 2)
      } else after = ' '.repeat(size)
      if (!column) line += '|'
      line += ' ' + before + value + after + ' |'
    }
    lines.push(line)
  }
  return lines.join('\n')
}

// a paragraph or heading written as a flow writes it (between line endings, in no construct but its own), for the
// fast path, which writes them as it converts them. the serializer's state is balanced between calls, so this is
// the same markdown handle() gives it later
export const renderBlock = (node: Md) => {
  const written = writeFlat(node)
  return written === undefined ? handle(node, undefined, '\n', '\n') : written
}

// a paragraph or heading written in one pass over its children, for the usual shape: text, code, links and
// emphasis around a single text that starts and ends with a letter where nothing could make the markers mean
// anything else. that's phrasing() and serialize() when every attention run pairs as written and nothing needs
// encoding; anything else returns undefined, for the general way
const writeFlat = (node: Md): string | undefined => {
  const isHeading = node.type === HEADING
  const rank = isHeading ? Math.max(Math.min(6, node.depth || 1), 1) : 0
  const kids = tidy(node)
  enter(isHeading ? 'headingAtx' : 'paragraph')
  enter('phrasing')
  let before = isHeading ? '# ' : '\n'
  const end = '\n'
  let out = ''
  // the marker of the attention just written, when nothing has come after it yet
  let lastMarker = 0
  let failed = false
  for (let i = 0; i < kids.length && !failed; i++) {
    const child = kids[i]!
    const next = i + 1 < kids.length ? firstCharacter(peek(kids[i + 1]!, node)) : end
    switch (child.type) {
      case TEXT: {
        const value = safe(child.value, before, next)
        if (!value) continue
        out += value
        before =
          value === child.value || endsAsInput ? lastCharacter(child.value) : lastCharacter(value)
        lastMarker = 0
        break
      }
      case STRONG:
      case EMPHASIS: {
        const inner = tidy(child)
        const sequence = child.type === STRONG ? '**' : '_'
        const marker = sequence.charCodeAt(0)
        if (inner.length !== 1 || inner[0]!.type !== TEXT || lastMarker === marker) {
          failed = true
          break
        }
        enter(child.type === STRONG ? 'strong' : 'emphasis')
        const text = safe(inner[0]!.value, sequence, sequence)
        exit()
        // letters at both ends inside; for _, no letter right outside either
        if (
          text === '' ||
          classify(text.charCodeAt(0)) !== 0 ||
          classify(text.charCodeAt(text.length - 1)) !== 0 ||
          (marker === 95 &&
            (classify(before.charCodeAt(before.length - 1)) === 0 ||
              classify(next.charCodeAt(0)) === 0))
        ) {
          failed = true
          break
        }
        out += sequence + text + sequence
        before = sequence.charAt(sequence.length - 1)
        lastMarker = marker
        break
      }
      case INLINE_CODE:
        out += inlineCode(child)
        before = '`'
        lastMarker = 0
        break
      case LINK:
        out += link(child, before)
        before = autolinked(child) ? '>' : ')'
        lastMarker = 0
        break
      case BREAK: {
        const value = isHeading ? (/[\t ]/.test(before) ? '' : ' ') : '\\\n'
        if (!value) continue
        out += value
        before = lastCharacter(value)
        lastMarker = 0
        break
      }
      default:
        failed = true
    }
  }
  exit()
  exit()
  if (failed) return undefined
  if (!isHeading) return out
  const head = out.charCodeAt(0)
  if (head === 9 || head === 32) out = reference(head) + out.slice(1)
  const sequence = '#'.repeat(rank)
  return out ? sequence + ' ' + out : sequence
}

// the markdown for a root, as toMarkdown writes it
export const toMarkdown = (root: Md): string => {
  stack = []
  masks = []
  mask = 0
  indexStack = []
  bulletCurrent = undefined
  bulletLastUsed = undefined
  // toMarkdown ends what it writes with a line ending; finish trims it straight off, so it's never added (reading
  // the last character would copy the whole markdown into one string just for that)
  return handle(root, undefined, '\n', '\n')
}

// a heading's text as a reader sees it (headingOf in @affordances/md): what it says, without images or a url shown as
// itself, nor the brackets right around one
export const headingText = (node: Md): string | undefined => {
  const pieces: (string | null)[] = []
  const walk = (parent: Md) => {
    for (const kid of parent.kids) {
      if (kid.type === TEXT || kid.type === INLINE_CODE || kid.type === HTML) pieces.push(kid.value)
      else if (kid.type === BREAK) pieces.push(' ')
      else if (kid.type === IMAGE) continue
      else if (kid.type === LINK && autolinked(kid)) pieces.push(null)
      else walk(kid)
    }
  }
  walk(node)
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
const BRACKETS: Record<string, string> = { '(': ')', '[': ']', '<': '>' }
