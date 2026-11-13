import { attr } from './attr.ts'
import { convertRoot, materialize, startConvert } from './emit-convert.ts'
import { HEADING, headingText, IMAGE, Md, setext, TEXT, toMarkdown } from './emit-markdown.ts'
import { inCells, liftBlocks, relinkMarked } from './emit-lift.ts'
import { readMarkers } from './emit-markers.ts'
import {
  begin,
  chrome,
  dropped,
  findMain,
  isText,
  made,
  marked,
  setFills,
  setPage,
  setTabs,
  valueBearing,
} from './emit-prune.ts'
import { FLAG, type Document, type Element, type Options, type Result } from './types.ts'

// markdown straight from the parser's tree: what @affordances/md's htmlToMarkdown writes for the same page. one walk
// prunes, extracts, collapses whitespace and converts (emit-prune, emit-convert) into a lean tree that's written out
// (emit-markdown); finish adds what the page's head says.
// not here yet, where they'd hook in: the form summary (convert's form()), streamed suspense boundaries (the
// parser), custom handlers
export const emit = (doc: Document, options: Options = {}): Result => {
  const { head } = doc
  const meta = (key: string) => (head.meta.get(key) ?? '').trim() || undefined
  const canonical = canonicalOf(head.canonical, options.url)
  const base = options.url ?? canonical
  const content = contentOf(doc, options)
  const { outer, main, markers } = content
  // a slot with a fill is the fill, and what's in it never converts
  const fills = new Map<Element, string>()
  if (options.fills && markers) {
    const { slots, unique } = slotsIn(doc, content)
    for (const slot of slots) {
      const name = attr(slot, 'data-name') ?? ''
      const fill = Object.hasOwn(options.fills, name) ? options.fills[name] : undefined
      if (unique.has(name) && typeof fill === 'string') fills.set(slot, fill)
    }
  }
  setFills(fills)
  setTabs(markers?.tabs)
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
  begin(false)
  setPage(doc.root)
  const main = auto && !outer ? findMain(doc.mains) : undefined
  const strip = auto && !outer && !main
  if (strip) begin(true)
  return { markers, outer, main, strip }
}

// the <AgentSlot>s that reach the markdown, in page order, as @affordances/md finds them once the page is pruned and
// extracted: not hidden, not in an <AgentText>, not in chrome that's stripped, and never one inside another. and the
// names rendered once, which are the ones a fill can go to
// what prune could take a slot out with: a link drops a block with nothing to read, a skeleton table goes, and so
// does a tablist whose tab labels a shown panel. where md-core can't tell from the tree as parsed, it declines
const slotsIn = (doc: Document, { outer, main, strip, markers }: Content) => {
  const slots: Element[] = []
  let decline: string | undefined
  const walk = (parent: Element, around: Element[]) => {
    for (const kid of parent.kids) {
      if (typeof kid === 'string' || isText(kid) || dropped(kid) || (strip && chrome(kid))) continue
      if (kid.tag === 'affordances-md' && marked(kid) === 'slot') {
        for (const el of around)
          if (el.tag === 'a' ? !says(kid) : el.tag === 'table' ? !standing(el) : markers?.tabs.size)
            decline ??= `slot inside ${el.tag === 'a' || el.tag === 'table' ? `<${el.tag}>` : 'a tablist'}`
        slots.push(kid)
        continue
      }
      const risky =
        kid.tag === 'a' ||
        kid.tag === 'table' ||
        (kid.flags & FLAG.role && attr(kid, 'role') === 'tablist')
      walk(kid, risky ? [...around, kid] : around)
    }
  }
  for (const root of outer ?? [main ?? doc.root]) walk(root, [])
  const counts = new Map<string, number>()
  for (const slot of slots) {
    const name = attr(slot, 'data-name') ?? ''
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const unique = new Set([...counts].flatMap(([name, count]) => (count === 1 ? [name] : [])))
  const duplicate = [...counts].flatMap(([name, count]) => (count > 1 ? [name] : []))
  return { slots, unique, duplicate, decline }
}
// whether prune leaves an element something to read: text outside what's hidden and what carries a value, an
// <AgentText>'s markdown, or a described image
const says = (el: Element): boolean =>
  el.kids.some((kid) =>
    typeof kid === 'string'
      ? kid.trim() !== ''
      : isText(kid)
        ? (attr(kid, 'data-md') ?? '') !== ''
        : !dropped(kid) &&
          !valueBearing(kid) &&
          ((kid.tag === 'img' && !!attr(kid, 'alt')) || says(kid)),
  )
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
      cells(row, ['td', 'th']).some(says),
  )
}

// a page's slot names, unique and duplicate, or why md-core can't read them as @affordances/md does
export const readSlots = (
  doc: Document,
  options: Options = {},
): { unique: string[]; duplicate: string[] } | { decline: string } => {
  const content = contentOf(doc, options)
  if (content.markers?.decline) return { decline: content.markers.decline }
  if (!content.markers) return { unique: [], duplicate: [] }
  const { unique, duplicate, decline } = slotsIn(doc, content)
  return decline ? { decline } : { unique: [...unique], duplicate }
}

// the page's canonical, if it's an http(s) url that fits in a Link header
const canonicalOf = (href: string | undefined, base: string | undefined) => {
  if (!href) return undefined
  try {
    const url = new URL(href, base)
    return /^https?:$/.test(url.protocol) && !/[,;]/.test(url.href) ? url.href : undefined
  } catch {
    return undefined
  }
}

type Meta = {
  title: string | undefined
  description: string | undefined
  canonical: string | undefined
  image: string | undefined
  lang: string | undefined
  jsonLd: string[]
}

// frontmatter, as @affordances/md writes it
const yaml = (data: Record<string, string | undefined>) => {
  const lines = Object.entries(data).flatMap(([key, value]) =>
    value ? [`${key}: ${JSON.stringify(value)}`] : [],
  )
  return lines.length ? `---\n${lines.join('\n')}\n---\n\n` : ''
}
const fenced = (lang: string, value: string) => {
  const fence = '`'.repeat(Math.max(3, ...(value.match(/`+/g) ?? []).map((run) => run.length + 1)))
  return `${fence}${lang}\n${value}\n${fence}`
}
const pretty = (raw: string) => {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

const TITLE_SEPARATORS = '·|–—-'
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const collapsed = (value: string) => value.replace(/\s+/g, ' ').trim()
// the page's title: its <title>, or its h1 when the <title> is the h1 and the site's name in a template
const pageTitle = (title: string | undefined, h1: string | undefined) => {
  const said = title === undefined ? undefined : collapsed(title)
  if (!said || !h1) return title
  const name = escapeRegExp(h1)
  const separator = ` [${TITLE_SEPARATORS}] `
  return new RegExp(`^${name}${separator}\\S|\\S${separator}${name}$`).test(said) ? h1 : title
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
