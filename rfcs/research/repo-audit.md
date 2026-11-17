# Repository audit: Affordances v0

**Status:** research input to RFC 0001. **Commit audited:** `e9645ab4` (main).

This audit records what the repository does today, where it falls short of a semantic capability model, and what any successor has to keep working. Every claim about the code cites `path:line` at that commit.

## Motivation

The next stage of Affordances aims to describe an application's capabilities independently of any page, route or transport, and to derive from that description what a particular caller can do, discover and choose in context. It has three parts:

- **A semantic capability IR:** a portable, deterministic and non-executable manifest of resources, capabilities, conditions, effects, relations and attributed claims.
- **A projection runtime:** it turns a manifest plus context (the caller, the resource, the state, a disclosure policy) into a graph of capability offers that an agent can explore step by step.
- **A choice benchmark:** it measures how the way capabilities are disclosed changes the choices agents make, while the options themselves stay fixed.

Designing those well needs an exact picture of v0: what it already does and should keep, and what it doesn't model.

The short version: v0 is a small, coherent, page-oriented protocol. It has state-aware availability, server-enforced confirmation, availability changes in deltas and a static site index. What it lacks is a model of the domain: no resource types, no identity outside a route, no typed relations except navigation, no structured consequences, and no build artifact that can be read without running the app (§4).

## 1. Packages

Ten packages and four apps. One app, `apps/bench`, is already an agent benchmark.

| Package                 | Published  | Role                                                                                                                                                 | Public surface                                                                                                                                                                                    |
| ----------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@affordances/protocol` | yes, 0.5.1 | The wire format: zod schemas that the TypeScript types and the JSON Schemas are both generated from                                                  | `Graph`, `ActionDescriptor`, `ActionSummary`, `NavItem`, `Call`, `Delta`, `ErrorCode`, `SiteIndex`, `Expose`, `AuthMode`, the constants, `jsonSchemas`; `schemas/*.json`, `fixtures/*`, `spec.md` |
| `@affordances/core`     | yes, 0.5.1 | Defining actions and state, and a framework-independent `Request → Response` handler                                                                 | `defineAction`, `defineState`, `createAffordances`, `createHandler`, `AffordancesError`, `redirect`, the route matcher (`compile`, `match`, `sort`)                                               |
| `@affordances/next`     | yes, 0.5.1 | Next.js integration: scans `app/` for `actions.ts` and `state.ts`, generates a manifest module, adds rewrites and `Link` headers, serves the handler | `.`, `./config` (`withAffordances`), `./route` (`GET`, `POST`, `createRouteHandler`), `./manifest`, `./codegen`                                                                                   |
| `@affordances/react`    | yes, 0.5.1 | Client provider that loads the page's graph, calls actions, and registers WebMCP tools; a DOM marker; a dev overlay                                  | `AffordancesProvider`, `useAffordances`, `Affordance`, `getModelContext`; `./dev` (`AffordancesDevtools`)                                                                                         |
| `@affordances/mcp`      | yes, 0.5.1 | An HTTP client for any Affordances site, and a stdio MCP server with two generic tools over it                                                       | `createClient`, `createServer`, `describeSite`, `signature`; bin `affordances-mcp`                                                                                                                |
| `@affordances/cli`      | yes, 0.1.5 | `init` and `build` for a Next app; `open` and `call` to see a page as an agent does                                                                  | bin `affordances`                                                                                                                                                                                 |
| `@affordances/lint`     | yes, 0.5.1 | Two ESLint/oxlint rules                                                                                                                              | `require-affordance`, `static-action-name`, `configs.recommended`                                                                                                                                 |
| `@affordances/md`       | yes, 0.5.1 | Serves any Next.js page as Markdown at the same URL, plus `llms.txt` handlers. It works without the rest of Affordances                              | `.`, `./react`, `./react/client`, `./next`, `./next/llms`, `./next/llms-full`, `./next/proxy`, `./routes`; bin `affordances-md`                                                                   |
| `@affordances/md-core`  | private    | Bench, parity and evaluation tools for md's single-pass converter. No source of its own                                                              | scripts only                                                                                                                                                                                      |
| `@affordances/ui`       | private    | The docs and demo design system (shadcn-style components)                                                                                            | `./components/*`, `./hooks/*`, `./lib/*`, `./globals.css`, `./postcss.config`                                                                                                                     |

| App            | Role                                                                                                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/example` | The demo store that every other part is tested against: six routes with state and five actions, in `apps/example/src/app/`: `search` (`actions.ts:8`), `updateQuantity` and `removeItem` (`cart/actions.ts:9`, `:35`), `placeOrder` (`checkout/actions.ts:10`), `addToCart` (`products/[slug]/actions.ts:10`) |
| `apps/bench`   | Runs five shopping tasks against `apps/example` with a browser agent and an Affordances agent, and records turns, tokens, cost, time and verified success (`apps/bench/README.md`)                                                                                                                            |
| `apps/docs`    | The documentation site                                                                                                                                                                                                                                                                                        |
| `apps/demo`    | A recorded walkthrough built on the bench's events                                                                                                                                                                                                                                                            |

## 2. What v0 does

### 2.1 The graph

A `GET` with the Affordances media type returns one page's graph: `v`, `page`, `route`, `entities`, `actions`, and optionally `nav` and `md` (`packages/protocol/src/schema.ts:35-45`). The handler builds it by matching the path against the route manifest's patterns (`packages/core/src/handler.ts:122-127`, called at `:245`), loading the route's state and describing each exposed action (`:129-135`), then assembling the graph (`:250-259`).

- `entities` is whatever the state loader returns, an untyped record (`packages/protocol/src/schema.ts:40`, `packages/core/src/action.ts:18`).
- `actions` lists every exposed action on the route, including the ones the caller can't call right now (`packages/protocol/spec.md:46`).
- The spec asks for graphs of about 2,000 tokens or less (`packages/protocol/spec.md:49`).
- `md` is defined (`packages/protocol/src/schema.ts:43`, `packages/protocol/spec.md:48`) but no package fills it: the handler's graph has no `md` (`packages/core/src/handler.ts:252-259`).

### 2.2 ActionDescriptor

`name`, `description`, `input`, `output?`, `expose`, `guard?`, `available`, `reason?`, `effects?`, `readOnly?` (`packages/protocol/src/schema.ts:14-27`). `ActionSummary` is the same without `available` and `reason`, for the site index (`packages/protocol/src/schema.ts:89-91`).

Authors write `defineAction` (`packages/core/src/action.ts:150-178`) with an `ActionConfig` (`:23-57`). The descriptor's `guard` is the author's `requires` text, not the guard function (`packages/core/src/handler.ts:94`). Input schemas are any Standard Schema; their JSON Schema comes from the library's Standard JSON Schema converter or an explicit `jsonSchema` (`packages/core/src/action.ts:101-111`).

### 2.3 Guards and availability

A guard is a closure over `{ input, state, ctx }` that returns `true`, `false`, or a reason (`packages/core/src/action.ts:21`, `:39-44`).

- **In the graph** it runs with `input: undefined` (`packages/core/src/handler.ts:109`). So availability is per action, not per input; authors return `true` for the undefined input unless the action is unavailable regardless (`packages/core/src/action.ts:38`; `apps/example/src/app/products/[slug]/actions.ts:23`).
- **On a call** it runs again, with the validated input against freshly loaded state (`packages/core/src/handler.ts:192-196`).
- An action that needs a session reads as `available: false` with "Requires a session" for an anonymous caller (`packages/core/src/handler.ts:107-108`).

### 2.4 Exposure

`expose` is `public`, `session` or `confirm`: "anyone", "an authenticated session, by cookie or bearer token", or "a session, and the call must carry `confirm: true` after the user has seen a summary" (`packages/protocol/src/schema.ts:12`, `packages/protocol/spec.md:68-74`). An action without it is never listed or callable (`packages/protocol/spec.md:76`, `packages/core/src/handler.ts:81`), and `defineAction` warns in development (`packages/core/src/action.ts:153-154`).

Cookie-authenticated calls must carry a matching `Origin`, bearer calls are exempt (`packages/core/src/handler.ts:168-177`). The handler checks `expose` against the session (`:178-179`) and applies an optional rate limit (`:181-189`).

### 2.5 Confirmation

A `confirm` action called without `confirm: true` answers `confirm_required`, with the author's `summary` for the person who approves it, and nothing runs (`packages/core/src/handler.ts:198-204`, `packages/protocol/spec.md:98`). Each client surfaces it:

- the React provider asks `window.confirm` by default and resends (`packages/react/src/provider.tsx:41`, `:72-75`);
- the MCP tool's description tells the model to show the summary and wait for approval (`packages/mcp/src/server.ts:43`);
- the CLI prints "Rerun with --confirm once the person approves" (`packages/cli/src/format.ts:69`).

### 2.6 Deltas and effects

A call returns a delta (`packages/protocol/src/schema.ts:65-84`). After `run`, the handler reloads the state and diffs it (`packages/core/src/handler.ts:215-225`):

- `changed` holds the keys named in `effects`; when `effects` is absent, every top-level key whose JSON differs (`:216-221`);
- `actionsAdded` holds any action whose descriptor changed, which covers availability flips; `actionsRemoved` holds the names that went away (`:222-225`, `packages/protocol/spec.md:118`);
- `redirect` comes from `redirect()` or the framework's own redirect error (`packages/core/src/handler.ts:207-214`, `packages/next/src/route.ts:5-8`);
- `message` is the author's sentence (`packages/core/src/handler.ts:234`).

`effects` is typed as keys of the route's state (`packages/core/src/action.ts:51`).

### 2.7 The site index

`GET /.well-known/affordances.json` lists every route with its optional description and its exposed actions as `ActionSummary`s (`packages/core/src/handler.ts:137-148`). The spec says it is enough to plan a task and call an action without opening its page (`packages/protocol/spec.md:149`). `auth` is always `['cookie', 'bearer']` (`packages/core/src/handler.ts:146`).

### 2.8 The Next codegen manifest

`scan` walks `app/` (or `src/app/`) for `state` and `actions` files, drops route groups and parallel slots, and skips `_private` folders (`packages/next/src/codegen.ts:25-26`, `:69-107`).

- An actions file must start with `'use server'` (`:39`), and each `defineAction` must have a string-literal `name` (`:62`), which is all the scanner reads from it (`:63`).
- Duplicate names are rejected within a route (`:90`).
- `render` writes `.affordances/manifest.ts`: an import of each state and action module, and an object `satisfies Manifest` (`:109-131`).
- `withAffordances` aliases `@affordances/next/manifest` to that file (`packages/next/src/config.ts:112`), regenerates it on change in development (`:85`), and adds the rewrites (`:26-38`) and `Link` headers (`:126`).
- The lint rule `static-action-name` enforces the literal name in the editor (`packages/lint/src/index.ts:84`).

### 2.9 MCP and WebMCP

- **MCP:** `affordances-mcp <site>` fetches the site index and passes it as the server's instructions, in a terse text form (`packages/mcp/src/cli.ts:19-23`, `packages/mcp/src/describe.ts:31-32`). It registers two tools whatever the site: `affordances_open`, read-only (`packages/mcp/src/server.ts:29-34`), and `affordances_call` (`:40`). The client refuses other origins (`packages/mcp/src/client.ts:17`), keeps the cookies the site sets (`:27-30`) and sends them back with the site's `Origin` (`:21-24`).
- **WebMCP:** the React provider registers one tool per _available_ action of the current page, named by the bare action name (`packages/react/src/provider.tsx:84-102`). It maps `readOnly` to `readOnlyHint` and `expose: 'confirm'` to `consequentialHint` (`:99-100`). `execute` posts to the page's endpoint, so browser agents get the same checks as headless ones (`apps/docs/content/guides/react.mdx:26`).

### 2.10 The CLI's agent flows

`open` prints a page's graph and an estimated token cost (four characters per token) (`packages/cli/src/agent.ts:8`, `:29`). `call` sends a call and prints the delta (`:37`, `packages/cli/src/commands.ts:86-97`). Both go through `@affordances/mcp`'s client. `init` and `build` set up and regenerate the manifest (`packages/cli/src/project.ts:30`, `:38`).

## 3. Easy to get wrong about v0

v0 already has contextual graphs, state-aware availability, session-aware exposure, confirmation, deltas with availability changes, a site index, and HTTP, MCP and WebMCP surfaces (§2). A successor shouldn't be argued for as if these were missing. A few other points are easy to misread:

- **`@affordances/md` isn't part of the graph.** It's a standalone HTML-to-Markdown product that "works without the rest of Affordances" (`packages/md/src/next/index.ts:1339`). Its only link to the protocol is that it reads the site index (`:1369-1386`) for its `llms.txt` output (`:1703`, `:1837`, `:1865`). The graph's own `md` field is unused (§2.1).
- **MCP's site discovery isn't a tool.** The site index reaches the model as server instructions (`packages/mcp/src/cli.ts:19-23`). The tools are two generic verbs, not one tool per action. So MCP tool annotations can't carry an action's `readOnly`. The model sees it only as text: `describeSite` writes `[expose, read-only]` after each action (`packages/mcp/src/describe.ts:40`).
- **The spec disagrees with itself on the index.** `packages/protocol/spec.md:27` says the index lists "their action names", while the type and the handler carry full `ActionSummary`s (`spec.md:140`, `packages/core/src/handler.ts:144`).

## 4. Limitations for a semantic model

These eight are the reasons a semantic model can't simply be v0 with more fields. None of them is a flaw in v0's own terms, which is a page-oriented protocol.

| #   | Limitation                                                            | Finding                                                                                      |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | Action identities are route-local                                     | Holds                                                                                        |
| 2   | `effects` are state keys, not consequences                            | Holds, and declared effects hide observed ones                                               |
| 3   | `requires` is prose; guards are opaque                                | Holds; `expose` is the one declarative condition                                             |
| 4   | Relations are mostly navigation                                       | Holds, more strongly: navigation is the only typed relation, and there are no resource types |
| 5   | The Next manifest imports executable code                             | Holds                                                                                        |
| 6   | Discovery returns a route's actions together                          | Holds                                                                                        |
| 7   | Availability and discoverability aren't independent                   | Holds; they're coupled differently on each surface                                           |
| 8   | Publisher preference, relevance and user benefit aren't distinguished | Holds: none is modeled, and ordering is an implicit, uncontrolled channel                    |

**1. Route-local identity.**

- An action's identity is the pair (route pattern, name): "unique per route, stable across releases" (`packages/protocol/spec.md:55`).
- The handler resolves a call by name among the route's actions (`packages/core/src/handler.ts:160`), and codegen only rejects a duplicate within a route (`packages/next/src/codegen.ts:90`).
- Each transport names it differently: MCP addresses `(path, action)` (`packages/mcp/src/server.ts:45-46`), and WebMCP uses the bare name (`packages/react/src/provider.tsx:95`).
- Names are plain identifiers such as `addToCart`, with no namespace. "Stable across releases" is a convention nothing checks.
- A hand-written `Manifest` can list the same action function on several routes (`packages/core/src/handler.ts:28`). It then has several identities.

**2. Effects are state keys.**

- `effects` is a list of state keys (`packages/protocol/spec.md:63`, `packages/core/src/action.ts:51`), used only to pick what goes in `changed` (`packages/core/src/handler.ts:216-221`).
- Consequences are carried elsewhere, all unstructured:
  - `readOnly` (`packages/core/src/action.ts:52`);
  - `expose: 'confirm'`, which the docs reserve for actions that "spend money or can't be undone" (`apps/docs/content/index.mdx:27`);
  - the per-call `summary` (`packages/core/src/action.ts:45`) and `message` (`:50`).
- **The demo store shows the gap.** `placeOrder` declares `effects: ['cart']` (`apps/example/src/app/checkout/actions.ts:26`). It also creates an order, reserves stock and redirects (`:27-32`). The order is its real consequence, and nothing machine-readable says so.
- **v0 also doesn't keep declared and observed effects apart,** which a model of consequences has to. When `effects` is declared, `changed` holds only those keys, even if others changed (`packages/core/src/handler.ts:216-217`).

**3. Prose preconditions and opaque guards.**

- `requires` is a string copied into the descriptor's `guard` (`packages/core/src/handler.ts:94`). The guard is a closure (`packages/core/src/action.ts:39-44`).
- An agent sees the guard's result for this request (`available`, `reason`), not its logic. The result is per action, not per input (§2.3).
- `expose` is a small declarative condition vocabulary that v0 already has: "anyone", "a session", "a session plus confirmation" (`packages/protocol/spec.md:68-74`). It is evaluated by the handler, not by the author's code.

**4. Relations are navigation, and there are no resource types.**

- `nav` items (`to`, `label`, `when` in prose) are the only typed relation (`packages/protocol/src/schema.ts:29-33`, `packages/core/src/action.ts:88`).
- There's no resource model to relate: `entities` is an untyped record per page (`packages/protocol/src/schema.ts:40`).
- Cross-route relations live in descriptions. `search` says its results carry SKUs "so addToCart on the product's page can follow without opening it" (`apps/example/src/app/actions.ts:11`).
- Three weaker links exist, none typed as a relation:
  - `effects` (action → state key);
  - `<Affordance>` (action → DOM element, `packages/react/src/affordance.tsx:24`);
  - `actionsAdded` and `actionsRemoved`: an observed follow-on, per call (`packages/core/src/handler.ts:222-225`).

**5. The manifest imports executable code.**

- The generated manifest is a TypeScript module that imports the app's state and action modules (`packages/next/src/codegen.ts:114`, `:119`, `:131`), resolved through a bundler alias (`packages/next/src/config.ts:112`).
- The only thing codegen reads statically is each action's name (`packages/next/src/codegen.ts:63`).
- **The closest thing to a portable artifact is the site index.** But it's produced by running the app (`packages/core/src/handler.ts:137-148`), its schemas come from running the schema library (`packages/core/src/action.ts:101-111`), and it's organized by route.

**6. Discovery returns a route's actions together.**

- A graph describes every exposed action of the route at once (`packages/core/src/handler.ts:133`), and the site index lists every route (`:141-145`).
- The only way to expand is to open another page (`packages/mcp/src/client.ts:41`). Size is bounded by guidance, not by a mechanism (`packages/protocol/spec.md:49`).

**7. Availability and discoverability are coupled, differently on each surface.**

- `expose` decides both whether an action is listed and whether it's callable (`packages/protocol/spec.md:76`). Every exposed action is listed, available or not (`:46`). There's no way to be callable but listed only on request, or listed but out of the current view.
- **The coupling goes the other way on WebMCP:** only available actions become tools (`packages/react/src/provider.tsx:90`). There, availability gates discoverability.
- So the same action is discoverable on HTTP and MCP but not on WebMCP when it's unavailable. That's a reasonable choice, made per surface rather than modeled.

**8. Preference, relevance and benefit are not distinguished.**

- None of the three is modeled, and neither is salience.
- Influence exists anyway, through channels nobody controls on purpose:
  - free-text descriptions (`packages/protocol/src/schema.ts:17`);
  - action order, which is the export order in the actions file (`packages/next/src/codegen.ts:63`, then `packages/core/src/handler.ts:133`);
  - route order, sorted by string (`packages/next/src/codegen.ts:106`).
- The only behavioral hints are `readOnly` and `consequentialHint` (`packages/react/src/provider.tsx:99-100`).

## 5. Strengths to preserve

- **One source for types and schemas.** The zod definitions generate both the TypeScript types and the published JSON Schemas (`packages/protocol/src/schema.ts:3`, `packages/protocol/src/json-schema.ts:5`).
- **Default deny.** Only actions with `expose` are reachable (`packages/protocol/spec.md:153`).
- **A fixed, tested call order.** Resolve, origin and `expose`, rate limit, validate, guard, confirm, run, each stopping at the first failure (`packages/protocol/spec.md:91-99`, `packages/core/src/handler.ts:156-235`).
- **An offer is already not authorization.** The graph's `available` is advice: a call re-checks `expose`, the origin and the guard against fresh state (`packages/core/src/handler.ts:168-196`). So the rule that a projected offer is never authorization already holds on v0's agent path.
- **Server-enforced confirmation** with a summary written for a person (`packages/core/src/handler.ts:198-204`).
- **Deltas carry availability changes**, so an agent learns what a call made possible or impossible without reopening the page (`packages/core/src/handler.ts:222-225`).
- **The same URL and the same session as a person**, with cache safety written into the spec (`packages/protocol/spec.md:29`, `packages/core/src/handler.ts:59-63`).
- **A framework-independent core.** `createHandler` is `Request → Response` (`packages/core/src/handler.ts:238`); Next is an adapter. Input schemas are any Standard Schema.
- **Static names, enforced twice:** by codegen (`packages/next/src/codegen.ts:62`) and by lint (`packages/lint/src/index.ts:84`).
- **Small, cheap context.** The token ceiling (`packages/protocol/spec.md:49`), the terse site index (`packages/mcp/src/describe.ts:31`), the CLI's token estimate (`packages/cli/src/agent.ts:8`).
- **A benchmark that checks outcomes, not the agent's word** (`apps/bench/README.md`).

## 6. Compatibility constraints for M2 and later

- **The v0 wire documents keep validating.** `Graph`, `Call`, `Delta` and `SiteIndex` against `packages/protocol/schemas/*.json`, and `v: '0'`. Within a major version, changes are additive only (`packages/protocol/spec.md:161`). Eight packages are published, at 0.5.1 (the CLI at 0.1.5).
- **The authoring API keeps working:** `defineAction`, `defineState`, `createAffordances`, the `actions.ts`/`state.ts` file convention, the `'use server'` and literal-name rules, `.affordances/manifest.ts` and its alias.
- **v0's identity is (route pattern, name).** A v0 adapter has to recover each route's action names from IR capabilities losslessly. WebMCP tool names are bare action names, and the MCP tools are `affordances_open` and `affordances_call`.
- **`effects` keeps its v0 meaning (state keys).** The IR's model of consequences must be a different concept with a different name.
- **The call order and error codes stay** (`packages/protocol/spec.md:91-99`, `:124-132`). Any new execution path enforces at least the same checks.
- **`@affordances/md` must not need the IR.** It reads only `name`, `routes[].route` and `routes[].description` from the site index (`packages/md/src/next/index.ts:1342`, `:1703`, `:1837`).

## 7. Gaps

What a semantic capability IR and a projection runtime need that v0 doesn't have:

1. **Semantic identity** independent of routes and transports (limitation 1).
2. **Resource types and resource instances.** Today there's only per-page state (limitation 4).
3. **Typed relations** beyond navigation, each with defined semantics (limitation 4).
4. **Structured effects:** categories (state, external, financial, privacy), reversibility, and declared effects kept apart from observed ones (limitation 2, and §6.5).
5. **Declarative conditions,** with an explicit marker for the ones that stay opaque and runtime-enforced, and availability per input when it matters (limitation 3).
6. **A portable, non-executable build artifact** that a tool can read without running the app (limitation 5).
7. **Provenance and attributable claims.** Nothing records who said what, or how it's known.
8. **Discovery policy as its own input,** with bounded, agent-directed expansion (limitation 6).
9. **Separate dimensions** for availability, discoverability, relevance, salience and publisher preference (limitations 7 and 8).
10. **Projection revisions.** A delta is a diff for one call. There's no graph revision to detect a stale view, or an offer that expired between reading and calling.
11. **Benchmark drivers.** `apps/bench` calls the Anthropic SDK directly (`apps/bench/src/loop.ts:1`, `:98`) and needs an API key. The choice benchmark needs a pluggable driver interface to run through other agent runtimes.

## 8. Other findings for RFC 0001

None of these is a bug in v0's own terms. They are boundaries that the IR's safety invariants should state precisely rather than assume away.

- **Confirmation is a flag the client sets.** The server enforces that `confirm: true` is present (`packages/core/src/handler.ts:199`). It can't know whether a person saw the summary; that rests on the client (`packages/protocol/spec.md:155`). Nothing in an IR should claim more than that.
- **The guard and `run` aren't atomic.** State can change between the guard check (`packages/core/src/handler.ts:193-196`) and `run` (`:210`). The docs tell authors to enforce what must hold inside `run` (`apps/docs/content/concepts/guards.mdx:48`). A runtime's tests for state that changes between projection and invocation need this in view.
- **The UI path doesn't evaluate guards or `expose`, by design.** A server action called from the app's components validates input and runs (`packages/core/src/action.ts:156-161`; documented in `apps/docs/content/guides/security.mdx:41`). "Execution re-checks authorization" is true of v0's agent path only, and an IR invariant has to say which path it means.
- **Declared effects hide observed changes** (`packages/core/src/handler.ts:216-217`; limitation 2).
- **The index's `auth` is fixed** at `['cookie', 'bearer']`, whatever the app accepts (`packages/core/src/handler.ts:146`).
- **The graph's `md` field is unused** (§2.1).
