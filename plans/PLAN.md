# Afford — implementation plan

> Make any Next.js app agent-operable. One `defineAction` → server action for humans, WebMCP tool in the browser, headless HTTP endpoint, MCP server. Per-route state + typed actions + deltas, same URL, user's session.

Working name: **Afford** (from _affordance_). Packages: `@afford/*`. Unscoped `afford` is taken on npm; `@afford` scope looked free on 2026-10-28 — claim the npm org + GitHub org before anything else.

---

## 0. Rules for the building agent

- Build milestones in order. Each ends green: `vlt run build`, `test`, `lint`, `fmt:check`.
- Protocol types live only in `@afford/protocol`. Other packages import, never redefine.
- Default deny: nothing reachable by agents unless `expose` says so.
- No custom webpack/Turbopack loaders. Codegen + plain imports only.
- Verify tool/API details against current docs (vlt, Next 16 `proxy.ts`, WebMCP `document.modelContext`, zod 4) before relying on them; they move.
- Keep public API tiny. If it doesn't fit in the README's first code block, push back.

---

## 1. Repo + tooling

```
afford/
  apps/
    docs/          # Next.js docs site, dogfoods @afford/next
    example/       # store template (no Shopify), the demo
    bench/         # screenshot agent vs Afford agent, reproducible numbers
  packages/
    protocol/      # types, JSON Schemas, spec.md, version constant
    core/          # defineAction, registry, state, delta, auth hooks, HTTP handler (framework-agnostic)
    react/         # <Affordance>, useAffordance, WebMCP registration
    next/          # withAfford, proxy helper, route handler, codegen, CLI init
    mcp/           # site → MCP server bridge (CLI)
    lint/          # coverage rule (ESLint rule API)
  vlt.json
  package.json
  tsconfig.base.json
  .oxlintrc.json
  .oxfmtrc.json
```

- **vlt** workspaces (`apps/*`, `packages/*`). Commit `vlt-lock.json` — Vercel auto-detects it.
- **oxlint** + **oxfmt**. `fmt:check` in CI.
- **TypeScript** strict, `moduleResolution: bundler`, project refs per package.
- **tsdown** for package builds: ESM only, `.d.ts`, `exports` map, `sideEffects: false`.
- **vitest** for unit/integration; **Playwright** for example e2e.
- **changesets** for versioning; packages start at `0.0.x`.
- **Turborepo** optional (remote cache). Add only if vlt's runner is too slow.
- CI: GitHub Actions — install, build, typecheck, lint, fmt:check, test, e2e on example.
- Node ≥ 20. Peer deps: `next >=16`, `react >=19`, `zod >=4` (or any Standard Schema).

---

## 2. Protocol v0 (`@afford/protocol`)

Write `spec.md` first; types + JSON Schema generated from/aligned with it.

**Discovery**

- `GET <page-url>` with `Accept: application/vnd.afford+json` → graph.
- HTML pages add `<link rel="afford" href="?afford">` and header `Link: <…>; rel="afford"`.
- `/.well-known/afford.json` → site index: protocol version, routes, auth modes, MCP endpoint.

**Graph**

```ts
type Graph = {
  v: "0";
  page: string; // concrete path
  route: string; // pattern, e.g. /products/[slug]
  entities: Record<string, unknown>;
  actions: ActionDescriptor[];
  nav?: { to: string; label?: string; when?: string }[];
  md?: string; // optional content alt
};
type ActionDescriptor = {
  name: string; // stable, unique per route
  description: string;
  input: JSONSchema;
  output?: JSONSchema;
  expose: "public" | "session" | "confirm";
  guard?: string; // human-readable precondition
  available: boolean; // evaluated guard
  reason?: string; // why unavailable
  effects?: string[]; // entity keys this changes
  readOnly?: boolean;
};
```

**Call**

- `POST <page-url>` `Content-Type: application/vnd.afford+json`, body `{ action, input, confirm? }`.
- Response `Delta`:

```ts
type Delta = {
  ok: boolean;
  changed?: Record<string, unknown>; // only effects keys
  actionsAdded?: ActionDescriptor[];
  actionsRemoved?: string[];
  redirect?: string;
  message?: string;
  error?: { code: ErrorCode; message: string; issues?: unknown };
};
type ErrorCode =
  | "not_found"
  | "invalid_input"
  | "unauthorized"
  | "confirm_required"
  | "unavailable"
  | "rate_limited"
  | "internal";
```

- `confirm`-exposed actions return `confirm_required` + summary unless `confirm: true` sent.

**Versioning:** `v` field; breaking change = new major; packages declare supported range.

Deliverables: `spec.md`, TS types, JSON Schemas, schema validation tests, fixtures used by every other package.

---

## 3. `@afford/core`

```ts
export const addToCart = defineAction({
  name: "addToCart",
  description: "Add a product variant to the cart",
  input: z.object({ sku: z.string(), size: z.number() }),
  expose: "session",
  guard: ({ input, state }) => inStock(state, input) || "size out of stock",
  effects: ["cart"],
  run: async (input, ctx) => cart.add(input),
});
```

- `defineAction` returns an `async` function (valid server action export) with metadata attached via a symbol. Metadata does **not** survive the client boundary — client gets it from the manifest (see §5).
- Schema: Standard Schema interface; JSON Schema via zod 4 `toJSONSchema` or user-supplied converter.
- `defineState(loader)` for route state; loader gets `{ params, searchParams, ctx }`.
- `createHandler({ manifest, auth, rateLimit })` → `(req: Request) => Response`. Framework-agnostic: resolve route, load state, build graph, validate input, eval guard, check `expose` + auth, run, reload state, diff, return delta.
- `auth` hook: `(req, action) => Ctx | null`. Default: session from cookies via adapter; `public` skips; headless token via `Authorization: Bearer` hook.
- Deterministic delta: re-run loader, return `effects` keys (or shallow diff when `effects` omitted).

Tests: graph build, validation errors, guard eval, expose matrix, delta correctness, error codes.

---

## 4. `@afford/react`

- `<Affordance action={addToCart} input={{ sku }}>{children}</Affordance>` — client component.
  - Registers WebMCP tool on mount via `document.modelContext.registerTool(tool, { signal })`, fallback `navigator.modelContext`, feature-detected, abort on unmount. No-op if unsupported.
  - Tool `execute` calls the server action (same reference the UI uses), returns structured result.
  - Adds `data-afford-action` attribute for DOM-based agents.
- `useAffordance(action, opts)` hook variant.
- `<AffordProvider manifest={…}>` supplies client-side metadata (name, description, JSON Schema) keyed by action name.
- Dev overlay (later): toggle that outlines affordances on the page with name + availability. The design-engineering showcase.

Tests: registration/unregistration with mocked `modelContext`, strict-mode double mount, SSR safe.

---

## 5. `@afford/next`

**Conventions (per route segment)**

```
app/products/[slug]/
  page.tsx
  actions.ts     // 'use server'; exports defineAction(...)
  state.ts       // export default defineState(...)
```

**Pieces**

- `withAfford(nextConfig)` — wires codegen into `next dev` / `next build`, adds headers.
- **Codegen** (`afford build`, also run by `withAfford`): parse `app/**/actions.ts` + `state.ts` with `oxc-parser` (static), emit `.afford/manifest.ts`:
  - route pattern → state loader import + action imports
  - action name → module + export, JSON Schema, expose, effects, description
  - client manifest (`.afford/client.ts`) — metadata only, no server imports
  - `.well-known` index data
  - Fail build on duplicate names per route or non-static `name`.
- **Route handler**: `npx @afford/next init` creates `app/api/afford/[...path]/route.ts`:
  ```ts
  export { GET, POST } from "@afford/next/route";
  ```
  (`_`-prefixed folders are private in App Router — don't use them.)
- **Proxy**: `afford()` helper for Next 16 `proxy.ts` — if `Accept`/`Content-Type` is `application/vnd.afford+json`, rewrite to `/api/afford/<path>`. Composable with user's existing proxy.
- `/.well-known/afford.json` served from same handler.
- Caching: graph responses `Cache-Control: private, no-store`, `Vary: Accept`. HTML untouched.
- Session: read `cookies()` inside handler; auth adapter hook for Auth.js / Better Auth / Clerk (docs examples).

Tests: codegen snapshot tests, handler integration against a fixture app, proxy rewrite tests, e2e via example.

---

## 6. `@afford/mcp`

- CLI: `npx @afford/mcp https://site.com` → stdio MCP server.
- Reads `/.well-known/afford.json`, exposes generic tools: `afford_open(url)` (returns graph), `afford_call(url, action, input)`. Optionally flattens current page's actions into dynamic tools.
- Auth: bearer token flag; never handles passwords.

---

## 7. `@afford/lint`

- ESLint-API rule `afford/require-affordance`: `<form action={x}>` or `onClick`/`formAction` calling an imported server action not wrapped in `<Affordance>` → warn. Opt-out comment.
- Rule `afford/static-action-name`.
- Ship as ESLint plugin; test it under oxlint's JS plugin support if available.

---

## 8. Apps

**example** — generic store: product list, product page (variants, stock), cart, checkout with `confirm` action, account orders. In-memory or SQLite seed. Every interactive element wrapped. Deployable as a Vercel template.

**bench** — script that runs the same 5 tasks (find + add to cart, change qty, checkout w/ confirm, search, check order) with:

1. screenshot/DOM browser agent
2. Afford headless agent (AI SDK, tool = `afford_open`/`afford_call`)
   Records steps, tokens, wall time, success rate over N runs → JSON + chart page in docs. Same model for both.

**docs** — Next.js site, `.md` routes + `llms.txt`, and itself Afford-enabled (search docs, copy snippet, etc.). Pages: Why, Quickstart, Concepts (actions, state, expose, deltas), Protocol spec, Next guide, React, MCP, Security, Bench results.

---

## 9. Security (non-negotiable)

- Default `expose` omitted → not exposed. Build warns.
- Headless calls never rely on server-action Origin check; handler enforces its own auth + CSRF (reject cookie-auth POST without matching `Origin` or bearer token).
- `confirm` actions require explicit `confirm: true`; example renders a human confirm card when WebMCP agent triggers one.
- Rate-limit hook per action; BotID / verified-agent hook documented, not required.
- No PII in URLs; graph never includes data the page wouldn't show the same user.
- Input validated before guard; guard before run.

---

## 10. Milestones

| #   | Scope                                            | Done when                                                        |
| --- | ------------------------------------------------ | ---------------------------------------------------------------- |
| M0  | Repo scaffold, tooling, CI, empty packages build | CI green, `vlt install` clean                                    |
| M1  | `protocol` spec + types + schemas                | fixtures validate, spec.md reviewed                              |
| M2  | `core` defineAction/defineState/handler          | unit tests cover expose matrix + deltas                          |
| M3  | `next` codegen + route + proxy + init            | fixture app: GET graph, POST action, delta, via curl             |
| M4  | `example` store wired end-to-end                 | Playwright: human flow + headless flow both pass                 |
| M5  | `react` Affordance + WebMCP                      | tools listed in Chrome w/ WebMCP testing flag; mocked tests pass |
| M6  | `bench` + numbers                                | reproducible run, results JSON committed                         |
| M7  | `docs` site, dogfooded                           | deployed; quickstart works from scratch in <5 min                |
| M8  | `mcp` bridge                                     | Claude/Cursor complete checkout on example via MCP               |
| M9  | `lint` + dev overlay                             | rule tests; overlay demo                                         |
| M10 | Launch: README, template, 30s video              | 0.1.0 published                                                  |

---

## 11. Open questions

- `state.ts` separate vs collected from RSC render (`React.cache` per-request store). v0: separate.
- Multistep flows (checkout): one route with state machine in `state.ts` vs multiple routes. v0: one route.
- Pagination/large entities: cap graph at ~2k tokens; `entities` support cursors?
- Name collision with future Next.js built-in — keep protocol framework-agnostic so it survives.
