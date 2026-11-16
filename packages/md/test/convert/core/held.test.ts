import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { expect, test } from 'vitest'
import { emit } from '../../../src/convert/core/emit.ts'
import { parse } from '../../../src/convert/core/parse.ts'

// what md-core keeps between pages: nothing of the page it last read, once it's written, or only parsed
setFlagsFromString('--expose-gc')
const gc = runInNewContext('gc') as () => void
const page =
  '<html><head><title>t</title><link rel=canonical href="/c"></head><body><main><p class="a" id="b" title="c">x</p><a href="/y" title="z">y</a></main></body></html>'
const freed = async (read: () => WeakRef<object>) => {
  const ref = read()
  for (let i = 0; i < 5 && ref.deref(); i++) {
    await new Promise((done) => setTimeout(done, 0))
    gc()
  }
  return ref.deref() === undefined
}
test.each([
  [
    'written',
    (html: string) => {
      const doc = parse(html)
      emit(doc, { url: 'https://site.test/a' })
      return new WeakRef(doc.root)
    },
  ],
  ['only parsed', (html: string) => new WeakRef(parse(html).root)],
])("a page md-core has %s isn't kept", async (_, read) => {
  expect(await freed(() => read(page))).toBe(true)
})
