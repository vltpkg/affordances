import { attr, endAttrs } from './attr.ts'
import { convertRoot, endConvert, materialize, startConvert } from './emit-convert.ts'
import { HEADING, headingText, IMAGE, Md, setext, TEXT, toMarkdown } from './emit-markdown.ts'
import { inCells, liftBlocks, relinkMarked } from './emit-lift.ts'
import { readMarkers, reads } from './emit-markers.ts'
import {
  begin,
  endPage,
  chrome,
  dropped,
  findMain,
  isTablist,
  isText,
  made,
  marked,
  setFills,
  setPage,
  setHeadings,
  setTabs,
  valueBearing,
} from './emit-prune.ts'
import { type Document, type Element, type Options, type Result } from './types.ts'
import { canonicalOf, collapsed, fenced, pageTitle, pretty, yaml } from '../shared.ts'

// markdown straight from the parser's tree: what @affordances/md's htmlToMarkdown writes for the same page. one walk
// prunes, extracts, collapses whitespace and converts (emit-prune, emit-convert) into a lean tree that's written out
// (emit-markdown); finish adds what the page's head says.
// a form is @affordances/md's own conversion of it, when md passes it in (options.convertForm). not here yet, where
// they'd hook in: streamed suspense boundaries (the parser), custom handlers
// a page's markdown. what md-core holds of the page while it writes it is let go after, written or thrown
// read: what readSlots found on this same tree, before anything converted it
export const emit = (doc: Document, options: Options = {}, read?: Read): Result => {
  try {
    return write(doc, options, read)
  } finally {
    endPage()
    endConvert()
    endAttrs()
  }
}
const write = (doc: Document, options: Options, read: Read | undefined): Result => {
  const { head } = doc
  const meta = (key: string) => (head.meta.get(key) ?? '').trim() || undefined
  const canonical = canonicalOf(head.canonical, options.url)
  const base = options.url ?? canonical
  const content = read?.content ?? contentOf(doc, options)
  const { outer, main, markers, strip } = content
  begin(strip)
  setPage(doc.root)
  // a slot with a fill is the fill, and what's in it never converts
  const fills = new Map<Element, string>()
  if (options.fills && markers) {
    const { slots, unique } = read?.slots ?? slotsIn(doc, content)
    for (const slot of slots) {
      const name = attr(slot, 'data-name') ?? ''
      const fill = Object.hasOwn(options.fills, name) ? options.fills[name] : undefined
      if (unique.has(name) && typeof fill === 'string') fills.set(slot, fill)
    }
  }
  setFills(fills)
  setTabs(markers?.tabs)
  setHeadings(markers?.headings)
  startConvert(options, base)
  const root = convertRoot(
    outer ? made(doc.root, outer, '#root') : main ? made(doc.root, [main], '#root') : doc.root,
  )
  // marker markdown, as @affordances/md treats it once the page is converted
  const relink = base && options.relinkMarkdown
  if (relinkMarked(root, relink ? (md) => relink(md, base, options.link) : undefined)) {
    inCells(root)
    liftBlocks(root)
  }
  return finish(
    root,
    {
      title: head.title || meta('property og:title'),
      description: meta('name description') ?? meta('property og:description'),
      canonical,
      image: meta('property og:image'),
      lang: head.lang || undefined,
      jsonLd: head.jsonLd,
    },
    canonical ?? options.url,
    options,
  )
}

// what becomes markdown: the page's <AgentMain>s, else its <main>, else the body without its chrome; or the whole body
type Content = {
  markers: ReturnType<typeof readMarkers> | undefined
  outer: Element[] | undefined
  main: Element | undefined
  strip: boolean
}
const contentOf = (doc: Document, options: Options): Content => {
  const auto = (options.extract ?? 'auto') === 'auto'
  const markers = doc.marked ? readMarkers(doc.root) : undefined
  const outer = auto && markers?.mains.length ? markers.mains : undefined
  const main = auto && !outer ? findMain(doc.mains) : undefined
  return { markers, outer, main, strip: auto && !outer && !main }
}

// what prune could take a slot out with: a link drops a block with nothing to read, a skeleton table goes, and so
// does a tablist whose tab labels a shown panel. where md-core can't tell from the tree as parsed, it declines
// what a slot can be inside for md-core to read it as the tree pipeline does: plain containers with no text rules of
// their own, headings, emphasis and code (in a pre too), a table's parts (the table itself is judged whole), a button, a label, a
// summary, and a form, which md's own form code converts
const SLOT_SAFE = new Set(
  (
    'div section article main aside header footer nav p span li ul ol blockquote figure ' +
    'h1 h2 h3 h4 h5 h6 em strong b i code pre tbody thead tfoot tr td button label summary details form affordances-md'
  ).split(' '),
)
const holdsValue = (el: Element): boolean =>
  el.kids.some((kid) => typeof kid !== 'string' && (valueBearing(kid) || holdsValue(kid)))
// the links an element is inside, outermost first
const linksAbove = (el: Element) => {
  const links: Element[] = []
  for (let at = el.up; at; at = at.up) if (at.tag === 'a') links.unshift(at)
  return links
}
// the <AgentSlot>s that reach the markdown, in page order, as @affordances/md finds them once the page is pruned and
// extracted: not hidden, not in an <AgentText>, not in chrome that's stripped, and never one inside another. and the
// names rendered once, which are the ones a fill can go to
const slotsIn = (doc: Document, { outer, main, strip, markers }: Content) => {
  const slots: Element[] = []
  let decline: string | undefined
  // whether each table a slot is in stands, judged once for all its slots
  const stands = new Map<Element, boolean>()
  const standingOnce = (table: Element) => {
    let known = stands.get(table)
    if (known === undefined) stands.set(table, (known = standing(table)))
    return known
  }
  const walk = (parent: Element, around: Element[], unlisted = false, valued = false) => {
    for (const kid of parent.kids) {
      if (typeof kid === 'string' || isText(kid) || dropped(kid) || (strip && chrome(kid))) continue
      if (kid.tag === 'affordances-md' && marked(kid) === 'slot') {
        // what prune makes of a slot depends on all that's around it, which md-core doesn't repeat. it reads a slot only
        // inside what prune leaves as it is (plain containers, headings, emphasis, a table's cells, a button, a label, a
        // summary) or what md-core judges as prune does: links, which keep a slot with something to read and drop one
        // without (and a link that says nothing but values is its label, or gone with the slot), a table that stands,
        // and a tablist where no tab labels a shown panel. never with a value around it (its text is a value, and prune
        // may take it out), nor in a link with one inside it, which the link takes out first. anything else declines
        const inLink = around.some((el) => el.tag === 'a')
        if (unlisted || valued) decline ??= "slot inside an element md-core can't judge"
        else if (inLink && holdsValue(kid)) decline ??= 'slot holding a value'
        else if (inLink) {
          const read = reads(kid)
          if (read === false) continue
          if (
            read === undefined ||
            around.some((el) => el.tag === 'a' && reads(el, false) !== true)
          )
            decline ??= 'slot inside <a>'
        }
        for (const el of around)
          if (el.tag === 'table' ? !standingOnce(el) : el.tag !== 'a' && markers?.tabs.size)
            decline ??= `slot inside ${el.tag === 'table' ? '<table>' : 'a tablist'}`
        slots.push(kid)
        continue
      }
      const risky = kid.tag === 'a' || kid.tag === 'table' || isTablist(kid)
      walk(
        kid,
        risky ? [...around, kid] : around,
        unlisted || !(SLOT_SAFE.has(kid.tag) || risky),
        valued || valueBearing(kid),
      )
    }
  }
  // the links above where the content starts (an <AgentMain> inside a link) judge its slots too
  for (const root of outer ?? [main ?? doc.root]) walk(root, linksAbove(root))
  const counts = new Map<string, number>()
  for (const slot of slots) {
    const name = attr(slot, 'data-name') ?? ''
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const unique = new Set([...counts].flatMap(([name, count]) => (count === 1 ? [name] : [])))
  const duplicate = [...counts].flatMap(([name, count]) => (count > 1 ? [name] : []))
  return { slots, unique, duplicate, decline }
}
const cells = (row: Element, tags: string[]) =>
  row.kids.filter((cell): cell is Element => typeof cell !== 'string' && tags.includes(cell.tag))
// a table that's no skeleton: a body row (not under thead, nor a first row of headers alone) has a cell that says
// something
const standing = (table: Element) => {
  const rows: [Element, boolean][] = []
  const walk = (parent: Element, inHead: boolean) => {
    for (const kid of parent.kids) {
      if (typeof kid === 'string' || dropped(kid)) continue
      if (kid.tag === 'tr') rows.push([kid, inHead])
      walk(kid, inHead || kid.tag === 'thead')
    }
  }
  walk(table, false)
  const headed = rows.some(([, inHead]) => inHead)
  return rows.some(
    ([row, inHead], i) =>
      !inHead &&
      !(i === 0 && !headed && cells(row, ['td']).length === 0) &&
      cells(row, ['td', 'th']).some((cell) => reads(cell) === true),
  )
}

// what a page's content and slots are, read from the tree as parsed (none of it reads what prune holds of a page): the
// first emit of that tree starts from it
export type Read = { content: Content; slots: ReturnType<typeof slotsIn> | undefined }
// a page's slot names, unique and duplicate, and the read they came from; or why md-core can't read them as
// @affordances/md does
export const readSlots = (
  doc: Document,
  options: Options = {},
): { unique: string[]; duplicate: string[]; read: Read } | { decline: string } => {
  const content = contentOf(doc, options)
  if (content.markers?.decline) return { decline: content.markers.decline }
  if (!content.markers) return { unique: [], duplicate: [], read: { content, slots: undefined } }
  const slots = slotsIn(doc, content)
  if (slots.decline) return { decline: slots.decline }
  return { unique: [...slots.unique], duplicate: slots.duplicate, read: { content, slots } }
}

type Meta = {
  title: string | undefined
  description: string | undefined
  canonical: string | undefined
  image: string | undefined
  lang: string | undefined
  jsonLd: string[]
}

// a node's text as written: its values, never an image's alt
const valueText = (node: Md): string => {
  if (node.type === IMAGE) return ''
  if (node.kids.length === 0) return node.value
  let text = ''
  for (const kid of node.kids) text += valueText(kid)
  return text
}

const isH1 = (node: Md) => node.type === HEADING && node.depth === 1

const finish = (root: Md, meta: Meta, url: string | undefined, options: Options): Result => {
  const { frontmatter = true, jsonLd = true } = options
  // the page's own h1 is its title; without one, the <title> stands in
  const hasH1 = root.kids.some(isH1)
  if (!hasH1 && meta.title) {
    const heading = new Md(HEADING, [new Md(TEXT, undefined, meta.title)])
    heading.depth = 1
    root.kids.unshift(heading)
  }
  // the block right after the h1 goes when it says exactly the description
  const h1 = root.kids.findIndex(isH1)
  const next = root.kids[h1 + 1]
  if (
    frontmatter &&
    meta.description &&
    next &&
    collapsed(valueText(materialize(next))) === collapsed(meta.description)
  )
    root.kids.splice(h1 + 1, 1)
  let output = toMarkdown(root)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const title = hasH1 ? pageTitle(meta.title, firstHeading(root)) : meta.title
  if (jsonLd && meta.jsonLd.length)
    output += `\n\n${meta.jsonLd.map((raw) => fenced('json', pretty(raw))).join('\n\n')}`
  const markdown =
    (frontmatter
      ? yaml({
          title,
          description: meta.description,
          url,
          image: meta.image,
          lang: meta.lang,
        })
      : '') + `${output}\n`
  return { markdown, title, url, tokens: Math.ceil(markdown.length / 4) }
}

// the text of the markdown's first # heading: the first h1 written atx style at the top
const firstHeading = (root: Md) => {
  for (const node of root.kids)
    if (isH1(node) && !setext(node)) return headingText(materialize(node))
  return undefined
}
