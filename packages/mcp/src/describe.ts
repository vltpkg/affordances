import type { SiteIndex } from '@afford/protocol'

type Schema = {
  type?: string | string[]
  enum?: unknown[]
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
}

const typeOf = (schema: Schema): string =>
  schema.enum
    ? schema.enum.map((v) => JSON.stringify(v)).join(' | ')
    : schema.type === 'array' && schema.items
      ? `${typeOf(schema.items)}[]`
      : Array.isArray(schema.type)
        ? schema.type.join(' | ')
        : (schema.type ?? 'unknown')

// addToCart(sku: string, quantity?: integer): the input schema as a one-line signature
const signature = (name: string, input: Schema) => {
  const required = new Set(input.required ?? [])
  const params = Object.entries(input.properties ?? {}).map(
    ([key, schema]) => `${key}${required.has(key) ? '' : '?'}: ${typeOf(schema)}`,
  )
  return `${name}(${params.join(', ')})`
}

// the site index as compact text for a model's context (MCP instructions, a system prompt): every route, what
// it's for, and every action as a signature. Enough to plan, and to call an action without opening its page.
// it rides in every turn's prompt, so it stays terse: action descriptions and guards are in the page's graph
export const describeSite = (index: SiteIndex) =>
  [
    `${index.name ?? 'This site'}: routes and their actions`,
    ...index.routes.map(({ route, description, actions }) =>
      [
        `- ${route}${description ? `: ${description}` : ''}`,
        ...actions.map(
          (a) =>
            `  - ${signature(a.name, a.input as Schema)} [${a.expose}${a.readOnly ? ', read-only' : ''}]`,
        ),
      ].join('\n'),
    ),
    'Call actions on a concrete path (/products/[slug] → /products/tee) without opening it first.',
  ].join('\n')
