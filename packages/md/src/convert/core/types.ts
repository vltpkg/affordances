// the contract between the parser (parse.ts) and the emitter (emit.ts). both sides are written against this file, so
// change it only with the other side in hand

// a text node is its string, already entity-decoded, whitespace as written (the emitter collapses it; <pre> keeps it)
export type Node = Element | string

export interface Element {
  // lowercase tag name; the root is '#root'
  tag: string
  // the tag's attributes as written, from after the tag name to before the closing '>' ('' when none), in any syntax
  // html allows (unquoted, single-quoted, any case, repeated names); re-serialised only where the parser had to merge
  // or rename them. never scan it by hand: read values with attr(), which parses on first use, and presence with flags
  attrs: string
  // which of the attributes in FLAG the tag has, whatever their values: one bit each, set by the parser as it reads
  // the tag, so asking "could this be hidden?" of every element never touches its source
  flags: number
  kids: Node[]
  up: Element | null
  // attr()'s cache
  map?: Map<string, string> | undefined
  // the emitter's own, on a document it owns (it emits each once and prunes it in place): kids are already as prune
  // leaves them; and whether the element is code or inside it (undefined until asked)
  pruned?: boolean | undefined
  code?: boolean | undefined
}

// the attributes an element's flags record, by name (ascii case-insensitive, as html matches them)
export const FLAG = {
  hidden: 1 << 0,
  'aria-hidden': 1 << 1,
  style: 1 << 2,
  role: 1 << 3,
  contenteditable: 1 << 4,
  'data-affordances-md': 1 << 5,
  'data-mode': 1 << 6,
  'data-mdast': 1 << 7,
  'data-title': 1 << 8,
  title: 1 << 9,
  nowrap: 1 << 10,
  rowspan: 1 << 11,
  colspan: 1 << 12,
  align: 1 << 13,
  class: 1 << 14,
  id: 1 << 15,
  'aria-label': 1 << 16,
  'aria-labelledby': 1 << 17,
  'data-language': 1 << 18,
} as const
export const flagOf = (name: string): number => (FLAG as Record<string, number>)[name] ?? 0

// what the page's <head> says, read during the one scan; the head's elements are not in the tree
export interface Head {
  // the first <title> in the head, else the first <title> anywhere outside an <svg>; trimmed
  title?: string | undefined
  // <html lang>
  lang?: string | undefined
  // <link rel="canonical"> in the head: its href as written
  canonical?: string | undefined
  // <meta> anywhere, first one wins: keyed 'name <name>' and 'property <property>' for each of the two it has, value
  // its content (decoded; '' without one)
  meta: Map<string, string>
  // each non-empty <script type="application/ld+json">, trimmed, in page order
  jsonLd: string[]
}

// a Document is emitted once: emit owns the tree it's given and may prune or annotate it in place
export interface Document {
  // children are the <body>'s children (or, without a body, the page's own)
  root: Element
  head: Head
  // every <main> and every element whose role attribute is exactly 'main', in tree order, wherever it is in the
  // root's tree (hidden or not: the emitter decides which one counts)
  mains: Element[]
  // the own text of every script element in the document, any namespace, in no particular order: what the flight
  // check reads, as it would read each script in parse5's tree
  scripts: string[]
}

// what the parser never builds, with everything inside: never content, whatever the page says. the same set as
// @affordances/md's ALWAYS_DROP; comments and the doctype are dropped too
export const NEVER = new Set([
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

export type Options = {
  // base for absolutizing links and images, usually the page's url
  url?: string
  // 'auto': <main> (or role=main), else the body minus its chrome; 'none': the whole body
  extract?: 'auto' | 'none'
  frontmatter?: boolean
  jsonLd?: boolean
  // another url for a link once it's absolute; undefined keeps it. not called for images or #fragment links
  link?: (url: URL) => string | undefined
}

export type Result = { markdown: string; title?: string; url?: string; tokens: number }
