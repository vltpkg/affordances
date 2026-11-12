import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { attr, parseAttrs, scanAttr } from '../src/attr.ts'
import { ENTITIES } from '../src/entities-table.ts'
import { parse } from '../src/parse.ts'
import { NEVER, type Element, type Node } from '../src/types.ts'
import { generate, KNOWN, ORACLE_THROWS } from './parse-fuzz.ts'
import { difference } from './parse-support.ts'

// every case holds the parser to the oracle (parse5, reading the page as a browser with scripting off does): the
// difference is the first place the two Documents part, or undefined

describe('text and character references', () => {
  test.each([
    'plain text',
    'a &amp; b &lt;c&gt; &quot;d&quot; &apos;',
    '&copy &copy; &COPY &AMP &amp',
    // legacy names match without ';', the longest one that does
    '&notit; &notin; &not &noti &ampx &amp;x',
    '&NotNestedGreaterGreater; &CounterClockwiseContourIntegral; &zwnj;&zwj;',
    '&unknown; &; & &# &#; &#x; &#xg; &x',
    '&#65; &#x41; &#X41; &#0065 &#x41x',
    // windows-1252 for the c1 controls, U+FFFD for nul, surrogates and past the last code point
    '&#128; &#x80; &#150; &#159; &#129; &#x8d;',
    '&#0; &#xD800; &#xDFFF; &#x110000; &#99999999999999999999; &#x10FFFF;',
    '&#13; &#x0d; &#1; &#x7f; &#xFDD0; &#xFFFE;',
    'a < b > c',
    '< b',
    '<3',
    'a\r\nb\rc\n',
    'a\0b\0\0c',
    '<math>\0</>\0</>\0</ >\0</math>',
    '\0</>\0x',
    '\0',
    'tab\there',
  ])('%j', (html) => expect(difference(html)).toBeUndefined())
})

describe('rcdata: title and textarea', () => {
  test.each([
    '<title>a <b>bold</b> &amp; </title>',
    '<title>x</titlex></title>',
    '<title>x</TITLE >y',
    '<title>x</title foo="</title>">y',
    '<title>a</title',
    '<title>never closed <p>',
    '<textarea>\nfirst newline dropped</textarea>',
    '<textarea>\n\nonly one dropped</textarea>',
    '<textarea><!-- not a comment --></textarea>',
    '<textarea>a\0b</textarea>',
    '<p><textarea>&lt;b&gt;</textarea>',
  ])('%j', (html) => expect(difference(html)).toBeUndefined())
})

describe('rawtext: style, xmp, iframe, noembed, noframes', () => {
  test.each([
    '<style>p { color: red } </p> <b></style>after',
    '<xmp><b>&amp;</b></xmp>',
    '<p>a<xmp>b</xmp>',
    '<iframe><p>x</p></iframe>after',
    '<noembed><b>x</b></noembed>after',
    '<noframes><b>x</b></noframes>after',
    '<style></styl></style >x',
    '<style>\0</style>',
    // noscript isn't raw text with scripting off: its content is parsed
    '<noscript><b>x</b></noscript>after',
    '<head><noscript><link rel=x><b>y</b></noscript></head>',
  ])('%j', (html) => expect(difference(html)).toBeUndefined())
})

describe('script data and its escapes', () => {
  test.each([
    '<script>if (a < b) document.write("</div>")</script>after',
    '<script>var s = "</scr" + "ipt>"</script>after',
    '<script>a</script >b',
    '<script>a</SCRIPT>b',
    '<script>a</scriptx>still script</script>b',
    '<script><!-- <script> </script> still --></script>after',
    '<script><!-- </script>after',
    '<script><!--></script>after',
    '<script><!---></script>after',
    '<script><!-- a --></script>after',
    '<script><!-- <script></script> --> </script>after',
    '<script><!-- <SCRIPT>x</SCRIPT> -- > --></script>after',
    '<script><!-- <scripts></script>after',
    '<script><!-- -- <script --></script>after',
    '<script>\0</script>',
    '<script>never closed <p>x',
    '<script>a</script',
    '<script type="application/ld+json">{"a": "</p>"}</script>',
  ])('%j', (html) => expect(difference(html)).toBeUndefined())
})

describe('plaintext', () => {
  test.each(['<plaintext><b>x</b></plaintext>&amp;', '<p>a<plaintext>b'])('%j', (html) =>
    expect(difference(html)).toBeUndefined(),
  )
})

describe('comments and bogus comments', () => {
  test.each([
    'a<!-- c -->b',
    'a<!---->b',
    'a<!-->b',
    'a<!--->b',
    'a<!-- c --!>b',
    'a<!-- c --!x -->b',
    'a<!-- c -- d -->b',
    'a<!-- <!-- nested --> -->b',
    'a<!-- c ---->b',
    'a<!--',
    'a<!-- never closed <p>x',
    'a<?php echo "<b>"; ?>b',
    'a</ x>b',
    'a</3>b',
    'a</>b',
    'a<!x>b',
    'a<!>b',
    'a<![CDATA[ c ]]>b',
    'a</',
    'a<',
  ])('%j', (html) => expect(difference(html)).toBeUndefined())
})

describe('cdata only in foreign content', () => {
  test.each([
    '<svg><![CDATA[ <b> ]]></svg>after',
    '<math><mi>x</mi><![CDATA[ a<b ]]></math>',
    '<math><![CDATA[ a\0\0b ]]></math>',
    '<math><![CDATA[ never closed',
    '<div><![CDATA[ <b>x</b> ]]></div>',
  ])('%j', (html) => expect(difference(html)).toBeUndefined())
})

describe('doctypes and quirks', () => {
  test.each([
    // a p doesn't close for a table in quirks mode
    '<!DOCTYPE html><p><table><tr><td>x</table>',
    '<p><table><tr><td>x</table>',
    '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN"><p><table></table>',
    '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd"><p><table></table>',
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "x"><p><table></table>',
    '<!DOCTYPE html SYSTEM "about:legacy-compat"><p><table></table>',
    '<!DOCTYPE html SYSTEM "http://www.ibm.com/data/dtd/v11/ibmxhtml1-transitional.dtd"><p><table></table>',
    '<!doctype HTML><p><table></table>',
    '<!DOCTYPEhtml><p><table></table>',
    '<!DOCTYPE><p><table></table>',
    '<!DOCTYPE foo><p><table></table>',
    '<!DOCTYPE html "x"><p><table></table>',
    '<!DOCTYPE html PUBLIC><p><table></table>',
    '<!DOCTYPE html PUBLIC "html"><p><table></table>',
    '<!DOCTYPE html PUBLIC "x" junk><p><table></table>',
    '<!DOCTYPE html SYSTEM "x" junk><p><table></table>',
    '<!DOCTYPE html PUBLIC "x>"><p><table></table>',
    'x<!DOCTYPE html><p><table></table>',
    '<!DOCTYPE html',
  ])('%j', (html) => expect(difference(html)).toBeUndefined())
})

describe('tags and attributes', () => {
  test.each([
    '<a href="x>y" title=\'a>b\'>z</a>',
    '<a href=x>y</a>',
    "<a b'c'>x</a>",
    '<a b"c">x</a>',
    "<a b='>'c>x</a>",
    '<a =b>x</a>',
    '<a ==b>x</a>',
    '<a b= c>x</a>',
    '<a b =c d>x</a>',
    '<a b="1"c="2">x</a>',
    '<a b=x/>y</a>',
    '<a/b/c>x</a>',
    '<a b=>x</a>',
    '<a href="&amp;&notit;&not=&amp=x&ampx">x</a>',
    "<a href='&#128;&#0;&#x26;'>x</a>",
    '<a HREF="X" Class=y>x</a>',
    '<a b=1 b=2 B=3>x</a>',
    '<a b="\0">x</a>',
    '<a\0b c>x</a>',
    '<DIV>upper</DiV>',
    '<div\n\tclass="a"\fid=b>x</div>',
    '<div class="a\r\nb">x</div>',
    '<my-element data-x="1">x</my-element>',
    '<div >no attributes</div>',
    '<br/><br /><img src=x/><hr/>',
    '<div/>not self-closing</div>',
    '<a href="never closed>x',
    '<div',
    '<div class',
    '</div foo="bar">x',
  ])('%j', (html) => expect(difference(html)).toBeUndefined())
})

describe('void elements and implied end tags', () => {
  test.each([
    '<p>a<p>b<div>c</div><p>d',
    '<p>a<h1>b</h1><p>c<ul><li>d</ul>',
    '<p>a<table></table>',
    '<p>a<hr>b',
    '<p>a<pre>\nb</pre>',
    '<pre>\n\nx</pre><listing>\nx</listing>',
    '<pre>&#10;x</pre>',
    '<pre><!---->\nx</pre>',
    '<ul><li>a<li>b<ul><li>c</ul><li>d</ul>',
    '<li>a<div><li>b</div>',
    '<dl><dt>a<dd>b<dt>c<dd>d</dl>',
    '<select><option>a<option>b<optgroup><option>c<optgroup>d</select>',
    '<h1>a<h2>b</h2>c</h1>',
    '<h1>a</h2>b',
    '<ruby>a<rb>b<rt>c<rp>d<rtc>e<rt>f</ruby>',
    '<button>a<button>b</button>',
    '<form><form>x</form></form>',
    '<form>a</form>b</form>c',
    '<nobr>a<nobr>b</nobr>',
    '<a>a<a>b</a>c',
    '<a href=1>a<div>b<a href=2>c</a></div>',
    '<br>a<input>b<img>c<wbr>d<embed>e<keygen>f<area>g',
    '<image src=x>',
    '<p>a</p></p>b',
    '</p>x',
    '</br>x',
    '</div>x',
    '<div>a</span>b</div>',
    '<p><b>x</p>y',
  ])('%j', (html) => expect(difference(html)).toBeUndefined())
})

describe('misnested formatting: the adoption agency', () => {
  test.each([
    '<b>1<p>2</b>3</p>',
    '<b>1<i>2</b>3</i>4',
    '<a href=x>1<p>2</a>3',
    '<b><b><b><b>x</b></b></b></b>',
    '<b>1<div>2<i>3</div>4</b>5',
    '<b id=1><b id=1><b id=1><b id=1>x',
    '<b><b><b><b><p>x</b>y',
    '<b>a<table><tr><td>b</b>c</td></tr></table>d',
    '<b><noscript><p>x</b>y',
    '<b><object><p>x</b>y</object>',
    '<i><b><p>x</i>y',
    '<em><strong><code><s><u><p>x</em>y',
    '<b>a</b></b>b',
    '<b>x<p>y<b>z',
    '<font color=red>a<p>b</font>c',
  ])('%j', (html) => expect(difference(html)).toBeUndefined())
})

describe('tables and foster parenting', () => {
  test.each([
    '<table><tr><td>a</td></tr></table>',
    '<table><td>a<td>b<tr><td>c</table>',
    '<table>text<tr><td>x</table>',
    '<table>  <tr>  <td>x</td>  </tr>  </table>',
    '<table><b>x</b><tr><td>y</table>',
    '<table><div>x</div></table>',
    '<table><caption>c<td>x</table>',
    '<table><colgroup><col><col></colgroup><tbody><tr><th>h</th></tr></tbody></table>',
    '<table><col><tr><td>x</table>',
    '<table><thead><tr><td>a<tbody><tr><td>b<tfoot><tr><td>c</table>',
    '<table><tr><td>a<table><tr><td>b</table>c</table>',
    '<table><table>x</table>',
    '<table><input type=hidden><input type=text>x</table>',
    '<table><form><tr><td>x</form></table>',
    '<table><script>a</script><style>b</style><tr><td>x</table>',
    '<table><select><option>a</table>b',
    '<table><tr><td><select><option>a<td>b</table>',
    '<table><tr>a<!-- c -->b<td>x</table>',
    '<table><tr><td>a</tr></td>b</table>',
    '<table></tbody></tr></td>x</table>',
    '<td>outside</td>',
    '<table><tr><td>x</table></td>y',
    '<table><caption>a<p>b</caption>c</table>',
    '<p>a<table><tr><td>b</p>c</td></tr></table>',
    '<table>&#0;<tr><td>x\0y</table>',
  ])('%j', (html) => expect(difference(html)).toBeUndefined())
})

describe('select', () => {
  test.each([
    '<select><option>a</option><b>bold?</b>text</select>',
    '<select><input>x',
    '<select><textarea>x</textarea>',
    '<select><select>x',
    '<select><script>a</script><option>b</select>',
    '<select><hr><option>a</select>',
    '<select><optgroup><option>a</optgroup>b</select>',
    '<select>\0x</select>',
  ])('%j', (html) => expect(difference(html)).toBeUndefined())
})

describe('html, head and body', () => {
  test.each([
    '',
    '   ',
    'x',
    '<html>',
    '<head>',
    '<body>',
    '<html><head><title>t</title></head><body>b</body></html>',
    'before<html><head></head><body>x</body></html>after',
    '<html> <head> </head> <body>x</body> </html> ',
    '<head><meta charset=utf-8><title>t</title><link rel=canonical href=/c><p>body text',
    '</head>x',
    '<head></head>between<body>x',
    '<head></head> <title>after head</title><body>x',
    '<html lang=en><body class=a><html lang=fr id=h><body class=b id=c>x',
    '<body a=1><p>x<body b=2>',
    '<body>a</body>b</html>c',
    '<body>a</body><!-- c --><p>b',
    '<body>a</body>  <p>b',
    '<html>a</html>  \n',
    '<head><p>x</head>',
    '<head><noscript><p>x</p></noscript></head>',
    '<head><noscript><noscript>x</noscript></head>',
    '<head><script>a</script><style>b</style><body>x',
    '<head><template><p>t</p></template></head><body>x',
    '<head><base href=x><basefont><bgsound></head>x',
    '\0x',
    '<html>\0x',
    '<head>\0x',
  ])('%j', (html) => expect(difference(html)).toBeUndefined())
})

describe('templates', () => {
  test.each([
    '<template><p>x</p></template>after',
    '<template><td>a</td></template>b',
    '<template><tr><td>a</template>b',
    '<template><col></template>b',
    '<template><caption>c</template>b',
    '<template><template>x</template>y</template>z',
    '<div><template>a</div>b</template>c',
    '<template><form><form>x</template>',
    '<template>never closed',
    '<table><template><tr><td>a</template></table>',
  ])('%j', (html) => expect(difference(html)).toBeUndefined())
})

describe('frameset', () => {
  test.each([
    '<frameset><frame></frameset>',
    '<frameset><frameset><frame></frameset><noframes>x</noframes></frameset>after',
    '<body><frameset><frame></frameset>',
    '<body>x<frameset><frame></frameset>',
    ' <frameset></frameset> ',
    '<html><head></head> <frameset></frameset></html> ',
    '<div><frameset>x',
  ])('%j', (html) => expect(difference(html)).toBeUndefined())
})

describe('foreign content: svg skipped where the browser ends it', () => {
  test.each([
    '<svg><path d="M0 0"/><g><circle/></g></svg>after',
    '<p>a<svg><text>dropped</text></svg>b</p>',
    '<svg><div>breaks out</div></svg>',
    '<svg><p>breaks out</svg>',
    '<svg><b>x</b>y</svg>',
    '<svg><font color=red>x</font></svg>',
    '<svg><font>stays inside</font>y</svg>z',
    '<svg><desc><b>in desc</b></desc>x</svg>y',
    '<svg><foreignObject><p>in foreign object</p></foreignObject></svg>after',
    '<svg><foreignobject><p>x</p></foreignobject></svg>after',
    '<svg><title><b>t</b></title></svg>after',
    '<svg><style><b>not raw</b></style></svg>after',
    '<svg><script>a<b>c</b></script></svg>after',
    '<svg><svg><g></svg>still svg</svg>after',
    '<svg><clipPath><path/></clippath>x</svg>y',
    '<svg/>after',
    '<svg>never closed <p>x',
    '<svg></p>x',
    '<svg></br>x',
    '<svg><table><tr><td>x</table>',
    '<table><svg><tr>x</tr></svg></table>',
    '<svg>a\0b</svg>c',
    '<svg>\0</svg>',
    '<div><svg><g></div>x',
  ])('%j', (html) => expect(difference(html)).toBeUndefined())
})

describe('foreign content: math', () => {
  test.each([
    '<math><mi>x</mi><mo>+</mo><mn>1</mn></math>',
    '<math><mi><b>bold</b></mi></math>',
    '<math><mtext><div>x</div></mtext></math>',
    '<math><mi><mglyph/><malignmark/></mi></math>',
    '<math><annotation-xml encoding="text/html"><p>x</p></annotation-xml></math>',
    '<math><annotation-xml encoding="TEXT/HTML"><p>x</p></annotation-xml></math>',
    '<math><annotation-xml encoding="application/xhtml+xml"><div>x</div></annotation-xml></math>',
    '<math><annotation-xml><p>breaks out</p></annotation-xml></math>',
    '<math><annotation-xml><svg><g>x</g></svg></annotation-xml></math>',
    '<math><svg>math svg</svg></math>',
    '<math definitionurl="x" xlink:href="y" xml:lang="en" xmlns="z" xmlns:xlink="w"><mi xlink:href=a>x</mi></math>',
    '<math/>after',
    '<math><mi/>x</math>',
    '<math><title>math title<script>dropped</script></title></math>',
    '<math><style>a<b>c</b></style></math>',
    '<math><textarea>x</textarea></math>',
    '<math><mi><textarea>x</textarea></mi></math>',
    '<math><td>x</td></math>',
    '<math>a\0\0b</math>',
    '<math><mo>\0</mo></math>',
    '<math><html lang=xx></math>',
  ])('%j', (html) => expect(difference(html)).toBeUndefined())
})

describe('one attribute read alone agrees with them all parsed', () => {
  const NAMES = [
    'class',
    'id',
    'href',
    'style',
    'role',
    'hidden',
    'title',
    'type',
    'xlink:href',
    'x',
    '=',
    '\uFFFD',
  ]
  const agree = (source: string) => {
    const map = parseAttrs(source)
    const problems: string[] = []
    for (const name of new Set([...map.keys(), ...NAMES]))
      if (scanAttr(source, name) !== map.get(name))
        problems.push(`${JSON.stringify(source)} ${name}`)
    return problems
  }
  test.each([
    ' a=1 A=2 a=3',
    ' STYLE="color:red" style=x',
    ' a b=c d = "e" f=\'g\' h=i/ j',
    '/a/b=c//d',
    ' =x ==y',
    ' a="&amp;&notit;&not=&amp=x&ampx" b=&lt',
    ' a="\0" \0b=c',
    ' a="never closed',
    ' a=',
    ' a"b=c \'d=e',
    '',
  ])('%j', (source) => expect(agree(source)).toEqual([]))
  test('on every element of generated pages, and attr() in any order of questions', () => {
    const problems: string[] = []
    const walk = (el: Element) => {
      problems.push(...agree(el.attrs))
      const map = parseAttrs(el.attrs)
      for (const name of [...NAMES, ...map.keys()]) {
        const fresh = { ...el, map: undefined } as Element
        if (attr(fresh, name) !== map.get(name) || attr(fresh, name) !== map.get(name))
          problems.push(`attr ${JSON.stringify(el.attrs)} ${name}`)
      }
      for (const kid of el.kids) if (typeof kid !== 'string') walk(kid)
    }
    for (let seed = 1; seed <= 1500; seed++) walk(parse(generate(seed)).root)
    expect(problems.slice(0, 5)).toEqual([])
  })
})

describe('flags and mains', () => {
  test.each([
    '<div hidden HIDDEN=x aria-hidden="true" Style="a" role=button>x</div>',
    '<p class=a id=b title=c nowrap align=left>x</p><td rowspan=2 colspan=3>y',
    '<div data-affordances-md data-mode=x data-mdast data-title=t data-language=ts>x</div>',
    '<div contenteditable aria-label=a aria-labelledby=b>x</div>',
    '<div hiddenx rol stylex classy data-modes>x</div>',
    '<div a=hidden b="role">x</div>',
    '<div/hidden/>x</div><div hidden=>y</div><div hidden="a>b" role>z</div>',
    '<math><mi xlink:title=t xml:lang=en>x</mi></math>',
    '<html hidden><body class=a><body id=b role=main>x',
    '<main>a</main><div role=main>b</div><div role=MAIN>c</div><div role="main ">d</div>',
    '<div role="ma&#105;n">x</div><main><main>nested</main></main>',
    '<b role=main>a<p>b</b>c',
    '<table><tr><td>x</td></tr><main>fostered</main></table>',
    '<script role=main></script><svg><main>in svg</main></svg><noscript><main>n</main></noscript>after',
    '<template><main>t</main></template><head><main>h',
    '<math><main>math main</main></math>',
    '</><frameset/><html/role="ma&#105n">',
    '<main>a</main><frameset><html role=main>',
  ])('%j', (html) => expect(difference(html)).toBeUndefined())
})

describe('the head', () => {
  test.each([
    '<title> spaced </title>',
    '<title></title><title>second</title>',
    '<head></head><body><title>body title</title>',
    '<title>head</title><body><title>body</title>',
    '<svg><title>svg title</title></svg><title>real</title>',
    '<body><table><tr><td><title>in cell</title></td></tr><title>fostered</title></table>',
    '<html lang="en-GB"><body>x',
    '<html lang=""><body>x',
    '<html><body><math><html lang=de></math>',
    '<link rel=canonical href="/a"><link rel=canonical href="/b">',
    '<link rel=canonical><link rel=canonical href="/b">',
    '<link rel="Canonical" href="/a">',
    '<link rel="canonical alternate" href="/a">',
    '<body><link rel=canonical href="/in-body">',
    '<link rel="&#99;anonical" href="/encoded">',
    '<meta name=description content="a &amp; b"><meta property="og:title" content=t><meta name=description content=second>',
    '<meta name=x><meta property=y content>',
    '<meta name=a property=b content=c>',
    '<body><p><meta name=late content=1></p>',
    '<template><meta name=t content=1><title>t</title></template>',
    '<script type="application/ld+json"> {"@type": "Thing"} </script><script type="application/ld+json">  </script>',
    '<body><script type="application/ld+json">[1]</script><script type=application/ld+json>[2]</script>',
    '<script type="application/LD+JSON">[1]</script><script type="text/javascript">[2]</script>',
    '<script type="application/ld&#43;json">[1]</script>',
    '<math><script type="application/ld+json">a<mi>b</mi></script></math>',
    '<body><meta name=a content=1><frameset></frameset>',
  ])('%j', (html) => expect(difference(html)).toBeUndefined())
})

describe('the contract', () => {
  const walk = (node: Element, visit: (el: Element) => void) => {
    visit(node)
    for (const kid of node.kids) if (typeof kid !== 'string') walk(kid, visit)
  }
  test('nothing NEVER names is in the tree, text is never split, and parents are right', () => {
    const page =
      '<head><title>t</title><style>s</style></head><body>a<script>x</script>b<svg><g/></svg>c<noscript>' +
      'n</noscript>d<template>t</template>e<iframe>i</iframe>f<video><source></video>g<object>o</object>h</body>'
    const { root } = parse(page)
    expect(root.tag).toBe('#root')
    expect(root.up).toBeNull()
    expect(root.kids).toEqual(['abcdefgh'])
    const problems: string[] = []
    for (let seed = 1; seed <= 300; seed++)
      walk(parse(generate(seed)).root, (el) => {
        if (NEVER.has(el.tag)) problems.push(`${seed}: a ${el.tag}`)
        el.kids.forEach((kid: Node, i: number) => {
          if (kid === '') problems.push(`${seed}: empty text in ${el.tag}`)
          if (typeof kid === 'string' && typeof el.kids[i + 1] === 'string')
            problems.push(`${seed}: split text in ${el.tag}`)
          if (typeof kid !== 'string' && kid.up !== el)
            problems.push(`${seed}: ${kid.tag}'s parent`)
        })
      })
    expect(problems).toEqual([])
  })
  test('attrs is the source after the name, and empty without attributes', () => {
    const { root } = parse('<div  class="a" >x</div><p >y</p><br/><span\n>z</span>')
    const [div, p, br, span] = root.kids as Element[]
    expect(div!.attrs).toBe('  class="a" ')
    expect(p!.attrs).toBe('')
    expect(br!.attrs).toBe('')
    expect(span!.attrs).toBe('')
  })
  test('the body is the root, with its attributes', () => {
    const { root } = parse('<body class=x><p>a')
    expect(root.attrs).toBe(' class=x')
    expect((root.kids[0] as Element).up).toBe(root)
  })
})

describe('character references, the whole table', () => {
  const names = Object.keys(ENTITIES)
  test('in text, each with and without its ";", and followed by more letters', () => {
    const page = names.map((name) => `&${name}|&${name}x|&${name.replace(';', '')}=`).join(' ')
    expect(difference(page)).toBeUndefined()
  })
  test('in attribute values, where a legacy name before = or a letter stays text', () => {
    const page = names
      .map((name, i) => `<i a="&${name}" b='&${name}x' c=&${name}= d="&${name}1">${i}</i>`)
      .join('')
    expect(difference(page)).toBeUndefined()
  })
  test('every numeric reference up to U+FFFF and the edges past it', () => {
    let page = ''
    for (let code = 0; code <= 0xffff; code++) page += `&#${code};&#x${code.toString(16)}`
    for (const code of [0x10000, 0x1f600, 0x10ffff, 0x110000, 0xffffffff, 2 ** 53])
      page += `&#${code};&#x${code.toString(16)};`
    expect(difference(page)).toBeUndefined()
  })
})

describe('the corpus pages', () => {
  const dir = new URL('../bench/corpus/.cache/', import.meta.url)
  const pages = existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.html')) : []
  test.skipIf(pages.length === 0).each(pages)('%s', (file) => {
    const html = readFileSync(new URL(file, dir), 'utf8')
    expect(difference(html)).toBeUndefined()
  })
})

describe('differential fuzz against the oracle', () => {
  const RUNS = 6000
  test(`${RUNS} generated pages`, () => {
    const failures: string[] = []
    const oracleThrew: number[] = []
    for (let seed = 1; seed <= RUNS; seed++) {
      const html = generate(seed)
      if (KNOWN.some(({ matches }) => matches(html))) continue
      let found: string | undefined
      try {
        found = difference(html)
      } catch {
        // parse5 itself throws on a few inputs (see ORACLE_THROWS); this parser must not
        parse(html)
        oracleThrew.push(seed)
        continue
      }
      if (found) failures.push(`seed ${seed} ${JSON.stringify(html)}\n  ${found}`)
    }
    expect(failures.slice(0, 5)).toEqual([])
    expect(oracleThrew.length).toBeLessThan(RUNS / 100)
  })
  test('pages parse5 throws on still parse', () => {
    for (const html of ORACLE_THROWS) expect(parse(html).root.tag).toBe('#root')
  })
})
