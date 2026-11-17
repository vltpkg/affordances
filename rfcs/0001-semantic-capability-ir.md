# RFC 0001: The semantic capability IR

- **Status:** draft
- **Package:** `@affordances/ir` (private until published)
- **Depends on:** [terminology](./research/terminology.md), [repo audit](./research/repo-audit.md), [prior art](./research/prior-art.md)

## Summary

This RFC defines a **capability manifest**: a portable, deterministic JSON document that describes what an application can do, independently of its pages, routes, transports and callers.

A manifest holds:

- resource definitions;
- capability definitions (queries, actions and events) with their inputs, outputs, preconditions, requirements and effects;
- relations between definitions;
- attributed claims about them;
- the provenance of every piece of semantic information.

It contains no executable code. It describes no particular caller and no particular resource instance.

The RFC fixes:

- the model and the reasons for each part of it;
- how identities stay stable across transports, and how definitions from several modules compose;
- versioning and a canonical serialization;
- five safety rules stated as rules of the IR, and the v0 boundaries it must not hide;
- the TypeScript types and the JSON Schema outline that `@affordances/ir` implements.

The projection runtime that turns a manifest into contextual offers is RFC 0002's subject. This RFC only constrains what that runtime can rely on.

## Motivation

Affordances v0 describes what a page exposes to an agent at one moment: the page's state, its actions with their availability, and links to other pages (repo audit §2). That works for operating one page. It doesn't give a model of the application from which other views can be derived. The audit lists the specific gaps (repo audit §4, §7):

- An action's identity is its route plus its name. The same operation is named differently on each transport (`packages/protocol/spec.md:55`, `packages/mcp/src/server.ts:45-46`, `packages/react/src/provider.tsx:95`).
- `effects` lists state keys used to build a delta, not consequences. A checkout that creates an order declares only `['cart']` (`apps/example/src/app/checkout/actions.ts:26-32`).
- Preconditions are prose, and guards are closures that no tool can inspect (`packages/core/src/action.ts:39-44`).
- Navigation is the only typed relation, and there are no resource types (`packages/protocol/src/schema.ts:29-33`, `:40`).
- The build artifact is a TypeScript module that imports the application's code (`packages/next/src/codegen.ts:109-131`).
- Nothing distinguishes availability from discoverability, or the publisher's preference from relevance or from the user's benefit.

The IR is the layer that fills those gaps. Three uses shape it:

1. **Tools read it without running the application:** validators, inspectors, exporters to MCP, WebMCP or OpenAPI, and a planner checking what can lead to what.
2. **A runtime projects it:** the same definitions, under different principals, states and disclosure policies, yield different offers (RFC 0002).
3. **Experiments vary disclosure with the options held fixed:** a choice benchmark needs the options defined once, outside any presentation.

## Goals

- **Portable:** independent of React, Next.js, MCP or any runtime. A manifest is plain JSON.
- **Deterministic:** the same definitions always serialize to the same bytes (§7).
- **Typed:** resources, capabilities, conditions, effects, relations and claims each have one shape, validated by one schema.
- **Composable:** fragments from several modules merge into one manifest, in any order, with the same result (§6).
- **Extensible:** other vocabularies can add fields without a new IR version (§7.4).
- **Inspectable:** conditions, effects and relations are data a tool can reason about, or are explicitly marked as opaque.
- **Non-executable:** no closures, no code, no expressions in a general-purpose language.
- **Context-independent:** no caller, session or resource instance appears in a manifest.
- **Honest about uncertainty:** what is unknown stays unknown, and inferred information never passes as declared (§8).

## Non-goals

- **A workflow language.** The IR says what can lead to what, never what must happen next (terminology §5). A chosen multi-step path can be exported to Arazzo.
- **RDF or OWL reasoning.** Identifiers are URI-compatible, so a JSON-LD context can be published later, but nothing requires one.
- **A planner.** Derived edges (§5.5) make simple reachability questions answerable. Planning stays with the agent.
- **A wire protocol.** Transports are bindings (§4.3). The v0 protocol is one of them.
- **Replacing v0.** v0 keeps working unchanged. An adapter maps between them (§10).

## 1. The model at a glance

```text
CapabilityManifest
├── namespace, schemaVersion, provenance (the default), sources
├── resources[]     ResourceDefinition: a type of domain entity, its key and attributes
├── capabilities[]  CapabilityDefinition: kind query | action | event
│     ├── target, references         what it acts on, what it takes as input
│     ├── input, output              JSON Schema 2020-12
│     ├── safe, idempotent           behavioral properties (tri-state)
│     ├── preconditions[]            Condition: declarative expression, or a guard
│     ├── authorization, confirmation  execution requirements
│     └── effects[]                  Effect: state | external | financial | access
├── relations[]     alternativeTo | enables | relatedTo
├── claims[]        Claim: an attributed statement about a definition
└── bindings[]      how a capability is invoked on one transport (optional)
```

Every definition can carry `provenance` and `extensions`.

## 2. Resources and capabilities (question 1: the minimal primitive)

**The question:** should everything be a capability, or should resources, actions, queries and events stay distinct?

**Decision:** two kinds of definition, resources and capabilities, with the capability's kind as a field (`query`, `action` or `event`). Conditions, effects and bindings are value objects nested in the capability they belong to. Relations are a separate list, only for facts that no single definition owns.

**Why two kinds of definition.**

- **A resource is not something you do.** It is what capabilities act on, and what contains other resources. A projection needs resource types to create resource instances, so it can offer `commerce.cart.addItem` on one cart and not another.
- **A resource type is also where conditions get their vocabulary.** A precondition on `target.status` is checked against the target resource's declared attributes (§3.2).

**Why the kind is a field, not three node types.**

- **They share almost everything.** Queries, actions and events have the same identity, provenance, schemas and bindings, and validation and traversal treat them alike.
- **What differs is small.** A query is safe and has no effects. An event has no input. These are validation rules on one shape (§2.2), not grounds for separate structures.

**Why conditions and effects are nested, not graph nodes.**

- **They belong to one capability.** A precondition or effect has no meaning apart from the capability it is part of, and is never shared.
- **Separate nodes would cost without paying.** Making them nodes would add identifiers, references that must resolve, and a way to share them that no use needs.
- **The edges that matter are derived.** Edges between an effect and a precondition (§5.5) are computed from the nested values, so tools still get them.

**Alternatives considered:**

| Alternative                                                                      | Rejected because                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Everything is a capability: resources become query capabilities that return them | It loses the thing capabilities act on. "Operates on", "contains" and the type of a resource instance would all have to be encoded as conventions on queries                                                                                          |
| A generic graph of typed nodes and edges, as in RDF                              | Validation becomes a matter of shapes over triples, and TypeScript can't infer anything useful. Making every condition and effect a node buys nothing, because they're never shared                                                                   |
| WoT's three kinds: property, action, event                                       | A WoT property is state on one Thing. In a domain model, state belongs to resources, so reading it is a query, changing it an action, and watching it an event (terminology §2.3)                                                                     |
| OWL-S's split into profile, process model and grounding                          | The split is right, and the IR keeps it: the capability is the profile and the process model's inputs, outputs, preconditions and effects, and the binding is the grounding. Composite processes (control flow) are left out, as workflow (Non-goals) |

### 2.1 ResourceDefinition

```ts
type ResourceDefinition = {
  id: Id // 'commerce.cart'
  title?: string
  description: string
  // the attribute that identifies an instance: a cart's `id`, a package's `name`
  key: string
  // the attributes a condition can read, as a JSON Schema object
  attributes?: JSONSchema
  // resource types whose instances are members of this one's
  contains?: Id[]
  // instances of this type are mutually exclusive choices (plans, tiers)
  alternatives?: true
  provenance?: Provenance
  extensions?: Extensions
}
```

- **`attributes`** is the vocabulary that declarative conditions read (§3.2). It describes data the application already has. It is not a storage schema.
- **`contains`** is the `contains` relation (terminology §4.1), stored on the container because the container owns the fact.
- **`alternatives: true`** says that offering one capability on different instances of this type gives the caller mutually exclusive choices. Hosting plans are the example: one `subscribe` capability, and three plans. A projection groups such offers into a **choice set**. This answers the question the terminology left open (terminology §4.1): the flag goes on the resource definition, because instances of the type are what get chosen.

### 2.2 CapabilityDefinition

```ts
type CapabilityDefinition = {
  id: Id // 'commerce.cart.addItem'
  kind: 'query' | 'action' | 'event'
  title?: string
  description: string
  target?: Id // the resource it reads or changes; absent for global ones like site search
  references?: Reference[] // other resources it takes as input
  input?: JSONSchema // absent: takes no input; events never have one
  output?: JSONSchema // for an event, its payload
  safe?: boolean
  idempotent?: boolean
  preconditions?: Condition[]
  authorization?: AuthorizationRequirement
  confirmation?: ConfirmationRequirement
  effects?: Effect[] // absent: unknown; []: declared to have none
  deprecated?: { replacedBy?: Id; reason?: string }
  provenance?: Provenance
  extensions?: Extensions
}

type Reference = {
  name: string // a condition reads its attributes as `<name>.<attribute>`
  resource: Id
  // where in the input the referenced instance's key is
  at: JSONPointer // '/productId'
}
```

**Validation rules on the kind:**

- **A `query`:** has no effects other than `[]`, and `safe` is `true` or absent. Absent is read as `true` for a query, because that's what a query means.
- **An `action`:** `safe` is not `true`. A safe action is a query.
- **An `event`:** has no `input`, no `preconditions`, no `confirmation` and no effects. It describes something the application emits. Subscribing is a binding concern.

**`target` and `references` are different things.**

- **The target** is the one resource whose state the capability reads (a query) or changes (an action): the `operatesOn` relation (terminology §4.1).
- **A reference** is a resource the capability takes as input without acting on it: the product in `commerce.cart.addItem`, whose target is the cart.
- **What a projection does with both:** it uses targets and references to offer a capability from either resource. That is the `supports` view, which the terminology keeps derived, not stored (terminology §4.2).

**Why `target`.** It reads well in paths (`target.count`), which is where developers write it most. It is not Schema.org's `target` (an entry point, a binding in our terms) or RFC 8288's link target, and it's not a DOM event's `target`. The relation it stores is `operatesOn` (terminology §4.1), and the field keeps the shorter name.

**Behavioral properties are tri-state** (terminology §2.4). `true` and `false` are claims by the definition's source, and absent means no claim. They never loosen enforcement (§8, rule 2).

## 3. Conditions (question 2)

**The question:** what can be expressed declaratively, and what must stay runtime-enforced?

**Decision:** a condition is either a **declarative expression**, in a small, closed, three-valued vocabulary, or a **guard**: a named check that only the runtime can evaluate, with a prose description. Every condition has an `id` and a `description`, so even a guard tells an agent what it checks.

```ts
type Condition = {
  id: string // unique within the capability
  description: string // 'The variant is in stock'
} & ({ expr: Expr } | { guard: true })
```

### 3.1 The expression vocabulary

```ts
type Expr =
  | { all: Expr[] } // and
  | { any: Expr[] } // or
  | { not: Expr }
  | { eq: [Operand, Operand] }
  | { ne: [Operand, Operand] }
  | { lt: [Operand, Operand] }
  | { le: [Operand, Operand] }
  | { gt: [Operand, Operand] }
  | { ge: [Operand, Operand] }
  | { in: [Operand, Operand] } // the left is a member of the right (an array)
  | { exists: Path }

type Operand = { path: Path } | { value: Scalar | Scalar[] }
type Scalar = string | number | boolean | null
// a root, then attribute names: 'target.status', 'input.quantity', 'principal.role', 'product.stock'
type Path = string
```

**Roots.** A path starts with one of these:

- `target`: the target resource's attributes;
- `input`: the input;
- `principal`: the principal's attributes, which RFC 0002 defines;
- a reference's `name` (§2.2).

Each path is checked at validation time. A `target` or reference path has to name an attribute declared in that resource's `attributes`, and an `input` path has to name a property in the input schema.

**Evaluation is three-valued.** It uses Kleene's strong three-valued logic, the same logic SQL uses for `NULL`:

- a path that can't be resolved at evaluation time is `unknown`;
- a comparison with an `unknown` operand is `unknown`;
- `all` is `false` if any argument is `false`, else `unknown` if any is `unknown`, else `true`; `any` is the dual;
- a guard that hasn't run is `unknown`.

So a projection can say `unknown` instead of guessing (terminology §3.4, availability).

**What is deliberately missing:**

- quantifiers over arrays ("some variant has stock");
- arithmetic;
- string functions;
- regular expressions;
- calls.

A check that needs them is a guard. That keeps every declarative condition checkable against a schema, and cheap to evaluate. It also keeps the honest default, that a condition no tool can analyze says so.

**Alternatives considered:**

| Alternative                                             | Rejected because                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serialize the guard function's source                   | Not portable, not analyzable, and it executes application code in whatever reads the manifest                                                                                                                                                                                                                         |
| [CEL](https://cel.dev/), the Common Expression Language | A full language with a string syntax and functions. Every reader would need a CEL implementation, and static reasoning over it is a project of its own. It is a reasonable future _guard_ language, but not the IR's                                                                                                  |
| [JSON Logic](https://jsonlogic.com/)                    | The closest existing shape, but its semantics are JavaScript truthiness, it has no `unknown`, and its operator set includes `map`, `reduce` and string operations. A subset with different semantics under the same name would mislead. Exporting the IR's vocabulary to JSON Logic is trivial if a consumer wants it |
| JSON Schema as a predicate over a context document      | It can't compare two values (input against stock), and it has no third value                                                                                                                                                                                                                                          |
| Only prose, as in v0's `requires`                       | Leaves every condition opaque, which is the gap this RFC exists to close                                                                                                                                                                                                                                              |

**Prior art for the shape:**

- XState references guards by name and composes them with `and`, `or` and `not` (prior art §3.3).
- SCXML's guidance that "Conditional expressions in conformant SCXML documents SHOULD NOT have side effects" (prior art §3.2) holds by construction here, since the vocabulary has no calls.
- PDDL's preconditions are the semantics we follow, minus its closed-world assumption (prior art §6.4).

### 3.2 Preconditions and the two execution requirements

v0 mixes three things in its guard and its `expose` field (terminology §2.7). The IR keeps them apart, because each fails differently:

|                           | Field                                       | Fails as                                                    | v0 equivalent                   |
| ------------------------- | ------------------------------------------- | ----------------------------------------------------------- | ------------------------------- |
| Precondition              | `preconditions: Condition[]`, all must hold | unavailable, with the condition's description as the reason | `requires`, `guard`             |
| Authorization requirement | `authorization`                             | needs authorization                                         | `expose: 'public' \| 'session'` |
| Confirmation requirement  | `confirmation`                              | needs a person's approval first                             | `expose: 'confirm'`             |

```ts
type AuthorizationRequirement = {
  principal: 'any' | 'authenticated'
  // further conditions on the principal: a role, membership of the target organization
  conditions?: Condition[]
}

type ConfirmationRequirement = {
  // what the person approves: prose, with {path} placeholders the runtime fills in from the call
  summary: string
}
```

**Presence means required.** `confirmation` has no `required` field, because it has no other value to take.

**The summary template.** A summary is prose with placeholders in the condition vocabulary's path syntax (§3.1), for example `"Place an order for {target.count} items, and pay its total"`.

- **What a placeholder can name:** a `target`, `input` or reference path. `validate` checks each one as it checks condition paths (`E_PATH`).
- **How it is rendered:** the runtime puts in each value's JSON text, and an unresolved path as `unknown`. There are no formatting functions.
- **Literal braces** are written `{{` and `}}`.
- **Why data, not a function.** The person approving sees this text, so it is the one sentence that mustn't depend on each runtime's guess, or on application code a reader can't inspect. v0's `summary` function (`packages/core/src/action.ts:45-48`) stays possible in v0's own `defineAction`. The IR's summary is the inspectable version.

- **An absent `authorization` means no requirement was declared.** It doesn't mean "anyone". RFC 0002 decides the runtime default, and v0's own default is deny (`packages/protocol/spec.md:153`).
- **There is no way to write "confirmation not required".** An absent `confirmation` declares nothing, and a present one adds a requirement (§8, rule 2).

## 4. Effects (question 3)

**The question:** how do we tell state changes, domain consequences, external side effects and observed outcomes apart?

**Decision:** an effect is a nested value on its capability. It has one of four categories and a reversibility, and a state effect can say declaratively what it establishes. Observed outcomes are not part of the IR at all: they are runtime records (RFC 0002), compared against declared effects.

```ts
type Effect = {
  description: string
  reversibility?: 'reversible' | 'compensable' | 'irreversible' // absent: unknown
  compensatedBy?: Id // the capability that undoes it, when compensable
} & (
  | {
      category: 'state'
      change: 'create' | 'update' | 'delete'
      resource: Id
      // what holds after success, in the expression vocabulary: { eq: [{ path: 'target.status' }, { value: 'paid' }] }
      establishes?: Expr
    }
  | { category: 'external' | 'financial' | 'access' }
)
```

**Four categories, not one free-text field.** These are the consequences an agent acting for a person has to tell apart before it commits:

- did it change the application's data (`state`);
- did it reach outside (`external`: an email, a third-party call);
- did it spend money or create an obligation (`financial`);
- did it change who can see or do what (`access`).

One action can have several effects: checkout creates an order (`state`), charges a card (`financial`) and sends a receipt (`external`).

**Unknown is not "none".** An absent `effects` means nobody said. `[]` means the source declares there are none. An importer that can't tell leaves `effects` absent, and an exporter treats absent as consequential (terminology §2.4).

**`establishes` links effects to preconditions.** It is what lets a runtime derive `enables` (§5.5): A enables B when an expression A establishes can make one of B's preconditions true. Without it, `enables` can only be declared, as a claim.

**One outcome per capability.** The effects listed are those of a successful execution. A failed execution has no declared effects. OWL-S's conditional results (`inCondition` with `withOutput` and `hasEffect`) would let one capability declare different effects under different conditions. That would need conditions over the state _after_ execution, which this vocabulary doesn't have. The name **outcome** is reserved for it (terminology §2.6), and a future version can add `outcomes` without changing `effects`.

**Alternatives considered:**

| Alternative                                | Rejected because                                                                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0's model: a list of state keys           | It describes what to send back in a delta, not what happens. Keys are page state, not consequences (repo audit §4, limitation 2)                                |
| Effects as graph nodes                     | Never shared between capabilities, so nodes only add identifiers. Derived edges give the graph view (§5.5)                                                      |
| A free-text `consequences` field           | No tool could tell a refund from a page view. The categories are the minimum an approval step needs                                                             |
| PDDL's add and delete lists of facts       | They assume a closed world of named facts. `establishes` takes the useful part, the post-state predicate, and expresses it over the resource's attributes       |
| Recording observed effects in the manifest | A manifest is context-independent. What was observed belongs to one execution, so it lives in runtime records, where it can be compared against the declaration |

## 5. Relations

A relation is a typed, directed edge between definitions (terminology §4). The storage rule: **a relation that one definition owns is a field of that definition. The `relations` list holds only edges that neither definition owns.**

| Relation        | Stored as                                    | Owner                   |
| --------------- | -------------------------------------------- | ----------------------- |
| `operatesOn`    | `CapabilityDefinition.target`                | the capability          |
| `contains`      | `ResourceDefinition.contains`                | the container           |
| `alternativeTo` | `relations[]`                                | neither: it's symmetric |
| `enables`       | derived (§5.5), or declared in `relations[]` | neither                 |
| `relatedTo`     | `relations[]`                                | neither                 |

```ts
type Relation = {
  type: 'alternativeTo' | 'enables' | 'relatedTo'
  from: Ref
  to: Ref
  description?: string // required for relatedTo
  provenance?: Provenance
  extensions?: Extensions
}
```

### 5.1 `alternativeTo`

- **Domain and range:** capability ↔ capability.
- **Semantics:** as defined in terminology §4.1.
- **It's symmetric.** A manifest stores each pair once, and the canonical form puts the lesser `Ref` in `from` (§7.2). A reader must treat the edge as running both ways. So "this alternative is reachable from that one" doesn't depend on which side the publisher wrote it on.

### 5.2 `enables`

- **Domain and range:** capability → capability.
- **Semantics:** as defined in terminology §4.1.
- **A declared `enables` is a statement by its source.** A runtime can check it against the derived edges (§5.5): a declared edge with no derived counterpart is shown as unconfirmed.

### 5.3 `relatedTo`

- **Domain and range:** any definition → any definition.
- **Semantics:** an association, explained by its `description`, with no other meaning. It is the import target for v0's `nav`.

### 5.4 Cross-manifest references

`from` and `to` can name a definition in another manifest by its canonical URI (§6.1). That is the only place a manifest refers outside itself. A validator checks local references and leaves remote ones as they are.

### 5.5 Derived edges

A reader can compute these, and a projection does. They are never stored:

- **`supports`** (resource → capability): from `target` and `references`.
- **`produces`** (capability → resource): from a `state` effect with `change: 'create'`.
- **`enables`** (capability → capability): from `establishes` against `preconditions`, when both are declarative.
- **`prerequisite`** (capability → capability): B is a prerequisite of A when one of A's preconditions can only become true through an effect of B.

Every derived edge records what it was derived from, and has basis `inferred` (§8).

**Why prerequisites aren't stored.** A stored "A requires B" is exactly how an optional purchase can be presented as necessary. Deriving necessity from conditions and effects doesn't stop a publisher from declaring a false precondition, and the derived edge would faithfully show it. What it changes is that the claim becomes checkable:

- **Unbacked:** a prerequisite with nothing behind it is visible as such, because no effect of B establishes anything A needs.
- **Backed:** a prerequisite that does rest on something rests on a named precondition, which rule 5 (§8.2) requires the binding to enforce. A conformance test can call A without it and must get the declared refusal.

A misleading dependency is then either visibly unbacked, or a precondition the application fails to enforce, which conformance catches (terminology §4.2).

## 6. Identity and composition (question 4)

**The question:** how is a capability's identity preserved when it is exposed through several routes or transports?

**Decision:**

- A definition's identity is a dotted identifier, unique within its manifest's namespace. Its global form is the namespace URI with the identifier as the fragment.
- Routes, tool names and component IDs are bindings, never identities.
- An identifier, once published, is never reused for a different meaning.

### 6.1 Identifiers

```ts
// segments of letters and digits, starting with a lowercase letter, joined by dots: 'commerce.cart.addItem'
type Id = string // /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/, at most 128 characters
// a local Id, or a canonical URI for a definition in another manifest
type Ref = string
```

- **The canonical URI** is `<namespace>#<id>`, for example `https://store.example/capabilities#commerce.cart.addItem`. The model is ALPS, where the URI of a descriptor, fragment included, is its "abstract semantic type" (ALPS §2.2.9.2). The namespace is an absolute URI that the publisher controls.
- **Resources and capabilities share one identifier space within a manifest.** So `commerce.cart` (a resource) and `commerce.cart.addItem` (a capability) can't be confused.
- **The identifier syntax is a subset of the tool-name rule MCP and WebMCP use** (1-128 characters of `[A-Za-z0-9_.-]`; [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)). So a capability exports as a tool of the same name, unchanged.
- **Identity is authored, never derived** from a file path, a route or a build. Next.js Server Action IDs, for example, are "periodically recalculated between builds" (prior art §4.5). A compiler emits only identifiers that are written in source.

### 6.2 Stability across releases

- An identifier keeps its meaning for as long as the namespace exists.
- To rename, add the new definition and mark the old one `deprecated: { replacedBy }`. Readers show the old identifier as an alias.
- To retire a capability, keep the deprecated definition until no binding uses it.
- A validator comparing two manifests of the same namespace reports any identifier whose kind changed, or that disappeared without having been deprecated.

### 6.3 Bindings

```ts
type Binding = {
  capability: Id
  // which transport: 'affordances/v0', 'mcp', 'http', 'webmcp', 'ui', or a URI
  protocol: string
  // the transport's own address for it, in that protocol's terms
  address: Record<string, string>
  extensions?: Extensions
}
```

Some examples:

```json
{ "capability": "commerce.cart.addItem", "protocol": "affordances/v0", "address": { "route": "/products/[slug]", "action": "addToCart" } }
{ "capability": "commerce.cart.addItem", "protocol": "mcp", "address": { "tool": "commerce.cart.addItem" } }
```

- **A binding is a description, not a handler.** The code that executes a capability is registered with a runtime (RFC 0002), keyed by the capability's identifier. That keeps a manifest non-executable while still letting a v0 adapter, or an inspector, know where each capability is reachable.
- **Bindings are optional.** A manifest without them is complete as a description.
- **One capability can have any number of bindings.** Its identity is the same in all of them, and every v0 route that serves it is one binding.

### 6.4 Composition

A Next.js application defines capabilities in many modules, and an importer may add more from an OpenAPI document. Each produces a **fragment**: a manifest with the same namespace. `compose` merges fragments into one manifest:

1. **Definitions are united by identifier.** Two definitions with the same identifier must be equal in canonical form (§7.2). If they differ, it is an error (`E_CONFLICT`), never a silent override.
2. **Sources are united by identifier,** under the same rule.
3. **Relations and claims are united.** Duplicates (equal in canonical form) collapse. Claims from different sources never merge, even when they disagree, because disagreement is information.
4. **Bindings are united.** Two bindings that give the same capability the same protocol and address collapse.
5. **The default provenance must be equal across fragments,** or each fragment's definitions must carry their own (§8).

Composition is commutative, associative and idempotent, so the build order of modules can't change the result. The canonical form (§7.2) makes that checkable: `canonical(compose(a, b)) === canonical(compose(b, a))`.

**Why not overrides.** OpenAPI Overlays let a later document change an earlier one, and the result is a merged document in which "who said what is lost" (prior art §4.6). A third party adds claims (§9), never edits a definition.

## 7. Versioning and determinism

### 7.1 Two versions

- **`schemaVersion`** is the version of the IR format, `"0.1"` for this RFC. It follows semantic versioning:
  - a change of major version may break readers;
  - a minor version only adds optional fields;
  - while the major is `0`, a minor may also break, because the package is private.
- **A manifest's revision** is the SHA-256 digest of its canonical form (§7.2), written `sha256-<base64url>`. It isn't stored in the manifest, since it is a function of it. A runtime uses it to tell whether a projection was derived from the definitions a caller holds (terminology §3.2).

### 7.2 Canonical form

The canonical form is what composition compares, what the revision digests, and what a compiler must produce byte-for-byte on the same inputs.

1. **Serialization:** the JSON Canonicalization Scheme, [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785). Object members are sorted by UTF-16 code units, numbers have ECMAScript's shortest form, and strings use minimal escaping.
2. **Arrays that are sets are sorted:**
   - definitions by `id`, sources by `id`;
   - relations by `type`, `from`, `to`;
   - claims by `id`;
   - bindings by `capability`, then `protocol`, then the canonical bytes of `address`;
   - `contains` lexicographically;
   - preconditions and conditions by `id`;
   - effects by the canonical bytes of each effect;
   - `all` and `any` arguments by their canonical bytes.
3. **Symmetric relations** put the lesser of `from` and `to` first.
4. **Defaults are removed:**
   - a field equal to the value it would inherit (provenance equal to the manifest default) is dropped;
   - an empty optional array is dropped, _except_ `effects: []`, which says something different from an absent `effects`.
5. **JSON Schemas embedded as `input`, `output` and `attributes`** are canonicalized by RFC 8785 only. Their arrays keep their order, because in JSON Schema some array orders carry meaning (`prefixItems`) and an IR can't know which. A `$schema` keyword is dropped, since every embedded schema is JSON Schema 2020-12. v0 already drops it (`packages/core/src/action.ts:108`).
6. **Nothing that varies between builds may appear:** no timestamps, no absolute paths, no build identifiers.

**No array in the IR is ordered by meaning.** Order in a manifest never expresses preference, priority or salience. SCXML's rule that the "first one in document order will be taken" (prior art §3.2) is the failure this avoids. Salience is a property of a projection's presentation, decided by a disclosure policy (RFC 0002), and so it can be varied without touching the definitions.

### 7.3 Normalization and validation

`@affordances/ir` exposes `normalize(manifest)` (to the canonical form, as an object) and `validate(manifest)`.

`validate` reports errors with stable codes:

| Code                  | Meaning                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `E_SCHEMA`            | the document doesn't match the IR schema                                                              |
| `E_DUPLICATE_ID`      | two definitions share an identifier                                                                   |
| `E_UNRESOLVED`        | a local reference (target, reference, contains, relation, claim subject, binding) names no definition |
| `E_KIND`              | a kind rule is broken (a query with effects, a safe action, an event with input)                      |
| `E_PATH`              | a condition or summary path doesn't name a declared attribute or input property                       |
| `E_KEY`               | a resource's `key` isn't one of its declared `attributes` (when it declares any)                      |
| `E_ENFORCEMENT_CLAIM` | a claim targets an enforcement field (§8, rule 2)                                                     |
| `E_BASIS`             | a provenance basis without what it requires (§8, rule 3)                                              |
| `E_SOURCE`            | provenance names a source that isn't declared                                                         |
| `E_CONFLICT`          | composition found two different definitions with one identifier                                       |

Warnings, which don't fail validation:

- `W_OPAQUE`: a capability whose preconditions are all guards;
- `W_EFFECTS_UNKNOWN`: an action whose `effects` is absent;
- `W_UNCONFIRMED_ENABLES`: a declared `enables` with no derived counterpart.
- `W_NO_ID` (from the v0 adapter, §10.1): a v0 action without an identifier, with a suggested one.

### 7.4 Extensions

Every definition, relation, claim, binding and the manifest itself can carry `extensions`: an object whose keys are absolute URIs, each owned by the vocabulary it names.

- **Readers ignore extensions they don't understand,** as ALPS readers do with `ext` (ALPS §2.2.6).
- **An extension can't change the meaning of a core field.** In particular, it can't loosen enforcement (§8).
- **Extensions take part in the canonical form,** so they are deterministic, but `validate` doesn't interpret them.

## 8. Provenance and the safety rules

### 8.1 Provenance

```ts
type Provenance = {
  source: string // a Source id
  basis: 'declared' | 'inferred' | 'imported' | 'observed' | 'verified'
  evidence?: Evidence[]
}

type Source = {
  id: string
  role: 'owner' | 'tool' | 'third-party'
  name: string // 'Example Store', '@affordances/next compiler 0.6.0', 'Example Audits'
  href?: string
}

type Evidence = { description: string; href?: string; digest?: string }
```

**Where provenance attaches.** A manifest has a default `provenance`, which is required. Each definition, relation and claim can override it. A definition can also give provenance for single fields in `fieldProvenance`, keyed by JSON Pointer ([RFC 6901](https://www.rfc-editor.org/rfc/rfc6901)) into the definition.

So a compiler that infers a capability's schema but finds its description written by the developer can say exactly that:

```json
{
  "provenance": { "source": "compiler", "basis": "inferred" },
  "fieldProvenance": { "/description": { "source": "store", "basis": "declared" } }
}
```

**Why both levels.** Provenance on whole definitions alone can't say that a compiler inferred the schema and a developer wrote the description. Per-field alone would repeat the same record on every field. Claims (§9) always carry their own provenance, because they are statements by a party, not parts of a definition.

**Source roles:**

- **`owner`:** the party that operates the application. It both develops the definitions and publishes them.
- **`tool`:** a compiler, an importer or a runtime.
- **`third-party`:** anyone else, such as a verifier or a reviewer.

### 8.2 The rules

These five rules are part of the IR. `validate` enforces the parts that a document can show, and RFC 0002's runtime enforces the rest. Each has tests (§12).

**Rule 1: an offer is never authorization.**

- No field of the IR, and no claim, is an input to an authorization decision except `authorization` itself. That field can only _require_ something of a principal, never grant anything.
- A projection derived from a manifest is advice, and every execution re-evaluates `authorization` and `preconditions` against current state. v0's handler already does this on its agent path (`packages/core/src/handler.ts:168-196`; repo audit §5).
- The IR has no field that means "pre-authorized", "trusted caller" or "skip checks".

**Rule 2: an annotation never makes an operation safe, or removes a confirmation.**

- **The enforcement fields:** `safe`, `idempotent`, `authorization`, `confirmation`, `effects` and `preconditions`. Enforcement reads them _monotonically_: they can add a check, never remove one.
  - **`confirmation`** can only be required. It is present or absent, and has no "not required" value.
  - **`safe: true` and `effects: []`** may make a client _present_ a capability as read-only. They may not lift a confirmation required by `confirmation`, by a host's policy, or by a client's own rules.
  - **An absent value** is read as the cautious one: not safe, not idempotent, effects unknown, so consequential (terminology §2.4).
- **A claim (§9) can't target an enforcement field.** A claim whose `about` points into one is `E_ENFORCEMENT_CLAIM`. A publisher can _say_ a plan is low-risk in a claim, but that statement can't change what is enforced.
- **Imported hints stay claims.** An importer records MCP's `readOnlyHint` as a claim with basis `imported`, never as `safe`. MCP itself requires clients to treat annotations as untrusted unless they come from trusted servers ([MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).

**Rule 3: inferred semantics never become declared or verified without a source that justifies it.**

- **The provenance rules,** checked by `validate` (`E_BASIS`):
  - `declared` requires a source with role `owner`;
  - `inferred` requires a `tool`;
  - `imported` requires a `tool` and evidence naming what was imported;
  - `verified` requires a `third-party` source and at least one evidence entry;
  - `observed` requires a `tool`, a runtime, and evidence.
- **No operation of `@affordances/ir` changes a basis.** That covers `normalize`, `compose` and any import. Changing one is an authoring act: an owner restates the value, or a verifier adds a claim with evidence.
- **Composition keeps each fragment's provenance as it is.** Two equal definitions with different provenance are a conflict, not a merge, because merging would pick one source's word over another's.

**Rule 4: no unexplained confidence numbers.**

- The IR has no confidence, trust or score field.
- A number in a claim must be a `quantity` with a `unit` (§9), so it means a measured or estimated amount ("20 USD per month", "99.9 percent monthly uptime"), never a degree of belief.

**Rule 5: every declared precondition and requirement is enforced.**

- A binding that serves a capability refuses an execution whose declarative preconditions evaluate to `false` or `unknown`, or whose authorization or confirmation requirement isn't met. It answers with the declared condition's `id` and `description`, and may add a runtime `detail`: the specific reason, such as the `` `Only ${left} left of ${what}` `` that the example store's guard returns (`apps/example/src/app/products/[slug]/actions.ts:27-32`). The `id` and `description` are the stable, inspectable part. The `detail` is never in the manifest, and RFC 0002 defines its shape.
- A guard is enforced by the handler registered for it. An execution whose guard can't be evaluated is refused, not allowed: `unknown` doesn't pass.
- **It is a conformance property, testable from outside.** For each declarative precondition, a test puts the target in a state where it's false, calls the capability, and must get that refusal. A manifest whose preconditions the application doesn't enforce fails conformance. A misleading dependency (§5.5) is caught this way, and the choice benchmark's misleading-dependency fixture is, by construction, a manifest that fails it.

### 8.3 v0 boundaries the IR must not paper over

The audit found three properties of v0 that are reasonable in v0's own terms, but would be dangerous to restate more strongly than they are (repo audit §8). The IR, and any runtime built on it, describes them as they are:

1. **Confirmation is a flag the client sets.**
   - **In v0:** the server enforces that `confirm: true` is present (`packages/core/src/handler.ts:199`). It can't know whether a person saw the summary; that rests on the client (`packages/protocol/spec.md:155`).
   - **For the IR:** `confirmation` says approval is _required_. Nothing in the IR or a projection may claim that approval _was given_. Whether a runtime can bind an approval to a summary, with a token for example, is RFC 0002's question, and until it does, docs and exports say "the caller asserts approval".
2. **The guard and the execution aren't atomic.**
   - **In v0:** state can change between the guard check (`packages/core/src/handler.ts:193-196`) and `run` (`:210`).
   - **For the IR:** availability is an evaluation at one revision, not a promise. Rule 5 requires a precondition to be checked at execution, not that it still holds while the execution runs. Anything that must hold throughout is the handler's job, as v0's docs already tell authors (`apps/docs/content/concepts/guards.mdx:48`). RFC 0002's tests cover state that changes between projection and execution.
3. **v0's UI path doesn't evaluate guards or `expose`, by design.**
   - **In v0:** a server action called from the application's own components validates its input and runs (`packages/core/src/action.ts:156-161`; documented at `apps/docs/content/guides/security.mdx:41`).
   - **For the IR:** rules 1 and 5 apply to every binding listed in a manifest. A UI binding (protocol `ui`) is only listed if it enforces them. v0's UI path is therefore not a binding in an imported manifest: the v0 adapter (§10) emits only `affordances/v0` bindings, for the agent path, where the handler enforces everything.

## 9. Claims

```ts
type Claim = {
  id: string
  subject: Ref // the definition it is about
  about?: JSONPointer // a field of the subject, when it's about one; never an enforcement field
  kind: 'recommendation' | 'benefit' | 'estimate' | 'assessment'
  statement: string // 'Includes automatic rollback'
  quantity?: { value: number; unit: string } // for estimates and measurable assessments
  applies?: Expr // the condition under which it holds, in the expression vocabulary
  provenance: Provenance // required: a claim is nothing without its source
  extensions?: Extensions
}
```

**The kinds:**

| Kind             | Meaning                                                                                                          | Example                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `recommendation` | The source prefers this choice. This is **publisher preference** when the source is the owner (terminology §3.4) | "Recommended for production projects"            |
| `benefit`        | The source says the subject gives this advantage                                                                 | "Includes automatic rollback"                    |
| `estimate`       | An expected amount, with a unit                                                                                  | 20 USD per month; about 2 minutes                |
| `assessment`     | A judgment of a property, such as reliability or quality                                                         | "99.9% monthly uptime", by a third-party monitor |

**A recommendation is structurally separate from everything else.** It is always a claim, never a field of the definition. It always carries its source, and its kind says it is a preference. A reader can therefore show "the store recommends this" next to "an independent monitor measured that", and an agent can weigh them differently. Whether agents do is something the choice benchmark measures (prior art §6.7, assumption 4).

**Claims never merge into definitions,** and claims from different sources about the same subject all stay. Disagreement is data.

**Third-party claims are composed in, not edited in.** A verifier publishes a fragment that holds only its source and its claims, and composition adds them (§6.4).

## 10. How v0 maps in

This section shows that the IR isn't v0 renamed. Most of what it holds has no v0 counterpart. The adapter that M7 builds maps in both directions.

### 10.1 From v0 to the IR

| v0                        | IR                                                                                           | Provenance of the result                                        |
| ------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `defineAction`            | `CapabilityDefinition`, kind `action`, or `query` when `readOnly: true`                      | the id must be declared (§6.1, below); everything else as below |
| route plus `name`         | a `Binding`, protocol `affordances/v0`, address `{ route, action }`                          | `inferred`                                                      |
| `description`             | `description`                                                                                | `declared`                                                      |
| `input` (Standard Schema) | `input` (JSON Schema)                                                                        | `inferred`, by conversion                                       |
| `output`                  | `output`                                                                                     | `inferred`                                                      |
| `readOnly: true`          | kind `query`                                                                                 | `declared`                                                      |
| `requires` and `guard`    | one `Condition`, id `guard`, with `guard: true` and `requires` as its description            | `declared`                                                      |
| `expose: 'public'`        | `authorization: { principal: 'any' }`                                                        | `declared`                                                      |
| `expose: 'session'`       | `authorization: { principal: 'authenticated' }`                                              | `declared`                                                      |
| `expose: 'confirm'`       | `authorization: { principal: 'authenticated' }` plus `confirmation: { summary }`             | `declared`                                                      |
| `summary` (a function)    | `confirmation.summary`, a prose template the developer writes                                | `declared`, if written; otherwise a generic summary, `inferred` |
| `effects` (state keys)    | **not an effect.** It stays a binding detail, the keys the v0 delta reports, in `extensions` | —                                                               |
| `defineState`'s entities  | no counterpart until the developer declares resource types                                   | —                                                               |
| `nav`                     | `relatedTo` relations, only where both ends are known definitions                            | `inferred`                                                      |

**Identifiers on import.** A v0 action has only a route-local `name`, and identity is never derived (§6.1). So without help, importing an existing application gives no capabilities at all. The adapter therefore:

- reports each action without an identifier as `W_NO_ID` (an error in strict mode), with a **suggested** identifier: the route's static segments and the action's name, such as `products.addToCart`;
- never emits a suggestion as an identifier. Only identifiers written in source reach a manifest;
- is paired with a CLI codemod that writes the suggestions into source as `id: '…'` on `defineAction`, for the developer to review and rename.

The compiler reads that `id` statically, as a literal, the way codegen already reads `name` (`packages/next/src/codegen.ts:62-63`). `id` on `defineAction` is the migration form. New code declares capabilities with `defineCapability` (§12.1). The imported guard's condition id is `guard`, so refusals and conformance tests can name it.

**An adapter can't invent what v0 doesn't say.** A v0 import gives capabilities with opaque guards, unknown effects, no resources and no relations. That's an accurate description of what v0 declares, and every `W_EFFECTS_UNKNOWN` and `W_OPAQUE` warning marks something the developer can add.

**v0's own behavior is unchanged.** Its packages, wire format and tests stay as they are, and nothing in v0 reads the IR until M7's adapter does.

### 10.2 What v0 can't express

These are the IR's own contributions. A v0 graph can't carry any of them:

- resource types;
- identities across routes;
- declarative conditions;
- effect categories and reversibility;
- derived `enables` and prerequisite edges;
- symmetric alternatives and choice sets;
- attributed claims;
- per-field provenance;
- a canonical, digestible artifact.

### 10.3 From the IR to v0

An IR capability with an `affordances/v0` binding is served by v0 exactly as today. The adapter emits the v0 descriptor from the definition:

- `expose` from `authorization` and `confirmation`;
- `guard` from the preconditions' descriptions;
- `readOnly` from the kind.

Where the IR is richer, the descriptor shows only what v0's fields allow. Nothing in v0's wire format changes in this RFC. A protocol evolution is RFC 0004's subject.

## 11. Example

A small store, in canonical form except for line breaks.

```json
{
  "capabilities": [
    {
      "authorization": { "principal": "authenticated" },
      "confirmation": { "summary": "Place an order for {target.count} items, and pay its total" },
      "description": "Place an order for everything in the cart. Reserves the stock and empties the cart.",
      "effects": [
        {
          "category": "financial",
          "description": "Charges the cart's total to the saved payment method",
          "reversibility": "compensable",
          "compensatedBy": "commerce.order.refund"
        },
        {
          "category": "state",
          "change": "create",
          "description": "Creates an order",
          "resource": "commerce.order"
        },
        {
          "category": "state",
          "change": "update",
          "description": "Empties the cart",
          "establishes": { "eq": [{ "path": "target.count" }, { "value": 0 }] },
          "resource": "commerce.cart",
          "reversibility": "irreversible"
        }
      ],
      "id": "commerce.cart.checkout",
      "input": { "type": "object", "additionalProperties": false },
      "kind": "action",
      "preconditions": [
        {
          "description": "The cart has items",
          "expr": { "gt": [{ "path": "target.count" }, { "value": 0 }] },
          "id": "notEmpty"
        },
        { "description": "Every item is in stock", "guard": true, "id": "inStock" }
      ],
      "target": "commerce.cart"
    },
    {
      "authorization": { "principal": "any" },
      "description": "Add a variant of a product to the cart, by SKU",
      "effects": [
        {
          "category": "state",
          "change": "update",
          "description": "Adds the item to the cart",
          "establishes": { "gt": [{ "path": "target.count" }, { "value": 0 }] },
          "resource": "commerce.cart",
          "reversibility": "reversible"
        }
      ],
      "id": "commerce.cart.addItem",
      "input": {
        "properties": {
          "productId": { "type": "string" },
          "quantity": { "maximum": 10, "minimum": 1, "type": "integer" },
          "sku": { "type": "string" }
        },
        "required": ["productId", "sku"],
        "type": "object"
      },
      "kind": "action",
      "preconditions": [
        { "description": "The variant is in stock", "guard": true, "id": "inStock" }
      ],
      "references": [{ "at": "/productId", "name": "product", "resource": "commerce.product" }],
      "target": "commerce.cart"
    }
  ],
  "namespace": "https://store.example/capabilities",
  "provenance": { "basis": "declared", "source": "store" },
  "resources": [
    {
      "attributes": { "properties": { "count": { "type": "integer" } }, "type": "object" },
      "contains": ["commerce.product"],
      "description": "A shopper's cart",
      "id": "commerce.cart",
      "key": "id"
    },
    { "description": "A placed order", "id": "commerce.order", "key": "id" },
    { "description": "A product with variants", "id": "commerce.product", "key": "slug" }
  ],
  "schemaVersion": "0.1",
  "sources": [{ "id": "store", "name": "Example Store", "role": "owner" }]
}
```

What a reader can do with it, without running the store:

- **Derive edges:** `commerce.cart.addItem` _enables_ `commerce.cart.checkout`, because adding establishes `target.count > 0`, which is checkout's `notEmpty` precondition. The edge is marked `inferred`, from that pair.
- **Check a prerequisite:** checkout's only derived prerequisite is an action that fills the cart. A claim that "checkout requires extended protection" would either have nothing to back it, or need a declared precondition (say, `target.protected`) that the store then has to enforce: a conformance test calling checkout on an unprotected cart must get the declared refusal (§8.2, rule 5).
- **Treat checkout as consequential:** it has a `financial` effect and an `irreversible` one, and its confirmation is required regardless of any claim.
- **Know where the truth stops:** the stock check is a guard, so its availability is `unknown` until a runtime evaluates it.
- **Map it to v0:** the stock check is v0's `requires: 'The variant is in stock'` (`apps/example/src/app/products/[slug]/actions.ts:20`). Checkout's consequences are the ones v0's `effects: ['cart']` couldn't state (`apps/example/src/app/checkout/actions.ts:26-32`).

A publisher recommendation is a separate claim, which an agent sees with its source attached:

```json
{
  "id": "proRecommended",
  "kind": "recommendation",
  "provenance": { "basis": "declared", "source": "host" },
  "statement": "Recommended for production projects",
  "subject": "hosting.plan.pro"
}
```

## 12. Authoring, and the package `@affordances/ir` (M2)

### 12.1 How a manifest is authored

Nobody writes §11's JSON by hand. The IR's types are chosen so that a typed authoring surface can produce it. M2 builds the data half; M6 builds the Next.js half.

- **Capabilities are declared as data, and code is bound to them separately.**
  - `defineResource` and `defineCapability` hold only data: identifiers, descriptions, schemas, conditions, effects.
  - v0's `defineAction` gains an additive `capability` option that refers to one, and supplies only the code: `run`, the guard implementations, and v0's own `summary` and `message`. The description and input come from the capability, so nothing is written twice.
  - The split matches the IR's own: definitions are data, and handlers are registered with a runtime (§6.3). XState's machine config against `setup()` and `provide()` is the precedent (prior art §3.3).
- **The compiler builds a manifest from capability modules alone.** They import `@affordances/ir` and a schema library, never the application's code. That closes the gap where today's build artifact imports the application (`packages/next/src/codegen.ts:109-131`).
- **Conditions are written as a record keyed by id:**
  - `preconditions: { notEmpty: when.gt('target.count', 0).because('The cart has items'), inStock: guard('Every item is in stock') }`.
  - The builder emits §13's `Condition[]`, so ids are unique by construction.
  - `defineAction({ capability, guards })` is typed so that `guards` has exactly one implementation per guard the capability declares. A missing or stray implementation is a type error. That is rule 5 (§8.2), caught in the editor as well as by conformance tests.
- **Paths are typed against the schemas.**
  - **The helpers** emit `Expr` from a path and a value: `when.gt`, `when.eq`, `when.all`, `when.not` and the rest.
  - **Paths are checked** against the target's `attributes`, the input and the references, so `'target.cout'` is a type error: `validate`'s `E_PATH`, moved to the editor.
  - **Helpers live under `when`,** not as top-level `eq` or `all`, which collide with common local names and query builders.
  - **Plain helpers, not a proxy builder** (`target.count.gt(0)`). A proxy looks like code, and would invite code the closed vocabulary can't express.
- **Authoring takes Standard Schema, and the IR stores JSON Schema,** as v0 already does for `input` (`packages/core/src/action.ts:101-111`). Conversion is recorded as `inferred` in `fieldProvenance`.
- **`references[].at` is authored as an input property name,** and the builder emits the JSON Pointer. Developers write one path syntax, the dotted one.
- **The namespace and the owner come from configuration,** written once: `withAffordances({ namespace, owner })` in Next.js, or `defineManifest` elsewhere.
  - The tools fill in `sources`, adding themselves with role `tool`, and the default `provenance` (`declared`, by the owner).
  - A fragment never invents an `owner` source, so only the configured owner can produce `declared` (rule 3).
- **IR effects never sit in `defineAction`.** v0's `effects` there keeps its v0 meaning, the state keys for the delta. The capability's `effects` are consequences, and the two never meet in one object (§4, §10.1). Renaming v0's field is RFC 0004's question.
- **Kinds:**
  - **`defineCapability`:** `kind` is required.
  - **A v0 `defineAction` without a capability:** it's an `action`, or a `query` when `readOnly: true` (§10.1).

**Alternatives considered:**

| Alternative                                                                             | Rejected because                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IR fields inline in `defineAction`                                                      | Closures and data in one object mean the compiler has to import the whole action module, and with it the application. It would also put the IR's `effects` next to v0's                                                                 |
| A codemod that moves a v0 action's description and schema into a new `defineCapability` | Schemas often refer to local imports, so the rewrite is a refactor, not a codemod. The migration form, `id` on `defineAction`, is one line (§10.1), and moving to `defineCapability` can happen when a developer adds what v0 can't say |
| Conditions as an array in authoring too                                                 | Ids would be a field to forget, and guard implementations couldn't be typed against them                                                                                                                                                |

### 12.2 The package

- **Exports:**
  - the types in §13;
  - the JSON Schema, which is generated from the same zod source as the types, as `@affordances/protocol` does today (`packages/protocol/src/schema.ts:3`);
  - the readers: `validate`, `normalize`, `canonicalize` (to bytes), `revision`, `compose`, and `derive` (the edges of §5.5);
  - the authoring helpers of §12.1: `defineResource`, `defineCapability`, `defineClaims`, `defineManifest`, `guard` and `when`.
- **No runtime dependencies** beyond the schema library. No Next.js, React or MCP.
- **Private** (`"private": true`) until published.
- **Tests:**
  - **Fixtures:** valid manifests and one invalid manifest per error code.
  - **Determinism:** canonical-form round trips, `compose` commutativity and associativity over generated fragments, and a revision stable across platforms.
  - **Three-valued evaluation:** truth tables for `all`, `any` and `not` with `unknown`.
  - **One test per safety rule:**
    - a claim on `confirmation` is rejected;
    - `safe: true` with `confirmation` keeps the confirmation;
    - `verified` without evidence is rejected;
    - `normalize` and `compose` never change a basis;
    - there is no numeric field outside `quantity`.
  - **Rule 5's conformance kit is M3's.** It needs a runtime to execute against, so `@affordances/ir` ships only the part that reads a manifest: for each declarative precondition, the state that makes it false.
  - **Portability:** the tests import nothing from Next.js or a live application.

## 13. TypeScript types

This is the exact sketch M2 implements. Field names and optionality are normative. Comments are not.

```ts
export type Id = string // /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/, ≤ 128 chars
export type Ref = string // an Id, or '<namespace URI>#<Id>'
export type URI = string
export type JSONPointer = string // RFC 6901
export type JSONSchema = Record<string, unknown> // JSON Schema 2020-12, without $schema
export type Extensions = Record<URI, unknown>

export type CapabilityManifest = {
  schemaVersion: '0.1'
  namespace: URI
  title?: string
  provenance: Provenance // the default for everything below
  sources: Source[]
  resources: ResourceDefinition[]
  capabilities: CapabilityDefinition[]
  relations?: Relation[]
  claims?: Claim[]
  bindings?: Binding[]
  extensions?: Extensions
}

export type Source = {
  id: string
  role: 'owner' | 'tool' | 'third-party'
  name: string
  href?: URI
}

export type Basis = 'declared' | 'inferred' | 'imported' | 'observed' | 'verified'

export type Provenance = {
  source: string
  basis: Basis
  evidence?: Evidence[]
}

export type Evidence = { description: string; href?: URI; digest?: string }

type Attributed = {
  provenance?: Provenance
  fieldProvenance?: Record<JSONPointer, Provenance>
  extensions?: Extensions
}

export type ResourceDefinition = Attributed & {
  id: Id
  title?: string
  description: string
  key: string
  attributes?: JSONSchema
  contains?: Id[]
  alternatives?: true
}

export type CapabilityKind = 'query' | 'action' | 'event'

export type CapabilityDefinition = Attributed & {
  id: Id
  kind: CapabilityKind
  title?: string
  description: string
  target?: Id
  references?: Reference[]
  input?: JSONSchema
  output?: JSONSchema
  safe?: boolean
  idempotent?: boolean
  preconditions?: Condition[]
  authorization?: AuthorizationRequirement
  confirmation?: ConfirmationRequirement
  effects?: Effect[]
  deprecated?: { replacedBy?: Id; reason?: string }
}

// per-kind names for code that needs them (terminology §2.3)
export type QueryCapability = CapabilityDefinition & { kind: 'query' }
export type ActionCapability = CapabilityDefinition & { kind: 'action' }
export type EventCapability = CapabilityDefinition & { kind: 'event' }

export type Reference = { name: string; resource: Id; at: JSONPointer }

export type Condition = { id: string; description: string } & (
  | { expr: Expr; guard?: never }
  | { guard: true; expr?: never }
)

export type Scalar = string | number | boolean | null
export type Path = string // '<root>.<attribute>[.<attribute>…]'
export type Operand = { path: Path } | { value: Scalar | Scalar[] }
export type Expr =
  | { all: Expr[] }
  | { any: Expr[] }
  | { not: Expr }
  | { eq: [Operand, Operand] }
  | { ne: [Operand, Operand] }
  | { lt: [Operand, Operand] }
  | { le: [Operand, Operand] }
  | { gt: [Operand, Operand] }
  | { ge: [Operand, Operand] }
  | { in: [Operand, Operand] }
  | { exists: Path }

export type AuthorizationRequirement = {
  principal: 'any' | 'authenticated'
  conditions?: Condition[]
}

export type ConfirmationRequirement = { summary: string } // presence means required

export type Reversibility = 'reversible' | 'compensable' | 'irreversible'

type EffectBase = {
  description: string
  reversibility?: Reversibility
  compensatedBy?: Id
}

export type StateEffect = EffectBase & {
  category: 'state'
  change: 'create' | 'update' | 'delete'
  resource: Id
  establishes?: Expr
}

export type OtherEffect = EffectBase & { category: 'external' | 'financial' | 'access' }

export type Effect = StateEffect | OtherEffect

export type Relation = {
  type: 'alternativeTo' | 'enables' | 'relatedTo'
  from: Ref
  to: Ref
  description?: string
  provenance?: Provenance
  extensions?: Extensions
}

export type Claim = {
  id: string
  subject: Ref
  about?: JSONPointer
  kind: 'recommendation' | 'benefit' | 'estimate' | 'assessment'
  statement: string
  quantity?: { value: number; unit: string }
  applies?: Expr
  provenance: Provenance
  extensions?: Extensions
}

export type Binding = {
  capability: Id
  protocol: string
  address: Record<string, string>
  extensions?: Extensions
}

export type ValidationIssue = {
  code: `E_${string}` | `W_${string}`
  message: string
  at: JSONPointer // into the manifest
}
```

## 14. JSON Schema outline

`@affordances/ir/schema.json` is JSON Schema 2020-12, with `$id` `https://affordances.sh/schemas/ir/0.1/manifest.json` and one `$defs` entry per type above. The constraints it states beyond the types:

| `$defs` entry          | Constraints                                                                                                                                                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Id`                   | `pattern` as in §13, `maxLength: 128`                                                                                                                                                                                                                                                   |
| `Ref`                  | an `Id`, or `format: "uri"` with a fragment that is an `Id`                                                                                                                                                                                                                             |
| `CapabilityManifest`   | `schemaVersion` `const: "0.1"`; `namespace` `format: "uri"`; `additionalProperties: false`                                                                                                                                                                                              |
| `Source`               | `role` enum                                                                                                                                                                                                                                                                             |
| `Provenance`           | `basis` enum. `if: { properties: { basis: { const: "verified" } } }, then: { required: ["evidence"], properties: { evidence: { minItems: 1 } } }`, and the same for `imported` and `observed`                                                                                           |
| `ResourceDefinition`   | `required: ["id", "description", "key"]`; `contains` is an array of unique `Id`s                                                                                                                                                                                                        |
| `CapabilityDefinition` | `required: ["id", "kind", "description"]`. With `kind: "query"`: `effects` absent or `maxItems: 0`, and `safe` not `false`. With `kind: "action"`: `safe` not `true`. With `kind: "event"`: no `input`, `preconditions`, `confirmation` or `effects`. `confirmation` requires `summary` |
| `Condition`            | `required: ["id", "description"]`; `oneOf` with `expr`, or with `guard: { const: true }`                                                                                                                                                                                                |
| `Expr`                 | `oneOf` of single-key objects (`minProperties: 1`, `maxProperties: 1`). Comparison values are `prefixItems` of two `Operand`s; `all` and `any` have `minItems: 1`                                                                                                                       |
| `Operand`              | `oneOf` `{ path }` and `{ value }`; `path` matches `^(target\|input\|principal\|[a-z][A-Za-z0-9]*)(\.[A-Za-z0-9_]+)+$`                                                                                                                                                                  |
| `Effect`               | `oneOf` on `category`. `state` requires `change` and `resource`. `compensatedBy` is required when `reversibility` is `compensable`                                                                                                                                                      |
| `Relation`             | `type` enum. With `type: "relatedTo"`, `description` is required                                                                                                                                                                                                                        |
| `Claim`                | `required: ["id", "subject", "kind", "statement", "provenance"]`; `quantity` requires `value` and `unit`                                                                                                                                                                                |
| `Binding`              | `address` is an object of strings, `minProperties: 1`                                                                                                                                                                                                                                   |
| `Extensions`           | `propertyNames: { format: "uri" }`                                                                                                                                                                                                                                                      |

**What the schema can't express, `validate` checks:**

- identifier uniqueness;
- reference resolution;
- condition paths against attributes and input schemas;
- the enforcement-field rule for claims;
- source roles against bases.

**What is left for RFC 0002:** principal attributes, the runtime's projection request and response, availability values, disclosure and relevance policies, observed-change records, and the handler registry.

## 15. Deviations from the initial design sketch

This RFC started from an initial sketch of the model: a manifest of resources, capabilities, relations and claims, with eight candidate relations (`supports`, `operatesOn`, `requires`, `produces`, `enables`, `contains`, `relatedTo`, `alternativeTo`). These are where it departs from that sketch, and why.

| Sketch                                                             | This RFC                                           | Replaced by                                                                                                                  | Rationale                                                                                                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `supports` (resource → capability), stored                         | not stored                                         | a derived edge, from `target` and `references` (§5.5)                                                                        | It's the inverse of what the capability already states. Storing both directions lets them disagree                                            |
| `produces` (capability → resource), stored                         | not stored                                         | a `state` effect with `change: 'create'` (§4), and a derived `produces` edge                                                 | Creating a resource is a consequence. As an effect, it keeps its reversibility and its place among the capability's other consequences        |
| `requires` (capability → capability), stored                       | not stored                                         | preconditions (§3), with prerequisite edges derived from effects that establish them (§5.5), and rule 5's enforcement (§8.2) | A stored necessity edge is the misleading-dependency vector. Derived necessity rests on named preconditions that conformance tests can check  |
| `operatesOn` and `contains` in a relation list                     | fields: `target` and `ResourceDefinition.contains` | the same relations, stored where their owner is (§5)                                                                         | A fact that one definition owns lives in that definition                                                                                      |
| `ConditionDefinition`, `EffectDefinition` as top-level definitions | nested value objects                               | `Condition` and `Effect` inside their capability                                                                             | Never shared, so identifiers and references would add cost without use (§2)                                                                   |
| A `recommended` flag, or relevance in the manifest                 | neither                                            | a `recommendation` claim (§9). Relevance and salience belong to projections (RFC 0002)                                       | Publisher preference is a statement by a party. Relevance depends on a task, and salience on presentation. None is a property of a definition |

## 16. Open questions

1. **`principal` attributes.** RFC 0002 defines which principal attributes a condition can read, and how an application declares them.
2. **A guard language.** Guards are opaque. A later version could let a guard name an implementation in a portable language, CEL for example. That would make it inspectable without making the IR executable, and the decision is deferred until real guards are surveyed.
3. **Conditional outcomes.** Whether to add OWL-S-style `outcomes` (§4), once there are post-state conditions.
4. **Namespace ownership.** Whether a namespace must be proved, for example by serving the manifest at its namespace URI or with reverse-DNS verification as the MCP Registry does (prior art §5), before third-party claims can name it.
5. **Signing.** A canonical form makes a detached signature (JWS over the RFC 8785 bytes) straightforward. Whether manifests are signed is a distribution decision for a later RFC.

## References

- The [terminology](./research/terminology.md), [repo audit](./research/repo-audit.md) and [prior-art review](./research/prior-art.md) for this RFC, and the specifications they cite.
- IETF, [RFC 8785: JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785).
- IETF, [RFC 6901: JavaScript Object Notation (JSON) Pointer](https://www.rfc-editor.org/rfc/rfc6901).
- [JSON Schema 2020-12](https://json-schema.org/draft/2020-12).
- M. Amundsen, L. Richardson, M. Foster, [ALPS](https://datatracker.ietf.org/doc/html/draft-amundsen-richardson-foster-alps-07), Internet-Draft -07.
- D. Martin et al., [OWL-S](https://www.w3.org/submissions/OWL-S/), W3C Member Submission, 2004.
- Model Context Protocol, [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), revision 2026-07-28.
- [Common Expression Language](https://cel.dev/); [JsonLogic](https://jsonlogic.com/).
