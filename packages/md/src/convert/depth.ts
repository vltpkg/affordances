// how deep md reads a page: past this many elements (the document's children at 1), what's nested further is read as
// text. both paths recurse over the tree (hast-util-to-mdast and md-core's emitter), and the time some of their work
// takes grows with the square of the nesting. both flatten the page this way once it's settled (its flight data checked
// and its streamed boundaries moved into place, which read the whole page) and before anything else reads it, so the
// two never differ, and a page under it is read as it always was
export const DEPTH = 128
// and past this many open elements, the page isn't read any further: it's cut at the tag that opens one more, and both
// paths read what's before it (the tree pipeline's parser takes time for every open element at every tag, so a page
// nesting thousands deep would take minutes to parse, and what converts its tree recurses)
export const CUT = 512

import { NEVER } from './core/types.ts'

// an element nested this deep keeps only text: the words of what's inside it, through elements that are only
// structure (no attributes, nothing prune reads), and nothing of anything else, which could be hidden, a control, or
// something that carries markers. so nothing hidden is ever read out of a page this deep
export const PLAIN = ['div', 'span', 'p', 'section', 'article', 'b', 'i', 'em', 'strong']
// of those, the ones laid out as blocks, which start and end a line of the text, as a <br> ends one
export const LINES = ['div', 'p', 'section', 'article']
const plainTags = new Set(PLAIN)
const lineTags = new Set(LINES)

type HastNode = {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  value?: string
  children?: HastNode[]
  content?: { children: HastNode[] }
}

// the namespace a parser puts an element in, from the tag and where it is (hast doesn't say): what an element's
// children are made in. html; svg; math; a mathml text element's (mi, mn, ...), where only mglyph and malignmark stay
// mathml; an annotation-xml's that isn't html, where only svg leaves mathml
const HTML = 0
const SVG = 1
const MATH = 2
const MATH_TEXT = 3
const ANNOTATION = 4
const nsOf = (made: number, tag: string) =>
  made === HTML
    ? tag === 'svg'
      ? SVG
      : tag === 'math'
        ? MATH
        : HTML
    : made === MATH_TEXT
      ? tag === 'mglyph' || tag === 'malignmark' || tag === 'math'
        ? MATH
        : tag === 'svg'
          ? SVG
          : HTML
      : made === ANNOTATION
        ? tag === 'svg'
          ? SVG
          : MATH
        : made
const SVG_HTML = new Set(['foreignObject', 'desc', 'title'])
const MATH_TEXTS = new Set(['mi', 'mo', 'mn', 'ms', 'mtext'])
const madeIn = (el: HastNode, ns: number) => {
  if (ns === HTML) return HTML
  const tag = el.tagName!
  if (ns === SVG) return SVG_HTML.has(tag) ? HTML : SVG
  if (MATH_TEXTS.has(tag)) return MATH_TEXT
  if (tag !== 'annotation-xml') return MATH
  const encoding = String(el.properties?.encoding ?? '').toLowerCase()
  return encoding === 'text/html' || encoding === 'application/xhtml+xml' ? HTML : ANNOTATION
}

const kidsOf = (node: HastNode) => node.content?.children ?? node.children ?? []
const attributeless = (el: HastNode) => Object.keys(el.properties ?? {}).length === 0

// what an element this deep keeps, in page order and without recursing: its text through plain structure, with a line
// between blocks, and the scripts there (json-ld is read after); and whether anything else was there. what's in svg or
// math, and what md never reads (a template), md reads nothing of anyway, on either path
const textIn = (
  nodes: HastNode[],
  outer: number,
): [text: string, scripts: HastNode[], lost: boolean] => {
  let text = ''
  let lost = false
  const scripts: HastNode[] = []
  const line = () => {
    if (!text.endsWith('\n')) text += '\n'
  }
  // each list, where in it, the namespace its elements are made in, and whether it's a block's
  const stack: [HastNode[], number, number, boolean][] = [[nodes, 0, outer, false]]
  while (stack.length) {
    const top = stack[stack.length - 1]!
    const [list, at, made, block] = top
    if (at === list.length) {
      stack.pop()
      if (block) line()
      continue
    }
    top[1]++
    const node = list[at]!
    if (node.type === 'text') text += node.value ?? ''
    if (node.type !== 'element') continue
    const tag = node.tagName!
    if (nsOf(made, tag) !== HTML) continue
    if (tag === 'br') line()
    else if (tag === 'script') scripts.push(node)
    else if (plainTags.has(tag) && attributeless(node)) {
      const opens = lineTags.has(tag)
      if (opens) line()
      stack.push([node.children ?? [], 0, HTML, opens])
    } else if (!NEVER.has(tag)) lost = true
  }
  return [text, scripts, lost]
}

// a page, with everything nested deeper than DEPTH read as text, in place; whether that left anything out. what md
// never reads (a template, an svg) is left as it is, with everything inside: it's dropped with all of it, on both paths,
// before anything reads the page as content
export const flattenDeep = (root: HastNode): boolean => {
  let lost = false
  // each node, its depth, and the namespace its children are made in
  const stack: [HastNode, number, number][] = [[root, 0, HTML]]
  while (stack.length) {
    const [node, depth, made] = stack.pop()!
    const kids = kidsOf(node)
    if (depth === DEPTH && node.type === 'element') {
      if (!kids.some((kid) => kid.type === 'element')) continue
      const [text, scripts, left] = textIn(kids, made)
      if (left) lost = true
      const replaced: HastNode[] = text ? [{ type: 'text', value: text }, ...scripts] : scripts
      if (node.content) node.content.children = replaced
      else node.children = replaced
      continue
    }
    for (const kid of kids)
      if (kid.type === 'element' && !NEVER.has(kid.tagName!))
        stack.push([kid, depth + 1, madeIn(kid, nsOf(made, kid.tagName!))])
  }
  return lost
}
