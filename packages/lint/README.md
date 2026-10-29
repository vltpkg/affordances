# @affordances/lint

Two lint rules for Affordances apps, for ESLint and oxlint's JS plugins:

- `affordances/require-affordance` warns when a control calls a server action (`action`, `formAction`, `onClick`, or `onSubmit` using an import from an `actions` module) outside an `<Affordance>`.
- `affordances/static-action-name` errors when `defineAction` has no `name`, or a name that isn't a string literal, which codegen can't read.

```bash
vlt install -D @affordances/lint
```

```js
// eslint.config.js
import affordances from '@affordances/lint'

export default [affordances.configs.recommended]
```

Docs: [https://github.com/affordances/affordances/blob/main/apps/docs/content/guides/lint.mdx](https://github.com/affordances/affordances/blob/main/apps/docs/content/guides/lint.mdx)
