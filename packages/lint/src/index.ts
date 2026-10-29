import type { Rule } from 'eslint'

// estree's types stop short of JSX, so walk nodes loosely
type Node = { type: string; parent?: Node | null; [key: string]: unknown }

// imports from a route's actions file: './actions', '../cart/actions', '@/app/cart/actions'
const isActionsModule = (source: string) => /(^|\/)actions(\.[jt]sx?)?$/.test(source)

const jsxName = (node: { name: { type: string; name?: string } }) =>
  node.name.type === 'JSXIdentifier' ? node.name.name : undefined

// the identifiers an attribute value hands to the element: action={x}, onClick={() => x(…)}, formAction={x.bind(…)}
const referenced = (expression: Node | undefined): string[] => {
  if (!expression) return []
  if (expression.type === 'Identifier') return [expression.name as string]
  if (expression.type === 'CallExpression') {
    const callee = expression.callee as Node
    // x.bind(null, …)
    if (callee.type === 'MemberExpression') return referenced(callee.object as Node)
    return referenced(callee)
  }
  if (expression.type === 'ArrowFunctionExpression' || expression.type === 'FunctionExpression') {
    const body = expression.body as Node
    if (body.type !== 'BlockStatement') return referenced(body)
    return (body.body as Node[]).flatMap((statement) =>
      statement.type === 'ExpressionStatement'
        ? referenced(statement.expression as Node)
        : statement.type === 'ReturnStatement'
          ? referenced(statement.argument as Node)
          : [],
    )
  }
  if (expression.type === 'AwaitExpression') return referenced(expression.argument as Node)
  return []
}

const requireAffordance: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Wrap controls that call a server action in <Affordance>, so agents can find them',
    },
    schema: [],
    messages: {
      missing:
        '{{name}} is a server action, but this control isn’t inside <Affordance>. Wrap it so agents and the dev overlay can find it.',
    },
  },
  create(context) {
    const actions = new Set<string>()
    return {
      ImportDeclaration(node) {
        if (typeof node.source.value !== 'string' || !isActionsModule(node.source.value)) return
        for (const spec of node.specifiers)
          if (spec.type === 'ImportSpecifier') actions.add(spec.local.name)
      },
      JSXAttribute(attribute: Rule.Node) {
        const node = attribute as unknown as Node
        const name = (node.name as { name?: string }).name
        if (name !== 'action' && name !== 'formAction' && name !== 'onClick' && name !== 'onSubmit')
          return
        const value = node.value as Node | null
        if (value?.type !== 'JSXExpressionContainer') return
        const used = referenced(value.expression as Node).filter((id) => actions.has(id))
        if (!used.length) return
        for (
          let parent = node.parent as Node | null;
          parent;
          parent = parent.parent as Node | null
        ) {
          if (
            parent.type === 'JSXElement' &&
            jsxName(parent.openingElement as never) === 'Affordance'
          )
            return
        }
        context.report({ node: attribute, messageId: 'missing', data: { name: used[0]! } })
      },
    } as Rule.RuleListener
  },
}

const staticActionName: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'defineAction needs a string literal name, so the manifest can be built statically',
    },
    schema: [],
    messages: {
      literal: 'defineAction’s `name` must be a string literal.',
      missing: 'defineAction needs a `name`.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee
        const called =
          callee.type === 'Identifier'
            ? callee.name
            : callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
              ? callee.property.name
              : undefined
        if (called !== 'defineAction') return
        const [config] = node.arguments
        if (config?.type !== 'ObjectExpression') return
        const name = config.properties.find(
          (p) => p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === 'name',
        )
        if (!name || name.type !== 'Property') return context.report({ node, messageId: 'missing' })
        if (name.value.type !== 'Literal' || typeof name.value.value !== 'string')
          context.report({ node: name.value, messageId: 'literal' })
      },
    }
  },
}

const plugin = {
  // oxlint's jsPlugins prefix rules with meta.name, eslint with the key under `plugins`; both say affordances/…
  meta: { name: 'affordances' },
  rules: { 'require-affordance': requireAffordance, 'static-action-name': staticActionName },
  configs: {} as Record<string, unknown>,
}

// eslint.config.js: import affordances from '@affordances/lint'; export default [affordances.configs.recommended]
plugin.configs.recommended = {
  plugins: { affordances: plugin },
  rules: { 'afford/require-affordance': 'warn', 'affordances/static-action-name': 'error' },
}

export default plugin
