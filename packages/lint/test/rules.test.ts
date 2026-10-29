import { RuleTester } from 'eslint'
import plugin from '../src/index.ts'

// RuleTester finds vitest's describe/it as globals (vitest.config.ts: globals)

const tester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
})

const imports = `import { addToCart, removeItem } from './actions'\nimport { track } from './analytics'\nconst el = `

tester.run('require-affordance', plugin.rules['require-affordance'], {
  valid: [
    imports + `<Affordance action={addToCart}><form action={addToCart} /></Affordance>`,
    imports +
      `<Affordance name="removeItem"><div><button onClick={() => removeItem({ id })} /></div></Affordance>`,
    imports + `<button onClick={() => track('x')} />`,
    `const el = <form action={addToCart} />`,
  ],
  invalid: [
    {
      code: imports + `<form action={addToCart} />`,
      errors: [{ messageId: 'missing', data: { name: 'addToCart' } }],
    },
    {
      code: imports + `<button formAction={addToCart.bind(null, 1)} />`,
      errors: [{ messageId: 'missing' }],
    },
    {
      code: imports + `<button onClick={async () => { await removeItem({ id }) }} />`,
      errors: [{ messageId: 'missing' }],
    },
    {
      code: `import { placeOrder } from '@/app/checkout/actions'\nconst el = <Card><button onClick={() => placeOrder({})} /></Card>`,
      errors: [{ messageId: 'missing' }],
    },
  ],
})

tester.run('static-action-name', plugin.rules['static-action-name'], {
  valid: [
    `defineAction({ name: 'addToCart', run() {} })`,
    `affordances.defineAction({ name: "x" })`,
    `other({ name: n })`,
  ],
  invalid: [
    { code: `defineAction({ name: n })`, errors: [{ messageId: 'literal' }] },
    { code: 'defineAction({ name: `a${b}` })', errors: [{ messageId: 'literal' }] },
    { code: `defineAction({ run() {} })`, errors: [{ messageId: 'missing' }] },
  ],
})
