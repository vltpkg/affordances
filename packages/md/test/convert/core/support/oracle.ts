import { parse } from 'parse5'
import {
  flagOf,
  NEVER,
  type Document,
  type Element,
  type Head,
  type Node,
} from '../../../../src/convert/core/types.ts'

// the Document parse.ts must build, made the slow way: parse5 reads the page as a browser does, and this walks its
// tree into the contract's shape. the parser is tested against it, and the emitter can be written against it before
// the parser exists
type P5 = {
  nodeName: string
  tagName?: string
  value?: string
  attrs?: { name: string; value: string }[]
  childNodes?: P5[]
  namespaceURI?: string
}

const source = (attrs: P5['attrs'] = []) =>
  attrs
    .map(
      ({ name, value }) => ` ${name}="${value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`,
    )
    .join('')
const textOf = (node: P5): string =>
  node.nodeName === '#text' ? (node.value ?? '') : (node.childNodes ?? []).map(textOf).join('')
const get = (node: P5, name: string) => node.attrs?.find((a) => a.name === name)?.value

export const oracle = (html: string): Document => {
  const document = parse(html, { scriptingEnabled: false }) as unknown as P5
  const head: Head = { meta: new Map(), jsonLd: [] }
  let headTitle: string | undefined
  let anyTitle: string | undefined
  let body: P5 | undefined
  const scan = (parent: P5, inHead: boolean, inSvg: boolean) => {
    for (const child of parent.childNodes ?? []) {
      const tag = child.tagName
      if (!tag) continue
      if (tag === 'title' && !inSvg) {
        if (inHead) headTitle ??= textOf(child)
        anyTitle ??= textOf(child)
      } else if (tag === 'link' && inHead && get(child, 'rel') === 'canonical')
        head.canonical ??= get(child, 'href')
      // the root's: an <html> in svg or math is a foreign element
      else if (tag === 'html' && child.namespaceURI === 'http://www.w3.org/1999/xhtml')
        head.lang ??= get(child, 'lang') || undefined
      else if (tag === 'body') body ??= child
      else if (tag === 'meta') {
        for (const kind of ['name', 'property']) {
          const value = get(child, kind)
          const key = `${kind} ${value}`
          if (value !== undefined && !head.meta.has(key))
            head.meta.set(key, get(child, 'content') ?? '')
        }
      } else if (tag === 'script' && get(child, 'type') === 'application/ld+json') {
        const value = textOf(child).trim()
        if (value) head.jsonLd.push(value)
      }
      scan(child, inHead || tag === 'head', inSvg || tag === 'svg')
    }
  }
  scan(document, false, false)
  head.title = (headTitle ?? anyTitle)?.trim() || undefined
  const mains: Element[] = []
  const build = (from: P5, up: Element | null, tag: string): Element => {
    const flags = (from.attrs ?? []).reduce((bits, { name }) => bits | flagOf(name), 0)
    const el: Element = { tag, attrs: source(from.attrs), flags, kids: [], up }
    if (up && (tag === 'main' || get(from, 'role') === 'main')) mains.push(el)
    for (const child of from.childNodes ?? []) {
      let kid: Node | undefined
      if (child.nodeName === '#text') kid = child.value ?? ''
      else if (child.tagName && !NEVER.has(child.tagName)) kid = build(child, el, child.tagName)
      if (kid === undefined) continue
      // text on both sides of something dropped is one text
      const last = el.kids.at(-1)
      if (typeof kid === 'string' && typeof last === 'string')
        el.kids[el.kids.length - 1] = last + kid
      else el.kids.push(kid)
    }
    return el
  }
  // the emitter never reads the scripts; scripts.test.ts holds the parser's to parse5's
  // markers are looked for wherever the page might have one
  const marked = /affordances-md/i.test(html)
  return {
    root: build(body ?? document, null, '#root'),
    head,
    mains,
    scripts: [],
    marked,
    streamed: undefined,
    selector: false,
    struck: false,
    formInSplit: false,
    formInCell: false,
    nowrapSplit: false,
    cut: undefined,
    lost: false,
  }
}

// a Document as plain data, for comparing two of them: attributes parsed, parents left out
export const plain = (doc: Document, attrs: (el: Element) => Record<string, string>) => {
  const node = (n: Node): unknown =>
    typeof n === 'string'
      ? n
      : { tag: n.tag, attrs: attrs(n), flags: n.flags, kids: n.kids.map(node) }
  const path = (el: Element): number[] => (el.up ? [...path(el.up), el.up.kids.indexOf(el)] : [])
  return {
    root: node(doc.root),
    // each main by where it is in the tree
    mains: doc.mains.map(path),
    head: { ...doc.head, meta: Object.fromEntries(doc.head.meta) },
  }
}
