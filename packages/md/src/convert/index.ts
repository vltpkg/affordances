import type { Element, ElementContent, Nodes as HastNodes, Root as HastRoot } from 'hast'
import type { List, ListItem, Nodes as MdastNodes, PhrasingContent, Root as MdastRoot } from 'mdast'
import { fromHtml } from 'hast-util-from-html'
import { select, selectAll } from 'hast-util-select'
import { defaultHandlers, toMdast, type Handle } from 'hast-util-to-mdast'
import { toString } from 'hast-util-to-string'
import { gfmToMarkdown } from 'mdast-util-gfm'
import { toMarkdown } from 'mdast-util-to-markdown'
import { visit } from 'unist-util-visit'

export type Handlers = Record<string, Handle>

export type Options = {
  // base for absolutizing links and images, usually the page's url
  url?: string
  // 'auto': markers, then <main>, then the body minus its chrome; 'none': the whole body
  extract?: 'auto' | 'none' | ((tree: HastRoot) => HastRoot)
  frontmatter?: boolean
  jsonLd?: boolean
  handlers?: Handlers
}

// url: the page's canonical url (or the one given), for a Link header
export type Result = { markdown: string; title?: string; url?: string; tokens: number }

// never content, whatever the page says
// (form controls stay until conversion: the form summary and task-list items read them, then handlers drop them)
const ALWAYS_DROP = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'link',
  'meta',
  'head',
  'object',
  'embed',
  'audio',
  'video',
  'source',
])
const CHROME =
  'nav, header, footer, aside, dialog, [role=navigation], [role=banner], [role=contentinfo], [role=complementary], [aria-hidden=true], [hidden]'

const isElement = (node: unknown): node is Element => (node as Element)?.type === 'element'
const mode = (node: Element) =>
  node.tagName === 'affordances-md'
    ? String(node.properties.dataMode ?? '')
    : node.properties.dataAffordancesMd === 'skip'
      ? 'skip'
      : undefined

// a code point a css escape names, or U+FFFD where css reads one instead: zero, a surrogate, or past the last code point
const codePoint = (hex: string) => {
  const code = Number.parseInt(hex, 16)
  return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
    ? '\ufffd'
    : String.fromCodePoint(code)
}
// a style attribute as css reads it: comments gone, escapes (n\one, \6e one) decoded
const cssText = (style: string) =>
  style
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, '')
    .replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?|\\([^\n0-9a-f])/gi, (_, hex: string, char: string) =>
      hex ? codePoint(hex) : char,
    )
// display: none, visibility: hidden or content-visibility: hidden in a style attribute, however it's spaced, cased,
// commented, escaped or marked !important. opacity: 0 isn't hidden: motion libraries render it on the server as the
// first frame of an entrance animation, so it would drop content people see a moment later
const styleHidden = (node: Element) =>
  cssText(String(node.properties.style ?? ''))
    .split(';')
    .some((declaration) => {
      const [property = '', value = ''] = declaration
        .split(':')
        .map((part) => part.trim().toLowerCase())
      const keyword = value.replace(/\s*!\s*important$/, '')
      return (
        (property === 'display' && keyword === 'none') ||
        (property === 'visibility' && (keyword === 'hidden' || keyword === 'collapse')) ||
        (property === 'content-visibility' && keyword === 'hidden')
      )
    })

// what an icon or avatar link (an image without alt) is called: its aria-label, then its title
const linkLabel = (a: Element) =>
  String(a.properties.ariaLabel ?? '').trim() || String(a.properties.title ?? '').trim()

// a link with nothing to read: no text, no described image, no label
const nameless = (a: Element) =>
  !toString(a).trim() && !select('img[alt]:not([alt=""])', a) && !linkLabel(a)

// drop what never belongs (scripts, controls, comments) and apply skip/text/only markers, in place
const prune = (parent: HastRoot | Element) => {
  parent.children = parent.children.flatMap((child): ElementContent[] => {
    if (child.type === 'comment' || child.type === 'doctype') return []
    if (!isElement(child)) return [child as ElementContent]
    if (ALWAYS_DROP.has(child.tagName)) return []
    // only an <AgentText> flattened below is emitted verbatim; the page's own attribute is just an attribute
    delete child.properties.dataAffordancesMdText
    const m = mode(child)
    if (m === 'skip') return []
    if (m === 'text') {
      // a span or div, so whitespace around it follows the page's inline/block flow; emitted verbatim below
      const block = child.properties.dataBlock !== undefined && child.properties.dataBlock !== false
      const md = String(child.properties.dataMd ?? '')
      // the text child keeps whitespace around it significant (an empty span would let it collapse)
      return [
        {
          type: 'element',
          tagName: block ? 'div' : 'span',
          properties: { dataAffordancesMdText: md },
          children: [{ type: 'text', value: md }],
        },
      ]
    }
    if (m === 'only') {
      const { hidden: _, ...properties } = child.properties
      child.properties = properties
    } else if (
      (child.properties.hidden !== undefined && child.properties.hidden !== false) ||
      String(child.properties.ariaHidden) === 'true' ||
      styleHidden(child)
    )
      // hidden from people means hidden from agents, unless it was marked for them
      return []
    prune(child)
    // gone before the spacing below, so it leaves no gap
    if (child.tagName === 'a' && nameless(child)) return []
    return [child]
  })
  // links laid out side by side with css gaps have no text between them; give them a space
  parent.children = parent.children.flatMap((child, i, all): ElementContent[] => {
    const next = all[i + 1]
    return isElement(child) && child.tagName === 'a' && isElement(next) && next.tagName === 'a'
      ? [child as ElementContent, { type: 'text', value: ' ' }]
      : [child as ElementContent]
  })
}

// react streams resolved <Suspense> boundaries as <div hidden id="S:n"> after the shell, plus a $RC("B:n","S:n")
// script that swaps each into its <template id="B:n"> placeholder. do the same swap, so streamed content counts
const resolveStreamed = (tree: HastRoot) => {
  const swaps = new Map<string, string>()
  for (const script of selectAll('script', tree))
    for (const [, boundary, segment] of toString(script).matchAll(/\$RC\("(B:\d+)","(S:\d+)"\)/g))
      swaps.set(boundary!, segment!)
  if (!swaps.size) return
  const segments = new Map(
    selectAll('div[hidden][id^="S:"]', tree).map((div) => [String(div.properties.id), div]),
  )
  // nested boundaries land in later segments, so repeat until nothing more resolves
  for (let changed = true; changed;) {
    changed = false
    for (const template of selectAll('template[id^="B:"]', tree)) {
      const segment = segments.get(swaps.get(String(template.properties.id)) ?? '')
      const parent = template && findParent(tree, template)
      if (!segment || !parent) continue
      // the fallback runs from the placeholder to the boundary's closing <!--/$-->
      const start = parent.children.indexOf(template)
      let end = start + 1
      for (let depth = 0; end < parent.children.length; end++) {
        const node = parent.children[end]!
        if (node.type !== 'comment') continue
        if (node.value.startsWith('$')) depth++
        else if (node.value === '/$' && depth-- === 0) break
      }
      parent.children.splice(start, end - start, ...segment.children)
      segment.children = []
      changed = true
    }
  }
}

const findParent = (tree: HastRoot | Element, target: Element): HastRoot | Element | undefined => {
  for (const child of tree.children) {
    if (child === target) return tree
    if (isElement(child)) {
      const found = findParent(child, target)
      if (found) return found
    }
  }
}

const extract = (body: HastRoot, how: Options['extract']): HastRoot => {
  if (typeof how === 'function') return how(body)
  if (how === 'none') return body
  // a main inside another main is already part of it
  const marked = selectAll('affordances-md[data-mode=main]', body)
  const outer = marked.filter(
    (m) =>
      !marked.some(
        (other) => other !== m && selectAll('affordances-md[data-mode=main]', other).includes(m),
      ),
  )
  if (outer.length) return { type: 'root', children: outer }
  // the outermost landmark, so a <main> or role=main in a comment inside it never replaces it; among several, a real
  // <main> before a [role=main], since a role survives sanitizers that keep attributes
  const landmarks = selectAll('main, [role=main]', body)
  const outermost = landmarks.filter(
    (m) =>
      !landmarks.some((other) => other !== m && selectAll('main, [role=main]', other).includes(m)),
  )
  const main = outermost.find((m) => m.tagName === 'main') ?? outermost[0]
  if (main) return { type: 'root', children: [main] }
  // the page has no landmark: take the body and drop its chrome, but keep what was marked for agents
  const chrome = new Set(selectAll(CHROME, body).filter((el) => mode(el) !== 'only'))
  const strip = (parent: HastRoot | Element) => {
    const kept = (parent.children as ElementContent[]).filter(
      (child) => !(isElement(child) && chrome.has(child)),
    )
    parent.children = kept
    for (const child of kept) if (isElement(child)) strip(child)
  }
  strip(body)
  return body
}

const CONTROLS = new Set([
  'input',
  'select',
  'textarea',
  'button',
  'label',
  'legend',
  'option',
  'datalist',
  'output',
])

// which element contains which, within one form
const parents = (root: Element) => {
  const map = new Map<Element, Element>()
  const walk = (node: Element) => {
    for (const child of node.children)
      if (isElement(child)) {
        map.set(child, node)
        walk(child)
      }
  }
  walk(root)
  return map
}

const closest = (node: Element, tag: string, up: Map<Element, Element>) => {
  for (let at = up.get(node); at; at = up.get(at)) if (at.tagName === tag) return at
}

const text = (node: Element | undefined) => (node ? toString(node).replace(/\s+/g, ' ').trim() : '')

// a label's or legend's own words. a control inside one carries a value (a textarea's text, a select's options),
// which never leaves the page this way
const VALUED = new Set([
  'input',
  'select',
  'option',
  'optgroup',
  'textarea',
  'datalist',
  'output',
  'button',
])
const words = (node: Element | undefined): string => {
  const strip = (el: Element): Element => ({
    ...el,
    children: el.children.flatMap((child): ElementContent[] =>
      isElement(child) ? (VALUED.has(child.tagName) ? [] : [strip(child)]) : [child],
    ),
  })
  return node ? text(strip(node)) : ''
}

const labelOf = (field: Element, form: Element, up: Map<Element, Element>) => {
  const id = field.properties.id
  const forLabel = id
    ? selectAll('label', form).find((l) => String(l.properties.htmlFor) === String(id))
    : undefined
  return (
    words(forLabel) ||
    words(closest(field, 'label', up)) ||
    // a placeholder is an example of what to type, and a name is the server's: neither is the label
    String(field.properties.ariaLabel ?? '').trim()
  )
}

// a form becomes what it asks for, followed by whatever else it says; values, hidden fields and tokens never
// leave the page (a choice's selected/unavailable state is the page's, so that stays)
const form: Handle = (state, node) => {
  const up = parents(node)
  const fields = selectAll('input, select, textarea', node).filter(
    (field) =>
      !['hidden', 'submit', 'button', 'reset', 'image'].includes(
        String(field.properties.type ?? 'text'),
      ),
  )
  // fields in document order; radios and checkboxes sharing a name are one choice, labelled by their fieldset
  const entries: (string | Element[])[] = []
  const groups = new Map<string, Element[]>()
  for (const field of fields) {
    const type = field.tagName === 'input' ? String(field.properties.type ?? 'text') : field.tagName
    const name = String(field.properties.name ?? '')
    if ((type === 'radio' || type === 'checkbox') && name) {
      const group = groups.get(name)
      if (group) group.push(field)
      else groups.set(name, entries[entries.push([field]) - 1] as Element[])
      continue
    }
    const label = labelOf(field, node, up)
    if (label) entries.push(type === 'text' ? label : `${label} (${type})`)
  }
  const lines = entries.flatMap((entry) => {
    if (typeof entry === 'string') return [entry]
    const fieldset = closest(entry[0]!, 'fieldset', up)
    const legend = fieldset && select('legend', fieldset)
    // a group with no legend or aria-label lists its options alone
    const name = words(legend ?? undefined) || String(fieldset?.properties.ariaLabel ?? '').trim()
    // an option without a label is left out: its value is the server's, and values never leave the page
    const options = entry.flatMap((choice) => {
      const label = labelOf(choice, node, up)
      if (!label) return []
      const flags = [
        choice.properties.checked && 'selected',
        choice.properties.disabled && 'unavailable',
      ].filter(Boolean)
      return [flags.length ? `${label} (${flags.join(', ')})` : label]
    })
    if (!options.length) return []
    return [name ? `${name}: ${options.join(', ')}` : options.join(', ')]
  })

  // everything that isn't a control or a label still says something: hints, stock, errors
  const prose = (el: Element): Element => ({
    ...el,
    children: el.children.flatMap((child): ElementContent[] =>
      isElement(child) ? (CONTROLS.has(child.tagName) ? [] : [prose(child)]) : [child],
    ),
  })
  const rest = state.toFlow(state.all(prose(node)))
  if (!lines.length) return rest as never
  const list: List = {
    type: 'list',
    ordered: false,
    spread: false,
    children: lines.map((value): ListItem => ({
      type: 'listItem',
      spread: false,
      children: [{ type: 'paragraph', children: [{ type: 'text', value }] }],
    })),
  }
  return [
    {
      type: 'paragraph',
      children: [{ type: 'strong', children: [{ type: 'text', value: 'Form' }] }],
    },
    list,
    ...rest,
  ] as never
}

// a url's scheme as a browser reads it: new URL drops the tabs, newlines and controls that hide java\nscript:.
// a relative url is the page's own, so it's http(s) whatever the base
const scheme = (url: string) => {
  try {
    return new URL(url, 'https://relative.invalid/').protocol
  } catch {
    return undefined
  }
}
const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const IMAGE_SCHEMES = new Set(['http:', 'https:'])

const link: Handle = (state, node, parent) => {
  const href = String(node.properties.href ?? '').trim()
  const children = state.all(node) as PhrasingContent[]
  if (!href || href === '#' || !LINK_SCHEMES.has(scheme(href) ?? '')) return children
  // a heading's link to its own anchor (the usual self-link) is the heading, not a link
  if (href.startsWith('#') && isElement(parent) && /^h[1-6]$/.test(parent.tagName)) return children
  const title = (node.properties.title as string) ?? null
  if (!children.some((child) => child.type !== 'text' || child.value.trim())) {
    // an icon or avatar link reads as its label; prune dropped those without one
    const name = linkLabel(node)
    if (!name) return
    return { type: 'link', url: href, title, children: [{ type: 'text', value: name }] }
  }
  return { type: 'link', url: href, title, children }
}

const img: Handle = (_, node) => {
  const alt = String(node.properties.alt ?? '').trim()
  // no alt is decorative or undescribed; either way it tells an agent nothing
  if (!alt || !node.properties.src || !IMAGE_SCHEMES.has(scheme(String(node.properties.src)) ?? ''))
    return
  return {
    type: 'image',
    url: String(node.properties.src),
    alt,
    title: (node.properties.title as string) ?? null,
  }
}

const details: Handle = (state, node) => {
  const summary = node.children.find((c) => isElement(c) && c.tagName === 'summary') as
    | Element
    | undefined
  const rest = { ...node, children: node.children.filter((c) => c !== summary) }
  const head: MdastNodes[] = summary
    ? [
        {
          type: 'paragraph',
          children: [{ type: 'strong', children: state.all(summary) as PhrasingContent[] }],
        },
      ]
    : []
  return [...head, ...state.toFlow(state.all(rest))] as never
}

// **term**: definition, one paragraph per pair (html lets each pair sit in its own <div>)
const dl: Handle = (state, node) => {
  const out: MdastNodes[] = []
  let terms: PhrasingContent[][] = []
  const pairs = node.children.flatMap((child) =>
    isElement(child) && child.tagName === 'div' ? child.children : [child],
  )
  for (const child of pairs) {
    if (!isElement(child)) continue
    if (child.tagName === 'dt') terms.push(state.all(child) as PhrasingContent[])
    else if (child.tagName === 'dd') {
      const strong = terms.flatMap((t, i): PhrasingContent[] => [
        ...(i ? [{ type: 'text' as const, value: ', ' }] : []),
        { type: 'strong', children: t },
      ])
      out.push({
        type: 'paragraph',
        children: [
          ...strong,
          { type: 'text', value: ': ' },
          ...(state.all(child) as PhrasingContent[]),
        ],
      })
      terms = []
    }
  }
  return out as never
}

const wrap =
  (tag: string): Handle =>
  (state, node) =>
    [
      { type: 'html', value: `<${tag}>` },
      ...(state.all(node) as PhrasingContent[]),
      { type: 'html', value: `</${tag}>` },
    ] as never

// <AgentText md="…">, flattened by prune(): its markdown goes out verbatim
const verbatim =
  (fallback: Handle): Handle =>
  (state, node, parent) =>
    node.properties.dataAffordancesMdText === undefined
      ? fallback(state, node, parent)
      : ({ type: 'html', value: String(node.properties.dataAffordancesMdText) } as never)

// <pre data-title="route.ts"> keeps its title as fence meta: ```ts title="route.ts"
const pre: Handle = (state, node) => {
  const result = defaultHandlers.pre(state, node) as
    | { type: string; meta?: string | null }
    | undefined
  const title = node.properties.dataTitle
  if (result?.type === 'code' && title) result.meta = `title=${JSON.stringify(String(title))}`
  return result as never
}

const handlers: Handlers = {
  form,
  pre,
  a: link,
  img,
  details,
  dl,
  sup: wrap('sup'),
  sub: wrap('sub'),
  span: verbatim(defaultHandlers.span),
  div: verbatim(defaultHandlers.div),
  // main and only markers are plain wrappers
  'affordances-md': (state, node) => state.all(node) as never,
  // values and placeholders are the user's, not the page's; task-list checkboxes are read by the li handler
  input: () => undefined,
  select: () => undefined,
  textarea: () => undefined,
  button: () => undefined,
}

const absolutize = (tree: MdastRoot, base: string | undefined) => {
  if (!base) return
  visit(tree, (node) => {
    if (node.type !== 'link' && node.type !== 'image' && node.type !== 'definition') return
    try {
      node.url = new URL(node.url, base).href
    } catch {
      // leave what can't be resolved as written
    }
  })
}

const yaml = (data: Record<string, string | undefined>) => {
  const lines = Object.entries(data).flatMap(([key, value]) =>
    value ? [`${key}: ${JSON.stringify(value)}`] : [],
  )
  return lines.length ? `---\n${lines.join('\n')}\n---\n\n` : ''
}

const firstTitle = (node: HastRoot | Element): Element | undefined => {
  for (const child of node.children) {
    if (!isElement(child) || child.tagName === 'svg') continue
    if (child.tagName === 'title') return child
    const found = firstTitle(child)
    if (found) return found
  }
}

// the page's canonical, if it's an http(s) url that fits in a Link header: only the <head>'s, since content in the
// body (a comment, a sanitized post) can carry a <link> too, and never one with a , or ; that would end the header's value
// early (URL already encodes <, >, quotes and whitespace)
const canonicalOf = (href: string | undefined, base: string | undefined) => {
  if (!href) return undefined
  try {
    const url = new URL(href, base)
    return /^https?:$/.test(url.protocol) && !/[,;]/.test(url.href) ? url.href : undefined
  } catch {
    return undefined
  }
}

const head = (tree: HastRoot, base: string | undefined) => {
  const meta = (selector: string) =>
    String(select(selector, tree)?.properties.content ?? '').trim() || undefined
  // next streams metadata for dynamic pages, so <title> may arrive in the body; an svg's <title> isn't the page's
  const title = select('head title', tree) ?? firstTitle(tree)
  return {
    title: (title && toString(title).trim()) || meta('meta[property="og:title"]'),
    description: meta('meta[name=description]') ?? meta('meta[property="og:description"]'),
    canonical: canonicalOf(
      String(select('head link[rel=canonical]', tree)?.properties.href ?? ''),
      base,
    ),
    image: meta('meta[property="og:image"]'),
    lang: String(select('html', tree)?.properties.lang ?? '') || undefined,
    jsonLd: selectAll('script[type="application/ld+json"]', tree)
      .map((s) => toString(s).trim())
      .filter(Boolean),
  }
}

// a fence longer than any run of backticks in what it holds, so text that isn't valid json can't close it
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

export const htmlToMarkdown = (html: string, options: Options = {}): Result => {
  const { frontmatter = true, jsonLd = true } = options
  const tree = fromHtml(html)
  resolveStreamed(tree)
  const meta = head(tree, options.url)
  const bodyElement = select('body', tree)
  const body: HastRoot = {
    type: 'root',
    children: bodyElement ? bodyElement.children : tree.children,
  }
  prune(body)
  const content = extract(body, options.extract ?? 'auto')

  const mdast = toMdast(content as HastNodes, {
    handlers: { ...handlers, ...options.handlers },
  }) as MdastRoot
  const url = meta.canonical ?? options.url
  absolutize(mdast, options.url ?? meta.canonical)

  // the page's own h1 is its title; without one, the <title> stands in
  const hasH1 = mdast.children.some((node) => node.type === 'heading' && node.depth === 1)
  if (!hasH1 && meta.title)
    mdast.children.unshift({
      type: 'heading',
      depth: 1,
      children: [{ type: 'text', value: meta.title }],
    })

  let output = toMarkdown(mdast, {
    extensions: [gfmToMarkdown()],
    bullet: '-',
    emphasis: '_',
    rule: '-',
    fences: true,
  })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (jsonLd && meta.jsonLd.length)
    output += `\n\n${meta.jsonLd.map((raw) => fenced('json', pretty(raw))).join('\n\n')}`

  const markdown =
    (frontmatter
      ? yaml({
          title: meta.title,
          description: meta.description,
          url,
          image: meta.image,
          lang: meta.lang,
        })
      : '') + `${output}\n`
  return { markdown, title: meta.title, url, tokens: Math.ceil(markdown.length / 4) }
}
