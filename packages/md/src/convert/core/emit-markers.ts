import { attr } from './attr.ts'
import {
  dropped,
  INLINE,
  isTablist,
  isText,
  LABEL_HOSTS,
  marked,
  role,
  valueBearing,
  words,
} from './emit-prune.ts'
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
  // each shown tab panel's heading, as @affordances/md finds its tabs ('' when it finds none)
  headings?: Map<Element, string>
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
export const changed = (el: Element) => CHANGED.has(el.tag) || isTablist(el) || isText(el)

// a strikethrough the tree pipeline writes outside a paragraph, where md-core writes what's in it otherwise: one
// that holds a list, or one in a list with no list item between
const STRUCK = new Set(['s', 'strike', 'del'])
const LISTS = new Set(['ul', 'ol', 'dir', 'menu'])
// what makes a list in a strikethrough: a list, or an item on its own (a <li> or <dd> without one)
const LISTED = new Set([...LISTS, 'li', 'dd'])
const holds = (el: Element, tags: Set<string>): boolean =>
  el.kids.some((kid) => typeof kid !== 'string' && (tags.has(kid.tag) || holds(kid, tags)))
export const struckList = (root: Element): boolean => {
  const walk = (el: Element, inList: boolean): boolean =>
    el.kids.some(
      (kid) =>
        typeof kid !== 'string' &&
        ((STRUCK.has(kid.tag) && (inList || holds(kid, LISTED))) ||
          walk(kid, LISTS.has(kid.tag) || (inList && kid.tag !== 'li'))),
    )
  return walk(root, false)
}

// whether @affordances/md's prune leaves an element something to read, judged on the page as parsed: a link drops a
// block with nothing to read, and a table of nothing is a skeleton, each judged on what prune has made of them. text
// outside what's hidden counts (a value's too: a link's blocks are judged before its values are taken out), and so do
// an <AgentText>'s markdown and a described image. undefined where prune could change what's there first: a tablist
// it may take out, a shown tab panel it heads. without values, it's what a link itself is judged by once its blocks
// are: a link whose text is all values (an <output>, a field) reads as its label, or is gone. and but a tag, what a
// label reads as without it (its button): there, what's hidden is never read, an <AgentText> included, and any tab
// panel is undefined
export const reads = (el: Element, values = true, but?: string): boolean | undefined => {
  let said = false
  const walk = (parent: Element): boolean => {
    for (const kid of parent.kids) {
      if (typeof kid === 'string') {
        if (kid.trim() !== '') said = true
        continue
      }
      if (but !== undefined && (kid.tag === but || dropped(kid))) continue
      if (isText(kid)) {
        if ((attr(kid, 'data-md') ?? '') !== '') said = true
        continue
      }
      if (dropped(kid) || (!values && valueBearing(kid))) continue
      if (
        isTablist(kid) ||
        (role(kid) === 'tabpanel' && (but !== undefined || marked(kid) === 'show'))
      )
        return false
      if (kid.tag === 'img' && attr(kid, 'alt')) said = true
      if (!walk(kid)) return false
    }
    return true
  }
  return walk(el) ? said : undefined
}

// whether a link around an element takes something out of it before it's read: what carries a value, or a block with
// nothing to read, at any depth (prune has already left out what's hidden). judged on the page as parsed, by reads(),
// which never prunes: this runs before the fills are known
const stripped = (el: Element): boolean =>
  el.kids.some(
    (kid) =>
      typeof kid !== 'string' &&
      !isText(kid) &&
      !dropped(kid) &&
      (valueBearing(kid) ||
        (!INLINE.has(kid.tag) && kid.tag !== 'img' && kid.tag !== 'br' && reads(kid) !== true) ||
        stripped(kid)),
  )

// whether something prune may change is above an element
export const underChanged = (el: Element) => {
  for (let at = el.up; at; at = at.up) if (changed(at)) return true
  return false
}

const mode = (el: Element) =>
  el.flags & (FLAG['data-affordances-md'] | FLAG['data-mode']) ? marked(el) : undefined

// the ids of the [role=tab]s in a tablist, at any depth
const tabsIn = (tablist: Element) => {
  const ids: string[] = []
  const walk = (parent: Element) => {
    for (const kid of parent.kids) {
      if (typeof kid === 'string') continue
      if (role(kid) === 'tab') ids.push(attr(kid, 'id') ?? '')
      walk(kid)
    }
  }
  walk(tablist)
  return ids
}

export const readMarkers = (root: Element): Markers => {
  const found: Markers = { mains: [], tabs: new Set() }
  const uncertain = new Set<string>()
  const tablists: string[][] = []
  // each [role=tab] with an id, by its id, with the tablist it's in; and the shown panels prune heads by them
  const tabsById = new Map<string, (Element | undefined)[]>()
  const headedPanels: Element[] = []
  const decline = (why: string) => {
    found.decline ??= why
  }
  // under: something prune leaves out or may change is above; inLink: only links are, which keep a block they hold
  // if it has something to read and drop it if it hasn't
  const walk = (
    parent: Element,
    gone: boolean,
    under: boolean,
    inLink = false,
    tablist: Element | undefined = undefined,
    inMain = false,
  ) => {
    for (const kid of parent.kids) {
      if (typeof kid === 'string') continue
      const text = isText(kid)
      const out = gone || (!text && dropped(kid))
      const m = mode(kid)
      // the outermost <AgentMain>s are the page's; what's inside one is read on, as the rest of the page is
      const main = kid.tag === 'affordances-md' && m === 'main' && !out
      if (main && !inMain) {
        if (under && !inLink) decline('main marker inside what prune changes')
        else if (inLink) {
          const read = reads(kid)
          // a link that reads only by its values is its label, or gone with the main: md-core declines it
          let silent = false
          for (let at = kid.up; at; at = at.up)
            if (at.tag === 'a' && reads(at, false) !== true) silent = true
          // a link drops it, and the page has no <AgentMain> there, whether the link stays or goes
          if (read === false) continue
          if (read === undefined || silent || stripped(kid))
            decline('main marker inside what prune changes')
        }
        found.mains.push(kid)
      }
      // data-affordances-md="show", as the attribute says it: what a tablist's tabs are checked against. one under
      // something hidden or something prune changes may or may not be found by then (prune finds them on a page it
      // is pruning in place): its tabs are uncertain, which matters only if they'd decide a tablist
      if (kid.tag !== 'affordances-md' && attr(kid, 'data-affordances-md') === 'show') {
        if (CHANGED.has(kid.tag)) decline('shown panel prune changes')
        for (const id of (attr(kid, 'aria-labelledby') ?? '').split(/\s+/))
          if (id) (gone || under ? uncertain : found.tabs).add(id)
      }
      // a tablist and its tabs' ids, as prune reads them: every [role=tab] in it, hidden or not
      const list = isTablist(kid)
      if (list) tablists.push(tabsIn(kid))
      if (kid.flags & FLAG.role) {
        const id = role(kid) === 'tab' ? attr(kid, 'id') : undefined
        if (id) tabsById.set(id, [...(tabsById.get(id) ?? []), tablist])
        if (role(kid) === 'tabpanel' && mode(kid) === 'show' && !out) headedPanels.push(kid)
      }
      const changes = changed(kid)
      // still only links above, if this is one (or changes nothing) and only links were
      const onlyLinks = changes ? kid.tag === 'a' && (inLink || !under) : inLink
      walk(kid, out || text, under || changes, onlyLinks, list ? kid : tablist, inMain || main)
    }
  }
  walk(root, false, false)
  // a tablist goes when one of its tabs labels a shown panel: md-core declines one only uncertain tabs would take out
  for (const ids of tablists)
    if (!ids.some((id) => found.tabs.has(id)) && ids.some((id) => uncertain.has(id)))
      decline('shown panel inside what prune changes')
  for (const id of uncertain) found.tabs.add(id)
  if (headedPanels.length) {
    const headings = tabHeadings(root, found.tabs)
    if (headings) found.headings = headings
    else decline("shown panel headed by a tab md-core can't place")
  }
  return found
}

// how @affordances/md heads each shown tab panel: by its tabs' words, from the page's ids, which prune gathers the first
// time it needs them (a shown panel to head, or a link with nothing to read to name), from the page as pruned so far.
// prune goes through the page depth first, each element once all inside it is done: by then a tablist whose tabs label a
// shown panel is gone from what holds it (once that's done), a label host with only buttons in it has them unwrapped, a
// link with nothing to read is its label. so a tab is found if none of that has happened to it yet. undefined where
// md-core can't tell: a link it can't judge before that moment, or a tab in a link or a table
const tabHeadings = (root: Element, shown: Set<string>): Map<Element, string> | undefined => {
  let clock = 0
  let first = Infinity
  let unsure = Infinity
  const done = new Map<Element, number>()
  // an element gone, with all in it, once what holds it is done; or itself gone at a time
  const goneWith = new Map<Element, Element>()
  const goneAt = new Map<Element, number>()
  const never = new Set<Element>()
  const doubtful = new Set<Element>()
  const panels: Element[] = []
  const withIds: Element[] = []
  const below = (el: Element, each: (el: Element) => void) => {
    for (const kid of el.kids)
      if (typeof kid !== 'string') {
        each(kid)
        below(kid, each)
      }
  }
  const visit = (parent: Element, inDoubt: boolean) => {
    for (const kid of parent.kids) {
      if (typeof kid === 'string') continue
      if (attr(kid, 'id') !== undefined) withIds.push(kid)
      if (isText(kid) || dropped(kid)) {
        never.add(kid)
        below(kid, (el) => {
          if (attr(el, 'id') !== undefined) withIds.push(el)
          never.add(el)
        })
        continue
      }
      const list = isTablist(kid)
      if (list && tabsIn(kid).some((id) => shown.has(id))) {
        goneWith.set(kid, parent)
        below(kid, (el) => {
          if (attr(el, 'id') !== undefined) withIds.push(el)
        })
        continue
      }
      if (inDoubt) doubtful.add(kid)
      visit(kid, inDoubt || kid.tag === 'a' || kid.tag === 'table')
      const at = ++clock
      done.set(kid, at)
      if (role(kid) === 'tabpanel' && mode(kid) === 'show') {
        panels.push(kid)
        first = Math.min(first, at)
      }
      if (kid.tag === 'a') {
        const read = reads(kid, false)
        if (read === false) {
          first = Math.min(first, at)
          below(kid, (el) => goneAt.set(el, Math.min(goneAt.get(el) ?? Infinity, at)))
        } else if (read === undefined) unsure = Math.min(unsure, at)
      }
      if (LABEL_HOSTS.has(kid.tag) && reads(kid, true, 'button') === false)
        below(kid, (el) => {
          if (el.tag === 'button') goneAt.set(el, Math.min(goneAt.get(el) ?? Infinity, at))
        })
    }
  }
  visit(root, false)
  if (unsure < first) return undefined
  const present = (el: Element) => {
    if (never.has(el)) return false
    for (let at: Element | null = el; at && at !== root; at = at.up) {
      if ((goneAt.get(at) ?? Infinity) <= first) return false
      const holder = goneWith.get(at)
      if (holder && (done.get(holder) ?? Infinity) <= first) return false
    }
    return true
  }
  const headings = new Map<Element, string>()
  for (const panel of panels) {
    const names: string[] = []
    for (const id of (attr(panel, 'aria-labelledby') ?? '').split(/\s+/)) {
      if (!id) continue
      const tab = withIds.find((el) => attr(el, 'id') === id && !never.has(el))
      if (!tab) continue
      if (doubtful.has(tab)) return undefined
      if (!present(tab)) continue
      if (role(tab) === 'tab') {
        const said = words(tab)
        if (said) names.push(said)
      }
    }
    headings.set(panel, names.join(' '))
  }
  return headings
}
