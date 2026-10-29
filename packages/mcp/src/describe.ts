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
// it's for, and every action as a signature. Enough to plan, and to call an action without opening its page
export const describeSite = (index: SiteIndex) =>
  [
    `${index.name ?? 'This site'} is operable through Afford. Routes and their actions:`,
    ...index.routes.map(({ route, description, actions }) =>
      [
        `- ${route}${description ? `: ${description}` : ''}`,
        ...actions.map(
          (a) =>
            `  - ${signature(a.name, a.input as Schema)} [${a.expose}${a.readOnly ? ', read-only' : ''}]: ${a.description}${a.guard ? ` Requires: ${a.guard}.` : ''}`,
        ),
      ].join('\n'),
    ),
    'Call an action on a concrete path of its route (e.g. /products/[slug] → /products/tee) without opening the page first; open a page when you need what it shows.',
  ].join('\n')
