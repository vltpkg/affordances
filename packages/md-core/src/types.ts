// the contract between the parser (parse.ts) and the emitter (emit.ts). both sides are written against this file, so
// change it only with the other side in hand

// a text node is its string, already entity-decoded, whitespace as written (the emitter collapses it; <pre> keeps it)
export type Node = Element | string

export interface Element {
  // lowercase tag name; the root is '#root'
  tag: string
  // the tag's attributes exactly as written, from after the tag name to before the closing '>' ('' when none). read
  // them with attr(), which parses on first use: most elements' attributes are never read
  attrs: string
  kids: Node[]
  up: Element | null
  // attr()'s cache
  map?: Map<string, string> | undefined
}

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

export interface Document {
  // children are the <body>'s children (or, without a body, the page's own)
  root: Element
  head: Head
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
