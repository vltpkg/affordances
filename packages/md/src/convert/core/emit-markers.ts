import { attr } from './attr.ts'
import { dropped, isText, marked } from './emit-prune.ts'
import { FLAG, type Element } from './types.ts'

// a page's markers, read from the tree as parsed, before it's converted: the <AgentMain>s, and the tabs that label a
// shown panel. @affordances/md finds both on its tree while it prunes it in place, so in a few shapes what it finds
// depends on what it pruned first; md-core says why it can't match those (the caller converts them the other way)
export type Markers = {
  // the outermost <AgentMain>s among what prune keeps, in page order
  mains: Element[]
  // the ids a shown panel's aria-labelledby names
  tabs: Set<string>
  // why md-core can't write the page as @affordances/md does, if it can't
  decline?: string
}

// what prune may change inside, beyond leaving out what's hidden: a link loses its empty blocks and values, a table
// can be a skeleton, a heading or summary can be read as its button, a tablist can go
const CHANGED = new Set([
  'a',
  'table',
  'th',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'caption',
  'summary',
  'dt',
])
const changed = (el: Element) =>
  CHANGED.has(el.tag) || (el.flags & FLAG.role && attr(el, 'role') === 'tablist') || isText(el)

const mode = (el: Element) =>
  el.flags & (FLAG['data-affordances-md'] | FLAG['data-mode']) ? marked(el) : undefined

export const readMarkers = (root: Element): Markers => {
  const found: Markers = { mains: [], tabs: new Set() }
  const decline = (why: string) => {
    found.decline ??= why
  }
  // under: something prune leaves out or may change is above
  const walk = (parent: Element, gone: boolean, under: boolean) => {
    for (const kid of parent.kids) {
      if (typeof kid === 'string') continue
      const text = isText(kid)
      const out = gone || (!text && dropped(kid))
      const m = mode(kid)
      if (kid.tag === 'affordances-md' && m === 'main' && !out) {
        if (under) decline('main marker inside what prune changes')
        found.mains.push(kid)
        continue
      }
      if (m === 'slot') decline('slot')
      // data-affordances-md="show", as the attribute says it: what a tablist's tabs are checked against
      if (kid.tag !== 'affordances-md' && attr(kid, 'data-affordances-md') === 'show') {
        if (gone || under) decline('shown panel inside what prune changes')
        if (CHANGED.has(kid.tag)) decline('shown panel prune changes')
        for (const id of (attr(kid, 'aria-labelledby') ?? '').split(/\s+/))
          if (id) found.tabs.add(id)
      }
      walk(kid, out || text, under || changed(kid))
    }
  }
  walk(root, false, false)
  return found
}
