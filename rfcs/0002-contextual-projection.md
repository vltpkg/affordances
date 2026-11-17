# RFC 0002: Contextual projection

- **Status:** draft
- **Package:** `@affordances/runtime` (private until published)
- **Depends on:** [RFC 0001](./0001-semantic-capability-ir.md), [terminology](./research/terminology.md), [prior art](./research/prior-art.md), [dark patterns and web agents](./research/dark-patterns.md)

## Summary

A capability manifest (RFC 0001) says what an application can do. This RFC defines the runtime that turns a manifest, plus the context of one request, into what a caller can do **here and now**: a **projection** of capability offers, which an agent explores step by step and executes through the application's own code.

It fixes:

- what a projection request carries, and what the runtime gets from the application instead (§2);
- the principal's attributes that conditions read, which RFC 0001 left open (§3);
- how an offer is formed, and the five things it keeps apart: availability, discoverability, relevance, salience and publisher preference (§4);
- choice sets, built from RFC 0001's `alternatives: true` (§5);
- discovery policies, views and expansion, with the rule that progressive disclosure never hides an alternative (§6);
- the projection revision (§7);
- execution, its checks, and the shape of its result, including the `detail` of a refusal (§8);
- the runtime's safety rules and the conformance kit for RFC 0001's rule 5 (§9);
- the TypeScript sketch that `@affordances/runtime` implements (§11).

## Motivation

A manifest is context-free by design: it names no caller and no resource instance (RFC 0001, Goals). Agents act in a context. An agent working for one person, on one cart, needs to know which capabilities apply there, which it may use now, which it can't and why, and which alternatives exist. It shouldn't have to read every operation the application has.

Today's protocol answers part of this per page: a graph lists the route's actions with `available` and a `reason` (`packages/protocol/spec.md`, Graph). It doesn't answer the rest:

- **Availability and discoverability are one thing.** An action is either in the page's list or not. "Exists, but you can't use it now" and "exists, but isn't shown here" can't be told apart.
- **"Available" can't be told from "needs input".** The graph runs a guard with no input and treats `true` as available (`packages/core/src/handler.ts:110` at `8ef689f8`, `packages/core/src/action.ts:38`).
- **The order is the route's order.** Nothing says whether an order reflects relevance, a recommendation or nothing at all.
- **No revision.** A caller can't tell whether what it saw still holds, beyond the delta of its own last call.

The prior art agrees that progressive discovery is needed, and specifies none of it:

- MCP's client guidance recommends progressive discovery, catalog then inspect then execute, and leaves it to hosts. Every proposal to put tool search in the protocol was closed (prior art §4.1).
- AI SDK's tool search loads names first and schemas later (prior art §4.3).
- UI SDK truncates a snapshot at 100 entries with an explicit `more` entry (prior art §4.4).

Disclosure is also where choices can be steered. Research on web agents found that agents follow manipulated flows: obstruction patterns reached an overall susceptibility of 52.2% (single pattern, GPT-4o, six agents; dark patterns §4). A projection runtime decides what an agent sees first, so it must make that decision explicit, attributable and measurable, and it must never be able to hide a legitimate alternative.

## Goals

- **Contextual:** the same manifest, under different principals, resources, states and policies, gives different offers.
- **Deterministic:** the same inputs give the same projection, byte for byte, and the same revision (§7).
- **Progressive:** an agent starts from a bounded view and asks for more, at a known cost.
- **Complete when asked:** an agent can always enumerate every offer it's entitled to see, and every alternative of an offer it was shown.
- **Explicit about influence:** a view says what its order is based on, and publisher preference appears only as an attributed claim.
- **Safe by construction:**
  - an offer is never authorization;
  - nothing an agent says changes what is available;
  - nothing a publisher annotates skips a check.
- **Measurable:** policies are named data, so an experiment can vary disclosure with the manifest unchanged.
- **Additive:** today's protocol keeps working, and a v0 graph is one rendering of a view (§10).

## Non-goals

- **A planner.** The runtime answers what is possible and what relates to what. Choosing a sequence stays with the agent.
- **A transport.** Views and executions map onto HTTP, MCP or WebMCP (§10), but the wire formats are RFC 0004's subject.
- **Authentication.** The application resolves the principal. The runtime never decides who a caller is.
- **Ranking by a learned model.** Relevance policies are declared and explainable (§4.4). A score that can't say what it was computed from has no place (RFC 0001, rule 4).

## 1. The model at a glance

```text
Runtime          manifest + handlers + resolvers, created once by the application
 └─ project(request) → Projection    one principal, one context, one revision
      ├─ view()                       the bounded part returned now
      │    ├─ offers[]                CapabilityOffer: a capability on a resource, with
      │    │                          availability, conditions, requirements, claims
      │    ├─ choiceSets[]            offers that are mutually exclusive answers to one goal
      │    ├─ order                   what the order is based on
      │    └─ omitted                 what this view left out, by kind, with how to get it
      ├─ expand({ from, along })      more of the projection: alternatives, relations, members
      ├─ inspect(offer)               the full definition behind an offer
      └─ execute({ offer, input })    re-checks everything, runs the handler,
                                      returns the result, what changed, and a new revision
```

A **projection** is the contextual graph for one request. A **view** is the part of it one response carries (terminology §3.2). Projections are cheap to make and are not stored: a later request with the same inputs makes the same projection again (§7).

## 2. Context: the request and what the runtime gets elsewhere (question 1)

**The question:** how is context represented, and what belongs in a projection request versus runtime state?

**Decision:** context comes from two places, sorted by **who can vouch for it**.

- **The request** carries what the agent says about its situation: where it starts, its task, what it has already seen, and which policy and budget it wants. None of it is trusted, and **none of it can change availability**.
- **The application** supplies, through resolvers it registers, everything that decides availability: the principal, its attributes, and the state of each resource instance.

```ts
type ProjectionRequest = {
  principal: Principal // resolved by the application from the request's credentials, never sent by the agent
  start?: ResourceRef | Id // a resource instance, or a capability or resource type to start from
  task?: Task // what the agent says it's trying to do; only relevance reads it
  seen?: Revision // the revision of a view the agent already holds
  policy?: PolicyId // which declared discovery policy to use; the application's default otherwise
  budget?: Budget // how much one view may hold
}

type ResourceRef = { type: Id; key: string } // 'commerce.cart' + 'c_8f2'
type Task = { statement: string } // free text, as the agent was asked
type Budget = { offers?: number; depth?: number }
```

**What the request may influence, and what it may not:**

| Input    | May change                                                   | May never change                         |
| -------- | ------------------------------------------------------------ | ---------------------------------------- |
| `start`  | which offers are in the first view                           | any offer's availability                 |
| `task`   | relevance, and order under a policy that orders by relevance | availability, membership of a choice set |
| `seen`   | whether the response says the agent's view is stale          | anything else                            |
| `policy` | disclosure and order, within the rules of §6                 | which offers exist for this principal    |
| `budget` | how many offers one view holds                               | the counts in `omitted`                  |

**Why split by who can vouch.**

- **An agent's statement is not evidence.** A task statement can be wrong, or written by whoever injected text into the agent's context. If it could make an offer available, prompt injection would become privilege escalation.
- **It matches v0.** v0's handler resolves the session from the request's cookie or bearer token, and loads the page's state on the server (`packages/core/src/handler.ts`). The agent only names the page and the action.
- **It keeps experiments clean.** The choice benchmark varies the policy and holds the options fixed. Because a policy can't change availability, a change in what an agent chooses can't come from a change in what it was allowed to do.

**Alternatives considered:**

| Alternative                                                       | Rejected because                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One context object with everything, trusted or not                | Nothing would mark which inputs an agent controls. The rule "an agent can't change availability" couldn't be stated, let alone tested                                                                                    |
| The agent sends the state it believes the resource is in          | That's the agent asserting facts the application owns. Resource state comes from the application's resolvers                                                                                                             |
| Store each agent's exploration on the server (a session of views) | It makes projections stateful and hard to cache, and it ties discovery to a connection. MCP forbids tool sets that vary per connection for the same reason (prior art §4.1). `seen` gives freshness without server state |
| A structured task (goal type, constraints, budget in currency)    | Nobody has a vocabulary for user goals that holds across applications, and a wrong structure would look authoritative. Free text, read only by relevance, says exactly what it is                                        |

### 2.1 Resolvers

The application registers how the runtime learns what it needs:

- **The principal** isn't resolved by the runtime. The runtime is transport-free: every request carries a resolved `Principal`, and the binding or adapter that receives the HTTP request resolves it, as v0's `auth` does today.
- **`resources[type].load(key, principal)`** returns an instance's attributes, as declared in its `ResourceDefinition.attributes`, and optionally its `version` (§7).
  - **Not supplied against null:** a declared attribute the resolver leaves out (no key) is not supplied, which RFC 0001 §3.1 evaluates as `missing`, so `unknown`. A key present with `null` is `absent`. The same holds for `Principal.attributes`. A resolver that can't read an attribute leaves it out; one that knows there's no value says `null`. Inside a value supplied whole (an attribute's own attributes, array elements, the input), an omitted key is `absent` (RFC 0001 §3.1). It returns `null` when the instance doesn't exist **or the principal may not see it**. The runtime can't tell those apart, and doesn't need to.
- **`resources[type].list(principal, scope)`** enumerates instances for a choice set or a containment: every plan, or a cart's items (§5).

A resolver that throws makes the attributes it would have supplied `unknown`, never a guess. Conditions that read them evaluate to `unknown` (RFC 0001 §3.1), and the offer says so (§4.2).

## 3. Principal attributes (RFC 0001, open question 1)

**Decision:** a manifest declares the principal's attributes as it declares a resource's, in `CapabilityManifest.principal` (RFC 0001 §2.3, "Principal"). Conditions read them as `principal.<attribute>`, and `validate` checks those paths (`E_PATH`). With no `principal` declared, any `principal.*` path is an error. This section covers the runtime's side.

```ts
type Principal = {
  authenticated: boolean // read only by `authorization.principal: 'authenticated'`
  subject?: string // a stable, opaque identity for this caller, from the application; never echoed
  attributes: Record<string, unknown> // values for the declared attributes; anything else is ignored
}
```

- **`authenticated` is built in, and isn't a path.** Conditions don't read `principal.authenticated`. `authorization.principal` is the one place that does, so "must be signed in" has one spelling.
- **`subject` identifies the caller, and is used only for approval tokens (§8.2).** It isn't an attribute, conditions can't read it, it never appears in a projection, and it isn't part of a revision. Two callers with the same attributes share revisions, because they see the same thing. They never share an approval.
- **Every other attribute is declared.** A condition can't read an undeclared attribute, so a typo can't become a condition that's silently always `unknown`.
- **Attributes describe the caller, not their permissions on one resource.** "A member of this organization" is a condition that compares the two: `{ in: [{ path: 'target.orgId' }, { path: 'principal.orgIds' }] }`. RFC 0001 §3.1's vocabulary already expresses it.
- **The application supplies the values** with each request (§2.1). The manifest declares the shape, never values, so it stays context-independent (RFC 0001, Goals).
- **Privacy:** a projection or an execution result never echoes principal attribute values back. An offer that's unavailable because of one says which condition failed, by its `id` and `description`, not the value (§8.3).

**Alternatives considered:**

| Alternative                                                | Rejected because                                                                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Declare principal attributes in runtime configuration only | `validate` couldn't check `principal.*` paths without running the application, and a manifest read by a tool would have conditions it can't interpret |
| A fixed set: id, roles, scopes                             | Applications model callers differently: plans, organizations, regions, verified age. A fixed set would be wrong for most, and stretched for the rest  |
| OAuth scopes as the attribute model                        | Scopes are one application's grant vocabulary on the wire. They can be one declared attribute (`principal.scopes`), not the model                     |

## 4. Offers

### 4.1 What an offer is

A capability offer is one capability on one resource instance, with its references bound when the projection knows them (terminology §3.3).

```ts
type CapabilityOffer = {
  id: OfferId // 'commerce.cart.addItem@commerce.cart:c_8f2?product=heavyweight-tee'
  capability: Id
  target?: ResourceRef // absent for a global capability
  with?: Record<string, string> // references already bound, by reference name: { product: 'heavyweight-tee' }
  revision: OfferRevision // §7: the state this offer was computed from
  availability: Availability
  conditions: ConditionResult[] // every precondition, evaluated
  requirements: Requirements // authorization and confirmation, evaluated
  consequential: boolean // derived from the definition (§4.3)
  claims: ClaimView[] // attributed claims about this capability or instance (§4.5)
  relevance: Relevance // §4.4
  alternatives: { count: number } // §6.3: how many alternatives exist, so none is hidden by omission
  choiceSet?: ChoiceSetId // §5
}
```

**The offer id** is readable and canonical: the capability, then `@` and the target's type and key, then the bound references in canonical order. Keys are percent-encoded. It identifies the same opportunity across requests and revisions, so an agent can refer to an offer it saw earlier. **An offer id grants nothing:** executing it re-checks everything (§8). An id sent by an agent is parsed, and its capability and target resolved afresh.

**What an offer does not carry:**

- **No order, no rank and no prominence.** Those belong to the view (§6.4).
- **No authorization token or capability token.** §9, rule R1.
- **Not the full definition.** An offer points to its capability, and `inspect` returns the definition: effects, the input schema, provenance (§6.5). This keeps views small. MCP's guidance is the same: the catalog, then inspection (prior art §4.1).

### 4.2 Availability

```ts
type Availability =
  | { status: 'available' }
  | { status: 'needs-input'; inputs: string[] } // depends on input not given yet
  | { status: 'needs-authorization' } // a different or authenticated principal could
  | { status: 'unavailable'; because: string[] } // ids of conditions or requirements that are false
  | { status: 'unknown'; because: string[] } // ids that couldn't be evaluated

type ConditionResult = {
  id: string
  description: string
  value: true | false | 'unknown'
  detail?: string // a guard's specific reason at projection time (§8.3)
}
```

The runtime computes availability in this order, and stops at the first that applies:

1. **Authorization.** If the capability declares no `authorization`, the status is `unknown`, `because: ['authorization']`: execution will refuse it (§4.3), so it must never read `available`. If `authorization.principal` is `'authenticated'` and the principal isn't, the status is `needs-authorization`. Authorization conditions are evaluated with three values like preconditions: `false` gives `needs-authorization`, and `unknown` gives `unknown`.
2. **Preconditions,** combined with Kleene `all` (RFC 0001 §3.1):
   - **`false`:** `unavailable`, with the ids of the false conditions.
   - **`unknown`,** where every unknown condition reads `input.*`: `needs-input`, with those input paths. v0's "available for some input" becomes this status when the capability takes input (§10). A capability **takes input** when its input schema declares at least one property, or isn't an object schema. So `{ type: 'object' }` with no properties, as a no-argument checkout has, takes none.
   - **`unknown` otherwise:** `unknown`, with the ids of the conditions that couldn't be evaluated.
   - **`true`:** go on.
3. **Otherwise:** `available`.

**Guards at projection time.**

- **The runtime may run a guard's handler** while projecting, with no input, as v0 does. Its result counts as follows:
  - `false` or a string makes the condition `false`, and the string becomes the `detail`;
  - `true` means "not ruled out". The condition is `true` if the capability takes no input, and otherwise `unknown` for input, which gives `needs-input`.
- **An application can mark a guard as execution-only.** Then it stays `unknown` in projections, for guards that are expensive or have side effects.
- **A guard that throws** is `unknown`.

**Quantified conditions.** RFC 0001 §3.1, as amended, adds bounded `some` and `every` over array-typed attribute paths, nested at most two deep, and `count` of an array. The runtime evaluates them with the same three values:

- **Empty arrays:** `some` over an empty array is `false`, `every` is `true`, and `count` is `0`.
- **Elements:** with elements, `some` is `true` if any element's condition is `true`, else `unknown` if any is `unknown`, else `false`. `every` is the dual.
- **Unknown arrays:** an array the resolver didn't supply, or a value that isn't an array at run time, makes the whole expression `unknown`, never `false` or `true`.
- **Nesting:** a quantifier's `of` is resolved in the enclosing scope, and its `where` in the new one. So in a nested quantifier, `item` in `of` is the outer element, and in `where` the inner one (RFC 0001 §3.1).
- **Arrays read from the input:** a quantified condition over an input array counts as reading `input.*`, so it gives `needs-input` before the input is given.
- **The `detail`** of a quantified condition names the first element that decided it, by its index ("item 2 has stock 0"), so a refusal says which one.

Arithmetic stays opaque: a check like "the total is under the limit" is a guard.

**Confirmation doesn't change availability.** An offer whose capability needs confirmation is still `available`. The requirement is shown in `requirements` (§4.3), and execution asks for it (§8.2).

**Why five values.**

- **Each needs a different next step from an agent:**
  - `needs-input`: supply input;
  - `needs-authorization`: sign in or ask the person;
  - `unavailable`: change the state, or give up;
  - `unknown`: try, and expect a possible refusal.
- **Collapsing them is v0's limitation** (Motivation), and the dark-patterns analysis depends on knowing whether an option reached the agent at all, which is exposure (dark patterns §6, item 5).

### 4.3 Requirements and consequences

```ts
type Requirements = {
  authorization: 'met' | 'unmet' | 'unknown' | 'none-declared'
  confirmation?: { summary: string } // the summary template with what's known filled in (RFC 0001 §3.2)
}
```

- **`none-declared`:** the manifest declares no `authorization`. Absent isn't "anyone" (RFC 0001 §3.2), so the runtime's default applies: **it doesn't execute a capability without a declared authorization requirement.** It still projects one, as `unknown`, so a reader sees that it exists. That's v0's default-deny, where an action without `expose` isn't callable (`packages/protocol/spec.md`, Security).
- **`consequential`** is derived, never declared, exactly as terminology §2.4 defines it: true when any of the capability's effects is `financial`, `external`, `access` or `irreversible`, or when its effects are unknown. Confirmation is a separate requirement, enforced whether or not a capability is consequential.

  Exports map it to WebMCP's `consequentialHint` and to tool-approval policies (prior art §6.5).

### 4.4 Relevance

```ts
type Relevance =
  | { level: 'undetermined' } // no task, or a policy that doesn't compute relevance
  | { level: 'direct' | 'related' | 'unrelated'; basis: RelevanceBasis[] }

type RelevanceBasis =
  | { kind: 'start'; detail: string } // the offer is on the start resource
  | { kind: 'relation'; relation: string; from: Id } // reached through a relation, e.g. enables
  | { kind: 'task-text'; matched: string[] } // words of the task matched in the definition's text
```

- **No number.** A level with its basis says what it was computed from (terminology §3.4, RFC 0001 rule 4). Two offers with the same level aren't ranked by relevance against each other.
- **Without a task, relevance is `undetermined`, not low** (terminology §3.4).
- **Relevance never reads claims.** A publisher's recommendation isn't evidence that an offer is relevant to the user's task. Keeping it out of relevance is what keeps publisher preference separate (§4.5).
- **Policies name their relevance method.** The basic method ships in M3: start resource, relations, and words of the task. Others can be added as named methods. A view says which method it used (§6.4).

### 4.5 Publisher preference and other claims

An offer lists the claims whose subject is its capability, and whose `applies` condition, evaluated against the offer's target, isn't `false` (RFC 0001 §9). A claim about one instance, such as "Pro is recommended", is a claim on the capability with `applies` reading `target.*`:

```ts
type ClaimView = {
  id: string
  kind: 'recommendation' | 'benefit' | 'estimate' | 'assessment'
  statement: string
  quantity?: { value: number; unit: string }
  source: { id: string; name: string; role: 'owner' | 'tool' | 'third-party' }
  basis: Basis
}
```

- **A claim always arrives with its source and basis.** "The store recommends this" and "an independent monitor measured that" look different in the data. That's the separation the benchmark's transparent-advocacy condition needs (dark patterns, Goals, condition C).
- **A claim never becomes a field of the offer.** There's no `recommended: true`. An agent that wants to know what the publisher prefers reads the claims, and sees who said it.
- **Policies decide whether claims are shown.** A view can leave them out, and says so in `omitted.claims`. It can't restate one without its source.

## 5. Choice sets

**Decision:** a **choice set** is the set of offers of one capability over every instance of a resource type declared with `alternatives: true` (RFC 0001 §2.1), for one principal and one binding of the other references.

```ts
type ChoiceSet = {
  id: ChoiceSetId // 'hosting.plan.subscribe@hosting.plan'
  capability: Id
  over: Id // the resource type whose instances are the choices
  members: OfferId[] // every instance the resolver lists for this principal
  order: OrderBasis // §6.4: what the members' order is based on
}
```

- **Members come from the resolver's `list`.** Every instance the principal may see is a member, including those whose offer is `unavailable`. "This plan exists, and you can't choose it now" is information.
- **Members have the same shape.** Every member is a full `CapabilityOffer` with the same fields, so no member carries more detail than another by construction. Differences in what the data says (a price, a limit) come from the instances' attributes and claims, which is what the benchmark holds fixed.
- **A choice set is atomic in a view** (§6.3): it's in the view whole, or it isn't there. If a budget can't fit it, the set is summarized with its member count, and expanding it returns all of it.
- **`alternativeTo` between capabilities is different.** It relates two capabilities ("buy now" and "add to cart, then check out", terminology §4.1), and it's handled by the alternatives rule of §6.3, not by choice sets.

**Alternatives considered:**

| Alternative                                                      | Rejected because                                                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Choice sets declared in the manifest, as lists of instances      | Instances are runtime data. A manifest names no instance (RFC 0001, Goals)                                                                        |
| Group by the resource's `alternatives` flag, across capabilities | Subscribing to Pro and reading Pro's limits aren't alternatives. A choice is between answers to one capability                                    |
| Let a policy choose a subset of members ("the relevant plans")   | That's the obstruction pattern: the cheaper option disappears from the first view (dark patterns §9). A policy can order members, never drop them |

## 6. Discovery policies, views and expansion (question 2)

**The question:** how do discovery policies work, and can an agent request more information without losing meaningful alternatives?

**Decision:**

- **A policy is named data,** registered with the runtime, that decides three things: which offers are in the first view, how a view is ordered, and how much detail it carries.
- **Every policy is bound by one rule, the disclosure invariant (§6.3).** A policy decides what is shown first, never what can be found.
- **Every view says what it left out,** and how to get it.

### 6.1 Policies

```ts
type DiscoveryPolicy = {
  id: PolicyId // 'progressive'
  description: string
  scope: 'exhaustive' | 'start' | 'neighborhood' // which offers a first view draws from
  depth?: number // for 'neighborhood': how many relation steps from the start
  order: OrderMethod // §6.4
  relevance?: RelevanceMethodId // §4.4; absent: relevance is undetermined
  claims: 'shown' | 'omitted'
  budget?: Budget // the default when the request gives none
}

type OrderMethod = 'canonical' | 'relevance' | { byClaim: 'recommendation' }
```

The policies the runtime ships:

| Policy        | `scope`        | Order       | What it's for                                                                  |
| ------------- | -------------- | ----------- | ------------------------------------------------------------------------------ |
| `exhaustive`  | `exhaustive`   | `canonical` | everything the principal may see, in canonical order: the neutral baseline     |
| `resource`    | `start`        | `canonical` | the offers on the start resource: what a v0 page graph shows (§10)             |
| `progressive` | `neighborhood` | `relevance` | the start resource and one step of relations, ordered by relevance to the task |
| `advocated`   | `neighborhood` | `byClaim`   | as `progressive`, with offers the owner recommends first, and the claims shown |

An application can register more. Every view names the policy that produced it (§6.2), so two views made under different policies never look the same. The policy isn't part of a revision, because it changes what's shown, not what's true (§7).

**How the benchmark's conditions map** (dark patterns, Goals). Five of them are policies over unchanged definitions. Two change the fixture. All of them run on the conformant runtime, so the invariant itself isn't an experimental variable.

- **Policies, with the manifest unchanged:**
  - **A, neutral:** `exhaustive`. Its canonical order is fixed, and the dark-patterns analysis requires A's order to be randomized or counterbalanced (dark patterns §8, item 3). The harness does that through the fixture's keys or its presentation, not through the policy, so the policy stays deterministic.
  - **B, progressive:** `progressive`.
  - **C, transparent advocacy:** `advocated`.
  - **D, salience:** a policy with a different `order`. A view can express order and which claims it shows, nothing more (§6.4). "Prominence" beyond position, such as a label, can only be a claim, so D's labelled variants are C's mechanism.
  - **E, discovery friction:** an alternative capability one counted expansion away (§6.3).
- **Fixture changes:**
  - **F, misleading dependency:** a description or a `benefit` or `recommendation` claim asserting a dependency that no precondition backs. Under RFC 0001 §5.5 it's visibly unbacked: no derived prerequisite supports it. It can't be a false _precondition_, because the runtime enforces declarative preconditions itself (§8.1, step 6), which would make the dependency real.
  - **G, bundled default:** a capability whose input default folds in an add-on.

### 6.2 Views

```ts
type View = {
  revision: Revision // §7
  policy: PolicyId
  stale?: true // the request's `seen` is older than this revision
  offers: CapabilityOffer[] // in the view's order
  choiceSets: ChoiceSet[]
  order: OrderBasis // §6.4
  omitted: Omitted // what this view left out
}

type Omitted = {
  offers: number // offers in the projection that this view doesn't carry
  choiceSets: number
  claims: number // claims on included offers that the policy left out
  expand: Expansion[] // how to get them: one entry per expandable group
}
```

### 6.3 The disclosure invariant

**Progressive disclosure changes what is shown first. It never changes what can be found.** For every view, the runtime guarantees:

1. **Counts are exact.** `omitted` counts every offer, choice set and claim the policy left out of this view. No offer the principal may see is uncounted.
2. **Choice sets are atomic.** A view holds all of a choice set's members, or none of them, with the set counted in `omitted`.
3. **Alternatives are one step away.**
   - **The count:** every offer carries `alternatives.count`, the number of its `alternativeTo` partners, which run both ways (RFC 0001 §5.1).
   - **The expansion:** if any partner isn't in the view, one expansion `along: 'alternatives'` returns all of them. An alternative is never more than one call from an offer that was shown.
4. **Exhaustive enumeration is always allowed.** A request with policy `exhaustive` is always honored, under any configured default. It's paginated by budget, but never refused for discovery reasons.
5. **Unavailable is not omitted.** An unavailable offer that's in scope is in the view with its reason. A policy can't treat "unavailable" as a reason to leave something out, because "exists but not now" is what the agent may need to act on (§4.2).

**What this permits.** A policy may:

- show a subset first, if the rest is counted and expandable;
- order offers, if the order states its basis (§6.4);
- leave out claims, if they're counted.

That's enough for every benchmark condition (§6.1).

**What this forbids:**

- an alternative that exists but can't be reached;
- an omission that isn't counted;
- a choice set shown in part;
- a policy that makes an offer appear unavailable or absent to steer a choice.

**What it does and doesn't rule out.**

- **Ruled out, for every policy:** uncounted or unreachable omission, and partial choice sets. Those are the strongest forms of obstruction and sneaking in the dark-patterns taxonomy (dark patterns §2, §9).
- **Bounded, not ruled out:** one counted expansion of friction (condition E), and defaults (G). They stay expressible on purpose, so the benchmark can measure them.
- **Outside the invariant: visibility.** The invariant holds over what the application's resolvers return. A resolver's `load` returning `null` for an instance, or its `list` leaving one out, is the application deciding what the principal may see, and the runtime can't check it. The conformance kit can't either: it's the application's own access policy.

**Tested by construction.** M3c's property tests generate manifests, principals and policies. For each, they check that the union of a view and its expansions equals the `exhaustive` projection's offers, and that every alternative of every shown offer is reachable in one expansion.

**Alternatives considered:**

| Alternative                                                      | Rejected because                                                                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Let policies hide offers, and document it                        | Documentation doesn't constrain a publisher. The invariant has to hold for every policy, including ones an application registers                              |
| Always return everything, and leave presentation to clients      | It gives up the token and latency savings that progressive discovery exists for (Motivation), and moves salience into each client, where it can't be measured |
| A `search_tools`-style meta query instead of views and expansion | Search ranks by text match and returns what matched. It can't say what it left out, so an agent can't know an alternative exists                              |

### 6.4 Order and salience

```ts
type OrderBasis =
  | { by: 'canonical' } // the IR's canonical order: ids, then keys. It means nothing
  | { by: 'relevance'; method: RelevanceMethodId } // ties keep canonical order
  | { by: 'claim'; kind: 'recommendation'; source: string } // the named source's recommendations first
```

- **Every view and every choice set states its order's basis.** An agent, or a person auditing a trace, can tell "this is first because the store recommends it" from "this is first because it's alphabetical".
- **Canonical order is declared to mean nothing.** It exists so that a neutral view is deterministic. RFC 0001 already makes manifest order meaningless (§7.2).
- **A claim-based order names its source.** Ordering by the owner's recommendations is publisher preference applied to presentation, so the view says so.
- **Salience beyond order isn't represented.** There are no badges, highlights or emphasis fields. What a view can do to make an offer prominent is limited to its position and to the claims it shows, both of which are explicit. That's the limit of what condition D can vary through a policy (§6.1).

### 6.5 Expansion and inspection

```ts
type Expansion = {
  from: OfferId | ChoiceSetId | ResourceRef
  along: 'alternatives' | 'members' | 'relations' | 'contains' | 'enables' | 'more'
  count: number // how many offers the expansion returns, before budget
}
```

- **`projection.expand({ from, along })`** returns a `View` of the requested part. It obeys the same invariant, so an expansion's own omissions are counted too. The kinds of `along`:
  - `alternatives`: an offer's `alternativeTo` partners;
  - `members`: a choice set's members;
  - `relations`: an offer's `relatedTo` and `enables` neighbors, declared or derived;
  - `contains`: the members of a container resource;
  - `enables`: the offers this one can make possible;
  - `more`: the next page of the same view.
- **A `more` cursor describes itself.** Its `from` is `more:` and the base64url of the RFC 8785 text of `{ r, o, b }`:
  - `r`: the projection revision it was issued under;
  - `o`: its origin, the first view (`{ view: true }`) or the expansion it pages (`{ from, along }`);
  - `b`: the `budget.offers` of every cut since the origin, `null` for none.

  Any projection with the same revision, under the same request, rebuilds the origin's sequence, makes the same cuts, and returns the same page. So a stateless server needs no record of the pages it served, and the same view always carries the same cursor. A cursor from another revision is refused: the state it paged has moved on, so the agent projects again. A cursor binds the revision, not the rest of the request: replayed under another start, policy, task or budget it gives nothing or a different page of that request's own view, never an offer that request doesn't disclose. A malformed cursor, or one with more than 256 cuts, is refused like one that names nothing.

- **`projection.inspect(offer)`** returns the capability's definition, the conditions with their results, the effects, the claims, and the provenance of each part (RFC 0001 §8). It's how an agent reads consequences before it commits.
- **Derived edges are marked.** A derived `enables` or prerequisite (RFC 0001 §5.5) is returned with basis `inferred` and what it was derived from.

## 7. Revisions

**Decision:** two digests, one per use.

- **The projection revision** identifies the state a whole projection was derived from. It answers "is my view stale?" (`seen`, `stale`).
- **An offer revision** identifies the state one offer was computed from. It's what execution can recompute, so `ifRevision` and approval tokens use it.

```text
projection revision = sha256-base64url( canonical({
  manifest:  the manifest's digest (RFC 0001 §7.1),
  principal: the digest of the principal's authenticated flag and declared attributes,
  resources: [ { type, key, version } for every instance the projection read ],   sorted by (type, key)
  guards:    [ { capability, condition, value } for every guard run at projection time ],   sorted by (capability, condition)
}))

offer revision = sha256-base64url( canonical({
  manifest:  the manifest's digest,
  principal: the principal's digest, as above,
  resources: [ { type, key, version } for the offer's target and bound references ],   sorted by (type, key)
  guards:    [ { condition, value } for that capability's guards run at projection time ],   sorted by condition
}))
```

- **Order:** both arrays are sorted as shown, with ties broken by canonical bytes, because RFC 8785 keeps array order. Without a stated order, "same inputs, same revision" wouldn't hold.
- **`version`** is what a resource resolver returns for an instance: an ETag, an updated-at value, a row version. When it returns none, the runtime uses the digest of the attributes it loaded.
- **The policy isn't an input.** A policy selects and orders what's shown, like `task` and `start`, and changes nothing that's true. Switching policy doesn't make a view stale. A view names its policy and order basis itself (§6.2, §6.4).
- **A revision changes exactly when its inputs do.** Same inputs, same revision; a changed input changes it. M3c tests both directions, for both digests.
- **Execution can recompute an offer revision.** It loads the target and the references anyway (§8.1), and the offer id names them. Recomputing re-runs that capability's guards with no input, as at projection, and skips those marked `executionOnly`, as projection did. It can't recompute a projection revision, because the runtime is stateless and doesn't store which instances a projection read. So `ifRevision` takes an offer revision.
- **It's opaque.** The principal enters only as a digest, so a revision reveals nothing about the caller. Two principals with the same attributes and the same view share a revision, which is correct: they see the same thing.
- **It isn't stored.** It's a function of its inputs, like the manifest's digest.
- **Freshness, not concurrency control.** Execution can be asked to refuse when an offer's state has moved on (§8.1), but it never _trusts_ a revision: it re-checks regardless.

**Alternatives considered:**

| Alternative                                   | Rejected because                                                                                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A counter the application increments          | Every application would have to wire one through every write, and a counter can't be recomputed by a test from the inputs. A digest can                              |
| The manifest's digest alone                   | It doesn't change when state changes, which is most of the time a view goes stale                                                                                    |
| Include the policy, `task` or `start`         | They select and order what's shown. They don't change what's true. Two agents starting from different resources, or under different policies, look at the same state |
| One projection revision, checked at execution | Execution would have to reload everything the projection read, which it doesn't know, to compare                                                                     |

## 8. Execution

### 8.1 The request

```ts
type ExecutionRequest = {
  principal: Principal // resolved afresh by the binding for this request
  offer: OfferId // or a capability id plus a target, for a caller that skipped projection
  input?: unknown
  approval?: ApprovalToken // §8.2, for a capability that requires confirmation
  ifRevision?: OfferRevision // optional: refuse with 'stale' if this offer's state has moved on
  view?: Omit<ProjectionRequest, 'principal'> // the caller's projection request, whole, for `changes` (§8.3)
}
```

**The checks, in order** (v0's order, `packages/protocol/spec.md`, Call, with references and freshness added):

1. **Resolve** the offer id to a capability and a target, and load the target. Failure: `not_found`.
2. **Authorization:** evaluate `authorization` against the principal and target. Authorization conditions read only `principal.*` and `target.*` (RFC 0001 §3.2, as amended), so they can run before input and references are read. Failure: `unauthorized`. A capability with no declared authorization is refused here (§4.3).
3. **Rate limit.** Failure: `rate_limited`.
4. **Input:** validate against the input schema. Failure: `invalid_input`, with the issues.
   - **The target's key in the input.** For a capability that declares `targetAt` (RFC 0001 §2.2), the input's key there must name the offer's target.
     - **Absent:** the runtime fills it in from the offer.
     - **A different key:** the call is refused with `invalid_input`, and a `detail` naming both keys. The offer and the input can never disagree about what is acted on.
     - **A caller that skipped projection** and sent a capability id with an input: the input's key is the target.
5. **References:** load each reference whose key is in the input (`references[].at`, RFC 0001 §2.2). A key that resolves to nothing refuses with `not_found`, and a `detail` naming the reference ("No commerce.product 'xyz'"). So "doesn't exist" never falls through to an `unknown` precondition. It's what v0's guards return today (`apps/example/src/app/products/[slug]/actions.ts:25`).
6. **Preconditions:** evaluate every declarative precondition and run every guard, with the input and the references. `false` or `unknown` fails (RFC 0001, rule 5). Failure: `precondition`, with the condition.
7. **Freshness:** if `ifRevision` was given and the offer revision recomputed now differs, the failure is `stale`. This check is optional, and never a substitute for 2-6.
8. **Confirmation:** if the capability requires confirmation and no valid approval for this exact call is present, the failure is `confirmation_required`, with the summary and an approval token to use (§8.2).
9. **Run** the registered handler.
10. **Observe:** reload the target and the resources the effects name, compare them with the declared effects (§8.4), and make the updated projection.

- **Every execution runs steps 2-6** with the principal resolved for this request, whatever view or offer the caller holds (§9, rule R1).
- **The checks and the run aren't atomic.** Steps 2-8 establish that the call may run at that moment. They don't guarantee their conditions still hold while the handler runs. Anything that must hold throughout is the handler's job (RFC 0001 §8.3, item 2). M3 tests a state change between step 6 and step 9.

### 8.2 Confirmation and approval tokens

RFC 0001 left open whether a runtime can bind an approval to what was approved (§8.3, item 1).

**Decision:** yes, with a single-use **approval token**.

- **What a refusal carries.** When step 8 refuses, the result carries the rendered summary and a token:
  - **What it is:** HMAC-SHA-256, under a key the application holds, ([RFC 2104](https://www.rfc-editor.org/rfc/rfc2104)) over the RFC 8785 canonical bytes of `{ offer, input, summary, subject, revision, expiresAt, nonce }`, written base64url without padding ([RFC 4648 §5](https://www.rfc-editor.org/rfc/rfc4648#section-5)).
  - **Its fields:** `input` is the digest of the canonical input, `subject` the principal's `subject` (§3), `revision` the offer revision (§7), and `nonce` a random value that identifies the token.
- **What the next call needs.** The next execution must carry that token, and it passes step 8 only for the same offer, input, subject and offer revision, before the expiry.
- **No subject, no approval.** A principal without a `subject` can't be issued a token, because nothing would tie the approval to that caller. Step 8 refuses it with `unauthorized` and a `detail` saying approval needs an identified caller.
- **Single use.**
  - **The store:** the runtime records each token's nonce as used until its expiry, in a store the application provides (`seenTokens`, a set with a time to live). A second use refuses with `confirmation_required`, and a new token.
  - **No store, no start:** `createRuntime` refuses to start if any capability requires confirmation and no store is given. There's no exemption for `idempotent: true`: that's an annotation, and under RFC 0001 rule 2 an annotation can't remove a check. An in-memory store is enough for a single process.
  - **Why the revision alone isn't enough:** binding the offer revision already stops replay after any execution that changes what the offer reads. Single use covers the rest, such as a donation that changes nothing the offer reads.
- **Keys:** the runtime accepts the current key and one previous key, so a key can rotate without invalidating every outstanding approval at once.
- **What it guarantees:** the call that runs is the call that was summarized, once. A caller can't approve "subscribe to Hobby" and then run Pro, change the quantity after approval, or reuse the approval.
- **What it doesn't guarantee:** that a person saw the summary. That still rests on the client, as in v0, and docs and exports keep saying "the caller asserts approval" (RFC 0001 §8.3).
- **The precedent:** Gmail recommends that senders embed limited-use access tokens in action URLs, against replay (prior art §2.6).
- **What it is not:** a token satisfies only step 8. It isn't authorization: steps 2-6 still run on the second call. A projection never issues one, and no claim or annotation can make one (§9, rule R2).

### 8.3 The result

```ts
type ExecutionResult =
  | {
      status: 'succeeded'
      output?: unknown // validated against the output schema when there is one
      observed: ObservedChange[] // §8.4
      undeclared: ObservedChange[] // observed changes no declared effect accounts for
      revision: Revision // the new projection revision
      changes: OfferChanges // what the caller's view should update
      message?: string // a sentence to repeat to the user, as v0's message
    }
  | {
      status: 'refused'
      code:
        | 'not_found'
        | 'unauthorized'
        | 'rate_limited'
        | 'invalid_input'
        | 'precondition'
        | 'stale'
        | 'confirmation_required'
      condition?: { id: string; description: string } // for 'precondition', and for authorization conditions
      detail?: string // the specific reason, from a guard or the runtime
      detailTruncated?: true // the detail was cut to the limit
      issues?: InputIssue[] // for 'invalid_input'
      confirmation?: { summary: string; approval: ApprovalToken; expiresAt: string } // for 'confirmation_required'
      revision: OfferRevision // the offer revision the refusal was decided at
    }
  | {
      status: 'failed' // the handler threw after the checks passed
      message: string // safe to show; never internals
      observed: ObservedChange[] // what changed anyway, if anything did
      undeclared: ObservedChange[]
      revision: Revision
      changes: OfferChanges // the view is updated after a partial effect too
    }

type OfferChanges = {
  added: CapabilityOffer[]
  removed: OfferId[]
  changed: { id: OfferId; availability: Availability }[]
}
```

**`detail`**, which RFC 0001 rule 5 left for this RFC to shape:

- **What it is:** a string, the specific reason for a refusal: "Only 2 left of Large", "The plan is already active".
- **Where it comes from:**
  - **A guard** returns it, as v0's guards return a string today. What a guard's string says is the application's responsibility.
  - **A declarative condition:** the runtime can generate one from the comparison ("count is 0"). A generated `detail` never includes a `principal.*` value: for a condition on the principal, it names the condition only (§3).
- **What it never is:** part of the manifest or a revision, or trusted as an instruction. It's application text, shown as text.
- **Length:** at most 280 characters. A longer one is cut, and `detailTruncated: true` says so.
- **What stays stable:** `condition` (`id` and `description`), so code can branch on the id and people can read the detail.

**`changes`** lists the offers whose existence or availability changed, compared with the projection before the execution under the same request: the same principal, under the request's `view`: its start, or the target when it names none, and its policy, task, budget and `seen`.

- **What it carries:** an execution result goes on the wire, so `changes` is the caller's first view before and after, never the projection (§11). `added` holds offers as that view shows them, without the claims a policy omits, and every id in `removed` and `changed` is one the caller's view shows, before or after. It's v0's `actionsAdded` and `actionsRemoved` (`packages/protocol/spec.md`, Delta), with availability changes kept apart from additions.

**`failed` after a partial effect.** A handler can fail after changing something. The result reports what was observed anyway, and carries the recomputed projection's `changes`, so the caller's view doesn't go stale. Nothing in the runtime assumes an action is atomic or reversible.

### 8.4 Declared against observed effects

```ts
type ObservedChange = {
  resource: ResourceRef
  change: 'create' | 'update' | 'delete'
  attributes?: string[] // which declared attributes changed, for an update
  matches?: number // the index, in canonical order, of the declared state effect it accounts for
  contradicts?: true // that effect declares what it establishes, and it's false after the run
}
```

- **What the runtime can see.** It observes what resolvers report, before and after: the target, and every resource a declared state effect names. It can't observe external, financial or access effects, so it never claims to.
- **`matches`** indexes the capability's `effects` in their canonical order (RFC 0001 §7.2), so every reader of the same manifest agrees which effect it means.
- **`undeclared`** lists observed changes no declared effect accounts for. It's how a developer finds an effect they forgot to declare, and how the inspector (M3f) shows "declared against observed".
- **`establishes` is checked.** When a state effect declares what it establishes, the runtime evaluates that expression after the run. A `false` result is reported as an observed change that contradicts its declaration: the change carries `matches` and `contradicts: true`.
- **Observations are records, with basis `observed`, never edits to the manifest** (RFC 0001 §4).

## 9. Safety rules of the runtime

These restate RFC 0001's rules (§8.2) as what the runtime does, and add the ones only a runtime can keep. Each has tests in M3.

- **R1. An offer is never authorization.**
  - Every execution resolves the principal afresh and re-runs authorization, references and preconditions (§8.1, steps 2-6), whatever the caller holds.
  - No offer, view, revision or id carries anything that skips a check.
  - **Tests:**
    - execute an offer projected for one principal as another;
    - execute after the state changed between projection and execution;
    - execute after the state changed between the checks and the run (§8.1).
- **R2. Nothing annotated skips a confirmation.**
  - The confirmation requirement comes from the definition, or from the application's own policy. Nothing else can remove it: not `safe: true`, not `effects: []`, not a claim, not a policy, and not an approval token from a different call.
  - **Tests:**
    - a capability with `safe: true`, `effects: []` and `confirmation` still refuses without approval;
    - an approval token used twice runs once, even on a capability declared `idempotent: true`;
    - a token issued to one subject is refused for another with the same attributes.
- **R3. Nothing the agent says changes availability.**
  - Availability reads only the principal, the resolvers and the input (§2).
  - **Test:** the same principal and state, with every combination of `task`, `start`, `policy` and `seen`, give the same availability for every offer that appears.
- **R4. Disclosure never hides an alternative.** This is the invariant of §6.3, tested by construction.
- **R5. Declared preconditions are enforced** (RFC 0001, rule 5). `false` and `unknown` both refuse.
  - **The conformance kit:** M3 ships the kit RFC 0001 §12.2 defers to it. `@affordances/ir` derives, for each declarative precondition, a state that makes it false. The kit asks the application's test fixture to put the context in that state: a target (`arrange(type, key, attributes)`), and for conditions on `principal.*` or `input.*`, a principal and an input that falsify them, which the kit supplies. It then executes the capability with an approval, and expects `refused` with that condition's id.
  - **Guards:** the kit runs the same test with the guard's handler forced to return `false`.
  - **A capability that passes when it should refuse fails conformance.** Under this runtime that means a resolver that misreports state, or a binding that bypasses the runtime, such as v0's agent path before M7.
- **R6. Influence is explicit.** Every view states its policy and order basis, and publisher preference appears only as attributed claims (§4.5, §6.4).
- **R7. Determinism.** The same inputs give the same views, byte for byte in canonical form, and the same revisions (§7).

## 10. How today's protocol relates

- **A v0 page graph is a view** with policy `resource`, started from the page's resource:
  - its `actions` are the offers on that resource;
  - `available` and `reason` come from availability, collapsed as v0 can show them (§4.2): `needs-input` becomes `available: true`, as v0 already behaves;
  - `nav` comes from `relatedTo` expansions.
- **Route parameters are input.** A v0 binding maps the route's parameters (a product's `slug`) into the capability's input, as RFC 0001 §6.3 amends bindings to do. They reach conditions as `input.*`. At projection, an offer's `with` binds references. At execution, references are resolved from the input (§8.1, step 5), where the binding puts route parameters. A route never binds a reference directly.
- **A v0 call is an execution** through an `affordances/v0` binding (RFC 0001 §6.3). Its delta's `changed` keeps v0's state-key meaning, and its `actionsAdded` and `actionsRemoved` come from `changes`.
- **An imported v0 guard** is the condition `guard` (RFC 0001 §10.1). At projection time it runs with no input, as in v0, and `true` gives `needs-input` when the action takes input (§4.2). That's the more accurate reading of what v0's `available: true` already meant.
- **Other transports.** Two exports are possible, and both are left to RFC 0004: one tool per capability, named by its id (RFC 0001 §6.1), or four generic tools, `discover`, `expand`, `inspect` and `execute`, over this API. The second is the catalog, inspect and execute pattern MCP's guidance recommends (prior art §4.1), with the disclosure invariant behind it.

Nothing in v0's packages, wire format or tests changes in this RFC.

## 11. The package `@affordances/runtime` (M3)

```ts
import type { CapabilityManifest, Id, Basis } from '@affordances/ir'

export type Runtime = {
  project(request: ProjectionRequest): Promise<Projection>
  execute(request: ExecutionRequest): Promise<ExecutionResult>
}

export type Projection = {
  revision: Revision
  // everything the principal may see, in canonical order: what views and expansions draw from. Runtime-internal
  offers: CapabilityOffer[]
  choiceSets: ChoiceSet[]
  view(): View // the first view, under the request's policy and budget
  expand(expansion: Pick<Expansion, 'from' | 'along'>, options?: { budget?: Budget }): Promise<View>
  inspect(offer: OfferId): Promise<OfferDetails>
}

export function createRuntime<M extends CapabilityManifest>(options: {
  manifest: M
  resources: { [type in ResourceIds<M>]: ResourceResolver }
  handlers: { [id in InvocableIds<M>]: Handler<M, id> } // one per query and action capability
  policies?: DiscoveryPolicy[] // added to the built-in four
  defaultPolicy?: PolicyId // 'resource' unless set
  approvalKeys: { current: CryptoKey; previous?: CryptoKey } // for approval tokens (§8.2)
  seenTokens?: TokenStore // required if any capability requires confirmation
}): Runtime

export type TokenStore = {
  // records the nonce until `expiresAt`; returns false if it was already recorded
  claim(nonce: string, expiresAt: Date): Promise<boolean>
}

export type ResourceResolver = {
  load(
    key: string,
    principal: Principal,
  ): Promise<{ attributes: Record<string, unknown>; version?: string } | null>
  list?(principal: Principal, scope: { capability: Id }): Promise<string[]> // keys, for choice sets and containment
}

export type Handler<M, Cap> = {
  run(
    input: InputOf<M, Cap>,
    ctx: { principal: Principal; target?: ResourceRef },
  ): Promise<OutputOf<M, Cap>>
  // one implementation per guard the capability declares; typed by its condition ids (RFC 0001 §12.1)
  guards: { [id in GuardIds<M, Cap>]: GuardImpl<M, Cap> }
  message?(args: { input: InputOf<M, Cap>; output: OutputOf<M, Cap> }): string
}

export type GuardImpl<M, Cap> = ((args: {
  input: InputOf<M, Cap> | undefined // undefined at projection time
  target?: { key: string; attributes: Record<string, unknown> }
  refs: Record<string, { key: string; attributes: Record<string, unknown> } | undefined> // by reference name
  principal: Principal
}) => boolean | string | Promise<boolean | string>) & { executionOnly?: true }

export type OfferDetails = {
  offer: CapabilityOffer
  definition: import('@affordances/ir').CapabilityDefinition
  derived: {
    relation: 'enables' | 'prerequisite'
    to: Id
    basis: Extract<Basis, 'inferred'>
    from: string
  }[]
}

// plus the types of §2-§8: ProjectionRequest, Principal, ResourceRef, Task, Budget, CapabilityOffer,
// Availability, ConditionResult, Requirements, Relevance, ClaimView, ChoiceSet, DiscoveryPolicy, View,
// Omitted, OrderBasis, Expansion, Revision, ExecutionRequest, ExecutionResult, ObservedChange, OfferChanges
export type Revision = string // 'sha256-…', a projection revision
export type OfferRevision = string // 'sha256-…', an offer revision
export type OfferId = string
export type ChoiceSetId = string
export type PolicyId = string
export type RelevanceMethodId = string
export type ApprovalToken = string
```

- **`handlers` is typed from the manifest.**
  - **Coverage:** every query and action capability needs a handler (a query's handler returns its output), and every declared guard needs an implementation, so a missing one is a type error. `createRuntime` checks the same at startup, for manifests loaded as JSON.
  - **Inside Next.js:** `defineAction({ capability, guards })` (RFC 0001 §12.1) registers exactly this.
- **A projection is runtime-internal, and only views are wire-visible.**
  - **What it holds:** a `Projection` carries every offer and choice set the principal may see, including what a policy leaves out of a view.
  - **Why it never leaves the runtime:** serializing it would hand an agent what the policy omitted. That breaks the disclosure invariant's bookkeeping (§6.3), and it would erase the difference between the benchmark's conditions (§6.1).
  - **The rule:** an agent-facing surface, such as an MCP server, an HTTP binding or the benchmark's harness, sends `View`s, from `view()` and `expand`, and `OfferDetails` from `inspect`, never a `Projection`.
  - **How it's enforced:** `toJSON` on a projection throws, so accidental serialization fails loudly.
- **No principal resolver.** Requests carry a resolved `Principal`. The binding or adapter that receives an HTTP request resolves it (§2.1), so the runtime stays transport-free.
- **`createRuntime` refuses to start** if any capability requires confirmation and no `seenTokens` store is given (§8.2).
- **Dependencies:** `@affordances/ir`, and Web Crypto for digests and approval tokens. No Next.js, React or MCP.

**Tests M3 adds, beyond R1-R7:**

- the five availability values, from fixtures that produce each;
- revision stability and sensitivity (§7);
- choice-set atomicity under every budget;
- the `detail` length cap;
- approval tokens refused for a different input, offer, subject or offer revision, after expiry, on a second use, and for a principal without a subject;
- a reference key that resolves to nothing refuses with `not_found`;
- undeclared-change reporting.

## 12. Example

A hosting provider with three plans: a resource type `hosting.plan` declared with `alternatives: true`, and an action `hosting.plan.subscribe` that targets it, with a `financial` effect, a confirmation requirement and a precondition `notCurrent`. The principal is signed in, and on Hobby. The agent's task: "Find a plan for my small project; keep costs low, but deploy reliably." Under policy `progressive`, starting from the project:

```json
{
  "revision": "sha256-3vQ…",
  "policy": "progressive",
  "order": { "by": "relevance", "method": "basic" },
  "offers": [
    {
      "id": "hosting.plan.subscribe@hosting.plan:business",
      "availability": { "status": "available" },
      "…": "…"
    },
    {
      "id": "hosting.plan.subscribe@hosting.plan:hobby",
      "revision": "sha256-Lp2…",
      "capability": "hosting.plan.subscribe",
      "target": { "type": "hosting.plan", "key": "hobby" },
      "availability": { "status": "unavailable", "because": ["notCurrent"] },
      "conditions": [
        {
          "id": "notCurrent",
          "description": "The project isn't already on this plan",
          "value": false
        }
      ],
      "requirements": {
        "authorization": "met",
        "confirmation": { "summary": "Subscribe to hobby for 0 USD a month" }
      },
      "consequential": true,
      "claims": [],
      "relevance": { "level": "direct", "basis": [{ "kind": "task-text", "matched": ["plan"] }] },
      "alternatives": { "count": 0 },
      "choiceSet": "hosting.plan.subscribe@hosting.plan"
    },
    {
      "id": "hosting.plan.subscribe@hosting.plan:pro",
      "availability": { "status": "available" },
      "…": "…"
    }
  ],
  "choiceSets": [
    {
      "id": "hosting.plan.subscribe@hosting.plan",
      "capability": "hosting.plan.subscribe",
      "over": "hosting.plan",
      "members": ["…:business", "…:hobby", "…:pro"],
      "order": { "by": "canonical" }
    }
  ],
  "omitted": {
    "offers": 4,
    "choiceSets": 0,
    "claims": 1,
    "expand": [
      { "from": { "type": "hosting.project", "key": "p_1" }, "along": "relations", "count": 4 }
    ]
  }
}
```

What the agent can rely on:

- **All three plans are here,** because a choice set is atomic. Hobby is listed though it can't be chosen now, with the reason.
- **The order says what it's based on:** the offers by relevance, all `direct`, so ties keep canonical order, and the choice set's members in canonical order (by key: business, hobby, pro), which means nothing. Under policy `advocated` it would say `{ "by": "claim", "kind": "recommendation", "source": "host" }`, and the omitted claim would be shown with its source: the host's recommendation on `hosting.plan.subscribe`, whose `applies` holds for the Pro instance (`target.slug` is `pro`).
- **Four more offers exist,** one expansion away, and one claim was left out. Nothing is hidden by omission.
- **Subscribing is consequential:** it has a financial effect and needs confirmation. Executing Pro returns `confirmation_required` with the rendered summary and a token for that exact call.

## 13. Open questions

1. **Relevance methods beyond the basic one.** Embedding similarity would need a defined, explainable basis to meet §4.4. Deferred until the benchmark shows whether relevance ordering matters.
2. **Partial attribute visibility.** A principal who may see an instance but not all of its attributes. Today the resolver leaves out the attributes the principal may not see, so conditions on them are `unknown` (`missing`, §2.1). Whether the manifest should declare per-attribute visibility is open.
3. **Event capabilities.** Subscribing to an event is a binding concern (RFC 0001 §2.2). How a projection offers a subscription, and how a view learns that state changed without polling, are left to RFC 0004's transports.
4. **Approval expiry.** The runtime accepts one previous key, so rotation doesn't invalidate outstanding approvals (§8.2). The expiry default (five minutes, the default timeout of UI SDK's `allow` callback, <https://ui-sdk.dev/docs/agents/connect-an-agent/reference>, `createAgent`) needs experience.
5. **Cross-manifest projections.** RFC 0001 allows relations that name another manifest's definitions. Projecting across two applications needs two principals and two runtimes, and is out of scope here.

## References

- [RFC 0001: The semantic capability IR](./0001-semantic-capability-ir.md), and the [terminology](./research/terminology.md), [prior art](./research/prior-art.md) and [dark-patterns](./research/dark-patterns.md) documents it builds on.
- Model Context Protocol, [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), 2026-07-28, and [client best practices](https://modelcontextprotocol.io/docs/2026-07-28/develop/clients/client-best-practices).
- S. C. Kleene, _Introduction to Metamathematics_ (1952), for the strong three-valued logic RFC 0001 §3.1 uses.
- IETF, [RFC 2104: HMAC](https://www.rfc-editor.org/rfc/rfc2104); [RFC 8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785); [RFC 4648 §5: base64url](https://www.rfc-editor.org/rfc/rfc4648#section-5).
- D. Ersoy et al., "Investigating the Impact of Dark Patterns on LLM-Based Web Agents", IEEE S&P 2026, [arXiv:2510.18113](https://arxiv.org/abs/2510.18113).
