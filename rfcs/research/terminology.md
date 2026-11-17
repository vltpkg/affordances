# Terminology for the semantic capability IR

**Status:** draft, input to RFC 0001. It takes the naming notes of [the prior-art review](./prior-art.md) (§6.2) into account; §8 records which ones changed a decision.

This document fixes the words RFC 0001 uses: what each term means, which prior art it comes from, and what it deliberately does not mean. Where an existing specification has a term that fits, we reuse it and cite it. Where we coin a term, we say why. The repository facts it relies on are in [the repo audit](./repo-audit.md).

## Goals

The vocabulary serves three pieces of work:

- **A semantic capability IR:** a portable, deterministic and non-executable manifest of what an application can do, independent of any page, route, transport or caller.
- **A projection runtime:** it derives from a manifest, for one caller and context, what is possible now, what the agent can discover, and what else it could choose.
- **A choice benchmark:** it measures how the way capabilities are disclosed changes agents' decisions, while the options stay fixed.

For the second and third to work, the words have to keep apart what an application can do, what is possible for one caller now, what an agent can find, why the application thinks a choice is good, and whether it actually serves the user. The vocabulary is built to keep those apart.

## 1. Rules for the vocabulary

1. **A definition and its instance never share a name.** Everything in a manifest is a _definition_ (`CapabilityDefinition`, `ResourceDefinition`). Everything a runtime produces for one context is not (`CapabilityOffer`, `Resource`). That is the split between what an application can do and what is possible for one caller now (Goals).
2. **Reuse before coining.** We reuse established terms when their meaning matches: `safe` and `idempotent` from HTTP, `precondition` and `effect` from OWL-S, `binding` from WoT, `claim` from Verifiable Credentials, `alternative` and `relation` in their ordinary senses. We coin a term only when no existing one has the meaning we need, or when the existing one carries a meaning we must avoid.
3. **One concept, one word.** Availability, discoverability, relevance, salience and publisher preference (§3.4) are five separate terms, and no field or flag may stand for two of them.
4. **No term implies authority.** Nothing a manifest or a projection says grants permission to do anything (§2.2, "capability").

## 2. Definitions: the manifest layer

### 2.1 Capability manifest

**A capability manifest** is a portable, deterministic JSON document holding one application's definitions: resource definitions, capability definitions, relations and claims. It contains no executable code and no data about any particular caller or resource instance.

- **Prior art.** It plays the role of a W3C WoT [Thing Model](https://www.w3.org/TR/wot-thing-description11/#thing-model), which describes a class of things without the communication metadata of a specific instance. It also resembles an [ALPS](https://datatracker.ietf.org/doc/html/draft-amundsen-richardson-foster-alps-07) profile: application-level semantics, independent of media type (ALPS §1.2.1).
- **Name collision.** v0 already has a `Manifest`: the executable route map in `.affordances/manifest.ts` (`packages/core/src/handler.ts:24`). In prose we always write **capability manifest** for the IR and **route manifest** for v0's.
- **Rejected:** "profile" (ALPS; in HTTP, `profile` is a link relation, [RFC 6906](https://www.rfc-editor.org/rfc/rfc6906)), "Thing Model" (WoT's device framing), "schema" (we mean the document, not its JSON Schema).
- **What it is not:** an authorization, or a live list of what can be called. A capability manifest declares what an application can do. A projection (§3.2) says what is possible now.

### 2.2 Capability

**A capability** is something an application can do or answer, described independently of any route, transport or caller. Its kind is one of `query`, `action` or `event` (§2.3).

- **Prior art.** OWL-S models a service in three parts: the profile ("what the service does"), the process model ("how it is used") and the grounding ("how to interact with it") ([OWL-S §3](https://www.w3.org/submissions/OWL-S/#3)). A capability definition is the profile and the process model's inputs, outputs, preconditions and effects. The grounding is the binding (§2.9).
- **Why not "affordance".** WoT calls these [interaction affordances](https://www.w3.org/TR/wot-thing-description11/#interactionaffordance). But a WoT affordance belongs to the Thing Description of one specific Thing, closer to our offer than to our definition. "Affordance" in Gibson's original sense is also relational between an agent and its environment, which again is the offer. And in this repository the word is the project's name and a React component (`packages/react/src/affordance.tsx:15`). Using it for a fourth thing would make every sentence ambiguous.
- **Why not "operation".** In OpenAPI and [Hydra](https://www.hydra-cg.com/spec/latest/core/), an operation is bound to an HTTP method and target. A capability has no transport.
- **Why not "tool" or "action".** "Tool" is MCP's transport-level unit. "Action" is one of the three kinds, and in v0 it means any `defineAction`, including read-only ones like `search` (`apps/example/src/app/actions.ts:8-15`).
- **What it does not mean: authority.** In security engineering a _capability_ is an unforgeable reference whose possession grants authority (the object-capability model; [Miller, _Robust Composition_, 2006](https://papers.agoric.com/assets/pdf/papers/robust-composition.pdf)). That is explicitly **not** this meaning. Knowing a capability, or receiving an offer of one, grants nothing. Authorization is checked at execution (§3.2).
- **The other collision.** MCP also uses "capabilities" for the optional protocol features a client and server declare: per request since revision 2026-07-28, and in an initialization handshake before it ([MCP lifecycle](https://modelcontextprotocol.io/specification/2026-07-28/basic/lifecycle)). The context always disambiguates, because ours are always "capability definitions" or "capability offers".

### 2.3 Capability kinds: query, action, event

| Kind     | Meaning                                                                           | Prior art                                                                                                                      |
| -------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `query`  | Returns information and has no declared effect. It is `safe` (§2.4) by definition | ALPS `safe` descriptor (§2.2.16); WoT reads of a [property](https://www.w3.org/TR/wot-thing-description11/#propertyaffordance) |
| `action` | May change state or have other effects (§2.6)                                     | ALPS `unsafe` and `idempotent`; WoT [`ActionAffordance`](https://www.w3.org/TR/wot-thing-description11/#actionaffordance)      |
| `event`  | Something the application emits that can be observed: the push model              | WoT [`EventAffordance`](https://www.w3.org/TR/wot-thing-description11/#eventaffordance)                                        |

- **WoT has properties where we have queries.** A WoT property is state on a Thing that can be read, written or observed. We model state as attributes of resources (§2.5). Reading it is a query, changing it is an action, and observing it is an event. That keeps the three verbs and puts the state where the domain has it.
- **The kinds are discriminant values, not exported names.** `kind: 'action'` costs nothing, but an exported `Action`, `Query`, `tool` or `act` would collide with React's `useActionState`, Next.js Server Actions, XState actions, AI SDK's `tool()` and UI SDK's `query()` and `act()`. Types that need a name per kind use `QueryCapability`, `ActionCapability` and `EventCapability`.
- **Why "event", not "observation".** Both would fit. "Observation" also names what a runtime records after execution (§3.6, observed change), so we keep it for that.

### 2.4 Behavioral properties: safe, idempotent

These two are HTTP's definitions for methods, applied to a capability.

- **`safe`:** the caller "does not request, and does not expect, any state change on the origin server" as a result of executing it ([RFC 9110 §9.2.1](https://www.rfc-editor.org/rfc/rfc9110#section-9.2.1)). For a capability, "the origin server" is the application. WoT uses the same term on actions ([`ActionAffordance`](https://www.w3.org/TR/wot-thing-description11/#actionaffordance)).
- **`idempotent`:** executing it several times with the same input has the same intended effect as executing it once ([RFC 9110 §9.2.2](https://www.rfc-editor.org/rfc/rfc9110#section-9.2.2)).

**Each is three-valued: `true`, `false`, or absent.** Absent means no claim was made. WoT gives `safe` and `idempotent` a default of `false`, but uses this rule for `synchronous`: "Lack of this keyword means that no claim on the synchronicity of the action can be made" ([`ActionAffordance`](https://www.w3.org/TR/wot-thing-description11/#actionaffordance)). We apply it to all of them, so an imported description with no annotation stays distinguishable from one that says `false`. Enforcement treats absent the same as the cautious value: not safe, not idempotent.

**What they don't mean:** that the capability is harmless, approved, or exempt from confirmation. A behavioral property is a statement by its source (§2.8), and every enforcement decision ignores it when it would loosen a check. MCP draws the same line: clients "MUST consider tool annotations to be untrusted unless they come from trusted servers" ([MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)). v0's `readOnly` (`packages/core/src/action.ts:52`) and MCP's `readOnlyHint`/`idempotentHint` map onto these two terms. Imported from MCP or WebMCP, they are recorded as **hints**, the word those protocols use: imported claims, never declarations (§2.8).

**Consequential** is the one combined flag, for targets that have only one (WebMCP's `consequentialHint`). It is derived, never authored: a capability is consequential when any of its effects is `financial`, `external`, `access` or `irreversible`, or when its effects are unknown (§2.6).

### 2.5 Resource and resource definition

- **A resource definition** describes a type of domain entity (a product, a cart, a deployment), its identifying key and its attributes. **A resource** is one instance of it in a projection, identified by its type and its key (`product:42`).
- **Prior art.** A resource definition plays the role of a Hydra `Class` with its `supportedProperty` entries, or an ALPS `semantic` descriptor with nested descriptors (ALPS §2.2.4, §2.2.16).
- **Why not "entity".** v0's `entities` are untyped page state (`packages/protocol/src/schema.ts:40`). The new term marks the difference: a resource has a type, and a key that survives across pages.
- **Why `Resource`, not `ResourceInstance`.** Rule 1 (§1) already separates it from the definition, so the suffix adds nothing.

### 2.6 Effect

**An effect** is a declared change in the world that a successful execution of a capability is expected to cause. The term is from OWL-S's `hasEffect` ([OWL-S §5.2](https://www.w3.org/submissions/OWL-S/#5)).

- **Returned information is not an effect.** OWL-S keeps outputs separate from effects, and so do we. Output is described by the output schema.
- **Categories:**
  - `state`: creates, changes or deletes an application resource;
  - `external`: acts outside the application's own resources, such as sending a message or calling a third party;
  - `financial`: moves money or creates an obligation to pay;
  - `access`: changes who can see or do something, including sharing personal data.
- **Reversibility** is a property of each effect, not of the capability:
  - `reversible`: it can be undone without loss;
  - `compensable`: another capability semantically undoes it, as with a saga's compensating transaction ([Garcia-Molina and Salem, _Sagas_, SIGMOD 1987](https://dl.acm.org/doi/10.1145/38713.38742)), and we name that capability;
  - `irreversible`.
- **Outcome.** OWL-S couples an output and effects under the condition in which they occur and calls it a `Result` (`inCondition`, `withOutput`, `hasEffect`; [OWL-S §5.2](https://www.w3.org/submissions/OWL-S/#5)). We call that coupling an **outcome**, because "result" already means a call's return value in every API this touches. Whether the IR models more than one outcome per capability is RFC 0001's question.
- **What it does not mean:**
  - v0's `effects` field, which lists state keys used to build a delta (`packages/core/src/action.ts:51`; repo audit §4, limitation 2);
  - an _observed_ change (§3.6). A declared effect is an expectation, and the runtime keeps the two apart.

### 2.7 Condition, precondition, and the two execution requirements

v0's single guard function (`packages/core/src/action.ts:39-44`) and `expose` (`packages/protocol/spec.md:68-74`) mix three different things. We give each its own term.

- **A condition** is a predicate over a resource's attributes, the principal (§3.1) or application state. It is one of two kinds:
  - **declarative:** written in the IR's small predicate vocabulary, so that tools can reason about it;
  - **a guard:** a named check that only the runtime can evaluate, described in prose. The word is v0's (`packages/core/src/action.ts:39`) and XState's, and it means exactly the opaque, runtime-enforced check. Marking it keeps a tool from treating an unknown check as absent.
- **A condition evaluates to `true`, `false` or `unknown`.** A web application's state is never fully known to whoever evaluates a condition, so a third value is needed. Unlike in PDDL's closed world, "not known to hold" doesn't mean "false".
- **A precondition** is a condition that must hold for an execution to succeed. This is OWL-S's sense: "if a process has a precondition, then the process cannot be performed successfully unless the precondition is true" ([OWL-S §5.2](https://www.w3.org/submissions/OWL-S/#5)). v0's `requires` text describes a precondition.
- **An authorization requirement** says which principals may execute a capability. It is about the caller, not the world. v0's `expose: 'session'` is one.
- **A confirmation requirement** says that a person must approve an execution, after seeing a summary, before it runs. v0's `expose: 'confirm'` is one (`packages/core/src/handler.ts:198-204`).

**What a condition is not:** a check of what a caller _believes_. OWL-S stresses "a condition's being true" as distinct from "being believed to be true, being known to be true, being represented in a database as true" ([OWL-S §5.2](https://www.w3.org/submissions/OWL-S/#5)). An offer's availability (§3.3) is the runtime's evaluation at one moment, not the condition itself.

### 2.8 Claim, source, basis, provenance

- **A claim** is a statement about a subject (a capability, a resource definition, an outcome) made by an identified source. The word and its sense come from the W3C [Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/), where a claim is an assertion made about a subject.
  - Examples: a publisher recommendation, a cost estimate, a claimed benefit, claimed reliability.
  - **Collision:** a JWT's "claims" ([RFC 7519 §4](https://www.rfc-editor.org/rfc/rfc7519#section-4)) are about an authenticated subject. Code that handles both qualifies ours as `CapabilityClaim`.
  - A claim never merges into the definition it is about, and claims from different sources can disagree.
- **Provenance** is the record of where a piece of semantic information came from. It has two parts:
  - **source:** _who_ stated it: the developer, the publisher, the compiler, an importer, the runtime, or a named verifier. This is PROV-O's [`wasAttributedTo`](https://www.w3.org/TR/prov-o/#wasAttributedTo).
  - **basis:** _how_ it is known, one of five values:
    - `declared`: a person who owns the application stated it;
    - `inferred`: a tool derived it from structure, such as a compiler reading a schema;
    - `imported`: it was copied from another description, such as MCP tool metadata or OpenAPI;
    - `observed`: the runtime saw it happen;
    - `verified`: an identified party other than the source checked it against named evidence ([`wasDerivedFrom`](https://www.w3.org/TR/prov-o/#wasDerivedFrom)).

**Why these are five values, not a score.** The kinds of provenance that matter (a developer's declaration, a compiler's inference, imported metadata, a runtime observation, an independent verification) mix _who_ and _how_, so we split them into source and basis. Basis is not ordered by trust, and it has no numeric form. A confidence number would need a defined meaning first, and none of these sources gives it one.

**Promotion.** A basis changes only with new evidence:

- `inferred` becomes `declared` only when an owner states it;
- anything becomes `verified` only with a named verifier and evidence.

**Schema validity does not imply semantic truth.** A claim that validates against the schema is still only as true as its source.

### 2.9 Identity and binding

- **A semantic identifier** names a definition, independently of every transport, as a dotted name such as `commerce.cart.addItem`.
  - Dots are already legal in MCP tool names (`admin.tools.list` is the spec's own example; [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).
  - For cross-application use, the canonical form is a URI: the manifest's namespace URI with the identifier as a fragment. That follows ALPS, where "the complete URI to an ALPS 'descriptor' (including the fragment) forms an 'abstract semantic type' identifier" (ALPS §2.2.9.2).
- **A binding** connects a capability to one concrete way of invoking it: a v0 route and action name, an MCP tool, an HTTP operation, a UI component interaction.
  - WoT calls the abstract version a [Protocol Binding](https://www.w3.org/TR/wot-thing-description11/#dfn-protocol-binding) and serializes it as [forms](https://www.w3.org/TR/wot-thing-description11/#form). OWL-S calls it a grounding ([OWL-S §6](https://www.w3.org/submissions/OWL-S/#6)).
  - We use "binding", because a runtime registers them to invoke capabilities, and because "form" means an HTML form to most web developers.
  - A capability keeps its identifier however many bindings it has. The v0 name `addToCart` on `/products/[slug]` is a binding name, not an identity (repo audit §4, limitation 1).

## 3. Projections: the runtime layer

### 3.1 Principal and context

- **A principal** is the party a request acts for, as resolved by the application's authentication. v0 calls it the session (`packages/core/src/action.ts:8-14`). "Principal" is the standard security term, and it doesn't assume cookies.
- **A discovery context** is what a projection request says about the agent's situation: the resource it starts from, the task it states (if any), and what it has already seen. It is supplied per request and never stored in the manifest, which stays independent of any caller or resource instance.

### 3.2 Projection, view, expansion, revision

- **A projection** is the contextual capability graph a runtime derives from one manifest for one principal and context, at one revision.
- **A view** is the bounded part of a projection returned in one response.
- **Expansion** is an agent's request for more of the projection than the current view: a resource's neighbors, a capability's alternatives, an outcome's details.
- **A revision** identifies the application state a projection was derived from, so that a caller can tell when a view is stale. v0 has no equivalent; a delta is a per-call diff (repo audit §7, gap 10).

### 3.3 Capability offer

**A capability offer** is a specific opportunity to execute a capability on a specific resource, in a projection: `commerce.cart.addItem` on `product:42`. One definition yields many offers. APIs say `offers`, and the type is `CapabilityOffer`.

- **What it does not mean: permission.** An offer is advice from the runtime at one revision. Execution re-evaluates authorization and preconditions, as v0's handler already does on the agent path (`packages/core/src/handler.ts:168-196`; repo audit §5).
- **Why not `ActionOffer`.** Queries are offered too, so "action" would be wrong for a third of the kinds.
- **Why not bare `Offer`.** [Schema.org's `Offer`](https://schema.org/Offer) is a commercial offer of a product at a price, which is exactly the domain of the choice benchmark (Goals). The type name keeps the qualifier, and prose says "capability offer" whenever a price is nearby.
- **Prior art.** Schema.org's [`potentialAction`](https://schema.org/potentialAction) attaches "an idealized action in which this thing would play an 'object' role", which is a definition-level link. [`PotentialActionStatus`](https://schema.org/ActionStatusType) marks an action not yet started. Hydra notes that its operation descriptions are "merely a hint" and "may also vary at runtime" ([Hydra Core](https://www.hydra-cg.com/spec/latest/core/)). That is the stance we take on offers.

### 3.4 Availability, discoverability, relevance, salience, publisher preference

These five are kept apart because each can change an agent's choice independently of the others. Each is a separate term, computed by a different part of the system from different inputs.

| Term                     | Question it answers                                    | Decided by                                     | From                                                   |
| ------------------------ | ------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------ |
| **Availability**         | Can this offer be executed now, by this principal?     | the runtime, from conditions and requirements  | the definition, the principal, the state at a revision |
| **Discoverability**      | Can the agent reach this offer from where it is?       | the disclosure policy                          | the projection and the agent's path through it         |
| **Relevance**            | How closely does this offer relate to the stated task? | a relevance policy, which must name its inputs | the discovery context and relations                    |
| **Salience**             | How prominently is this offer presented?               | the presentation of a view                     | order, depth, detail, labels                           |
| **Publisher preference** | Does the application recommend this?                   | a claim (§2.8) with the publisher as source    | the publisher                                          |

**Availability** values:

- `available`;
- `unavailable`, with a reason;
- `needs-input`: it depends on input not yet given. v0 has no such value. Its graph runs the guard with `input: undefined` (`packages/core/src/handler.ts:109`), and the convention is to "return true for it unless the action is unavailable regardless" (`packages/core/src/action.ts:38`). So v0's `available: true` means "available for some input", and can't be told apart from `needs-input`;
- `needs-authorization`: a different principal could, as v0's "Requires a session" (`packages/core/src/handler.ts:107-108`);
- `unknown`: not evaluated, or an opaque condition that hasn't run.

What each term does **not** mean:

- **Availability** is not a promise. The state can change before execution (repo audit §8: the guard and `run` aren't atomic).
- **Discoverability** is not availability. An available offer can be outside the current view, and an unavailable one can be in it. Progressive disclosure changes discoverability only. It never changes what is available, and it never makes an available alternative unreachable: progressive disclosure is not hiding.
- **Relevance** is not a property of a capability. Without a stated task it is _undetermined_, not low. A relevance value always says what it was computed from.
- **Salience** is not relevance. Two offers can be equally relevant and presented differently. The order of definitions in a manifest is not salience either: it carries no meaning, because the IR's arrays are put in a canonical order (RFC 0001), not an order of preference. The choice benchmark varies exactly this, ordering and prominence with the options unchanged. So salience is recorded on the view, never stored as a fact in the manifest.
- **Publisher preference** is not relevance, quality or user benefit. It is a claim with the publisher as its source, and it stays attributed wherever it is shown. User benefit is not something the application can state about itself, except as another attributed claim.

## 4. Relations

**A relation** is a typed, directed edge between two definitions. Each one has a domain (what it starts from), a range (what it points to), and a meaning defined here.

**The rule for storing them:** a fact that belongs to one definition (its target, its preconditions, its effects) lives in that definition, not in a relation. Relations hold facts between definitions that neither owns. The runtime can still _derive_ more edges, and every derived edge says what it was derived from (§2.8, basis `inferred`). Not everything needs to be a graph node, and this rule gives every fact one place to live.

### 4.1 Kept

| Relation        | Domain → range                            | Meaning                                                                                                                                                                                  | Not                                                                                                                                                                                                              |
| --------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operatesOn`    | capability → resource definition          | The capability's target: the resource whose state it reads (query) or changes (action). At most one target per capability; a capability with none, such as a site-wide search, is global | Every resource the capability mentions. A resource referenced by an input (the product in `cart.addItem`) is a typed input, not a target                                                                         |
| `contains`      | resource definition → resource definition | Instances of the domain hold instances of the range as members: a cart contains line items, an organization contains repositories. Like Hydra's collection `member`                      | Lifecycle ownership (deleting the container need not delete the members) unless an effect says so. Not navigation                                                                                                |
| `alternativeTo` | capability ↔ capability                   | Either can serve the same goal in the same context, and choosing one generally excludes the other: "buy now" and "add to cart, then check out"                                           | A recommendation, an equivalence of cost or quality, or an ordering. **Always symmetric:** declaring A → B also makes A reachable from B. This keeps an alternative from being discoverable from only one side   |
| `enables`       | capability → capability                   | Some declared effect of the domain can make a declared precondition of the range true, or create a resource the range operates on                                                        | That B becomes available after A runs (other preconditions can still fail), that B needs A first, that B is the expected next step (salience or relevance), or that the publisher recommends doing them together |
| `relatedTo`     | definition → definition                   | An association with a prose description and no stronger meaning. It's the fallback, and the mapping for v0's `nav` (`packages/protocol/src/schema.ts:29-33`)                             | Any of the above. A tool may not infer dependency, alternative or containment from it                                                                                                                            |

**`alternativeTo` is not IANA's `alternate`.** The registered link relation `alternate` "Refers to a substitute for this context" ([IANA Link Relations](https://www.iana.org/assignments/link-relations/), from HTML). HTML and Atom read it as another representation of the same thing. An exported relation never uses `rel="alternate"` for an alternative capability.

**`enables` is derivable.** When both effect and precondition are declarative, the runtime derives the edge and marks it `inferred`. A declared `enables` with nothing to back it stays a claim of its source, so a reader can tell a checked link from an asserted one.

**Alternatives also exist between instances.** Subscribing to the Hobby, Pro or Business plan is one capability on three resources. Those offers are alternatives to each other without any `alternativeTo` edge between capabilities. Which IR construct groups them (a flag on the resource definition, or a choice set) is RFC 0001's decision. The term **choice set** is reserved for it: a set of offers the runtime presents as mutually exclusive answers to one goal.

### 4.2 Not kept as stored relations

| Candidate                            | Decision                                                            | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supports` (resource → capability)   | Derived, not stored                                                 | It is the inverse of `operatesOn`, plus "takes this resource as an input". Storing both directions invites them to disagree. It's Hydra's `supportedOperation` and Schema.org's `potentialAction`, which a projection can compute                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `produces` (capability → resource)   | An effect, not a relation                                           | Creating a resource is an effect of category `state` (§2.6). It belongs to the capability, and it keeps its reversibility and outcome with it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `requires` (capability → capability) | Not stored. "Requires" is kept only as the precondition link (§2.7) | A free-standing "A requires B" edge is exactly how a publisher would present an optional purchase as a prerequisite, a misleading dependency, which the choice benchmark tests as an adversarial condition. Stating necessity as a precondition, and the way to satisfy it as an effect, makes a prerequisite checkable. Either nothing backs it (no effect of B establishes any precondition of A), or it rests on a named precondition that the binding must enforce, and a test can call without it and expect the declared refusal. A false precondition can still be declared, but it is then a testable claim, not a free-floating edge. The runtime derives "prerequisite" edges from those, marked `inferred` |

## 5. Workflows are out of scope for the vocabulary

A relation graph is not a workflow. [OpenAPI Arazzo](https://spec.openapis.org/arazzo/latest.html) describes sequences of API calls with steps, success criteria and data passed between them. ALPS leaves workflow out on purpose (ALPS Appendix A.2). The vocabulary has no terms for steps, sequencing or control flow, so that the base IR doesn't become a workflow engine. `enables` and the derived prerequisite edges say what can lead to what, not what must happen next.

## 6. Mapping from v0's words

| v0                                            | New term                                                     | Note                                                                                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| action (`defineAction`)                       | capability definition, kind `query` or `action`              | `readOnly: true` actions such as `search` are queries                                                                                                                                                           |
| action name per route                         | a binding name                                               | not an identity (§2.9)                                                                                                                                                                                          |
| `description`                                 | the capability's description                                 | unchanged                                                                                                                                                                                                       |
| `requires` (sent as the descriptor's `guard`) | the prose of a precondition                                  | the wire's `guard` is this text (`packages/protocol/spec.md:60`, `packages/core/src/handler.ts:94`)                                                                                                             |     |
| `guard` (the function)                        | an opaque precondition                                       | unless it is rewritten declaratively                                                                                                                                                                            |
| `expose: 'public' \| 'session'`               | an authorization requirement                                 |                                                                                                                                                                                                                 |
| `expose: 'confirm'`                           | an authorization requirement plus a confirmation requirement |                                                                                                                                                                                                                 |
| `available`, `reason`                         | availability                                                 | `available: false` is `unavailable`. `available: true` is `available` or `needs-input`, which v0 doesn't distinguish (§3.4), so an importer records `unknown` or an `inferred` `available`, as RFC 0002 decides |
| `effects` (state keys)                        | the scope of observed change in a delta                      | not an effect (§2.6)                                                                                                                                                                                            |
| `changed`                                     | observed change                                              |                                                                                                                                                                                                                 |
| `actionsAdded`, `actionsRemoved`              | changes to offers between revisions, including availability  | `actionsAdded` holds any action whose descriptor changed (`packages/core/src/handler.ts:222-225`)                                                                                                               |     |
| `entities`                                    | resources, once they are typed                               |                                                                                                                                                                                                                 |
| `nav`                                         | `relatedTo`                                                  |                                                                                                                                                                                                                 |
| route manifest                                | not part of the IR                                           | the capability manifest replaces its role as a description                                                                                                                                                      |

## 7. Words we reserve and don't use yet

- **Affordance:** the project's name, prose only (§2.2).
- **Outcome** (§2.6) and **choice set** (§4.1): reserved for RFC 0001's decisions.
- **Policy:** always qualified, as a _disclosure_ policy or a _relevance_ policy. A bare "policy" would hide which of the §3.4 dimensions it changes.
- **Profile, domain, snapshot, and a bare "context":** avoided. "Profile" means different things in WoT, ALPS and OWL-S. "Domain" collides with web domains, and with PDDL. "Snapshot" belongs to UI SDK and XState. "Context" collides with React, XState and JSON-LD's `@context`, so it is always qualified, as a _discovery context_ (§3.1).
- **Recommended:** never a field or flag. A recommendation is a claim with the publisher as source (§3.4).

## 8. Naming input, and what is still open

**From the prior-art review's naming notes (§6.2), taken:**

- "guard" for the opaque condition (§2.7);
- three-valued conditions (§2.7);
- "hint" for imported behavioral annotations, and "consequential" as a derived flag (§2.4);
- the `alternate` and JWT-claims collisions (§4.1, §2.8);
- no exported `Action`, `Query`, `tool` or `act`, with per-kind type names (§2.3);
- three-valued behavioral properties, absent meaning no claim (§2.4);
- the words to avoid (§7);
- order carrying no meaning (§3.4);
- what the manifest is not (§2.1).

**Not taken:**

- **`ActionOffer`, or "opportunity", for the offer.** Queries are offered too, so `ActionOffer` names a third of the kinds wrongly. "Opportunity" reads well in prose but says nothing about what is offered. `CapabilityOffer` keeps the review's point, that a bare `Offer` collides with Schema.org's, while covering every kind.
- **`requires` and `produces` as stored relations** (review §6.6, item 6). They are kept as a precondition link and as an effect (§4.2). The review lists them as relations Affordances must define, and this document defines them, as derived edges, not stored ones.

**Still open.** These names may change without changing the meaning:

1. `basis` for the "how it is known" half of provenance.
2. `operatesOn`, or `target`: a field may read better than a relation for a capability's single target.
3. The `Definition` suffix on authored types, or a convention where authoring helpers (`defineCapability`) produce plain-named JSON.

## References

- W3C, [Web of Things (WoT) Thing Description 1.1](https://www.w3.org/TR/wot-thing-description11/), Recommendation, 5 December 2023.
- M. Amundsen, L. Richardson, M. Foster, [Application-Level Profile Semantics (ALPS)](https://datatracker.ietf.org/doc/html/draft-amundsen-richardson-foster-alps-07), Internet-Draft -07, 2021.
- D. Martin et al., [OWL-S: Semantic Markup for Web Services](https://www.w3.org/submissions/OWL-S/), W3C Member Submission, 22 November 2004.
- Hydra W3C Community Group, [Hydra Core Vocabulary](https://www.hydra-cg.com/spec/latest/core/), unofficial draft.
- Schema.org, [`potentialAction`](https://schema.org/potentialAction), [`ActionStatusType`](https://schema.org/ActionStatusType), [`Offer`](https://schema.org/Offer).
- Model Context Protocol, [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) and [Lifecycle](https://modelcontextprotocol.io/specification/2026-07-28/basic/lifecycle), revision 2026-07-28.
- IANA, [Link Relations](https://www.iana.org/assignments/link-relations/) registry.
- IETF, [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110), §9.2.1 and §9.2.2; [RFC 6906: The 'profile' Link Relation Type](https://www.rfc-editor.org/rfc/rfc6906).
- W3C, [PROV-O: The PROV Ontology](https://www.w3.org/TR/prov-o/), Recommendation, 2013.
- W3C, [Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/).
- OpenAPI Initiative, [Arazzo Specification](https://spec.openapis.org/arazzo/latest.html).
- H. Garcia-Molina, K. Salem, [Sagas](https://dl.acm.org/doi/10.1145/38713.38742), SIGMOD 1987.
- M. S. Miller, [Robust Composition: Towards a Unified Approach to Access Control and Concurrency Control](https://papers.agoric.com/assets/pdf/papers/robust-composition.pdf), PhD thesis, Johns Hopkins University, 2006.
