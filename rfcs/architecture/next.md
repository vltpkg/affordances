# Next.js compilation

How a Next.js app's capability modules become one canonical manifest at build time, and the routes that serve it and
version 1 of the protocol. The specification is [RFC 0005](../0005-nextjs-compilation.md), with the wire from
[RFC 0004 §2](../0004-protocol-evolution.md#2-http). The package is `@affordances/next` (0.5.1, published for v0). Its
capability parts need `@affordances/ir` and `@affordances/runtime`, optional peers that are private and unpublished, so
they work only inside this repository until those are published, which is the human's release decision.

The manifest it produces is [ir.md](./ir.md)'s; the runtime the projection route runs is [runtime.md](./runtime.md).

## Where it lives

| Concern                                  | Code (`packages/next/src/`)               | Tests (`packages/next/test/`)           |
| ---------------------------------------- | ----------------------------------------- | --------------------------------------- |
| the config wrapper, rewrites and headers | `config.ts`                               | `config.test.ts`                        |
| v0's route walk and codegen              | `codegen.ts`                              | `codegen.test.ts`, `ids.test.ts`        |
| finding capability modules               | `modules.ts`                              | `modules.test.ts`                       |
| extraction from v0 actions               | `extract.ts`, `merge.ts`                  | `extract.test.ts`, `v0-adapter.test.ts` |
| input schemas: the slice and its child   | `slice.ts`, `evaluator.ts`, `evaluate.ts` | `slice.test.ts`, `evaluator.test.ts`    |
| the compile pipeline and its output      | `compile.ts`                              | `compile.test.ts`, `no-ir.test.ts`      |
| diagnostics                              | `diagnostics.ts`                          | `diagnostics.test.ts`                   |
| the catch-all route: v0 and the manifest | `route.ts`                                | `route.test.ts`, `discovery.test.ts`    |
| the projection route: version 1          | `projection.ts`                           | `projection.test.ts`                    |

## What the build reads

The specification is [§1 and §2](../0005-nextjs-compilation.md#1-where-declarations-live).

- **Capability modules:** files named `capabilities.ts` anywhere under the app, outside folders starting with `_` and
  `node_modules`. A `capabilities.tsx`, `.js`, `.jsx` or `.mts` is flagged, not read.
- **v0's actions:** each route folder's `actions` file, which must start with `'use server'`, and its `state` file,
  outside `_private` folders and `api/affordances`. Capability ids are unique app-wide.
- **Extraction** follows RFC 0005's rules E1 to E9: what a v0 action's definition says becomes a capability with a
  v0 binding, `{ route, action }`, and a route parameter is mapped from the target.
- **An input schema** is evaluated, never parsed by hand. The compiler takes a slice of the module, only the consts
  and imports the schema needs, and runs it in a child process under Node's permission model, which reads only the
  slice's folder and `node_modules`, with an empty environment, and can't write or fetch. Zod, Valibot, ArkType,
  TypeBox, Effect and `@effect/schema` are recognized. The slice is run twice, and two runs that give different
  schemas make the input opaque (`W_INPUT_OPAQUE`). `E_CAPABILITY_NONDETERMINISTIC` is a different check, on the
  capability modules' whole evaluation.

## The slice's rule

The slice may read only schema-library imports, consts and a few value globals (`Number`, `String`, `Boolean`,
`BigInt`, `Array`, `Object`, `RegExp`, `JSON` and the three constants). What reaches the language's machinery is
refused, and the input becomes opaque (`W_INPUT_OPAQUE`):

- **Banned members:** `constructor`, `__proto__`, `prototype`, Object's reflection (`getOwnPropertyDescriptor`,
  `getOwnPropertyDescriptors`, `getPrototypeOf`, `setPrototypeOf`, `defineProperty`, `defineProperties`) and its legacy
  aliases (`__lookupGetter__`, `__lookupSetter__`, `__defineGetter__`, `__defineSetter__`, since 973a6d7d).
- **Every key is static** (an allowlist, since 75ec8373): in a member expression, an object literal, a destructuring
  pattern or a class, at any depth, a key is an identifier or a plain string or number literal, never computed, and
  never a banned member. Any computed key is refused, a numeric index such as `a[0]` included, whatever it computes to.
- **Also refused:** `import()`, `import.meta`, a `let`, a function declaration, and any other read.
- **Lossy constructs** survive evaluation but not JSON Schema, for example zod's `refine`, `superRefine`, `transform`,
  `preprocess`, `custom` or a pipe to a function, and each library has its own. They're `W_INPUT_LOSSY`, each named,
  and opaque in strict mode.

## What the build emits

The specification is [§4](../0005-nextjs-compilation.md#4-output).

`withAffordances` runs v0's codegen and the compiler once per root as the config loads, and in development recompiles
when an `actions`, `state` or `capabilities` file changes. A failed compile throws outside development. The build's own
process never loads ir: all of ir's work runs in the child. It writes into `.affordances/`, each file only when it
changes:

- `manifest.json`, the canonical manifest, only when there is one, and removed when there isn't (since b52e756f), so it
  always agrees with the next two;
- `capabilities.ts`, always: `{ canonical, digest }`, or `null`, so the compiled alias always resolves;
- `diagnostics.json`, the digest and every diagnostic;
- `bindings.ts`, each capability's v0 action by its export, and how to call it.

With no namespace, there's no manifest, and `W_NO_NAMESPACE` says why. Its suggestion comes from a literal
`metadataBase`, then the package's `homepage`. The codemod that writes ids marks each `// placeholder`.

## The config

The specification is [§3](../0005-nextjs-compilation.md#3-the-dx-bar).

`withAffordances(nextConfig, { name, root, plugins, namespace, owner, strict, manifest, projection })`, each value
checked as the config loads. In strict mode, `W_NO_ID`, `W_INPUT_OPAQUE`, `W_INPUT_LOSSY` and
`W_TSCONFIG_UNREADABLE` are errors. It aliases `@affordances/next/manifest` and `@affordances/next/compiled` to the
generated files, rewrites a page to the catch-all when `Accept` or `Content-Type` names v0's media type or the query has
`?affordances=1`, and adds a `Link: <?affordances=1>; rel="affordances"` header to every route.

## The routes

- **The catch-all, `createRouteHandler`** (`/api/affordances/graph`): v0, as before, through core's handler. The site
  index gains `capabilities: { manifest, base }` only when the manifest is public. `GET`
  `/.well-known/affordances/manifest.json` serves the canonical bytes as `application/json`, publicly cacheable for
  five minutes, with the digest as its `ETag`. `If-None-Match` is matched as RFC 9110 has it, `*` or a list of tags
  compared weakly (since 721455aa), for a 304.
- **The projection route, `createProjectionRoute`** (`/api/projection` by default): version 1, `GET {base}/view` and
  `/inspect`, `POST {base}/expand`, `/check` and `/execute` ([RFC 0004 §2.2](../0004-protocol-evolution.md#22-endpoints)).
  - Every response is `application/vnd.affordances+json; version=1` (since ec7e80d1), private and uncacheable, with
    `Vary: Authorization, Cookie`.
  - A cookie-authenticated POST needs the site's own `Origin`, or one in `allowedOrigins`, or it's refused before the
    runtime.
  - A refusal before the runtime has the runtime's shape, `{ status: 'refused', code, detail }`: the Origin's 403 is
    `unauthorized`, a malformed body's 400 is `invalid_input`, and a missing offer or operation's 404 is `not_found`
    ([RFC 0004 §2.3](../0004-protocol-evolution.md#23-the-rules-every-endpoint-keeps)).
  - `expand` takes every direction, `comparison` included (since e52d5780), and its budget is the view's, `offers` and
    `facts` as positive whole numbers and nothing else (since 741d2767).
  - It fails closed without an `approvalKey` and `seenTokens` outside development and test. The runtime is loaded lazily,
    as an optional peer, and each v0 `run` and guard runs in a v0 context.

## Real apps

- **hosting-lab** has capability modules, a namespace, a manifest and both routes, and its runtime handlers are its own.
- **apps/example** is v0 only: no modules, no namespace, so `capabilities.ts` is `null` and there's no `manifest.json`
  and no projection route. M7b's golden check holds that its v0 documents are byte-identical through the
  semantic-capabilities work (`apps/example/scripts/v0-golden/`).

## Not built, and divergences

- **Not built:** reference-sourced route parameters (RFC 0005 §4's `{ from: 'reference', name }`); a binding's
  parameters are only ever from the target. Mixed apps (RFC 0005 §9.2) are open. The serving direction of RFC 0004 §8,
  from the IR to v0, has only its binding-identity test.
- **Divergences:** RFC 0005 §5 has the app import `manifest.json` and `bindings`. hosting-lab passes its IR manifest
  object and its own handlers instead, with no bindings, which the route supports. `allowedOrigins`, the `handlers`
  option and the manifest's cache lifetime are as built and not in the RFC.
