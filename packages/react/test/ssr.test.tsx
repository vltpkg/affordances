import { renderToString } from 'react-dom/server'
import { expect, test } from 'vitest'
import { z } from 'zod'
import { defineAction } from '@affordances/core'
import { Affordance, AffordancesProvider } from '../src/index.ts'

const addToCart = defineAction({
  name: 'addToCart',
  description: 'Add it',
  input: z.object({ sku: z.string() }),
  expose: 'public',
  run: () => {},
})

test('renders on the server without touching the dom', () => {
  const html = renderToString(
    <AffordancesProvider path="/products/tee">
      <Affordance action={addToCart} input={{ sku: 'TEE-M' }}>
        <button type="submit">Add to cart</button>
      </Affordance>
    </AffordancesProvider>,
  )
  expect(html).toContain('data-affordances-action="addToCart"')
  expect(html).toContain('data-affordances-input="{&quot;sku&quot;:&quot;TEE-M&quot;}"')
  expect(html).toContain('display:contents')
})

test('a bare server reference needs a name', () => {
  expect(() => renderToString(<Affordance action={() => {}}>x</Affordance>)).toThrow(
    'pass name="…"',
  )
  expect(renderToString(<Affordance name="addToCart">x</Affordance>)).toContain(
    'data-affordances-action="addToCart"',
  )
})
