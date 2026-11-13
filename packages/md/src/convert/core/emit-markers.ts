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
export const changed = (el: Element) =>
  CHANGED.has(el.tag) || (el.flags & FLAG.role && attr(el, 'role') === 'tablist') || isText(el)

// a strikethrough the tree pipeline writes outside a paragraph, where md-core writes what's in it otherwise: one
// that holds a list, or one in a list with no list item between
const STRUCK = new Set(['s', 'strike', 'del'])
const LISTS = new Set(['ul', 'ol', 'dir', 'menu'])
const holds = (el: Element, tags: Set<string>): boolean =>
  el.kids.some((kid) => typeof kid !== 'string' && (tags.has(kid.tag) || holds(kid, tags)))
export const struckList = (root: Element): boolean => {
  const walk = (el: Element, inList: boolean): boolean =>
    el.kids.some(
      (kid) =>
        typeof kid !== 'string' &&
        ((STRUCK.has(kid.tag) && (inList || holds(kid, LISTS))) ||
          walk(kid, LISTS.has(kid.tag) || (inList && kid.tag !== 'li'))),
    )
  return walk(root, false)
}

// chrome inside what prune changes, on a page whose chrome is stripped: the tree pipeline strips it after prune has
// judged what's around it (a link, a heading, a cell), md-core before
const CHROME = new Set(['nav', 'header', 'footer', 'aside', 'dialog'])
const CHROME_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'complementary'])
const isChrome = (el: Element) =>
  CHROME.has(el.tag) || (el.flags & FLAG.role && CHROME_ROLES.has(attr(el, 'role') ?? ''))
export const chromeUnderChanged = (root: Element): boolean => {
  const walk = (el: Element, under: boolean): boolean =>
    el.kids.some(
      (kid) =>
        typeof kid !== 'string' && ((under && isChrome(kid)) || walk(kid, under || changed(kid))),
    )
  return walk(root, false)
}

// whether something prune may change is above an element
export const underChanged = (el: Element) => {
  for (let at = el.up; at; at = at.up) if (changed(at)) return true
  return false
}

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
