# The runtime

The engine that serves a manifest to one principal at a time: it loads the manifest with the app's resolvers and
handlers, evaluates conditions, projects views of offers, and executes calls through a fixed sequence of checks. The
specification is [RFC 0002 §2, §8 and §11](../0002-contextual-projection.md#8-execution), as amended. The package is
`@affordances/runtime` (private, 0.0.0, unpublished). Its only workspace dependency is `@affordances/ir`.

What an offer discloses and why (views, choice sets, the comparison and the disclosure invariant) is
[projection.md](./projection.md). The transports that export the runtime are [mcp.md](./mcp.md) and
[webmcp.md](./webmcp.md), over the HTTP route in [next.md](./next.md#the-routes).

## Where it lives

| Concern                                        | Code (`packages/runtime/src/`)         | Tests (`packages/runtime/test/`)        |
| ---------------------------------------------- | -------------------------------------- | --------------------------------------- |
| startup and the session                        | `project.ts`, `facts.ts`, `session.ts` | `project.test.ts`                       |
| conditions                                     | `decide.ts`                            | `project.test.ts`, `execute.test.ts`    |
| execution, confirmation and the approval token | `execute.ts`                           | `execute.test.ts`                       |
| resolver output                                | `data.ts`                              | `project.test.ts`                       |
| the conformance kits                           | `conformance.ts`                       | `conformance.test.ts`                   |
| HTTP statuses                                  | `http.ts` (`statusOf`)                 | `http.test.ts`                          |
| the agent tools' core and adapters             | `agent.ts`, `agent-runtime.ts`         | `agent.test.ts`, `http-adapter.test.ts` |

## Exports

- **`.`:** `createRuntime`, `offerId` and `parseOfferId`, `builtInPolicies`, `checkOrderBasis`, `claimFree`,
  `statusOf`, `HandlerRefusal`, `keptColumns`, `conformance` and `resolverConformance`, and every type.
- **`./agent`:** the shared tool core ([mcp.md](./mcp.md#the-shared-tool-core)): `createToolset`, `toModel`,
  `TOKEN`, `GENERIC_TOOLS`, `capabilityTool`, `exportable` and `httpAdapter`. It imports only ir and types, so it runs in a
  browser.
- **`./agent-runtime`:** `createRuntimeAdapter`, the same tools over an in-process runtime, for a server.

Several are marked `@experimental`, among them `statusOf`, `HandlerRefusal`, `keptColumns`, the conformance kits
and the agent modules. The package as a whole is unpublished.

## Startup

The specification is [§11](../0002-contextual-projection.md#11-the-package-affordancesruntime-m3).

`createRuntime` refuses to start, by throwing, when the manifest doesn't validate, a declared resource type has no
resolver, a guard has no implementation, a query or action has no handler, two policies share an id, the default policy
doesn't exist, or any capability requires confirmation without `approvalKeys` and `seenTokens`. What depends only on the
manifest is computed once: edges, alternatives, claims, each type's declared attributes, effects in canonical order, and
the digest.

## Principals and resolvers

The specification is [§2.1](../0002-contextual-projection.md#21-resolvers).

- **The principal** is the app's to resolve: each request carries `authenticated`, an optional `subject` and
  `attributes`. A session keeps only the declared principal attributes, and its digest leaves out `subject`, which is
  used only to bind approval tokens.
- **A resolver** loads an instance by key for a principal, returning its `attributes` and an optional `version`, or
  `null` for anything the principal can't read. It can also `list` the keys a capability may target. It leaves out an
  attribute it can't read (missing), and uses `null` for a known no-value (absent). Its `version` changes whenever any
  attribute does.
- **What the runtime enforces of that:** one resolver per declared type; a throw becomes a failed load, read as unknown;
  attributes that aren't plain data, or don't fit the type's declared schema, are a failed load too (`data.ts`, since
  87667f5b; RFC 0002 §6.6 says the same since bf21c76a); a version that isn't a string is ignored; a throwing `list`
  yields only the start; and an attribute the type doesn't declare is never observed or compared.
- **What it doesn't enforce:** that a resolver hides what the principal can't read, which `resolverConformance` tests
  instead (the owner loads it; another principal and an anonymous one get `null`, and `list` leaves it out); that the
  `version` tracks the attributes; and whether a guard's message is safe to show, which is the app's.

## Conditions

`decideCondition` is the one decider for projection and execution. A declarative condition is ir's three-valued
`evaluate`. A guard returns `true` (not ruled out), `false`, or a string, which is `false` with that string as the
detail; a throw or any other value is unknown. At projection time a guard that needs input is unknown "for input", and
an execution-only guard isn't run. A missing value is unknown; an absent one is a value.

## Execution

The specification is [§8](../0002-contextual-projection.md#8-execution).

`execute` walks one fixed sequence, and stops at the first refusal. A refusal runs nothing and observes nothing.

1. **The offer id is parsed afresh,** since it grants nothing. An unknown capability, an event, a wrong target type, a
   missing `targetAt` key, an unknown reference or a target that loads as none is `not_found`.
2. **Authorization:** none declared, or authentication required and absent, is `unauthorized`. Its conditions get no
   input.
3. **Rate limiting** isn't built (below).
4. **Input:** the target and bound reference keys are filled or compared, a mismatch is `invalid_input`, the input is
   checked against its schema (`invalid_input`, with the issues), and defaults give the effective input.
5. **References** the input names are loaded; one that loads as none is `not_found`.
6. **Preconditions:** false or unknown is `precondition`, with the condition and its detail, or "couldn't be checked".
7. **Freshness:** an `ifRevision` that isn't the offer's revision now is `stale`.
8. **Confirmation:** without a valid token, `confirmation_required`, with the summary and a fresh token for this exact
   call. A valid one is claimed here, before the run, so it's spent whatever happens next.
9. **The handler runs** with the effective input, the principal, the target and the references. A throw is `failed`
   ("The action failed."), and so is output off its schema. One throw isn't: a `HandlerRefusal` (since a60bd872) is a
   `precondition` refusal with its message as the detail, at the offer's revision. It's for a call the app's own state
   no longer allows though every declared check passed, such as approving the bundle a project already has, and it's
   thrown before the handler changes anything.
10. **Observation:** a snapshot before and after, of the target type and each state effect's type, compared on declared
    attributes only, matched to the declared effects in canonical order, and the offers whose existence or availability
    changed in the caller's view.

`check` walks steps 1 to 8 without running anything, for v0's agent path. It strips any token and issues none, and
accepts only v0's own client confirmation.

### The result

The specification is [§8.3](../0002-contextual-projection.md#83-the-result).

- **`succeeded`:** the output, the handler's message, what was observed, anything undeclared, the revision, and the
  changes.
- **`refused`:** the code, the condition, the detail (cut at 280 characters, marked when cut), the input's issues, and
  for a confirmation its summary and token.
- **`failed`:** a message safe to show, with what was observed, since a run that fails can change things.

`statusOf` maps a result to RFC 0004 §2.3's HTTP statuses, in one place, so hosts can't drift: 404, 401 with a
challenge or 403, 422, 409, 429 with `Retry-After`, and 500 for a failure.

## The approval token

The specification is [§8.2](../0002-contextual-projection.md#82-confirmation-and-approval-tokens).

- **Its form:** the expiry, a 16-byte nonce and an HMAC-SHA-256, joined by `~`. It carries nothing about the caller.
- **What it binds:** the MAC is over the canonical call: the recomputed offer id with the references the input named,
  the digest of the effective input, the rendered summary with its charges, the principal's `subject`, the offer's
  revision, the expiry and the nonce.
- **How it's checked:** recomputed from the call being made, verified in constant time under the current key and then
  the previous one, unexpired, and its nonce claimed once in the shared store. Any failure gives a fresh token for this
  exact call. A caller with no `subject` can't be approved.
- **Defaults:** five minutes to expire. `createRuntimeAdapter`, like the HTTP route, fails closed without a key and a
  store, except under `NODE_ENV` development or test.
- **The model never holds one:** the agent tools strip every `approval` field and anything shaped like a token, and
  only the person's explicit accept spends one ([mcp.md](./mcp.md#the-shared-tool-core)).

## Kept columns

A choice set's comparison can't cut what a shown claim on its members cites, or what its capability's conditions and
effects read and its confirmation summary renders. `keptColumns(capability, shownClaims)` (since dd3a28ea) is that rule,
the one views apply, exported so the inspector marks the same columns ([projection.md](./projection.md)).

## Not built, and divergences

- **Not built, though specified:** rate limiting ([§8.1](../0002-contextual-projection.md#81-the-request), step 3), so
  `rate_limited` exists only in the types and in `statusOf`; a generated detail for a declarative condition, "count
  is 0" ([§8.3](../0002-contextual-projection.md#83-the-result)); and a quantified condition's detail naming the
  element that decided it ([§4.2](../0002-contextual-projection.md#42-availability)).
- **Open in RFC 0002 §13, and not built:** relevance beyond `basic`, event capabilities (events have no offers), and
  cross-manifest projection (references are local only).
- **Divergences:** §11 makes `approvalKeys` required, while the code needs it only when something requires
  confirmation. The token's string form, a nonce spent before the run, failed loads left out of observation,
  `establishes` checked on the target only, and the throwing-`list` fallback are as built here and not specified in
  the RFC.
