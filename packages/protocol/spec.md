# Afford protocol, version 0

Afford lets an agent read and operate a web page through the same URL a person uses, with the same session. A page answers in HTML for browsers and in JSON for agents. The JSON lists what the page shows (entities), what can be done there (actions), and where to go next (nav). Calling an action returns a delta: the parts of the page that changed.

This document is normative. The key words "must", "must not", "should", and "may" are used as in RFC 2119. The JSON Schemas in `schemas/` are generated from the same source as the TypeScript types and are authoritative for shapes.

## Media type

All Afford documents use `application/vnd.afford+json`. A server must not return an Afford document for a request that did not ask for one.

## Discovery

**Per page.** A client requests the page's own URL with `Accept: application/vnd.afford+json`. The server responds with a [graph](#graph) for that page, or `406` if the page has no Afford graph.

HTML responses for pages with a graph should advertise it in both places:

```http
Link: <?afford>; rel="afford"
```

```html
<link rel="afford" href="?afford" />
```

`?afford` is an alias for the `Accept` header, for clients that cannot set headers. A server that supports it must treat `GET <url>?afford` like `GET <url>` with the Afford `Accept` header.

**Per site.** `GET /.well-known/afford.json` returns a [site index](#site-index): the protocol version, the route patterns that have graphs and their action names, the supported auth modes, and optionally an MCP endpoint.

Responses that vary by `Accept` must send `Vary: Accept`. Graphs must send `Cache-Control: private, no-store`.

## Graph

```ts
type Graph = {
  v: '0'
  page: string // concrete path: /products/heavyweight-tee
  route: string // pattern: /products/[slug]
  entities: Record<string, unknown>
  actions: ActionDescriptor[]
  nav?: { to: string; label?: string; when?: string }[]
  md?: string
}
```

- `entities` is the page's state, keyed by name. It must not contain anything the page would not show the same user in HTML.
- `actions` lists every action on the route that the requester may know about. Actions the requester can't call right now are still listed, with `available: false` and a `reason`.
- `nav` lists links an agent can follow. `when` is a human-readable condition.
- `md` is an optional Markdown rendering of the page's content.
- A graph should stay small. About 2,000 tokens is a good ceiling, and large collections should be summarized in `entities`.

### Action descriptor

```ts
type ActionDescriptor = {
  name: string // unique per route, stable across releases
  description: string
  input: JSONSchema
  output?: JSONSchema
  expose: 'public' | 'session' | 'confirm'
  guard?: string // human-readable precondition
  available: boolean // the guard, evaluated for this request
  reason?: string // why available is false
  effects?: string[] // entity keys the action changes
  readOnly?: boolean
}
```

`expose` says who may call an action:

| `expose`  | Caller                                                                               |
| --------- | ------------------------------------------------------------------------------------ |
| `public`  | anyone                                                                               |
| `session` | an authenticated session, by cookie or bearer token                                  |
| `confirm` | a session, and the call must carry `confirm: true` after the user has seen a summary |

An action with no `expose` is not part of the protocol. It must not appear in graphs and must not be callable.

## Call

```http
POST <page-url>
Content-Type: application/vnd.afford+json

{ "action": "addToCart", "input": { "sku": "TEE-BLK-M" } }
```

```ts
type Call = { action: string; input?: unknown; confirm?: boolean }
```

The server processes a call in this order, and stops at the first failure:

1. Resolve the action by name on the page's route. Failure: `not_found`.
2. Check the CSRF rule below and `expose` against the caller. Failure: `unauthorized`.
3. Apply the rate limit. Failure: `rate_limited`.
4. Validate `input` against the action's input schema. Failure: `invalid_input`, with `issues`.
5. Evaluate the guard. Failure: `unavailable`, with the guard's reason as `message`.
6. For `confirm` actions without `confirm: true`: `confirm_required`, with a summary of what will happen as `message`. Nothing runs.
7. Run the action, reload the page's state, and respond with a delta.

## Delta

```ts
type Delta = {
  ok: boolean
  changed?: Record<string, unknown>
  output?: unknown
  actionsAdded?: ActionDescriptor[]
  actionsRemoved?: string[]
  redirect?: string
  message?: string
  error?: { code: ErrorCode; message: string; issues?: unknown }
}
```

- `changed` holds the new value of each entity in the action's `effects`. When an action declares no effects, `changed` holds every top-level entity whose value differs after the action ran.
- `output` is the action's return value, described by the descriptor's `output` schema when it has one.
- `actionsAdded` and `actionsRemoved` describe changes to the action list, including availability changes. An action whose `available` flipped appears in `actionsAdded` with its new descriptor.
- `redirect` is a path the person would have been sent to. The agent should request it next.
- `message` is a short sentence suitable to repeat to the user.

### Error codes

| Code               | HTTP | Meaning                                                 |
| ------------------ | ---- | ------------------------------------------------------- |
| `not_found`        | 404  | No such route or action                                 |
| `invalid_input`    | 422  | `input` failed the schema; `issues` says where          |
| `unauthorized`     | 401  | The caller may not call this action                     |
| `confirm_required` | 409  | Resend with `confirm: true` after showing `message`     |
| `unavailable`      | 409  | The guard failed; `message` says why                    |
| `rate_limited`     | 429  | Too many calls; the response should carry `Retry-After` |
| `internal`         | 500  | The action threw; `message` must not leak internals     |

## Site index

```ts
type SiteIndex = {
  v: '0'
  name?: string
  routes: { route: string; actions: string[] }[]
  auth: ('cookie' | 'bearer')[]
  mcp?: string
}
```

## Security

- Default deny. Only actions that declare `expose` are reachable.
- A call that authenticates by cookie must carry an `Origin` header that matches the site. A call with `Authorization: Bearer` is exempt. A server must not rely on its framework's server-action protections for Afford calls.
- `confirm` actions must not run without `confirm: true`. Clients acting for a person should show `message` and get approval first.
- Input is validated before the guard runs, and the guard runs before the action.
- URLs must not carry personal data. A graph must not include data that the HTML page would not show to the same user.

## Versioning

`v` is the protocol's major version. A breaking change ships as a new major version. Additive changes, such as new optional fields, may ship within a major version, and clients must ignore fields they don't recognize. Packages declare the range of majors they support.
