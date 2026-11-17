// generated streamed pages where segments, templates and the instructions that move one into the other nest in
// every way: a segment around its own template (its parent, or further up), segments inside segments, a template
// inside the segment another template moves, the same id twice. md-core must read each as the tree pipeline does,
// or decline it, and never put an element inside itself
const IDS = [0, 1, 2]

export const nestedStreamedPages = (seed: number) => {
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
  const id = () => pick(IDS)
  const OPEN = [
    () => `<div hidden id="S:${id()}">`,
    () => `<div id="S:${id()}">`,
    () => `<span hidden id="S:${id()}">`,
    () => '<main>',
    () => '<section>',
    () => '<p>',
    () => '<table>',
    () => '<ul><li>',
    () => `<template id="B:${id()}">`,
    () => `<template id="P:${id()}">`,
    () => '<!--$?-->',
    () => '<!--$-->',
  ]
  const CLOSE = [
    '</div>',
    '</span>',
    '</main>',
    '</section>',
    '</p>',
    '</table>',
    '</li></ul>',
    '</template>',
  ]
  const LEAF = [
    () => `<template id="B:${id()}"></template>`,
    () => `<template id="P:${id()}"></template>`,
    () => '<!--/$-->',
    () => '<p>text</p>',
    () => 'words',
    () => '<h1>Title</h1>',
    () => `<script>$RC("B:${id()}","S:${id()}")</script>`,
    () => `<script>$RS("S:${id()}","P:${id()}")</script>`,
    () => `<template data-rci="" data-bid="B:${id()}" data-sid="S:${id()}"></template>`,
    () => `<template data-rsi="" data-pid="P:${id()}" data-sid="S:${id()}"></template>`,
  ]
  return () => {
    let out = rnd(2) ? '<!doctype html>' : ''
    const n = 3 + rnd(25)
    for (let i = 0; i < n; i++) {
      const r = rnd(10)
      out += r < 4 ? pick(OPEN)() : r < 6 ? pick(CLOSE) : pick(LEAF)()
    }
    // an instruction always, so every page asks for a move
    return out + `<script>$RC("B:${id()}","S:${id()}")</script>`
  }
}
