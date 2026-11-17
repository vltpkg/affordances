import {
  HEADING,
  HTML,
  isLeaf,
  MARKED_BLOCK,
  MARKED_INLINE,
  Md,
  PARAGRAPH,
  TABLE_CELL,
  TEXT,
  tidy,
} from './emit-markdown.ts'

// what @affordances/md does to a page's marker markdown (an <AgentText>'s, a slot's fill) once it's converted, in its
// order, and only when there is some: its links resolved like the page's, one in a table cell kept to its line, and a
// block of it lifted out of the paragraph or heading it's in

// each marker's markdown, in tree order
const markedIn = (node: Md, found: Md[] = []) => {
  if (node.type === HTML && node.depth) found.push(node)
  else for (const kid of tidy(node)) markedIn(kid, found)
  return found
}

// whether there was any; links resolved with the page's base, by @affordances/md's own rewrite of them
export const relinkMarked = (
  root: Md,
  relink: ((markdown: string) => string) | undefined,
): boolean => {
  const marked = markedIn(root)
  if (relink) for (const node of marked) node.value = relink(node.value)
  return marked.length > 0
}

// a table cell is one line: its marker markdown keeps line breaks as <br> and pipes escaped, and is inline there
export const inCells = (node: Md, inCell = false) => {
  for (const kid of tidy(node)) {
    if (kid.type === HTML && kid.depth && inCell) {
      kid.value = kid.value
        .trim()
        .replace(/(?<!\\)((?:\\\\)*)\|/g, '$1\\|')
        .replace(/[ \t]*\n\s*/g, '<br>')
      kid.depth = MARKED_INLINE
    } else inCells(kid, inCell || kid.type === TABLE_CELL)
  }
}

const hasBlock = (node: Md): boolean =>
  (node.type === HTML && node.depth === MARKED_BLOCK) || tidy(node).some(hasBlock)
const says = (node: Md): boolean =>
  node.type === TEXT ? Boolean(node.value.trim()) : isLeaf(node) || tidy(node).some(says)
// the text at one end of a node
const edge = (node: Md | undefined, end: boolean): Md | undefined =>
  node === undefined || (isLeaf(node) && node.type !== TEXT)
    ? undefined
    : node.type === TEXT
      ? node
      : edge(end ? node.kids.at(-1) : node.kids[0], end)
const empty = (node: Md): Md => {
  const copy = Object.assign(Object.create(Md.prototype) as Md, node)
  copy.kids = []
  copy.clean = true
  return copy
}
const lifted = (node: Md): Md[] => {
  const out: Md[] = []
  let side = empty(node)
  const close = () => {
    const first = edge(side, false)
    if (first && out.length) first.value = first.value.trimStart()
    if (says(side)) out.push(side)
    side = empty(node)
  }
  for (const child of tidy(node))
    for (const part of !isLeaf(child) && hasBlock(child) ? lifted(child) : [child])
      if (part.type === HTML && part.depth === MARKED_BLOCK) {
        const last = edge(side, true)
        if (last) last.value = last.value.trimEnd()
        close()
        out.push(part)
      } else side.kids.push(part)
  close()
  return out
}
export const liftBlocks = (node: Md) => {
  const kids = tidy(node)
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i]!
    if (kid.type !== PARAGRAPH && kid.type !== HEADING) {
      liftBlocks(kid)
      continue
    }
    if (!hasBlock(kid)) continue
    const parts = lifted(kid)
    kids.splice(i, 1, ...parts)
    i += parts.length - 1
  }
}
