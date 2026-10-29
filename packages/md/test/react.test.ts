import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { expect, test } from 'vitest'
import { htmlToMarkdown } from '../src/index.ts'
import { AgentMain, AgentOnly, AgentSkip, AgentText } from '../src/react/index.ts'

const page = h(
  'main',
  null,
  h(AgentSkip, null, h('p', null, 'Promo')),
  h(
    AgentMain,
    null,
    h('h1', null, 'Tee'),
    h('p', null, 'Price: ', h(AgentText, { md: '$48.00' }, h('span', null, '$48'))),
  ),
  h(AgentOnly, null, h('p', null, 'Size L is sold out.')),
  h(AgentText, { md: '- M: 8\n- L: 0', block: true }, h('div', null, 'grid')),
)

test('markers render as display: contents custom elements', () => {
  const html = renderToString(page)
  expect(html).toContain('<afford-md data-mode="skip" style="display:contents">')
  expect(html).toContain('<afford-md data-mode="only" hidden="">')
  expect(html).toContain('data-md="$48.00"')
  expect(html).toContain('data-block=""')
})

test('attribute values are escaped', () => {
  expect(renderToString(h(AgentText, { md: '"><script>x</script>' }, 'x'))).toContain(
    'data-md="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"',
  )
})

test('a rendered page converts through its markers', () => {
  const { markdown } = htmlToMarkdown(`<html><body>${renderToString(page)}</body></html>`, {
    frontmatter: false,
  })
  // AgentMain wins, so the AgentOnly and block AgentText outside it are left out
  expect(markdown).toBe('# Tee\n\nPrice: $48.00\n')
})
