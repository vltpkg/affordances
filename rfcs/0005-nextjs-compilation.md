# RFC 0005: Compiling capabilities from a Next.js app

**Status:** draft. **Builds on:** RFC 0001 (the IR), RFC 0002 (contextual projection). **Defers to RFC 0004:** the projection wire format.

## Summary

`next build` emits a portable capability manifest, `.affordances/manifest.json`, and a runtime binding module. The manifest comes from two sources:

- **Declarations:** capability modules, files named `capabilities.ts` that hold only data.
- **Extraction:** what an app's existing `defineAction` exports already say, read statically.

The manifest never imports application code. Extraction marks everything it reads as `imported` or `inferred`, never `declared`, and every fact it can't recover is a named warning that tells the developer what to declare. A v0 app gets a first manifest with no configuration, and enriches it one warning at a time.

## Motivation

An application that already describes its actions for agents shouldn't have to describe them twice. Today it can't avoid it:

- **The route manifest isn't portable.** `@affordances/next` generates `.affordances/manifest.ts`, a module that imports the app's state and action exports (`packages/next/src/codegen.ts:152-176`). It's executable, so nothing outside the app can read it.
- **RFC 0001's manifest has no compiler.** An app that wants one writes it by hand with `defineCapability` and `defineManifest`, as `apps/hosting-lab/src/app/capabilities.ts` does. It then repeats, in the IR, what its `defineAction` calls already say: ids, input schemas, exposure, confirmation.

What's needed is a build step that reads what's already written, asks for only what isn't, and emits an artifact any tool can read.

## Goals

- **G1. No duplicated business logic.** Whatever a `defineAction` already states reaches the manifest without being written again.
- **G2. A portable artifact.** `next build` emits `.affordances/manifest.json`: canonical JSON (RFC 8785), digest-stable, importing nothing.
- **G3. Honest provenance.** Extracted facts are `imported` or `inferred`, never `declared` (RFC 0001 §8). Only a developer's own declaration is `declared`.
- **G4. The DX bar:**
  - one obvious way;
  - types that infer;
  - safe by default;
  - zero configuration for a v0 app's first manifest;
  - diagnostics wherever enrichment is missing.
- **G5. A measured claim.** How much of a real manifest extraction recovers is measured per field (§7), not asserted.

## Non-goals

- **A new wire format.** How a route serves projections to agents is RFC 0004's. This RFC states only the minimum M6 needs (§5).
- **Inferring effects, declarative preconditions or claims.** They're consequences and judgments, and code doesn't state them. They're always explicit (§2.2).
- **Changing v0.** Its packages, wire format and runtime behavior are unchanged. Everything here is additive and `@experimental` in `@affordances/next`.

## 1. Where declarations live

**Decision: capability modules, files named `capabilities.ts`.**

- **Where:** a `capabilities.ts` may sit in any app route folder, beside `actions.ts` and `page.tsx`. One more may sit at the app root, for definitions shared across routes. The compiler finds them with the same walk codegen already does (`codegen.ts:96-150`), so there's no new configuration.
- **`_private` folders:** a `capabilities.ts` in one is never a module itself. What it defines counts only when a discovered module exports it, since only exports are read.
- **What they hold:** `defineResource`, `definePrincipal`, `defineCapability`, `defineClaims` and `defineRelations` exports (RFC 0001 §12.1). Or one `defineManifest` export, which is then used whole, as `apps/hosting-lab` does.
- **How exports are read:**
  - **By brand:** every value the authoring API returns carries a non-enumerable `Symbol.for('affordances.defined')` brand, naming what it is, so a resource is never told from a capability by its shape. Unbranded exports, such as a shared schema, are ignored.
  - **One manifest:** `fromModules`, in the authoring API, merges every module's branded exports, wherever the modules sit. A value exported twice is one value. The result is normalized, so the order the modules are found in never shows.
  - **What it refuses:**
    - two different definitions with one id, including a resource and a capability, `E_CAPABILITY_DUPLICATE`, naming both places;
    - an export beside a `defineManifest` export that the manifest doesn't hold, `E_CAPABILITY_MANIFEST`. The manifest's own parts may be exported beside it, since bound actions import them;
    - claims with no owner, `E_CLAIMS_NO_OWNER`.
  - **It reports, it doesn't throw:** `validate`'s issues are reported the same way.
- **What they may import:** `@affordances/ir`, or its re-export `@affordances/next/author` (the authoring API apps will import, under M6b's contract; not built yet, since it follows the inlined evaluator entry), a Standard Schema library, and other capability modules, nothing else. Type-only imports are erased, so they import nothing.
  - The compiler checks the import graph statically with oxc, which codegen already depends on, before it evaluates anything.
  - An import of application code is the error `E_CAPABILITY_IMPORT`, naming the import.
  - That keeps G2: building the manifest runs the capability modules alone (RFC 0001 §12.1), never the app.
- **What they may not reach at all,** since a static import list doesn't see it:
  - **Rejected statically:** the compiler rejects, with oxc, any dynamic `import()`, any `require`, and any reference to `process`, `Date`, `Math.random`, `crypto`, `fetch` or a timer (`setTimeout`, `setInterval`, `setImmediate`), as `E_CAPABILITY_AMBIENT`, naming the construct. A capability module is data, so it needs none of them. Reaching the app, the environment, the network or the clock would make the manifest depend on the machine or the moment it was built on.
  - **Evaluated twice:** to catch what that check misses, the compiler evaluates the modules twice, each time in a fresh process with an empty environment. If the two manifests differ by a byte, it refuses with `E_CAPABILITY_NONDETERMINISTIC`, showing the first difference.
- **How they're evaluated:** in a separate Node process, with Node's own type stripping, so there's no new dependency. Two ordinary things break that, and the compiler handles both:
  - **Imports without extensions, and tsconfig path aliases** (`./dep`, `@/schemas`), which Next apps use everywhere and Node won't resolve. The evaluator registers a small resolve hook (`node:module`'s `register`) that resolves them to `.ts`, from the app's tsconfig.
  - **Syntax that can't be erased** (an `enum`, a `namespace`, parameter properties, `import =`), which Node refuses with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. The compiler checks every module and slice with oxc first, and reports `E_CAPABILITY_SYNTAX`, with the construct and its location, instead of a Node crash. A TS `enum` reaching a schema (`z.nativeEnum(Status)`) is the common case. The fix is a `const` object and `z.enum`.

**Identity comes from configuration.** `withAffordances(nextConfig, { namespace, owner })` gains two optional fields, beside the existing `name`, `root` and `plugins`:

- **`namespace`:** the manifest's namespace, an absolute URI with no fragment, such as `https://acme.example/capabilities` (RFC 0001 §2);
- **`owner`:** the manifest's owner source, `{ id, name }`. Only the configured owner produces `declared` provenance (RFC 0001 §12.1, rule 3).

A `defineManifest` export overrides both.

- **Suggested ids:** their prefix is an identifier inferred from `name` ("Acme Store" gives `acmeStore`). That's a separate thing from the namespace.
- **No owner:** the owner is unset, and that's a warning, `W_NO_OWNER`, since no field can then be `declared`.
- **No namespace: nothing is inferred, and no `manifest.json` is written** (intake, 2026-11-18).
  - **What the build reports:** `W_NO_NAMESPACE`, with the exact line to paste.
  - **The suggested value:** derived from the site's URL where it can be read without running the app: a literal `metadataBase` in the root layout, then `package.json`'s `homepage`. It's shown as "suggested, not applied", and the build never writes it in.
  - **A v0 app loses nothing:** `.affordances/manifest.ts`, its routes and its graph are unchanged.
  - **Why not infer:** the namespace is the app's identity. Every capability's canonical URI is `<namespace>#<id>` (RFC 0001 §2), so a silently inferred namespace that later changes re-keys every id.
    - **A local URN,** such as `urn:affordances:acmeStore`, would invent a URN namespace no one registered.
    - **A homepage** is often a repository's URL, not the site's.

**Alternatives considered:**

| Alternative                                                  | Rejected because                                                                                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Declarations inside `actions.ts`, beside each `defineAction` | `actions.ts` is a `'use server'` module that imports the app. Reading it for data means running it, which breaks G2                |
| One app-wide file, such as `src/capabilities.ts`             | It's allowed, as the root module. Requiring it would separate a route's capabilities from the route, so co-location is the default |
| A config field listing the modules                           | It's configuration a convention doesn't need. Codegen already walks the tree                                                       |
| Decorators or comment pragmas on actions                     | They aren't types, so they don't infer, and comments carry no schemas                                                              |

## 2. What's extracted, and what's declared

### 2.1 Extraction rules

Each rule reads one fact, statically, and records its basis. Fields from a v0 `defineAction` are `imported`: they're the developer's v0 declaration, carried across formats. That amends RFC 0001 §10.1's table, which marked several as `declared`. Fields the compiler derives are `inferred`.

| Rule                            | Reads                                                            | Produces                                                                                  | Basis                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **E1, route**                   | the route folder, the action's `name` literal                    | a binding, protocol `affordances/v0`, address `{ route, action }`                         | `inferred`                                                                                                       |
| **E2, id**                      | an `id` string literal on `defineAction`                         | the capability's id                                                                       | `imported`. Without a literal, `W_NO_ID` with a suggestion (codegen's `suggestId`, `:216-231`), never an id      |
| **E3, input**                   | the `input` property's schema expression                         | `input`, as JSON Schema                                                                   | `inferred`, by conversion. See the slice rule below                                                              |
| **E4, kind**                    | `readOnly: true` literal                                         | kind `query`; otherwise `action`                                                          | `imported`                                                                                                       |
| **E5, authorization**           | `expose: 'public' \| 'session' \| 'confirm'` literal             | `authorization.principal`: `any`, `authenticated`, `authenticated`                        | `imported`. No `expose` means no authorization, so the action isn't exposed (RFC 0002 §4.3)                      |
| **E6, confirmation**            | `expose: 'confirm'`                                              | `confirmation`, with a generic summary, "Run {name}"                                      | the requirement `imported`; the summary `inferred`, with `W_SUMMARY_GENERIC`, since v0's `summary` is a function |
| **E7, guard**                   | `requires` literal and a `guard`                                 | one condition, id `guard`, `guard: true`, described by `requires`                         | `imported`. `W_OPAQUE`: it can't be evaluated outside the app                                                    |
| **E8, description**             | `description` literal                                            | `description`                                                                             | `imported`                                                                                                       |
| **E9, resources from segments** | a dynamic segment under a static one, such as `/products/[slug]` | a resource type, id from the static segment (`products`), key from the parameter (`slug`) | `inferred`. `W_ATTRIBUTES_UNKNOWN`, until a `defineResource` with that id declares the attributes                |

**The slice rule for E3.** An input schema is a runtime value, so reading it needs evaluation, and evaluating `actions.ts` would run the app.

- **What's evaluated:** the `input` initializer, and the bindings it refers to, followed transitively. The compiler resolves bindings itself, since oxc parses but doesn't analyze scope: top-level declarations by name, with shadowing respected (an arrow's parameter, as in `z.lazy(() => Node)`).
- **What the slice may reach:**
  - **imports from a schema library,** a closed list: zod, valibot, arktype, TypeBox and Effect's Schema. Each is confirmed at evaluation to be a Standard Schema;
  - **`const` declarations** whose initializers are themselves in the slice;
  - **other files,** following an import into a module whose own slice also holds (schema-library imports and such consts only), to a depth of 4. `import { ProductInput } from './schemas'` is the usual case;
  - **type-only imports,** even from app code (`const X: z.ZodType<Order>`), which are erased and never counted as app imports.
- **Recursion:** a self-referential schema (through `lazy`) makes a cycle in the walk. Each binding is visited once, and the slice is evaluated as a module graph.
- **If it holds,** the slice alone is evaluated in the capability-module process, and converted to JSON Schema as authoring already converts (`ir/author/standard.ts`).
  - **Only the slice runs.** Each reached module contributes only the imports and consts the slice needs. A side-effect-only import (`import './setup'`) in a module the slice reaches is never emitted, so it never runs. A schema that depends on a side effect, such as a global schema-library configuration, is evaluated without it.
  - **The rule is a lint, not a sandbox.** It decides statically which inputs are worth evaluating, and keeps app code out of the slice. It also bans the members that reach the language's machinery (`constructor`, `__proto__` and `prototype`) and any computed key that isn't a literal, and it reads defaults inside binding patterns as it reads initializers.
  - **The sandbox is the child process,** run under Node's permission model with an empty environment. It can read only the app and the `node_modules` it resolves from, and has no file writes, network, child processes or workers. A slice the lint misjudges still can't reach the host.
- **If it reaches anything else** (an import of app code, a call on app values, a `let`), the input is `W_INPUT_OPAQUE`. The developer then binds the action to a capability, whose schema is declared.
- **Lossy conversion,** the larger risk: `refine`, `superRefine`, `transform`, `preprocess`, `custom` and a pipe to a function all survive evaluation, but not JSON Schema. The IR's schema would then accept inputs the app's own schema rejects, so the runtime would validate weaker than v0 did. The compiler detects them in the slice and reports `W_INPUT_LOSSY`, naming each one dropped. In strict mode the input is opaque instead.

**Literals only.** Each rule reads a literal. A value built at runtime, or spread from another object (codegen already ignores spreads, `:88`), is read as absent, with a warning on the rule that needed it. Extraction never guesses.

**A capability-bound action extracts nothing from v0.** `defineAction({ capability, ... })` (RFC 0001 §12.1) takes its definition from the capability module. The compiler records only its binding (E1), checked against the capability's id. An action that sets both `capability` and a v0 field the capability also defines is `E_BOUND_REDEFINES`.

### 2.2 Always explicit

These are never extracted, because code doesn't state them. Each one missing is a warning that names what to declare:

- **Effects** (`W_EFFECTS_UNKNOWN`): v0's `effects` are delta keys, not consequences (RFC 0001 §10.1). A financial effect without an amount is `W_NO_AMOUNT`, since every confirmation summary lists every charge (RFC 0001 §4).
- **Declarative preconditions** (`W_OPAQUE` on the guard): a v0 guard is code. The developer declares what it checks, with `when.*`.
- **Claims:** a claim is the owner's assertion, so only the owner writes one.
- **Relations** beyond what's derived (`alternativeTo`, `relatedTo`).

**Why never inferred:** RFC 0001 rules 3 and 5 make a declared consequence and a declared precondition promises the runtime enforces and agents rely on. An inferred one would be a guess presented as a promise.

## 3. The DX bar

- **One obvious way.**
  - New code declares a capability in `capabilities.ts` and binds it with `defineAction({ capability, ... })`.
  - Existing v0 code needs nothing to start.
  - The two meet at one rule: a bound action extracts nothing.
- **Types that infer.** Authoring's types already infer conditions' paths against schemas, and `guards` against declared guard ids (RFC 0001 §12.1). The compiler adds no type a developer writes.
- **Safe by default.**
  - Nothing is exposed without authorization (E5).
  - A declarative condition with no runtime fails closed (RFC 0001 §12.1).
  - Extraction never produces `declared`.
  - An app import in a capability module is an error, not a warning.
- **Zero configuration breaks nothing a v0 app has, and the first build names the one line, pre-filled where possible, that turns the manifest on** (`W_NO_NAMESPACE`, §1).
  - **With a namespace:** `.affordances/manifest.json` lists every action that has an `id`, plus `W_NO_ID` suggestions for the rest.
  - **The codemod:** the existing codemod writes the suggestions in (`writeIds`, `codegen.ts:188-283`).
- **Diagnostics.** Every warning:
  - names the file, the line and the rule;
  - says what to declare, and where;
  - is collected in `.affordances/diagnostics.json`, and printed once per build.
  - In strict mode (`withAffordances({ strict: true })`), `W_NO_ID`, `W_INPUT_OPAQUE` and `W_INPUT_LOSSY` are errors.

| Code                            | When                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `W_NO_ID`                       | an action without an `id` literal or a capability                                                                                                 |
| `W_INPUT_OPAQUE`                | E3's slice reaches beyond schemas                                                                                                                 |
| `W_SUMMARY_GENERIC`             | a confirm action whose summary is v0's function                                                                                                   |
| `W_OPAQUE`                      | a v0 guard, which can't be evaluated outside the app                                                                                              |
| `W_EFFECTS_UNKNOWN`             | no effects declared                                                                                                                               |
| `W_NO_AMOUNT`                   | a financial effect with no amount (RFC 0001's code)                                                                                               |
| `W_ATTRIBUTES_UNKNOWN`          | a resource type inferred from a segment, with no `defineResource`                                                                                 |
| `W_NO_NAMESPACE`                | no namespace configured, so no `manifest.json`; it names the line to paste, with a suggested value where one is readable                          |
| `W_NO_OWNER`                    | no owner configured                                                                                                                               |
| `W_INPUT_LOSSY`                 | E3's slice converts, but drops a refinement or transform; each is named                                                                           |
| `W_NOT_LITERAL`                 | a field an extraction rule reads (`name`, `expose`, `description`, `readOnly`, `requires`) isn't a literal; a non-literal `name` skips the action |
| `W_SEGMENT_CONFLICT`            | two routes infer one resource type from their segments with different keys (`/products/[slug]`, `/products/[id]`); neither is used                |
| `E_IR_MISSING`                  | the app has capability modules or a namespace, but `@affordances/ir`, `@affordances/next`'s optional peer, doesn't resolve from the app's root    |
| `E_CAPABILITY_IMPORT`           | a capability module imports application code                                                                                                      |
| `E_CAPABILITY_SYNTAX`           | a capability module or slice uses syntax Node can't erase (an `enum`, a `namespace`)                                                              |
| `E_CAPABILITY_AMBIENT`          | a capability module uses a dynamic `import()`, `require`, `process`, `Date`, `Math.random`, `crypto`, `fetch` or a timer                          |
| `E_CAPABILITY_EVALUATION`       | a capability module throws while it's evaluated, or the evaluation itself fails; the detail names the error                                       |
| `E_CAPABILITY_NONDETERMINISTIC` | two evaluations, in fresh processes with an empty environment, give different manifests                                                           |
| `E_CAPABILITY_DUPLICATE`        | two capability modules define one id differently                                                                                                  |
| `E_CAPABILITY_MANIFEST`         | a definition exported beside a `defineManifest` export that doesn't hold it                                                                       |
| `E_CLAIMS_NO_OWNER`             | a capability module makes claims, and no owner is configured                                                                                      |
| `E_BOUND_REDEFINES`             | a bound action also sets a v0 field its capability defines                                                                                        |

## 4. Output

`next build` writes three files to `.affordances/`:

| File               | What it is                                                                                                                                                             | Imports app code?                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `manifest.json`    | written only when a namespace is configured (§1): the RFC 0001 manifest, canonical JSON (RFC 8785), validated by `validate`, with the manifest digest RFC 0001 defines | **no**                                |
| `bindings.ts`      | the runtime binding module: capability id to the `defineAction` export that implements it, and how to call it (below)                                                  | yes: it's runtime, never the artifact |
| `diagnostics.json` | §3's warnings, for tools and CI                                                                                                                                        | no                                    |

**What a binding holds.** A runtime handler is called with `(input, { principal, target, refs })` (RFC 0002 §11). A v0 `run` and `guard` take v0's page context: the route's params, and the session. So each entry in `bindings.ts` says how to rebuild that context:

- **`export` and `route`:** the `defineAction` that implements the capability;
- **`params`:** where each route parameter comes from, `{ slug: { from: 'target' } }` for E9's key, or `{ from: 'reference', name }` for a bound reference. The runtime's call has no URL, so the params can't come from one;
- **the session:** from the projection route's own request. `next/headers` works for request-scoped reads there, so the binding needs no field for it;
- **`guards`:** each declared guard id to the v0 guard that implements it. E7's condition `guard` binds to the action's v0 `guard` (RFC 0001 §12.1).

- **The existing route manifest is kept.** `.affordances/manifest.ts` stays v0's, unchanged.
- **Deterministic:** the same sources give byte-identical output, and `manifest.json` changes only when its content does, as codegen's writer already does (`codegen.ts:178-186`).
- **Validation:** an `E_*` from `validate` fails the build. A `W_*` doesn't. In strict mode, §3's three strict codes (`W_NO_ID`, `W_INPUT_OPAQUE` and `W_INPUT_LOSSY`) do.

## 5. The runtime interop

**The minimum M6 needs:** a route that serves RFC 0002's views from the compiled manifest.

- **`createProjectionRoute({ resources, principal })`**, from `@affordances/next/projection` (new, `@experimental`):
  - it builds `createRuntime` (RFC 0002 §11) from `manifest.json`, the app's resolvers, and handlers taken from `bindings.ts`;
  - `principal` maps the request to a principal, as `apps/hosting-lab/src/lib/principal.ts` does;
  - it serves views and inspections, never a projection.
- **What it fixes:** only where the parts come from, and the rules RFC 0002 already sets. Those are views only, an Origin check for cookie calls, and per-caller caching.
- **What it defers:** the URLs, the request and response shapes, and paging are RFC 0004's. Until then, the route's surface is hosting-lab's (`apps/hosting-lab/src/lib/serve.ts`), marked `@experimental`, so RFC 0004 can replace it. The route is versioned with RFC 0004: it declares the wire-format version it serves, and moves only when RFC 0004 does, so the two can't drift.

## 6. Ownership and sequencing

| Part                                                                                          | Owner                     |
| --------------------------------------------------------------------------------------------- | ------------------------- |
| this RFC, and M6b, the enrichment API (§1's modules and diagnostics, as an authoring surface) | design                    |
| M6a, c and d: the extractor, the compiler pipeline, the projection route                      | backend, after M5's runs  |
| §8's measurement                                                                              | design, as a marked spike |

## 7. Measuring how much extraction recovers

**The assumption:** a Next.js app's existing code determines enough of its manifest that a developer only enriches, never rewrites.

**The measurement:** run extraction (§2) over two apps, compare it with a hand-written manifest field by field, and report precision and recall per field.

- **apps/hosting-lab:** its hand-written manifest is the reference. Its actions are capability-bound, so extraction alone would recover them trivially. So it's measured against a v0 rewrite of the same actions, the form an app has before it adopts capabilities.
- **apps/example:** a plain v0 app with no IR manifest, so a reference is written for it by hand, before the extractor runs, and committed with the measurement.
- **Per field:** id, kind, input, authorization, confirmation, binding, resource types and keys, effects, preconditions, claims and relations.
  - **Precision** is the share of extracted values that match the reference.
  - **Recall** is the share of the reference's values extracted.
- **Expected, from §2's rules, before the spike:**
  - binding, kind and authorization at full recall, where they're literals;
  - input wherever the schema slice holds;
  - ids only where written;
  - effects, declarative preconditions, claims and relations at zero, by design.

  The spike reports what it finds. A precision below 1 on any extracted field is a defect in a rule, not an expected loss.

- **What can't be inferred:** effects, declarative preconditions, claims and relations, and an input schema built from application values.

**The compiler's own tests,** alongside the measurement:

- **Isolation:** a capability module importing app code, statically or through a dynamic `import()` or `require`, fails, with `E_CAPABILITY_IMPORT` or `E_CAPABILITY_AMBIENT`.
- **Ambient values:** one reading `process.env`, `Date.now()`, `Math.random()` or `crypto.randomUUID()` fails `E_CAPABILITY_AMBIENT`.
- **Nondeterminism:** one that varies between evaluations by a route the static check misses fails `E_CAPABILITY_NONDETERMINISTIC`.
- **Determinism:** the same sources give a byte-identical `manifest.json` and digest across two clean builds.

## 8. Alternatives considered for the whole approach

| Alternative                                                | Rejected because                                                                                                       |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Import `actions.ts` at build time and read the objects     | It runs the app, with its database clients, environment and side effects, to build an artifact meant to import nothing |
| The TypeScript compiler API, for types instead of literals | It's a new, heavy dependency, and input schemas are values, not types. oxc already parses everything §2 reads          |
| Infer effects from what a handler writes                   | It's a guess presented as a promise (§2.2)                                                                             |
| A separate CLI instead of `next build`                     | It's another command to forget. The build already runs codegen                                                         |

## 9. Open questions

1. **Resource ids from segments (E9): decided.** The inferred id is the segment as written (`products`), never singularized, since singularizing is a heuristic. Renaming is the developer's, with a `defineResource` (intake, on acceptance, 2026-11-18).
2. **Mixed apps.** An app with both bound and v0 actions gets one manifest from both. Should a namespace be able to hold capabilities from two sources at once? This RFC allows it, with provenance telling them apart.
3. **The wire format** (§5) is RFC 0004's.

## References

- RFC 0001, the semantic capability IR: §4, §6.1, §8, §10 and §12.1.
- RFC 0002, contextual projection: §4.3 and §11.
- `packages/next/src/codegen.ts`, the route walk and `writeIds`.
- `apps/hosting-lab/src/app/capabilities.ts` and `apps/example/src/app/**`.
