# The projection

What the runtime shows one principal of what an app can do, and why. A projection turns the manifest's definitions into
**offers**, groups the offers that are one choice into **choice sets**, and serves them in **views** under a named
**policy**, bound by one rule: a policy decides what is shown first, never what can be found. The specification is
[RFC 0002 §4 to §6](../0002-contextual-projection.md#4-offers), as amended. The package is `@affordances/runtime`
(private, 0.0.0).

The engine around it (loading, conditions, execution, the approval token and the resolver contract) is in
[runtime.md](./runtime.md). This page covers what an offer discloses.

## Where it lives

| Concern                                   | Code (`packages/runtime/src/`)          | Tests (`packages/runtime/test/`)      |
| ----------------------------------------- | --------------------------------------- | ------------------------------------- |
| offers, availability, claims, choice sets | `project.ts`, `decide.ts`               | `project.test.ts`, `exposure.test.ts` |
| offer ids                                 | `offer-id.ts`                           | `project.test.ts`                     |
| policies, views, expansion, cursors       | `views.ts`                              | `views.test.ts`, `disclosure.test.ts` |
| order bases                               | `order.ts`                              | `order.test.ts`                       |
| a choice set's comparison                 | `comparison.ts`, `views.ts` (`tableOf`) | `comparison.test.ts`                  |
| attribute values a resolver returns       | `data.ts` (`attributesFor`)             | `project.test.ts`                     |

## Offers (§4)

An offer is one capability on one resource instance, with its references bound where the projection knows them.

- **Its id is readable and canonical:** the capability, `@`, the target's type and key, then the bound references in
  canonical order, percent-encoded: `hosting.plan.subscribe@hosting.plan:p2`. It names the same opportunity across
  requests, and grants nothing: executing it re-checks everything ([runtime.md](./runtime.md)).
- **Availability has five values,** computed in a fixed order, stopping at the first that applies: authorization, then
  preconditions under Kleene `all`, then `available`. `unknown` never reads as `available`: a capability with no declared
  authorization is `unknown` because of `authorization`, and execution refuses it.
- **Requirements:** `authorization` (`met`, `unmet`, `unknown` or `none-declared`) and `confirmation`, the summary template
  with what's known filled in. Confirmation doesn't change availability.
- **`consequential` is derived, never declared:** as built (`project.ts`), an action is consequential when its effects
  are unknown, or any of them isn't a reversible state change. A query is never consequential.
- **Relevance has a level and its basis, never a number.** The one method built is `basic`: the start resource, relations,
  and words of the task. Without a task it's `undetermined`. It never reads claims.
- **Claims arrive with their source and basis,** listed on the offers they apply to. A claim never becomes a field of the
  offer, and there's no `recommended: true`.
- **What an offer doesn't carry:** an order or rank (the view's), a token (never), or the full definition (`inspect`
  returns it).

## Choice sets (§5)

A choice set is the offers of one capability over every instance of a resource type declared `alternatives: true`, for one
principal: hosting-lab's `hosting.plan.subscribe@hosting.plan`, over its three plans.

- **Members come from the resolver's `list`,** including members whose offer is `unavailable`.
- **A choice set is atomic in a view:** whole, or summarized with its member count and expanded whole.
- **A policy can order members, never drop them.**

## Policies and views (§6.1, §6.2)

The built-in policies (`views.ts`, `BUILT_IN`):

| Policy        | First view                                                             | Order                          | Claims  |
| ------------- | ---------------------------------------------------------------------- | ------------------------------ | ------- |
| `exhaustive`  | everything the principal may see                                       | canonical                      | shown   |
| `resource`    | the offers on the start resource, as a v0 page graph shows them        | canonical                      | shown   |
| `progressive` | the start's capabilities and one step of their neighbours (`depth: 1`) | relevance (`basic`)            | omitted |
| `advocated`   | as `progressive`                                                       | by the owner's recommendations | shown   |

- **A neighbourhood is reached through capabilities:** the capabilities of the offers on the start, then, for each step,
  their neighbours by the manifest's relations and the derived edges. Every offer of a reached capability is in scope.
- **A view says what it left out:** `omitted` counts every offer and choice set not shown, and the claims a
  claims-omitting policy stripped from the offers it does show. It lists the expansions that would show the rest.

## The disclosure invariant (§6.3)

For every view, under every policy, the runtime guarantees:

1. **Counts are exact:** nothing the principal may see is uncounted.
2. **Choice sets are atomic.**
3. **Alternatives are one step away:** every offer carries `alternatives.count`, and one expansion `along: 'alternatives'`
   returns every partner.
4. **Exhaustive enumeration is always allowed,** paginated by budget, never refused for discovery reasons.
5. **Unavailable is not omitted:** an unavailable offer in scope is in the view, with its reason.
6. **A choice set carries its comparison** (§6.6, below).

`disclosure.test.ts` checks them as a property, over 1,000 seeded generated cases, shrinking a failure to its smallest.

## Order and salience (§6.4)

- **A view's order states its basis:** `canonical`, `relevance` with its method, a claim kind (`byClaim`), or a group by a
  manifest-derived attribute. `order.ts` checks a basis, and the only group key built is `targetType`.
- **Claim-free bases:** `claimFree` tells a basis that names no claim, recommendation or source at any depth, which is
  what a structural rendering may state. A view ordered by the owner's recommendations states a `claim` basis instead.

## Expansion and inspection (§6.5)

- **Expansions,** from an offer, a set, or a resource (`contains`, and the first view's own `relations` entry, which
  can come from the start): `alternatives`, `members`, `relations` (the offers of the offer's
  capability's neighbours), `contains`, `enables`, `comparison` (a summarized set's members, whole) and `more` (the next
  page of a cut sequence).
- **A `more` cursor describes itself:** its origin and every cut since, under a projection revision, as base64url of its
  RFC 8785 text. The same view asked for twice has the same bytes. An agent's cursor is untrusted, and is checked whole.
- **`inspect`** returns an offer's definition: effects, the input schema and provenance.

## A choice set carries its comparison (§6.6)

Every view that shows a choice set carries its comparison: each member's declared attributes, as its resolver returned
them, side by side. It was added after M5's run met rules 1 to 5 and still hid the one attribute that decided the choice
(RFC 0002 §6.6, "The finding").

- **Columns:** every top-level property of the resource's `attributes` schema, except its key. Object and array values are
  one cell, compared whole by RFC 8785 bytes.
- **`differ`, `shared` and `unsupplied`:** attributes on which members differ, with a row per member; attributes every
  member has with the same value, stated once; and attributes a member's resolver left out, named.
- **The column order, and what's never cut** (`comparison.ts`, `keptColumns` and `columnsOf`): first what a shown claim on the set cites,
  then what the capability reads (its conditions, its effects, and the `{target.x}` paths of its confirmation summary),
  then the rest in declared order. A request's own `facts` budget cuts from the end, past those kept columns, and names
  each cut. A policy's budget never cuts a comparison.
- **Values are checked before they're used:** a resolver's attributes that aren't plain data fitting the declared schema
  are taken as none, so the load fails and the member reads as unknown, never a throw (`data.ts`, `attributesFor`). The
  RFC said the opposite until bf21c76a corrected it.
- **The limit, as built:** a view carries an offer's target only by reference, so a resource's attributes reach a view
  only through a choice set's comparison, and a comparison covers its members' own attributes. A deciding fact on a
  related resource that isn't an `alternatives` type is in no view at all: it's reachable only by running a capability
  whose output carries it. One that is has it in its own set's comparison, never in the deciding set's. Measured on
  hosting-lab with a region resource (`apps/hosting-lab/test/t8-fixture-depth.test.ts`); M8e's T8 plan
  (`apps/choice-bench/results/surfaces-t8/PLAN.md`) uses it, and it's open in the specification roadmap.

## Where the RFC and the code differ

- **The kept group's "input":** RFC 0002 §6.6 said the kept columns included what the capability's input reads. An IR
  input is a plain JSON Schema and can't read a target attribute, so the runtime never counted it, and 2ae07b3f
  corrected the RFC to match `keptColumns` (dd3a28ea).
- **The inspector's marks** re-implemented the kept-column rule and drifted from it. They now call `keptColumns`, so
  they can't drift again (78b2651f, [inspector.md](./inspector.md)).

## Related

- [The runtime](./runtime.md): projecting and executing, the resolver contract, revisions.
- [MCP and the v1 wire](./mcp.md): how views reach an agent over HTTP and MCP.
- [WebMCP](./webmcp.md): views in the person's browser.
