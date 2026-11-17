// generated pages that nest md's markers in links and links in markers, at random, with what prune changes around
// them: slots, <AgentMain>, <AgentText>, skip and only, tablists, tabs, shown and hidden panels, hidden content,
// chrome, values, images, tables, forms and strikethroughs. each page comes with the options it's read with
import type { Options } from '../../../src/index.ts'

type Piece = string | (() => string)

export const markerPages = (seed: number) => {
  let state = seed >>> 0 || 1
  const rnd = (n: number) => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state % n
  }
  const pick = <T>(list: T[]) => list[rnd(list.length)]!
  const tab = () => pick(['t1', 't2', 't3'])
  const name = () => pick(['a', 'b', 'a'])
  const OPEN: Piece[] = [
    '<a href="/x">',
    '<a href="/y" aria-label="Y label">',
    '<a href="/z" aria-labelledby="lbl">',
    '<a href="/w" title="W">',
    '<a>',
    () => `<affordances-md data-mode="slot" data-name="${name()}">`,
    '<affordances-md data-mode="main">',
    '<affordances-md data-mode="skip">',
    '<affordances-md data-mode="only">',
    '<affordances-md data-mode="text" data-md="said">',
    '<affordances-md data-mode="text" data-md="">',
    '<affordances-md data-mode="text" data-block data-md="**blk**">',
    '<div role="tablist">',
    () => `<div role="tabpanel" data-affordances-md="show" aria-labelledby="${tab()}">`,
    () => `<div role="tabpanel" aria-labelledby="${tab()}" hidden>`,
    () => `<section data-affordances-md="show" aria-labelledby="${tab()}">`,
    '<div hidden>',
    '<div aria-hidden="true">',
    '<div style="display:none">',
    '<span class="sr-only">',
    '<div hidden data-affordances-md="show">',
    '<nav>',
    '<header>',
    '<footer>',
    '<aside>',
    '<dialog>',
    '<div role="navigation">',
    '<main>',
    '<div>',
    '<span>',
    '<p>',
    '<h2>',
    '<li>',
    '<ul>',
    '<table><tr><td>',
    '<td>',
    '<th>',
    '<label>',
    '<button>',
    '<form>',
    '<del>',
    '<s>',
    '<strong>',
    '<em>',
    '<details>',
    '<summary>',
    '<figure>',
  ]
  const CLOSE = [
    '</a>',
    '</affordances-md>',
    '</div>',
    '</span>',
    '</nav>',
    '</header>',
    '</main>',
    '</p>',
    '</h2>',
    '</li>',
    '</ul>',
    '</td></tr></table>',
    '</section>',
    '</label>',
    '</button>',
    '</form>',
    '</del>',
    '</strong>',
    '</details>',
  ]
  const LEAF: Piece[] = [
    'text',
    'Two words',
    ' ',
    '<img src="/i.png" alt="Pic">',
    '<img src="/i.png">',
    '<svg><title>Icon</title></svg>',
    '<input name="q" value="secret">',
    '<input type="hidden" value="hv">',
    '<textarea>ta</textarea>',
    '<select><option>opt</option></select>',
    '<output>out</output>',
    () => `<button role="tab" id="${tab()}">Tab ${tab()}</button>`,
    '<span id="lbl">Labelled</span>',
    '<span id="lbl"></span>',
    'LEAK',
    '<br>',
    '<h3>Head</h3>',
    '<code>c</code>',
    () => `<affordances-md data-mode="slot" data-name="${name()}">fallback</affordances-md>`,
    () => `<affordances-md data-mode="slot" data-name="${name()}"></affordances-md>`,
  ]
  const OPTIONS: Options[] = [
    {},
    { slots: { a: 'FILLED-A' } },
    { slots: { a: 'FILLED-A', b: '**FB**' } },
    { url: 'https://site.test/a/', extract: 'none' },
    { frontmatter: true },
  ]
  const value = (piece: Piece) => (typeof piece === 'function' ? piece() : piece)
  return () => {
    let html = rnd(3) ? '<!doctype html>' : ''
    const n = 4 + rnd(30)
    for (let i = 0; i < n; i++) {
      const r = rnd(10)
      html += value(r < 4 ? pick(OPEN) : r < 6 ? pick(CLOSE) : pick(LEAF))
    }
    return { html, options: pick(OPTIONS) }
  }
}
