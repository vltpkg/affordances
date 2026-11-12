// generated html for the differential fuzz: small pages that pile up the constructs a parser gets wrong (raw text and
// its end tags, comments and their odd endings, quotes and '>' in attributes, references, misnesting, tables, foreign
// content, implied tags), seeded so a failure can be replayed

// where this parser knowingly differs from the oracle, on what the generator can make: a generated page one of these
// matches is left out of the fuzz, and the reason stays here to be seen. none at present: the differences known (see
// the report) are on pages this generator doesn't make
export const KNOWN: { why: string; matches: (html: string) => boolean }[] = []

// pages parse5 7.3 throws on: an end tag that empties its stack of open elements (popUntilTagNamePopped pops
// everything when the tag isn't there, then text goes into nothing). browsers don't, so the oracle can't speak to
// them; the fuzz counts and skips them, and checks this parser still parses them
export const ORACLE_THROWS = ['<table><svg><select><desc><select></table/>>']

// mulberry32: small, fast, and the same everywhere
export const random = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TAGS = (
  'p div span b i u s em strong code a font nobr big small tt strike li ul ol dl dt dd h1 h2 h3 pre listing ' +
  'table caption colgroup col tbody thead tfoot tr td th select option optgroup form button label input textarea ' +
  'title script style xmp iframe noembed noframes noscript template svg math mi mo mtext annotation-xml desc ' +
  'foreignObject path g html head body br img hr wbr image keygen object applet marquee canvas video audio source ' +
  'meta link base rt rp rb rtc ruby section article header footer nav main aside blockquote figure figcaption ' +
  'details summary dialog address center fieldset menu dir search hgroup frameset frame param track embed area ' +
  'sub sup var my-element x main'
).split(' ')
const RARE_TAGS = ['plaintext']
const ATTRS = [
  'class',
  'id',
  'href',
  'type',
  'color',
  'face',
  'size',
  'encoding',
  'lang',
  'rel',
  'name',
  'content',
  'property',
  'xlink:href',
  'XLINK:href',
  'definitionurl',
  'title',
  'data-x',
  'CLASS',
  'hidden',
  'HIDDEN',
  'aria-hidden',
  'Aria-Hidden',
  'style',
  'role',
  'ROLE',
  'contenteditable',
  'data-affordances-md',
  'data-mode',
  'data-mdast',
  'data-title',
  'nowrap',
  'rowspan',
  'colspan',
  'align',
  'aria-label',
  'aria-labelledby',
  'data-language',
  'xlink:title',
  'hiddenx',
  'rol',
]
const VALUES = [
  'x',
  'hidden',
  'HIDDEN',
  'canonical',
  'text/html',
  'application/ld+json',
  'a b',
  '>',
  'a>b',
  '"',
  "'",
  '&amp;',
  '&notit;',
  '&not',
  '&amp=',
  '&ampx',
  '&#x26;',
  '&#128;',
  '&#0;',
  '',
  '/',
  'red',
  'en',
  'og:title',
  'main',
  'Main',
  'main ',
  'ma&#105;n',
]
const WORDS = [
  'a',
  'text',
  ' ',
  '\n',
  '  \n ',
  '\t',
  '&amp;',
  '&lt;b&gt;',
  '&notit;',
  '&not',
  '&copy',
  '&#x80;',
  '&#150;',
  '&#0;',
  '&#xD800;',
  '&#x110000;',
  '&#X41;',
  '&#13;',
  '&#10;',
  '&#;',
  '&#x;',
  '&',
  '&;',
  '&zz;',
  '<',
  '< b',
  '>',
  '"',
  "'",
  '=',
  '\r\n',
  '\r',
  '\0',
  ' ',
  '©',
  '</',
  '</ >',
  '</>',
]
const COMMENTS = [
  '<!-- c -->',
  '<!---->',
  '<!-->',
  '<!--->',
  '<!-- a --!>',
  '<!-- a --!x -->',
  '<!-- <!-- -->',
  '<!-- a -- b -->',
  '<!--',
  '<?php x ?>',
  '</ x>',
  '</3>',
  '<!x>',
  '<![CDATA[ c ]]>',
  '<![CDATA[ c',
  '<!DOCTYPE html>',
  '<!doctype html public "-//W3C//DTD HTML 4.01 Transitional//EN">',
  '<!DOCTYPE html SYSTEM "about:legacy-compat">',
  '<!DOCTYPE>',
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "x">',
  '<!DOCTYPE foo>',
]
const RAW_BITS = [
  'x',
  '</script>',
  '</SCRIPT >',
  '</script',
  '</scriptx>',
  '<!--',
  '-->',
  '<script>',
  '<script ',
  '</style>',
  '</title>',
  '</textarea>',
  '</xmp>',
  '<b>',
  '&amp;',
  '-',
  '--',
  '<',
  '</',
  "'</script>'",
  '\0',
]

// a few tags that interact a lot, for the denser half of the pages: formatting misnested across blocks, tables and
// what gets fostered out of them, select, and foreign content with its integration points and breakouts
const DENSE = (
  'a b i nobr font p div li dd table caption tr td th tbody colgroup col select option optgroup svg math mi ' +
  'annotation-xml desc foreignObject title template button form h1 pre textarea script style noscript object br main'
).split(' ')

export const generate = (seed: number) => {
  const next = random(seed)
  const dense = next() < 0.5
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!
  const chance = (p: number) => next() < p
  const attrs = () => {
    let out = ''
    const count = chance(0.5) ? 0 : Math.floor(next() * 4)
    for (let i = 0; i < count; i++) {
      out += pick([' ', '\n', '  ', '/', ' /'])
      out += pick(ATTRS)
      if (chance(0.8)) {
        out += pick(['=', ' = ', '='])
        const value = pick(VALUES)
        const q = next()
        if (q < 0.45) out += `"${value.replaceAll('"', '&quot;')}"`
        else if (q < 0.8) out += `'${value.replaceAll("'", '&#39;')}'`
        else out += value.replace(/[\s"'>]/g, '') || 'v'
      }
    }
    if (chance(0.1)) out += '/'
    return out
  }
  const parts: string[] = chance(0.3) ? ['<!DOCTYPE html>'] : []
  const length = 1 + Math.floor(next() * (dense ? 80 : 40))
  for (let i = 0; i < length; i++) {
    const r = next()
    if (r < 0.3) parts.push(pick(WORDS))
    else if (r < 0.62) {
      const tag = chance(0.003) ? pick(RARE_TAGS) : pick(dense && chance(0.8) ? DENSE : TAGS)
      const name = chance(0.1) ? tag.toUpperCase() : tag
      parts.push(`<${name}${attrs()}>`)
      // raw text content right after its element
      if (/^(script|style|title|textarea|xmp|iframe|noembed|noframes)$/.test(tag) && chance(0.7)) {
        const bits = 1 + Math.floor(next() * 5)
        for (let b = 0; b < bits; b++) parts.push(pick(RAW_BITS))
        if (chance(0.8)) parts.push(`</${tag}>`)
      }
    } else if (r < 0.9)
      parts.push(`</${pick(dense && chance(0.8) ? DENSE : TAGS)}${chance(0.1) ? attrs() : ''}>`)
    else parts.push(pick(COMMENTS))
  }
  // sometimes a page ends inside a tag or an attribute
  if (chance(0.03))
    parts.push(pick(['<a href="x', '<div', '</p', '<a b=', '<!--x', '<!DOCTYPE html']))
  return parts.join('')
}
