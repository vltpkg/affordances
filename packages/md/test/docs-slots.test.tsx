import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { expect, test } from 'vitest'
import { htmlToMarkdown, readPage } from '../src/index.ts'
import { AgentSlot } from '../src/react/index.ts'

// the examples in markers.mdx and converter.mdx, as written, so they type-check
const Readme = ({ pkg }: { pkg: string }): ReactNode => <p>Loading {pkg}’s readme…</p>
const Page = ({ pkg }: { pkg: string }) => (
  <main>
    <h1>{pkg}</h1>
    <AgentSlot name="readme">
      <Readme pkg={pkg} />
    </AgentSlot>
  </main>
)
const readme = async (name: string) => `${name}: Fast, unopinionated.`

test('the docs examples run as written', async () => {
  const html = `<html><body>${renderToString(<Page pkg="express" />)}</body></html>`
  const url = 'https://example.test/package/express'
  const page = readPage(html, { url, frontmatter: false })
  const slots: Record<string, string> = {}
  for (const name of page.slots.unique) slots[name] = await readme(name)
  const { markdown } = page.markdown(slots)
  expect(markdown).toBe('# express\n\nreadme: Fast, unopinionated.\n')
  // and the one-call form
  expect(htmlToMarkdown(html, { url, slots, frontmatter: false }).markdown).toBe(markdown)
})

test('a slot needs a name', () => {
  // @ts-expect-error name is required
  expect(renderToString(<AgentSlot>x</AgentSlot>)).toContain('data-mode="slot"')
})
