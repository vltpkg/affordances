// how deep md reads a page: past this many elements (the document's children at 1), what's nested further is read as
// text. both paths recurse over the tree (hast-util-from-parse5, hast-util-to-mdast and md-core's emitter), and a page
// nested thousands deep would run them out of stack. both flatten the page this way, right after it's parsed and
// before anything recurses, so the two never differ, and a page under it is read as it always was
export const DEPTH = 128
// and past this many open elements, the page isn't read any further: it's cut at the tag that opens one more, and both
// paths read what's before it (the tree pipeline's parser takes time for every open element at every tag, so a page
// nesting thousands deep would take minutes to parse)
export const CUT = 512

import { NEVER } from './core/types.ts'

// an element nested this deep keeps only text: the words of what's inside it, through elements that are only
// structure (no attributes, nothing prune reads), and nothing of anything else, which could be hidden, a control, or
// something that carries markers. so nothing hidden is ever read out of a page this deep
export const PLAIN = ['div', 'span', 'p', 'section', 'article', 'b', 'i', 'em', 'strong']
const plainTags = new Set(PLAIN)

type Parse5Node = {
  nodeName: string
  tagName?: string
  attrs?: unknown[]
  namespaceURI?: string
  value?: string
  childNodes?: Parse5Node[]
  content?: { childNodes: Parse5Node[] }
  parentNode?: Parse5Node | null
}

const HTML_NS = 'http://www.w3.org/1999/xhtml'
const plain = (node: Parse5Node) =>
  node.namespaceURI === HTML_NS &&
  plainTags.has(node.tagName ?? '') &&
  (node.attrs?.length ?? 0) === 0

// the text an element this deep keeps, in page order, without recursing; and whether anything else was there
let lost = false
const textIn = (nodes: Parse5Node[]) => {
  let text = ''
  const stack: [Parse5Node[], number][] = [[nodes, 0]]
  while (stack.length) {
    const top = stack[stack.length - 1]!
    const [list, at] = top
    if (at === list.length) {
      stack.pop()
      continue
    }
    top[1]++
    const node = list[at]!
    if (node.nodeName === '#text') text += node.value ?? ''
    else if (node.tagName !== undefined && plain(node)) stack.push([node.childNodes ?? [], 0])
    // what's in svg or math, and what md never reads (a script, a template), md reads nothing of anyway, on either path
    else if (
      node.tagName !== undefined &&
      node.namespaceURI === HTML_NS &&
      !NEVER.has(node.tagName)
    )
      lost = true
  }
  return text
}

// a parse5 document, with everything nested deeper than DEPTH read as text, in place; whether that left anything out
export const flattenDeep = (document: Parse5Node): boolean => {
  lost = false
  // and whether the node is in what md never reads: flattened too, since the tree pipeline converts it before dropping
  // it, but nothing there is lost
  const stack: [Parse5Node, number, boolean][] = [[document, 0, false]]
  while (stack.length) {
    const [node, depth, never] = stack.pop()!
    const kids = node.content?.childNodes ?? node.childNodes ?? []
    if (depth === DEPTH && node.tagName !== undefined) {
      if (!kids.some((kid) => kid.tagName !== undefined)) continue
      const before: boolean = lost
      const text = textIn(kids)
      if (never) lost = before
      const replaced: Parse5Node[] = text
        ? [{ nodeName: '#text', value: text, parentNode: node }]
        : []
      if (node.content) node.content.childNodes = replaced
      else node.childNodes = replaced
      continue
    }
    for (const kid of kids)
      if (kid.tagName !== undefined) stack.push([kid, depth + 1, never || NEVER.has(kid.tagName)])
  }
  return lost
}
