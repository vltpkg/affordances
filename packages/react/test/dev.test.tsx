// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { MEDIA_TYPE } from '@afford/protocol'
import { AffordProvider } from '../src/index.ts'
import { AffordDevtools } from '../src/dev.tsx'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

test('⌥A toggles the overlay, which reports the page graph', async () => {
  const graph = { v: '0', page: '/', route: '/', entities: {}, actions: [] }
  vi.stubGlobal(
    'fetch',
    async () => new Response(JSON.stringify(graph), { headers: { 'content-type': MEDIA_TYPE } }),
  )
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(
      <AffordProvider path="/">
        <AffordDevtools />
      </AffordProvider>,
    ),
  )
  await act(async () => {})
  expect(container.querySelector('[data-afford-devtools]')).toBeNull()
  await act(async () => dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', altKey: true })))
  expect(container.textContent).toContain('/ · 0 actions')
  await act(async () => dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', altKey: true })))
  expect(container.querySelector('[data-afford-devtools]')).toBeNull()
  vi.unstubAllGlobals()
})
