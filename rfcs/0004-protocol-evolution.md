# RFC 0004: Protocol evolution

**Status:** accepted (2026-11-18); amended 2026-11-18: §5 (WebMCP's confirmation fails closed, generic is its default, the per-capability option as built, a fixed list, with following the view not built, and the page's start); §4 (an MCP server over any adapter, protocol 1 over fetch in the runtime's agent core, and a connection's start is the host's). **Builds on:** RFC 0001 (the IR), RFC 0002 (contextual projection), RFC 0003 (the benchmark's tools), RFC 0005 (Next.js compilation). **Settles:** the wire format RFC 0002 §10 and RFC 0005 §5 left open.

## Summary

v0's wire stays as it is: `Graph`, `Call`, `Delta` and `SiteIndex`, `v: '0'`, additive only. Capabilities and projections get a second protocol version, `1`, served beside v0, never replacing it.

- **What `1` serves:** views, expansions, inspections, checks and executions, over HTTP; the portable manifest as a public document; and two agent transports (MCP and WebMCP).
- **What it never sends:** a projection. Every transport sends views only (RFC 0002 §11).
- **What every transport keeps:** an offer is never authorization, what's approved is what runs, and an annotation never skips a confirmation.

## Motivation

Three RFCs left their wire to this one:

- **RFC 0002** specified projection and execution, but not how a view crosses a network. Its §10 left two MCP exports open: one tool per capability, or four generic tools.
- **RFC 0003** defined a four-tool surface for the benchmark only, for this RFC to adopt or supersede (§5.1).
- **RFC 0005** stated the minimum a Next.js route needs, and deferred its URLs and shapes here (§5).

Meanwhile a reference implementation exists: hosting-lab serves views, expansions, inspections and executions (`apps/hosting-lab/src/lib/serve.ts`). Reviews of it fixed its credential, Origin and caching rules. This RFC makes that surface the protocol, generalizes it, and maps it to MCP and WebMCP.

## Goals

- **G1. v0 keeps working unchanged.** Every compatibility constraint in the repo audit (§6) holds: v0's wire documents, authoring API, identity, `effects`, check order, error codes and `@affordances/md`.
- **G2. One protocol for capabilities,** whatever the transport: HTTP, MCP or WebMCP. Each carries the same views and results, and the same rules.
- **G3. Views only on the wire,** and every execution re-checked (RFC 0001 rule 1; RFC 0002 §8.1).
- **G4. What's approved is what runs,** on every transport: the approval token binds the effective input and the rendered summary, charges included (RFC 0002 §8.2).
- **G5. Measured, not assumed:** what each export loses is measured (§6).

## Non-goals

- **Changing v0.** No v0 field, code or behavior changes here.
- **Distribution:** signing manifests and proving namespaces (RFC 0001 §16, questions 4 and 5) are left to a later RFC.
- **Events and push** (RFC 0001's `event` kind) on the wire. They're listed and not served.

## 1. v0: what stays, what changes, what goes

| v0 concept                                                                                        | In version 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The media type `application/vnd.affordances+json`                                                 | **stays.** Version 1 uses it with a parameter, `version=1`. A request whose `Accept` doesn't name `version=1` gets v0, and only v0, so a v0 client never receives a version-1 document unasked (spec.md:9). Version 1 lives at its own `{base}` URLs, so this matters only if a page URL ever negotiates                                                                                                                                                                       |
| `Graph` (a page's actions)                                                                        | **stays** for v0. Version 1's counterpart is a view: offers, not actions, under a policy                                                                                                                                                                                                                                                                                                                                                                                       |
| `Call` (`{ action, input?, confirm? }`)                                                           | **stays** for v0. Version 1's is an execution: an offer id, input, and an approval token in place of `confirm`                                                                                                                                                                                                                                                                                                                                                                 |
| `Delta`                                                                                           | **stays** for v0. Version 1 returns an `ExecutionResult`, whose `changes` is the caller's view before and after (RFC 0002 §8.3)                                                                                                                                                                                                                                                                                                                                                |
| `SiteIndex` (`/.well-known/affordances.json`)                                                     | **stays, and gains one additive field,** `capabilities: { manifest, base }`, naming version 1's manifest and endpoints. v0 clients ignore it (spec.md:161)                                                                                                                                                                                                                                                                                                                     |
| `expose`                                                                                          | **stays** for v0. Version 1 states authorization and confirmation per capability instead                                                                                                                                                                                                                                                                                                                                                                                       |
| `confirm: true`                                                                                   | **stays** for v0. Version 1 confirms with RFC 0002's single-use approval token. v0's flag is never accepted as an approval (RFC 0001 §12.1)                                                                                                                                                                                                                                                                                                                                    |
| The error codes (spec.md:124-132)                                                                 | **stay,** for v0: v0's responses keep v0's statuses. Version 1 **shares** 404 (`not_found`), 422 (`invalid_input`), 409 (v0's `confirm_required` and `unavailable`, as version 1's `confirmation_required`, `precondition` and `stale`), 429 (`rate_limited`) and 500. It **refines** one: `unauthorized` is 401 when the principal isn't authenticated and 403 when it is (v0 has 401 for both). It **adds** one: 400 for a malformed body, refused before the runtime (§2.3) |
| The v0 MCP tools `affordances_open` and `affordances_call`, and v0's WebMCP tools named by action | **stay,** for v0                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**Nothing goes.** Retiring any v0 concept is a later major version's decision, once version 1 has users.

## 2. HTTP

### 2.1 Discovery

- **The index:** `SiteIndex` gains `capabilities: { manifest: string; base: string }`. Both are URLs: the manifest, and the base for the endpoints below.
- **The manifest:** `GET {manifest}` returns RFC 0005's `manifest.json`, the canonical IR (RFC 0001), with `ETag` set to its digest. It's public and cacheable, and it holds no principal's data.

### 2.2 Endpoints

Every request takes the caller's view request: `start`, `policy`, `task`, `seen` and `offers` (the budget). As RFC 0002 §8.3 requires, the server rebuilds the same view for every call, so an expansion and an execution's `changes` are the caller's own.

| Endpoint              | Request                                                      | Response                                                                                                          |
| --------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `GET {base}/view`     | the view request, as query parameters                        | a `View` (RFC 0002 §6.2)                                                                                          |
| `POST {base}/expand`  | `{ from, along, budget?, ...view request }`                  | a `View` (RFC 0002 §6.5). A `more` cursor resolves on any projection of the same revision                         |
| `GET {base}/inspect`  | `?offer=`, with the view request                             | `OfferDetails` (RFC 0002 §11), or a 404 for an offer the caller can't see, the same as for one that doesn't exist |
| `POST {base}/check`   | `{ offer, input?, ...view request }`                         | a `CheckResult` (RFC 0002 §8.1, steps 1-7). It never issues or accepts a token                                    |
| `POST {base}/execute` | `{ offer, input?, approval?, ifRevision?, ...view request }` | an `ExecutionResult` (RFC 0002 §8.3)                                                                              |

```ts
// version 1's request and response bodies are RFC 0002's types; only these are new
type ViewRequest = {
  start?: string
  policy?: PolicyId
  task?: string
  seen?: Revision
  offers?: number
}
type ExpandRequest = ViewRequest & {
  from: OfferId | ChoiceSetId | ResourceRef
  along: Expansion['along']
  budget?: Budget
}
type ExecuteRequest = ViewRequest & {
  offer: OfferId
  input?: unknown
  approval?: ApprovalToken
  ifRevision?: OfferRevision
}
```

### 2.3 The rules every endpoint keeps

- **Views only.** No endpoint sends a projection; `toJSON` on one throws (RFC 0002 §11).
- **One credential parser.** A request authenticates by `Authorization: Bearer <one token>`, or by the session cookie, never both. A bearer header that names no single token authenticates nothing, so the cookie does, and the cookie's rules apply. The principal is resolved by the application, from the credential, and the credential is never an identity: never a principal's id, an attribute or a key (M3's code review, findings 1 and 2).
- **Origin for cookies.** A POST the cookie authenticates must carry an `Origin` that matches the site (spec.md:154). Otherwise it's refused before the runtime with 403, whatever the principal, and the body is a refusal with code `unauthorized` and a detail naming the missing or mismatched Origin. A bearer call is exempt.
- **No session from a read.** An agent-facing request with no credential is an anonymous principal. It's never given a session, and reading never creates state (M3's code review, findings 3 and 4).
- **Caching.** Every response to a credentialed request, and every view, sends `Cache-Control: private, no-store` and `Vary: Authorization, Cookie`. Only the manifest is publicly cacheable.
- **Statuses,** with HTTP's own meanings. Both `unauthorized` cases follow RFC 0001's authorization requirement against `principal.authenticated`. v0's responses keep v0's own mapping (spec.md:124-132), with its 401, since v0's wire stays additive (repo audit §6). The planner's ruling, 2026-11-18, confirmed by backend's review:
  - **The server picks the status.** The runtime has one `unauthorized` code for every authorization refusal, so the server chooses from the principal it resolved: 401 if `principal.authenticated` is false, otherwise 403. That needs no runtime change.
  - **The challenge:** RFC 9110 requires one on every 401, so it's `WWW-Authenticate: Bearer`, since a bearer token is the agent's credential.
  - **One edge, as HTTP practice has it:** an anonymous caller refused by a condition that signing in wouldn't satisfy still gets 401 first, then 403 once authenticated.

  | Code                                                                                    | Status                               |
  | --------------------------------------------------------------------------------------- | ------------------------------------ |
  | `not_found`                                                                             | 404                                  |
  | `unauthorized`, the principal isn't authenticated (no credential, or an invalid one)    | 401, with `WWW-Authenticate: Bearer` |
  | `unauthorized`, the principal is authenticated but lacks the capability's authorization | 403                                  |
  | `invalid_input` (the input fails its schema)                                            | 422, as v0                           |
  | a malformed body (not JSON, not an object, no offer id), refused before the runtime     | 400                                  |
  | `precondition`, `stale`, `confirmation_required`                                        | 409                                  |
  | `rate_limited`                                                                          | 429, with `Retry-After`              |
  | a handler failure                                                                       | 500                                  |

  A refusal's body is the runtime's, in full: its code, condition, detail, issues and, for a confirmation, its summary and token.

**Alternatives considered:**

| Alternative                               | Rejected because                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Extend v0's `Call` with offers and tokens | v0's identity is (route, name), and its delta reports state keys. Carrying offers through it would change what v0's fields mean, against G1 |
| One endpoint, dispatching on a body field | Caching, logging and per-method rules (Origin on POST) all work better per endpoint                                                         |
| GraphQL                                   | It's a new dependency and a query language, for five fixed shapes                                                                           |

## 3. The tool surface: RFC 0003's four, adopted

**Decision:** version 1's generic tools are RFC 0003's, adopted as they are: `project`, `expand`, `inspect` and `execute`, with the same inputs and outputs.

- **The names:** RFC 0002 §10 called the first `discover`. It's `project`, as the benchmark measured it, so results transfer.
- **`check`** isn't a tool. An agent learns availability from views, and refusals from `execute`, so it needs no preflight. `check` stays an HTTP endpoint, for bindings such as v0's (RFC 0001 §12.1).
- **Rendering:** results are RFC 8785-ordered JSON, as in the benchmark (RFC 0003 §5.1).

## 4. MCP

**Decision: the generic mode by default, and a per-capability mode only for capabilities everyone can see.**

- **The generic mode:** an MCP server exposes the four tools of §3, the same for every connection. MCP forbids tool sets that vary per connection (prior art §6.4), and a projection varies per principal, so this is the only mode that carries a projection faithfully. The view, not the tool list, carries what this caller can do.
- **The per-capability mode:** one tool per capability, named by its id. MCP's rule for tool names is a SHOULD of 1-128 characters of `[A-Za-z0-9_.-]` (prior art §4.1). An RFC 0001 id is a subset of that, capped at 128, so it carries over unchanged.
  - **Only capabilities whose authorization is `any`** are exported this way, since their availability doesn't depend on who's asking. The rest stay behind the generic tools.
  - **Annotations** follow prior art §6.5. `readOnlyHint` comes from `safe`, and `idempotentHint` from `idempotent`. `destructiveHint` comes from an irreversible effect, and an open-world hint from an `external` effect.
- **What's lost, by mode** (assumption 9, measured in §6):
  - **The per-capability mode** loses everything contextual: availability, conditions, claims, relations, choice sets, revisions, and per-principal scope. It loses reversibility beyond MCP's four booleans, and a financial effect's amount outside the confirmation summary.
  - **The generic mode** loses only MCP's own per-tool annotations. It carries everything else in views.
- **Confirmation goes to the person, not the model.** When `execute` is refused with `confirmation_required`, the MCP server asks the person itself, through MCP's elicitation (`elicitation/create`): it shows the rendered summary, charges included, and asks for an answer. On an accept, the server runs the same call with the token. The model never holds the token, so it can't approve on the person's behalf. A client that doesn't support elicitation gets the refusal and the summary, but no token. Only the person's own client can approve, and the client must not resend on its own. An MCP annotation never stands in for any of this (§7).
- **A connection's start is the host's:** the server can be given one, as the user's own project, and a `project` that names none starts there. Without one, a view is site-wide. It's a view parameter only and grants nothing: the resolvers still load only what the caller may read, and every call is authorized as the caller's (intake, 2026-11-18). Why: a site-wide view binds no resource, so an offer that needs one reads `unknown` until the agent thinks to name it, which the benchmark's own tools never ask of it.
- **Where the tools reach the runtime:** in process by default, or over any adapter the server is given, such as protocol 1 over HTTP to the app's own server (`httpAdapter`, shared with WebMCP, §5). The tools, the boundary and the confirmation through elicitation are the same either way.
- **The per-capability mode's descriptions carry the charges.** A tool's annotations can't state a price, so a capability with a financial effect gets its confirmation summary's charges clause appended to its tool description. A client reading only the tool list then still sees what it charges.

## 5. WebMCP

**Decision: generic tools by default, as on MCP (§4). One tool per capability is an option: it's named by the capability id, for the capabilities everyone can see, as on MCP** (amended, intake, 2026-11-18; the per-capability details below apply to that option). Registering and unregistering those tools as the page's view changes isn't built (M7e).

- **The name:** WebMCP's rule is normative. `registerTool()` rejects a name that isn't 1-128 characters of `[A-Za-z0-9_.-]` (prior art §4.2). A capability id always passes, and an id that wouldn't is already invalid in the IR. So a capability's WebMCP tool name is its id, unchanged.
- **One tool per capability, not per offer:** when a view has several offers of one capability (the plans of a choice set), it registers one tool, and the target goes in its input, as `targetAt` names it (RFC 0001 §2.2).
- **Registration, as built:** the option registers a fixed list from the public manifest, one tool for each capability whose authorization is `any`, through the same shared core as MCP's per-capability mode (§4). Following the view isn't built: registering a capability's tool when one of its offers appears, and unregistering it when they're all removed (`rfcs/research/0004-fidelity.md`).
- **The start, from the page** (intake, 2026-11-18): the host can give the connection a start, the resource the page is about, which `project` uses when the agent names none. With none configured, the first view is site-wide, as before. The reason: without it, the first view can't say what the page's own resource allows, so its offers read `unknown` until the agent finds it. A start is a view parameter only, and grants nothing: every offer and every call is still checked against the session's principal.
- **Beside v0's tools:** v0's WebMCP tools are bare action names (repo audit §6). Version-1 names are dotted ids, so the two can't collide, and a page can serve both.
- **Confirmation fails closed** (amended, intake, 2026-11-18). The rule is unchanged: an agent's own resend is never consent, and no tool returns a token to the agent. What changed is the mechanism, since Chromium's WebMCP has no browser-mediated consent (`rfcs/research/0004-webmcp/SPIKE.md`).
  - **A call that needs confirmation:** when `execute` is refused with `confirmation_required`, the tool returns only the refusal, through the same boundary every tool result passes (`toModel`), with no token and no way to approve. The person confirms in the app's own review-and-confirm step.
  - **In-tool consent, only where the browser offers it:** when the tool's execution gets a client with `requestUserInteraction` (WebMCP's request for user interaction), the tool asks the person for consent to the rendered summary, charges included, through it, and only then resends with `approval`. That's feature-detected, and no current build has it.
  - **The guarantee, exactly:** no tool channel ever yields an approval.
  - **The limit, plainly:** an agent that also drives the page's DOM can click the app's own Confirm, as on any web app, and the protocol can't prevent that. The guarantee is about the tool channel, not about the page.
- **The default mode is generic,** the four tools over the page's projection, with one tool per capability as an option. By M7d's criterion (`rfcs/research/0004-webmcp/CRITERION.md`), per-capability isn't lossless: a capability that requires confirmation isn't reachable as a tool without in-tool consent. M7f's pilot uses generic.

## 6. Measuring what each export loses

**The assumption:** export to MCP and WebMCP loses nothing an agent uses in practice, or what it loses can be measured (prior art §6.7).

**The measurement (M7c and M7d):** the same tasks, the benchmark's T6 among them, run on four surfaces:

- version 1 over HTTP, through the benchmark's harness;
- MCP's generic mode;
- MCP's per-capability mode;
- WebMCP.

Each reports the benchmark's metrics (RFC 0003 §6). A metric that moves between surfaces is the export's loss, named per field. That's RFC 0003 §12's six-surface comparison, with its own budget.

## 7. Safety, on every transport

- **An offer is never authorization.** Every execution, over any transport, goes through the runtime's `execute`, which re-checks everything (RFC 0002 §8.1). A view, a tool list or an annotation grants nothing.
- **What's approved is what runs.** The approval token is an HMAC over the offer, the effective input's digest (after schema defaults), the rendered summary (charges included), the subject, the offer revision, an expiry and a nonce (RFC 0002 §8.2). It's single use. A transport that alters any of those between approval and run gets a refusal, never a different run.
- **Who approves is the client's duty.** The token guarantees that what's approved is what runs, and that it runs once. It can't guarantee that a person approved, since it returns to the caller that asked for it. That a person approved is the client's duty on each transport: MCP's elicitation (§4), the browser's user interaction on WebMCP (§5), and the human-facing client over HTTP (spec.md:155). It's not the runtime's.
- **Annotations never skip confirmation.** `readOnlyHint`, `destructiveHint` and any other hint are derived from the manifest, and are advice. A capability that requires confirmation requires a token on every transport, whatever its annotations or claims say.
- **v0's confirm is v0's.** A v0 `confirm: true` reaches the runtime only as `{ basis: 'v0-client-flag' }`, and is never an approval (RFC 0001 §12.1).

## 8. v0 interop: the adapter's two directions (M7b)

- **v0 to the IR:** RFC 0001 §10.1's table, as RFC 0005 §2.1 extracts it: ids, inputs, kind, authorization, confirmation and guards, each `imported` or `inferred`.
- **The IR to v0:** RFC 0001 §10.3. A capability with an `affordances/v0` binding is served by v0 as today, with `expose` from its authorization and confirmation, `readOnly` from its kind, and `guard` from its preconditions.
- **Identity, losslessly:** a capability's `affordances/v0` binding names `{ route, action }`, so the adapter recovers v0's identity (route pattern, name) exactly, as the repo audit (§6) requires.
- **What v0 can't carry** stays version 1's alone (RFC 0001 §10.2): resource types, declarative conditions, effect categories and reversibility, derived edges, choice sets, attributed claims, provenance, and a canonical artifact.

## 9. Compatibility

Each of the repo audit's constraints (§6), and how it holds:

| Constraint                                                              | How it holds                                                                                                                                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0's wire documents validate, with `v: '0'`, and change only additively | v0's documents are untouched. `SiteIndex` gains one optional field                                                                                                                              |
| v0's authoring API and files keep working                               | version 1 adds endpoints and tools. It changes no v0 API or file                                                                                                                                |
| v0's identity, (route, name), is recoverable                            | through the `affordances/v0` binding (§8)                                                                                                                                                       |
| `effects` keeps its v0 meaning                                          | version 1's consequences are the IR's `effects`, a different field in a different document                                                                                                      |
| v0's check order and error codes stay                                   | v0's are untouched, and v0's responses keep v0's statuses. Version 1 runs RFC 0002's checks, which keep v0's order inside them (authorization, then input, then preconditions), with §2.3's map |
| `@affordances/md` needs no IR                                           | nothing here touches it                                                                                                                                                                         |

## 10. Open questions

1. **The per-capability MCP mode for authenticated capabilities.** It could be served per authorization class, one tool set per kind of principal, but MCP's fixed tool sets make that a server per class. Left until §6's measurement shows whether it's needed.
2. **Events.** RFC 0001's `event` kind has no wire here. Server-sent events, or MCP notifications, are a later RFC's.
3. **Namespace proof and signing** (RFC 0001 §16, questions 4 and 5) are distribution decisions, for a later RFC.

## References

- RFC 0001: §2.2, §10, §12.1 and §16.
- RFC 0002: §6, §8.1-§8.3, §10 and §11.
- RFC 0003: §5.1, §6 and §12.
- RFC 0005: §5.
- `packages/protocol/spec.md`, v0's wire.
- `rfcs/research/repo-audit.md` §6, the compatibility constraints.
- `rfcs/research/prior-art.md` §4.1, §4.2, §6.4, §6.5 and §6.7.
- `apps/hosting-lab/src/lib/serve.ts`, the reference implementation.
