import type { Element, Nodes, Parents, Text } from 'hast'

// html's insignificant whitespace, collapsed and trimmed in place as css would lay it out: what hast-util-to-mdast
// does to a tree before converting it, with hast-util-minify-whitespace (MIT, Titus Wormer). that one builds its
// tag-name tests again for every node it asks about, which was a quarter of a conversion; this is its algorithm,
// rule for rule, over sets. the names are its lists'
const BLOCKS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'br',
  'caption',
  'center',
  'col',
  'colgroup',
  'dd',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'legend',
  'li',
  'listing',
  'main',
  'menu',
  'nav',
  'ol',
  'optgroup',
  'option',
  'p',
  'plaintext',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
  'wbr',
  'xmp',
])
// what contributes content of its own, so whitespace beside it counts: embedded content and form controls
const CONTENT = new Set([
  'audio',
  'canvas',
  'embed',
  'iframe',
  'img',
  'math',
  'object',
  'picture',
  'svg',
  'video',
  'button',
  'input',
  'select',
  'textarea',
])
const SKIPPABLE = new Set([
  'area',
  'base',
  'basefont',
  'dialog',
  'datalist',
  'head',
  'link',
  'meta',
  'noembed',
  'noframes',
  'param',
  'rp',
  'script',
  'source',
  'style',
  'template',
  'track',
  'title',
])

type Whitespace = 'normal' | 'nowrap' | 'pre' | 'pre-wrap'
// before, after: whether a break comes before or after the node, so whitespace at that edge says nothing
type State = { whitespace: Whitespace; before: boolean | undefined; after: boolean | undefined }
type Result = { ignore: boolean; stripAtStart: boolean; remove: boolean }

const isElement = (node: Nodes | undefined): node is Element => node?.type === 'element'
const ignorable = (node: Nodes) => node.type === 'comment' || node.type === 'doctype'
const content = (node: Nodes | undefined) => isElement(node) && CONTENT.has(node.tagName)
const blocklike = (node: Nodes) => isElement(node) && BLOCKS.has(node.tagName)
const skippable = (node: Parents) =>
  (isElement(node) && (Boolean(node.properties.hidden) || SKIPPABLE.has(node.tagName))) ||
  ignorable(node)
const blank = (value: string) => !/[^ \t\n\f\r]/.test(value)
const collapse = (value: string) => String(value).replace(/[\t\n\v\f\r ]+/g, ' ')
const removable = (character: string) => character === ' ' || character === '\n'

export const minifyWhitespace = (tree: Nodes) => {
  minify(tree, { whitespace: 'normal', before: undefined, after: undefined })
}

const minify = (node: Nodes, state: State): Result => {
  if ('children' in node) {
    const edge = node.type === 'root' || blocklike(node)
    return all(node, {
      whitespace: whitespaceOf(node, state),
      before: edge || state.before,
      after: edge || state.after,
    })
  }
  if (node.type === 'text') {
    if (state.whitespace === 'normal') return minifyText(node, state)
    // (not `pre-wrap` or `pre`: those keep their whitespace)
    if (state.whitespace === 'nowrap') node.value = collapse(node.value)
  }
  return { ignore: ignorable(node), stripAtStart: false, remove: false }
}

const minifyText = (node: Text, state: State): Result => {
  const value = collapse(node.value)
  const result = { ignore: false, stripAtStart: false, remove: false }
  let start = 0
  let end = value.length
  if (state.before && removable(value.charAt(0))) start++
  if (start !== end && removable(value.charAt(end - 1))) {
    if (state.after) end--
    else result.stripAtStart = true
  }
  if (start === end) result.remove = true
  else node.value = value.slice(start, end)
  return result
}

const all = (parent: Parents, state: State): Result => {
  let before = state.before
  const { after, whitespace } = state
  const children = parent.children
  let length = children.length
  let index = -1
  while (++index < length) {
    const result = minify(children[index]!, {
      whitespace,
      before,
      after: collapsableAfter(children, index, after),
    })
    if (result.remove) {
      children.splice(index, 1)
      index--
      length--
    } else if (!result.ignore) {
      before = result.stripAtStart
    }
    // an element that contributes content somehow, a <select> or an <img>, allows whitespace again
    if (content(children[index])) before = false
  }
  return { ignore: false, stripAtStart: Boolean(before || after), remove: false }
}

// whether a break comes after the node at index: true where whitespace there says nothing
const collapsableAfter = (
  nodes: Nodes[],
  index: number,
  after?: boolean | undefined,
): boolean | undefined => {
  while (++index < nodes.length) {
    const node = nodes[index]!
    let result = boundary(node)
    if (result === undefined && 'children' in node && !skippable(node))
      result = collapsableAfter(node.children, -1)
    if (typeof result === 'boolean') return result
  }
  return after
}

// true: whitespace around the node says nothing; false: it does; undefined: its siblings or children decide
const boundary = (node: Nodes): boolean | undefined => {
  if (node.type === 'element') {
    if (content(node)) return false
    if (blocklike(node)) return true
  } else if (node.type === 'text') {
    if (!blank(node.value)) return false
  } else if (!ignorable(node)) {
    return false
  }
  return undefined
}

// see <https://html.spec.whatwg.org/multipage/rendering.html#flow-content-3>
const whitespaceOf = (node: Parents, state: State): Whitespace => {
  if (isElement(node))
    switch (node.tagName) {
      case 'listing':
      case 'plaintext':
      case 'script':
      case 'style':
      case 'xmp':
        return 'pre'
      case 'nobr':
        return 'nowrap'
      case 'pre':
        return node.properties.wrap ? 'pre-wrap' : 'pre'
      case 'td':
      case 'th':
        return node.properties.noWrap ? 'nowrap' : state.whitespace
      case 'textarea':
        return 'pre-wrap'
    }
  return state.whitespace
}
