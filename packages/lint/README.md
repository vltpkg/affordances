# @afford/lint

Two lint rules for Afford apps, for ESLint and oxlint's JS plugins:

- `afford/require-affordance` warns when a control calls a server action (`action`, `formAction`, `onClick`, or `onSubmit` using an import from an `actions` module) outside an `<Affordance>`.
- `afford/static-action-name` errors when `defineAction` has no `name`, or a name that isn't a string literal, which codegen can't read.

```bash
vlt install -D @afford/lint
```

```js
// eslint.config.js
import afford from '@afford/lint'

export default [afford.configs.recommended]
```

Docs: [https://github.com/afford/afford/blob/main/apps/docs/content/lint.mdx](https://github.com/afford/afford/blob/main/apps/docs/content/lint.mdx)
