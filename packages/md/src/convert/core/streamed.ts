import { attr } from './attr.ts'
import type { Element, Node } from './types.ts'

// react streams each resolved <Suspense> boundary after the shell, hidden, with an instruction that moves it into
// place: $RC("B:1","S:1") (or $RR, with its stylesheets) puts a segment where the boundary's fallback is, and
// $RS("S:2","P:1") puts one where a placeholder is. with an external runtime the same instructions are templates:
// data-rci, data-rri, data-rsi. @affordances/md's tree pipeline makes these moves (resolveStreamed) before it reads the
// page, and md-core makes the same ones, the same way, on its own tree: every id (the last element with it wins), the
// instructions from the scripts' text and then from the templates, and the templates in page order, each boundary's
// fallback from its template to its closing <!--/$-->

// what the parser knows that the tree doesn't say: what it kept, and what's inside svg, where it keeps nothing
export type Streamed = {
  // the whole document, the head's elements too
  root: Element
  // every script in the document, and all the text inside one
  scripts: Element[]
  textOf: (el: Element) => string
  // whether an element is an html <template>, whose children are its content (the tree pipeline's walk never enters)
  content: (el: Element) => boolean
  // whether an element is one the parser keeps text in
  keeps: (el: Element) => boolean
  // the ids of elements inside svg, whether a template with an id is in svg, and whether an instruction template is
  svgIds: Set<string>
  svgTemplate: boolean
  svgInstructed: boolean
}

// a react boundary comment, kept by the parser for this: an element of this tag whose attrs are the comment's data
export const COMMENT = '#comment'
const isComment = (node: Node) => typeof node !== 'string' && node.tag === COMMENT

const INSTRUCTION = /\$R([CRS])\("([^"]+)","([^"]+)"/g

// the moves made, or why md-core can't make them as the tree pipeline does
export const resolveStreamed = (page: Streamed): string | undefined => {
  const templates: Element[] = []
  const instructions: Element[] = []
  const byId = new Map<string, Element>()
  const parents = new Map<Node, Element>()
  const walk = (parent: Element) => {
    for (const node of parent.kids) {
      if (typeof node === 'string' || isComment(node)) continue
      parents.set(node, parent)
      const id = attr(node, 'id')
      if (id !== undefined) byId.set(id, node)
      if (node.tag === 'template') {
        if (id !== undefined) templates.push(node)
        if (attr(node, 'data-bid') !== undefined || attr(node, 'data-pid') !== undefined)
          instructions.push(node)
      }
      if (!page.content(node)) walk(node)
    }
  }
  walk(page.root)
  const boundaries = new Map<string, string>()
  const placeholders = new Map<string, string>()
  for (const script of page.scripts)
    for (const [, kind, a, b] of page.textOf(script).matchAll(INSTRUCTION))
      if (kind === 'S') placeholders.set(b!, a!)
      else boundaries.set(a!, b!)
  for (const template of instructions) {
    const at = (name: string) => attr(template, name)
    // as String() reads a property that isn't there
    const sid = String(at('data-sid'))
    if (
      (at('data-rci') !== undefined || at('data-rri') !== undefined) &&
      at('data-bid') !== undefined
    )
      boundaries.set(at('data-bid')!, sid)
    if (at('data-rsi') !== undefined && at('data-pid') !== undefined)
      placeholders.set(at('data-pid')!, sid)
  }
  // an instruction md-core never kept may move anything, whatever md-core found
  if (page.svgInstructed) return 'streamed instruction in svg'
  if (!boundaries.size && !placeholders.size) return undefined
  // what a move took out of the tree (a fallback, or a segment's children when the segment holds its own template)
  // is out of it: nothing that reads the page later (its head, its mains) may find it by its parent
  const touched: Element[] = []
  // what md-core can't see: a template in svg the tree pipeline moves content through, or a segment it would find in
  // svg (the last element with an id wins), or one whose text md-core never kept
  if (page.svgTemplate) return 'streamed boundary in svg'
  for (const id of [...boundaries.values(), ...placeholders.values()])
    if (page.svgIds.has(id)) return 'streamed segment in svg'
  for (const template of templates) {
    const id = attr(template, 'id')!
    const boundary = boundaries.has(id)
    const segment = byId.get((boundary ? boundaries : placeholders).get(id) ?? '')
    const parent = parents.get(template)
    // a template inside a fallback that was already replaced is gone
    const start = parent ? parent.kids.indexOf(template) : -1
    if (!segment || !parent || start < 0) continue
    if (!page.keeps(segment)) return 'streamed segment md-core keeps no text in'
    // a segment's children go where the template is: one that holds the template's parent (at any depth) would be
    // put inside itself. the tree pipeline makes that loop and never reaches it again; md-core declines it, so no move
    // ever makes one (a segment that is the template's parent only takes its own children back). the walk goes up by
    // every parent each element has had, so it finds all of the parent's ancestors (and maybe more, which only
    // declines), and never takes more steps than there are elements
    if (holds(segment, parent, parents)) return 'streamed segment holds its own template'
    // a boundary's fallback runs from its template to the boundary's closing <!--/$-->; a placeholder is the
    // template alone
    let end = start + 1
    if (boundary)
      for (let depth = 0; end < parent.kids.length; end++) {
        const node = parent.kids[end]!
        if (typeof node === 'string' || node.tag !== COMMENT) continue
        if (node.attrs.startsWith('$')) depth++
        else if (node.attrs === '/$' && depth-- === 0) break
      }
    for (const node of parent.kids.slice(start, end))
      if (typeof node !== 'string') touched.push(node)
    for (const child of segment.kids)
      if (typeof child !== 'string') {
        parents.set(child, parent)
        child.up = parent
        touched.push(child)
      }
    parent.kids.splice(start, end - start, ...segment.kids)
    segment.kids = []
  }
  for (const el of touched) if (el.up && !el.up.kids.includes(el)) el.up = null
  return undefined
}

// whether an element is above another, by the parents the walk and the moves recorded
const holds = (segment: Element, at: Element, parents: Map<Node, Element>) => {
  for (let up = parents.get(at), steps = 0; up; up = parents.get(up), steps++)
    if (up === segment || steps > parents.size) return true
  return false
}
