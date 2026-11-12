import { convertRoot, startConvert } from './emit-convert.ts'
import { HEADING, headingText, IMAGE, Md, setext, TEXT, toMarkdown } from './emit-markdown.ts'
import { begin, findMain, made, setPage } from './emit-prune.ts'
import type { Document, Options, Result } from './types.ts'

// markdown straight from the parser's tree: what @affordances/md's htmlToMarkdown writes for the same page. one walk
// prunes, extracts, collapses whitespace and converts (emit-prune, emit-convert) into a lean tree that's written out
// (emit-markdown); finish adds what the page's head says.
// not here yet, where they'd hook in: <affordances-md> markers and slots (prune's mode() and convert's one()), the form
// summary (convert's form()), shown tab panels (prune), streamed suspense boundaries (the parser), custom handlers
export const emit = (doc: Document, options: Options = {}): Result => {
  const { head } = doc
  const meta = (key: string) => (head.meta.get(key) ?? '').trim() || undefined
  const canonical = canonicalOf(head.canonical, options.url)
  const base = options.url ?? canonical
  // extract: the page's <main>, else the body without its chrome; or the whole body
  const auto = (options.extract ?? 'auto') === 'auto'
  begin(false)
  setPage(doc.root)
  const main = auto ? findMain(doc.root) : undefined
  if (auto && !main) begin(true)
  startConvert(options, base)
  const root = convertRoot(main ? made(doc.root, [main], '#root') : doc.root)
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
    collapsed(valueText(next)) === collapsed(meta.description)
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
  for (const node of root.kids) if (isH1(node) && !setext(node)) return headingText(node)
  return undefined
}
