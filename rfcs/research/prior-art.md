# Prior art for a semantic capability IR

This document reviews the standards, research and agent frameworks that bear on three things:

- `@affordances/ir`, a portable, deterministic, non-executable manifest of an application's capabilities;
- `@affordances/runtime`, which projects that manifest and a context into a graph of action offers that an agent discovers progressively;
- the benchmark that measures how the structure of that graph influences agent choices.

For each source it records:

- what the source models;
- its primitives;
- what it gets right and wrong for this purpose;
- its status.

A reference matrix (§5) then says which concepts to adopt, modify or reject. §6 holds the research deliverables:

- precedents;
- candidate naming;
- common primitives;
- incompatibilities;
- interoperability;
- what Affordances has to introduce itself;
- the assumptions that need experiments.

**How to read it:**

- **Sources:** every source was read online on **2026-11-17**, from its primary specification or documentation. Citations give the URL and a section, heading or definition number. Quotations are verbatim.
- **Versions:** for projects that change quickly (MCP, WebMCP, AI SDK, UI SDK, Next.js), the version and date read are given with the source. Treat those sections as a snapshot.
- **Gaps:** where something couldn't be read or confirmed, the text says so (§7 lists the gaps).
- **Our analysis:** the "for us" paragraphs, the verdicts and §6 are our analysis. Everything else reports the sources.

## Goals

The design these sources are measured against:

- **A manifest that's portable and inert.** It's deterministic JSON, independent of React, Next.js, MCP or any transport, and contains no executable code. It describes resource types and capabilities: their schemas, conditions, effects, behavioral properties, relations and claims. It needs no live user or resource to compile.
- **Explicit uncertainty.** Every statement carries its provenance: declared by the developer, inferred by a compiler, imported from another description, observed at run time, or verified. An inferred statement is never presented as declared or verified, and a publisher's recommendation is never presented as a fact.
- **A projection that depends on context.** The runtime turns the manifest, plus a caller, a resource, state and a discovery policy, into offers an agent can explore step by step. Availability, discoverability, relevance, salience and publisher preference stay separate.
- **Safety that doesn't rest on description.** An offer is never authorization: execution re-checks it. No annotation can mark an operation safe or skip a confirmation.
- **Measurable influence.** The same definitions can be projected under different disclosure policies, so their effect on agent choices can be measured with the options held fixed.
- **Compatibility.** The current page-oriented protocol keeps working, and becomes one output of the new model.

In this document:

- A **capability** is a reusable definition of something an application can do (a query, an action or an event).
- An **offer** is a capability projected into one context.
- **v0** is the current Affordances protocol (`packages/protocol/spec.md`).

## Summary

1. **Separating meaning from binding is old and settled.** WoT Thing Descriptions (abstract `op` verbs and protocol forms), ALPS (profiles without URLs), OWL-S (profile and process separate from grounding) and Schema.org (an `Action` type separate from its `EntryPoint`) all separate what an interaction means from how it's carried. The IR should do the same, and bind to HTTP, Server Actions, MCP or UI components as separate, typed bindings.
2. **No source separates availability from discoverability, with a reason.**
   - Hypermedia formats (Siren, HAL, and Hydra for forbidden links) signal "not available" only by leaving the control out.
   - MCP lets a tool list vary by authorization. WebMCP registers and unregisters tools by page state.
   - None says "this exists, you can't use it now, and here's why", separately from "you haven't been shown this yet".
   - v0's `available` and `reason` are already ahead of the prior art here.
3. **Declarative preconditions and effects have one strong precedent: planning.** PDDL's preconditions and add/delete effects over a closed set of predicates, with the STRIPS rule that unmentioned state persists, are the model to borrow. OWL-S tried the same with free-form logic in four rule languages, and saw little adoption. The IR needs a small, closed, versioned condition vocabulary, with an explicit "opaque" marker for conditions only the runtime can enforce.
4. **Every safety flag in the agent protocols is an untrusted, self-asserted hint.**
   - MCP: "clients **MUST** consider tool annotations to be untrusted unless they come from trusted servers".
   - WebMCP: "a malicious site can omit or misrepresent those hints".
   - The AI SDK passes MCP's hints through without turning them into policy.
   - None distinguishes a publisher's declaration from an inference or a verified fact. That distinction, per claim, is the IR's provenance model.
5. **Static manifests have been rejected as a basis for trust,** by MCP's Server Cards (SEP-2127) and by WebMCP. Both arguments hold: what a caller may do depends on who's calling and on current state. The IR answers them by being a declaration that's never authorization. The runtime evaluates context, and execution re-checks authorization.
6. **Progressive discovery is recommended everywhere but specified nowhere.**
   - MCP's client guidance recommends Catalog → Inspect → Execute, and every proposal to put tool search in the protocol was closed.
   - AI SDK's tool search loads names first and schemas later.
   - UI SDK caps a snapshot at 100 entries and narrows with `query`.
   - A declared discovery policy in the runtime fills a real gap.
7. **Relations between capabilities are nearly absent.**
   - OpenAPI Link Objects (one response to another operation, "not guarantee[d]") are the only standardized typed relation.
   - Arazzo's step `dependsOn` is the right meaning for a prerequisite that doesn't trigger anything.
   - Everything else relates resources, not capabilities.
8. **The frameworks give no stable capability identity.**
   - Next.js Server Action IDs are "encrypted, non-deterministic" and rotate.
   - UI SDK refs are session-local.
   - AI SDK and MCP tool names are local to a call or a server.
   - The IR has to own identity, and treat every framework handle as a binding detail.
9. **"Consequential" is the flag the field converges on:** WebMCP's `consequentialHint` and OpenAPI tooling's `x-openai-isConsequential`. The IR's finer properties (financial, reversible, external) should export to it.

## 1. Semantic capability descriptions

### 1.1 W3C Web of Things Thing Description 1.1

**Status:**

- **TD 1.1** is a W3C Recommendation, 5 December 2023: <https://www.w3.org/TR/wot-thing-description11/>.
- **TD 2.0** is a First Public Working Draft (4 November 2025) that "continues the work … with no guarantees on backwards compatibility". It moves the binding mechanism into the TD, sends individual bindings to a registry, and removes the HTTP binding's content: <https://www.w3.org/TR/wot-thing-description-2.0/>, Abstract and Changes.
- **The Binding Templates note** is retired.
- **The Working Group** is active.

**What it models:**

- A Thing Description describes one Thing, "an abstraction of a physical or a virtual entity" (§5.3.1.1), through abstract interaction affordances (properties, actions and events), each with one or more protocol forms (§1.1).
- A Thing Model is the class-level template, without instance-specific details "such as concrete protocol usage (e.g., IP address)". It may still include security schemes and URLs (§9.1).

**Primitives:**

- **`InteractionAffordance`:** "Metadata of a Thing that shows the possible choices to Consumers" (§5.3.1.2). Its subclasses:
  - `PropertyAffordance`, which exposes state (§5.3.1.3);
  - `ActionAffordance`, which invokes "a function of the Thing, which manipulates state … or triggers a process" (§5.3.1.4);
  - `EventAffordance` (§5.3.1.5).
- **`Form`:** "To perform an _operation type_ operation on _form context_, make a _request method_ request to _submission target_". Its `op` member "Indicates the semantic intention of performing the operation(s)" (§5.3.4.2). The values include `readproperty`, `invokeaction` and `subscribeevent`.
- **`safe`, `idempotent` and `synchronous` on actions** (§5.3.1.4):
  - `safe` defaults to false, and `idempotent` defaults to false (§5.4).
  - Leaving out `synchronous` "means that no claim on the synchronicity of the action can be made."
- **`DataSchema`:** a JSON-Schema-like subset (§5.3.2).
- **Security:** "The purpose of a TD is to describe how to access a Thing if and only if a Consumer already has authorization, and is not meant be used to grant that authorization" (§5.3.3.1).
- **Thing Models:** `tm:extends`, `tm:optional` and placeholders (§9.3).

**For us:**

- **Right:**
  - The abstract `op` verb, kept separate from the protocol form, is the clearest prior art for separating capability from binding. TD 2.0 §8.1.1 notes that one Thing may use POST for a write where another uses PUT.
  - The conservative defaults, and the "no claim" meaning of an absent `synchronous`, are a precedent for three-valued behavioral properties (true, false, unknown).
  - "Describe, don't grant" is the right security stance.
  - Thing Model to Thing Description is a precedent for manifest to projection.
- **Wrong:**
  - There are no preconditions, no effect vocabulary, no reversibility or financial properties, no typed relations between affordances, no availability with a reason, and no provenance.
  - `DataSchema` isn't JSON Schema.
  - JSON-LD processing and fetching `@context` add cost and attack surface (§10.2).
  - The binding layer is still changing.

### 1.2 ALPS (Application-Level Profile Semantics)

**Status:**

- **The draft:** the latest is `draft-amundsen-richardson-foster-alps-07` (19 May 2021), an individual submission that expired on 20 November 2021: <https://datatracker.ietf.org/doc/draft-amundsen-richardson-foster-alps/>.
- **The spec repository** has been dormant since 2021. Tooling around it is still maintained.

**What it models:**

- ALPS profiles describe application semantics "independent of transfer protocol or media type" (§1.2.1). They name data elements and state transitions, which a representation such as HTML or HAL may then contain.
- "Since each service implementation is in charge of their own URL space, ALPS descriptions do not include URLs" (App. A.1).

**Primitives** (draft -07):

- **`descriptor`:** "defines the semantics of specific data elements or state transitions that MAY exist in an associated representation" (§2.2.4).
- **`type`** is `semantic`, `safe`, `idempotent` or `unsafe`, defined against HTTP methods (§2.2.16).
- **`rt`:** "the kind of resource that will be returned" (§2.2.13).
- **`def`:** an IRI "that idenfities the source definition of the descriptor", not necessarily dereferenceable (§2.2.3).
- **`href` inheritance** with local override (§2.2.4).
- **`ext`**, which "MUST be ignored by any application that does not understand its meaning" (§2.2.6).
- **`link`/`rel`** (§2.2.10, §2.2.12).

**For us:**

- **Right:**
  - The split between profile and runtime is the split between manifest and projection. "Servers are free to implement the transitions they find useful and to arrange them in any order they wish", and clients may "act upon them directly, render them for humans to invoke, or ignore/hide them completely" (App. A.2).
  - `def` is a cheap way to credit where a term's meaning comes from.
  - The must-ignore rule for extensions is a good compatibility rule.
- **Wrong:**
  - `type` combines "data or transition" with safety, has no "unknown", and can't say safe-but-not-idempotent.
  - Inputs are untyped nested descriptors (§1.3: "This hypermedia control has one input value"), and the only output is `rt`, a resource kind. Value ranges are excluded by design, as "over-constraining" (App. A.3).
  - There are no preconditions or effects: "ALPS is not designed to describe workflows or execution paths" (App. A.2).
  - The media-type mappings were never written: §3 is marked "[TK : this page does not yet exist.]".

### 1.3 OWL-S

**Status:** a W3C Member Submission, OWL-S 1.1, 22 November 2004, not a W3C standard. It's dormant: <https://www.w3.org/submissions/OWL-S/>.

**What it models:**

- An OWL ontology meant to let agents "discover, invoke, compose, and monitor" Web services (Abstract).
- A service _presents_ a `ServiceProfile` (what it does, for discovery), is _described by_ a process model (how to use it), and _supports_ a `ServiceGrounding` (the protocol, through WSDL) (§3).

**Primitives** (§4-§6):

- **Processes:** atomic, simple and composite.
- **Parameters:** inputs, outputs and locals.
- **`hasPrecondition`:** "if a process's precondition is false, the consequences of performing or initiating the process are undefined" (§5.2).
- **`Result`,** "a coupled output and effect", under an `inCondition` that "specifies the condition under which this result (and not another) occurs" (§5.2).
- **Composite control constructs:** Sequence, Split, Choice, If-Then-Else, Repeat-While and the rest (§5.4).
- **Groundings:** in practice, to WSDL (§6).

**For us:**

- **Right:**
  - **The precondition and effect model.** The conditional result, an outcome with its own output and effect, is the richest of any source. It fits per-outcome effects such as success or failure.
  - **Belief is not truth.** OWL-S separates "a condition's being true" from "being believed to be true, being known to be true, being represented in a database as true" (§5.2). That's the distinction behind our provenance levels.
  - **Selective advertising.** A profile "advertises those functionalities that the service wants to provide, while it may hide (not declare publicly) other functionalities" (§4.1). That's an early precedent for separating discoverability from availability.
  - **Claims are unverified.** Of a service's self-published quality rating: "It is up to the service requester to use this information, to verify that it is indeed correct" (§4). Publisher claims stay distinct from verified facts.
- **Wrong:**
  - Preconditions and effects are free-form formulas in SWRL, KIF, PDDL or DRS, stored as literals (§5.1). Nobody can validate or evaluate them generically.
  - The profile and the process may contradict each other "without affecting the validity" (§4.1).
  - The only grounding defined is WSDL's, and the composite constructs are a workflow language.

**Why it didn't take hold:**

- Verborgh, Mannens and Van de Walle (2015) describe "the apparent failure of Semantic Web services … to gain any traction or usage". They point to hand-made bindings and RPC-style services that ignore hyperlinks: "Bottom-up Web APIs with self-descriptive responses", First Karlsruhe Service Summit Research Workshop, §1, <https://biblio.ugent.be/publication/5939097>.
- In a 2007 expert survey, practitioners ranked "the lack of effective tools" first, then "the lack of industrial commitment and the limited interest of vendors": D. Bachlechner, SciTePress 2008, <https://www.scitepress.org/Papers/2008/17182/17182.pdf>.
- **The lesson for the IR:** keep it small, keep it JSON, and ship it with the tools that produce and consume it.

## 2. Hypermedia and relationship discovery

### 2.1 Siren

**Status:** dormant. The latest tag is v0.6.2, the last commit is 19 October 2020, and the last substantive change was in 2017: <https://github.com/kevinswiber/siren>.

**What it models:** "Siren is a hypermedia specification for representing entities" (README). An entity carries its `properties`, its sub-`entities`, its `links` and its `actions`. Each action has a `name` (unique within the entity), a `method` (default GET), an `href`, a `type` and `fields` typed by HTML5 input types (README, Actions and Fields).

**For us:**

- **Right:**
  - Actions travel in the representation of one resource instance, so they depend on state by construction: "Actions show available behaviors an entity exposes." That's the shape of v0's `actions[]`, and of an offer.
  - The split between an embedded link and an embedded representation suits progressive disclosure.
- **Wrong:**
  - Leaving an action out is the only way to say it's unavailable.
  - Its names are local to an entity.
  - Its fields aren't JSON Schema, and there's no output.
  - There are no safety properties beyond the method.

### 2.2 Hydra Core Vocabulary

**Status:**

- An unfinished W3C Community Group draft: "not a W3C Standard nor is it on the W3C Standards Track", and "a work in progress" (Document status), <https://www.hydra-cg.com/spec/latest/core/>.
- A release-candidate pull request was merged in May 2026, but there's no final release.

**What it models:** an RDF/JSON-LD vocabulary for Web APIs.

- An `ApiDocumentation` declares the supported classes, their properties and their operations.
- Representations carry links, operations and IRI templates inline.

**Primitives** (<https://www.w3.org/ns/hydra/core>):

- **`supportedOperation`:** "An operation supported by instances of the specific Hydra class, or the target of the Hydra link, or IRI template." Mostly class-level, but also on links and templates.
- **`operation`:** "An operation supported by the Hydra resource", at instance level.
- **`Operation`,** with `method`, `expects` and `returns`.
- **`possibleStatus`,** which the spec calls "merely a hint".
- **`IriTemplate`, `Collection` and `memberAssertion`.**
- **Discovery** through a `Link` header to the API documentation (spec, "Discovering a Hydra-powered Web API").

**For us:**

- **Right:**
  - The declared operation set (on classes, and on links and templates) against the instance-level one is close to our manifest-and-offer split.
  - Discovery through a `Link` header is a cheap bootstrap.
  - The honest "hint" framing.
  - Everything is identified by IRI.
- **Wrong:**
  - It assumes RDF.
  - There's no safety or idempotency marker.
  - That operations depend on permissions appears only in prose, about Link properties: `supportedOperation` "is often helpful when certain operations depend on the permissions of the current user". A link the caller may not follow "would simply be hidden" (Documenting a Web API), so Hydra also signals unavailability by absence.
  - There are no effects, and the spec is unfinished.

### 2.3 HAL

**Status:** `draft-kelly-json-hal-11` (19 October 2023), an expired individual draft, never adopted. It's widely deployed in practice: <https://datatracker.ietf.org/doc/draft-kelly-json-hal/>.

**What it models:** links and embedded resources only, through `_links` keyed by relation type and `_embedded` (§4). Forms were left out on purpose: "Omitting forms from HAL was an intentional design decision" (App. B.5).

**For us:**

- **Right:**
  - Embedded resources "MAY be a full, partial, or inconsistent version of the representation served from the target URI" (§4.1.2). That's an honest marker worth copying for embedded snapshots.
  - CURIEs (§8.3), and a Link Object's `deprecation` property (§5.4).
- **Wrong:** there are no operations at all.

### 2.4 RFC 8288, Web Linking

**Status:** IETF Proposed Standard, October 2017, and stable: <https://www.rfc-editor.org/rfc/rfc8288>.

**What it models:**

- A link is "a typed connection between two resources", made of a link context, a relation type, a link target and optional target attributes (§2).
- **Relation types** are registered tokens in an IANA registry, under "Specification Required… which implies review and approval by a designated expert" (§2.1.1.2), or URIs for extensions, compared as strings, which "clients SHOULD NOT automatically access" (§2.1.2).
- **The `Link` header** serializes links in HTTP (§3).

**For us:**

- **Right:**
  - The shape of a link (context, type, target, attributes) is the shape of an IR relation.
  - Two tiers of names, a registered core and URI extensions, suit a small closed set of relation types with namespaced extensions.
  - A `Link` header can advertise a manifest from any response.
- **Wrong:**
  - Links join resources, while IR relations often join capabilities and resource types, which have no URL.
  - A relation type's meaning stands alone: "Relation types SHOULD NOT infer any additional semantics based upon the presence or absence of another link relation type, or its own cardinality of occurrence" (§2.1). The model has nothing to say about a link that's absent, so availability has to be its own field.

### 2.5 JSON Hyper-Schema

**Status:**

- The latest is `draft-handrews-json-schema-hyperschema-02`, for JSON Schema 2019-09 (17 September 2019): <https://json-schema.org/draft/2019-09/json-schema-hypermedia>.
- "There was no JSON Hyper-Schema draft for 2020-12 releases" (<https://json-schema.org/specification>).
- A statement that it's unmaintained appears only on a mirrored older page, so we haven't confirmed it.

**What it models:** links computed from a JSON instance. A Link Description Object (LDO) "is a serialization of the abstract link model defined in RFC 8288, section 2" (§6). Its members:

- `rel` and an `href` template;
- `hrefSchema`, the client input that fills the template;
- `submissionSchema`, the request body;
- `targetSchema`, the target, non-authoritative;
- `templateRequired`: if a listed variable has no value, "the link MUST NOT be used" (§6.4.2).

**For us:**

- **Right:**
  - It uses JSON Schema for every payload.
  - Whether a link is usable is a declarative function of the instance data (`templateRequired`, or `if`/`oneOf` over the instance). That's a precedent for deterministic conditions over resource state.
  - "Advisory" and "non-authoritative" are marked explicitly.
- **Wrong:**
  - It has no operation, by design: LDOs "do not directly indicate what operations, such as HTTP methods, are supported". `targetHints.allow` can only hint at them (§8.1), and §8.3 covers POST with the `submission*` keywords.
  - Its conditions can only read the instance, not the caller or authorization.
  - It's frozen at 2019-09.

### 2.6 Schema.org Actions

**Status:** maintained, version 30.1 (16 September 2026): <https://schema.org/Action>, <https://schema.org/docs/actions.html>.

**What it models:**

- An `Action` is "An action performed by a direct agent and indirect participants upon a direct object" (/Action).
- A Thing's `potentialAction` "describes an idealised action in which this thing would play the 'object' role" (actions.html; the property page words it "an idealized action in which this thing would play an 'object' role").
- The action is carried out against a `target` `EntryPoint` (`urlTemplate`, `httpMethod`, `encodingType`) (actions.html).
- **Its semantics come from:**
  - `object`, "whose state is kept intact or changed";
  - `result`, "The result produced in the action";
  - `actionStatus`: potential, active, completed or failed;
  - a taxonomy of subtypes such as `BuyAction`, "The act of giving money to a seller in exchange for goods or services rendered" (<https://schema.org/BuyAction>).
- **Inputs:** declared as a `PropertyValueSpecification` (`valueRequired`, `valueMaxLength`, `valuePattern`, minimum and maximum values), which "Can also be expressed as" a string shorthand such as `"required maxlength=100 name=q"` (actions.html).

**Consumers:**

- **Gmail** reads Actions in email markup: <https://developers.google.com/workspace/gmail/markup/actions/declaring-actions>. Gmail layers trust on top of the vocabulary, outside it:
  - **Sender registration:** senders must register.
  - **Authentication:** "Emails must be authenticated using DKIM or SPF".
  - **Bearer tokens:** optionally, requested at registration, requests carry a token proving they come from Google.
  - **Limited-use tokens:** senders should "embed limited-use access tokens in action URLs" against replay.
  - Sources: <https://developers.google.com/workspace/gmail/markup/registering-with-google> and <https://developers.google.com/workspace/gmail/markup/actions/securing-actions>.
- **Google's sitelinks search box,** the best-known web consumer, was retired on 21 November 2024: <https://developers.google.com/search/blog/2024/10/sitelinks-search-box>.

**For us:**

- **Right:**
  - Semantics (the Action type) are kept separate from the binding (the `EntryPoint`).
  - A shared action taxonomy gives identity across sites.
  - `object` and `result` are domain outcomes.
  - One type covers both offered and completed actions.
  - Gmail shows that provenance and verification belong to the consumer and runtime layer.
- **Wrong:**
  - There's no general condition language. Declarative access requirements exist only for `ConsumeAction`, through `actionAccessibilityRequirement` → `ActionAccessSpecification`, "A set of requirements that must be fulfilled in order to perform an Action": a subscription, a region, an availability window, `expectsAcceptanceOf` (<https://schema.org/ActionAccessSpecification>).
  - Inputs are HTML-input-like constraints (`PropertyValueSpecification`), not JSON Schema.
  - There are no safety or reversibility properties.
  - Its web adoption is narrow.
- **Watch the naming:** schema.org's `Offer` is "An offer to transfer some rights to an item or to provide a service", with `addOn` for "An additional offer that can only be obtained in combination with the first base offer" (<https://schema.org/Offer>). A commerce application will have both commercial offers and action offers.

### 2.7 What a contextual capability graph adds to hypermedia

Each item is a gap the specifications above can't express (our analysis):

1. **"Exists, but not now, and why."**
   - Siren and HAL signal unavailability only by absence.
   - Hydra admits that permissions matter, in prose only, and a link the caller may not follow "would simply be hidden" (Documenting a Web API).
2. **Context beyond the resource.** Hyper-Schema's conditions read only the instance. Schema.org's access requirements cover only `ConsumeAction`. None of these formats has a general condition over the caller, authorization or a discovery policy.
3. **Behavioral properties.** None defines safe, idempotent, reversible or financial as declared properties. Hydra has no marker; Hyper-Schema defers to the protocol (§8.1); in Schema.org, money appears through the type and `TradeAction`'s `price` and `priceSpecification`, with no consequence flag.
4. **Relations between capabilities.** Links relate resources. None relates one capability to another (`requires`, `enables`, `alternativeTo`), which a multi-step plan needs.
5. **Provenance of claims.** The most any of them does is mark a field advisory (Hyper-Schema), a hint (Hydra) or possibly inconsistent (HAL). Gmail bolts trust on from outside.
6. **Relevance, salience and preference.** Every format lists controls flat and unranked. None can say "available, and the publisher recommends this one" while keeping that distinct from a fact.
7. **A manifest for the whole application.** HATEOAS controls live in individual responses. Hydra's `ApiDocumentation` is the only whole-API description, and it's RDF and unfinished.

## 3. Workflows and state transitions

### 3.1 OpenAPI Arazzo

**Status:** version 1.1.0 (17 May 2026), maintained by the OpenAPI Initiative. Earlier releases are 1.0.0 (2024) and 1.0.1 (2025): <https://spec.openapis.org/arazzo/latest.html>, App. A.

**What it models:**

- Sequences of API calls over existing API descriptions, to "express specific sequences of calls and articulate the dependencies between them" (§3).
- **A workflow** has `inputs` (JSON Schema), `steps`, `outputs`, and success and failure actions (§5.8.4).
- **A step** calls an `operationId`, an `operationPath` or another workflow. Steps for AsyncAPI can use a `channelPath` (§5.8.5.1). A step asserts `successCriteria` of four condition types: simple, regex, JSONPath and XPath, with the JSONPath and XPath versions pinned (§5.8.5, §5.8.11-12).
- **Actions** `end`, `goto` or `retry` (§5.8.7-8).

**For us:**

- **Right:**
  - **A non-triggering prerequisite.** A step's `dependsOn` "only establishes a prerequisite relationship for the current step" and "does not trigger execution of the referenced steps" (§5.8.5.1). That's the meaning a `requires` relation needs.
  - **Bindings by reference.** Workflows reference API descriptions through `sourceDescriptions` instead of embedding them (§5.8.3).
  - **Closed, versioned condition types.** Conditions are a fixed set of expression types with pinned versions, not code. XPath 3.1 isn't small, but the set is closed.
- **Wrong:**
  - "An ordered list" of steps with `goto`, `retry` and `end` is a program.
  - Its conditions test the response after a call, not the state before one.
  - There's no safety or idempotency vocabulary, though `retry` exists. The spec warns that processing a description "can cause both safe and unsafe operations to be performed" (§6).
- **Arazzo is the right _export_ target for a chosen multi-step path,** not a model to adopt.

### 3.2 W3C SCXML

**Status:** W3C Recommendation, 1 September 2015, final: <https://www.w3.org/TR/scxml/>.

**What it models:** Harel statecharts with an exact run-time semantics:

- states, parallel regions, and transitions with `event`, `cond` and `target` (§3.3-3.5);
- a pluggable data model;
- "executable content" on transitions and on entry and exit (§4);
- an informative reference algorithm: "Implementations are free to implement SCXML interpreters in any way they choose" (App. D).

**For us:**

- **Right:**
  - **Structure is separate from execution.** States and transitions are kept apart from executable content, which is a separate, named category.
  - **A declarative guard language is workable.** With the null data model, "The boolean expression language consists of the In predicate only" (App. B.1.2): a guard that can only ask which states are active.
  - **Conditions must be pure.** "Conditional expressions in conformant SCXML documents SHOULD NOT have side effects" (§5.9.1), and each data model's condition language "MUST not have side effects" (App. B).
- **Wrong:**
  - The interpreter (microsteps, macrosteps, event queues) is the workflow engine the IR must not become.
  - When several transitions match, "the first one in document order will be taken" (§3.1.1). That makes meaning depend on serialization order.
  - Guards in the ECMAScript data model are arbitrary script (App. B.2).

### 3.3 Statecharts and XState

**Statecharts:**

- **The paper:** David Harel, "Statecharts: A visual formalism for complex systems", _Science of Computer Programming_ 8(3), 231-274, 1987, doi:10.1016/0167-6423(87)90035-9.
- **What we read:** the abstract and bibliographic record (§7). The abstract frames statecharts as extending state diagrams with "hierarchy, concurrency and communication", for specification.

**XState** is the dominant TypeScript statechart library, maintained: 5.33.4 is the latest, and 6.0 is in beta. Its docs are at <https://stately.ai/docs>.

- **Guards** "should be pure, synchronous functions that return either `true` or `false`". They're best referenced by name as `{ type, params }`, and combined with `and`, `or` and `not` (/docs/guards).
- **Implementations are bound later:** with `setup()` or `machine.provide()`, a machine's guards and actions are "referenced using JSON-serializable strings and/or objects" (/docs/machines).
- **`state.can(event)`** "determines whether an `event` object will cause a state change" (/docs/states).
- **`transition()`** computes the next state without running anything (/docs/machines).

**For us:**

- **Right:**
  - **Named, parameterized predicates with boolean combinators** are a good shape for serialized conditions. The runtime binds an evaluator to each name.
  - **`can` and a pure `transition`** show that checking availability can be separated from executing.
- **Wrong:**
  - **Closures:** inline closures as guards and actions make a machine non-portable.
  - **Engine behavior:** actions are side effects of a live actor, and transitions without events chain automatically. All of that is engine behavior.

### 3.4 PDDL and STRIPS

**Status:** PDDL is a community language tied to the International Planning Competition, not maintained as a single specification. Its versions:

- 1.2 (1998);
- 2.1 (the 2002 competition's language, published 2003);
- 2.2 (2004);
- 3.0 and 3.1 (used in 2008 and 2011).

**What we read:**

- **PDDL 2.1:** M. Fox and D. Long, "PDDL2.1: An Extension to PDDL for Expressing Temporal Planning Domains", _JAIR_ 20 (2003) 61-124, doi:10.1613/jair.1129, <https://arxiv.org/abs/1106.4561>.
- **PDDL 1.2 and STRIPS:** cited, not read (§7).

**What it models:**

- **A planning domain:** types, predicates, and action schemas, each with a precondition and an effect.
- **A separate problem:** the objects, an initial state and a goal.
- **Applicability:** an action "is applicable in a state s if the Pre_a is satisfied in s" (Definition 10).
- **The next state** removes the action's delete list and adds its add list (Definitions 6 and 13).
- **Feature flags:** `:requirements` declares which language features a domain uses.

**Two principles:**

- **"Physics, not advice."** PDDL 2.1 follows McDermott's maxim. Fox and Long gloss it as "that a language should focus on expressing the physical properties of the world, not advice to the planner" (§1).
- **The frame rule.** "The strips assumption provides a simple solution to the frame problem when states are described using atomic formulae" (§11). Whatever an effect doesn't mention stays as it was. M. Shanahan, "The Frame Problem", _Stanford Encyclopedia of Philosophy_, <https://plato.stanford.edu/entries/frame-problem/>, gives the background.

**For us:**

- **Right:**
  - **Preconditions and effects** declared over a small, closed set of predicates are inspectable, comparable, and evaluable without code.
  - **"Enables" edges can be derived**, not authored: one capability's effect satisfies another's precondition.
  - **`:requirements` levels** are a model for IR profiles: a core condition vocabulary, and extensions a consumer can decline.
  - **"Physics, not advice"** is exactly the line between availability and publisher preference.
- **Wrong:**
  - **A closed, fully known world,** where web state is partial and remote, so the IR needs `unknown`.
  - **Deterministic effects,** where real calls fail.
  - **Grounding over every object.**
  - **A planner as the purpose.** Affordances must not require one.

### 3.5 A graph of capabilities, not a workflow

**Our analysis:**

- **A capability graph** states facts about each capability: its conditions, its effects, and its relations to other capabilities. Sequences can be derived from it, but none is prescribed. PDDL is the archetype.
- **An executable workflow** fixes control: order, branches, retries, termination and an interpreter. Arazzo and SCXML are the archetypes.

**What the IR can carry without becoming an engine:**

1. preconditions and effects over a declared state vocabulary, with the frame rule (PDDL);
2. prerequisite edges that don't trigger anything (Arazzo `dependsOn`), whether stored or derived from conditions;
3. optional lifecycle states per resource type, with each capability naming the states it moves between (as SCXML transitions name a source and target), and conditions that test the current state (XState's `stateIn` guard), as annotations, with no interpreter;
4. named, parameterized predicates with `and`, `or` and `not`, evaluated by the runtime (XState);
5. vocabulary profiles that consumers can decline (PDDL `:requirements`).

**What stays out:**

- ordered steps;
- `goto`, `retry` and `end`;
- event queues;
- document-order priority;
- entry and exit actions;
- assignments and scripts;
- actors;
- automatic transitions;
- guards written as code.

Checking availability belongs to the runtime (XState's `can`), never to the IR. A chosen path can be exported to Arazzo when someone wants to run it.

## 4. Agent interaction systems

### 4.1 Model Context Protocol (MCP)

**Status:**

- **Read:** revision **2026-07-28**, the current one, on 2026-11-17: <https://modelcontextprotocol.io/specification>.
- **What that revision changed** (changelog):
  - it removed protocol sessions and the `initialize` handshake, and added `server/discover`;
  - it moved Tasks to an extension;
  - it required `ttlMs` and `cacheScope` on list results;
  - it deprecated Roots, Sampling and Logging.
- **Maintenance:** active, through working groups and Specification Enhancement Proposals (SEPs).

**What it models:** a JSON-RPC protocol between AI applications and servers. Servers offer:

- tools, which are "model-controlled";
- resources, which are "application-driven";
- prompts, which are "user-controlled".

**Tools** (server/tools):

- **Fields:** a `name` (which SHOULD be 1-128 characters of `[A-Za-z0-9_.-]` and unique within a server), `title`, `description`, `inputSchema`, an optional `outputSchema` with `structuredContent` results, and `annotations`.
- **Annotations:** `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint`.
  - **Defaults:** they default to the worst case.
  - **Trust:** "For trust & safety and security, clients **MUST** consider tool annotations to be untrusted unless they come from trusted servers." The schema adds: "Clients should never make tool use decisions based on `ToolAnnotations` received from untrusted servers" (schema.ts, `ToolAnnotations`).
- **The tool list:** it "**MAY** vary by the authorization presented on the request" but "**MUST NOT** vary per-connection", and should come "in a deterministic order" (server/tools, Capabilities). Changes are announced with `notifications/tools/list_changed`.

**Discovery:**

- **Tool overload:** the client guidance recommends progressive discovery, Catalog → Inspect → Execute, with a `search_tools` meta-tool. "Loading every tool definition into the model's context window upfront wastes tokens, increases latency, and degrades model performance" (introduction): <https://modelcontextprotocol.io/docs/2026-07-28/develop/clients/client-best-practices>, Progressive Tool Discovery.
- **Proposals that were closed without merging:**
  - tool search in the protocol (SEP-1821);
  - scope-filtered listing (SEP-1881);
  - tool groups and tags (SEP-1300, SEP-2084).
- **Server Cards (SEP-2127, Final)** are static pre-connection documents that deliberately leave tools out. "A static document cannot reliably represent this surface", and so "clients cannot trust a static manifest for access-control or safety decisions; primitives are always validated at runtime": <https://modelcontextprotocol.io/seps/2127-mcp-server-cards>.

**Open proposals on 2026-11-17** (SEP-2793 and SEP-2487 are labeled `proposal` and `wg-support-needed`; SEP-1913 is a `draft`, updated 2026-11-16):

- tool risk metadata, with reversibility and side effects (SEP-2793);
- opaque execution requirements (SEP-2487);
- trust and sensitivity annotations with attribution (SEP-1913).

**For us:**

- **Right:**
  - **Interop:** the `name`, `title`, `description`, `inputSchema` and `outputSchema` quartet is the common shape of agent tools, so export to it should be mechanical.
  - **Defaults and annotations:** pessimistic defaults, and a frank statement that annotations aren't enforcement.
  - **Variation:** varying by authorization and not by connection.
  - **Ordering:** a deterministic order, for prompt caching.
  - **Discovery:** the official endorsement of progressive discovery.
- **Wrong:**
  - **Context-free hints:** four booleans that don't depend on context.
  - **Missing structure:** there are no preconditions, effects, reversibility, financial flag or relations. Proposals to add them are open, unsponsored or still in progress.
  - **Coarse trust:** trust is all or nothing per server.
  - **Discovery left to the host:** progressive discovery has no wire representation.

### 4.2 WebMCP

**Status:** a W3C Web Machine Learning Community Group "Draft Community Group Report, 13 November 2026", changing quickly. It was read on 2026-11-17: <https://github.com/webmachinelearning/webmcp>, published at <https://webmachinelearning.github.io/webmcp/>.

- **The API moved:** from `navigator.modelContext` to `document.modelContext` (May 2026).
- **`provideContext()` was removed:** in March 2026.
- **The declarative form API was taken out of the spec:** in October 2026. It now lives only in an explainer.
- **Shipping:** an origin trial in Chrome 149 and Edge 150, and the `about:flags#enable-webmcp-testing` flag for local work (`implementation-status.md`).

**What it models:** a page registers JavaScript-backed tools with `document.modelContext.registerTool()`, and the browser mediates agents' calls to them.

- **Tool fields:** `name`, `title`, `description`, `inputSchema`, `outputSchema`, an `execute` callback and annotations.
- **Annotations:** `readOnlyHint`, `untrustedContentHint`, `consequentialHint` and `debugging` (for developer tooling). `consequentialHint` is defined as "executing the tool will result in consequential actions that are significant, real-world, or non-reversible, ex: booking a flight, transferring money" (index.bs).
- **Provenance:** the browser stamps each registered tool with its `origin`.
- **The README's stance on static manifests:** "Static manifests prevent web developers from dynamically adding, updating, or removing tools based on the active page state or user authentication status" (Alternatives Considered). It also advises "dynamically registering and unregistering them based on the active page state … to avoid overloading the agent's context window" (Imperative Tool Registration).
- **Its security section:** "a malicious site can omit or misrepresent those hints."

**For us:**

- **Right:**
  - **Scoping:** page-scoped, state-dependent tool sets, close to v0.
  - **Consequence:** `consequentialHint` confirms that a consequence flag is needed.
  - **Provenance:** origin stamped by the browser is a model of provenance the user agent actually verifies.
  - **Inference:** the explainer's deterministic form-to-schema synthesis is a good inference source.
- **Wrong:**
  - **No portable description:** it's executable and imperative.
  - **Missing structure:** there are no relations, preconditions, effects or idempotency.
  - **Churn:** the API surface is still moving.

### 4.3 AI SDK

**Status:** `ai` **7.0.173** (13 November 2026) and `@ai-sdk/mcp` 2.0.99, read on 2026-11-17 at <https://ai-sdk.dev/docs>. It's maintained, with releases several times a week.

**What it models:** a tool set (`name → tool`) passed to a model call, with the SDK running the multi-step loop.

- **`tool()`:** "a helper function that infers the tool input and context for its `execute` method … It does not have any runtime behavior" (reference, `tool`). It takes:
  - `inputSchema`;
  - `outputSchema`, "Used for type inference";
  - an optional `execute`;
  - `metadata` "(e.g. its source)".
- **Approval policy has moved from the definition to the call:** `needsApproval` is deprecated in v7 in favor of `toolApproval`, whose statuses are `not-applicable`, `approved`, `denied` and `user-approval`, each with an optional reason. "This keeps approval policy close to the generation or agent configuration and lets you vary it by request" (Migration Guide 7.0). Approval requests and responses travel in the message stream (Tool Calling, Tool Execution Approval).
- **Tool search:** `toolSearch()` with `deferLoading: true` matches names and descriptions. It returns `{ name, description }`, and the matched tools become available "on the next model step" (Tool Search).
- **Active tools:** `activeTools` and `prepareStep` choose the active tools per step.
- **MCP's annotations:** they come through as `metadata.annotations`. "Annotations are untrusted, server-provided hints. The MCP client does not turn them into an approval policy automatically" (MCP Tools, Tool Annotations and Approval).
- **Drift detection:** `fingerprintTools` and `detectToolDrift` digest each tool's description, schema and title.

**For us:**

- **Right:**
  - **Policy:** policy is separate from the definition.
  - **Approvals:** approvals are data with reasons.
  - **Disclosure:** two-phase disclosure, summary first and schema later.
  - **Untrusted hints:** untrusted hints aren't policy.
  - **Digests:** digests of definitions.
- **Wrong:**
  - **Behavior:** the tool itself declares no behavioral properties or effects.
  - **`outputSchema`:** it's for types, not a contract.
  - **Names:** they're local to a call.
  - **Availability:** it's imperative code, which no agent or benchmark can inspect.

### 4.4 UI SDK

**Status:** `@ui-sdk/*` **0.1.0-beta.6** (16 November 2026, the `latest` tag; 0.1.0-beta.7 shipped on the `beta` tag on 17 November), first published 12 November 2026. It was read on 2026-11-17 at <https://ui-sdk.dev/docs/agents/connect-an-agent/reference.md>; the repository is <https://github.com/vercel-labs/ui>.

- **Maturity:** pre-1.0, released about daily. Its `agent` key is marked experimental.

**What it models:** a bridge that turns the mounted component tree into an agent surface. Its unit is a rendered control, not a domain operation (reference):

- **`snapshot()`** returns components, each with:
  - a `ref`, a `component` kind, a `label` and row text;
  - state, `items`, and `disabled` or `offPage`;
  - a `confirm` sentence;
  - the `actions` it accepts.

  Past 100 entries it ends with a `more` entry that points to `query`.

- **`query({ text, within, kind })`** "Finds components and their choices without listing the page".
- **`act({ steps })`** "Runs actions in order". "A failed step stops the call. Earlier steps stay applied; there is no rollback."
- **`subscribe()`** reports settled changes, with their `source`: the agent or the person.
- **Confirmation:**
  - `data-agent-confirm` holds "a sentence that says what the control does", for example "Charges $20 to your card for 1,000 credits".
  - An `allow(step)` callback decides whether a step may run. "An `allow` that returns `true` without reading `step.confirm` answers yes for the person" (permissions).
- **Declared actions:** components declare them with `definePrimitive({ agent: { actions } })`. Without that, the bridge infers them from method names (reference, Custom Primitives).

**What it can't reveal** (our analysis, from the reference): choosing "Premium" in a plan select is `setValue("premium")`. The snapshot holds the label and the value. It doesn't hold:

- the price difference or the billing cycle;
- the term or the cancellation policy;
- the fact that pressing Save later charges a card.

The only channel for consequence is a free-text sentence on a control the author chose to mark. So component interactions are a binding for capabilities, and their observations are evidence. They aren't a source of business semantics.

**For us:**

- **Right:**
  - **Truncation:** an explicit truncation marker, then narrowing by query.
  - **Confirmation:** confirmation the agent sees before it acts.
  - **Results:** honest results, with no rollback and observed changes kept separate.
  - **Attribution:** each change carries its source.
- **Wrong:**
  - **Shallow schemas:** the bridge's tools carry an `inputSchema`, but a component action's arguments are `unknown[]`, and only a `set` action's first argument is checked against the primitive's schema.
  - **Inferred actions:** the action surface is inferred from names.
  - **Identity:** session-local refs.
  - **Consequences:** they're free text.
  - **Availability:** it comes without a reason.
  - **Browser only:** it needs a browser.

### 4.5 Next.js Server Actions

**Status:** Next.js **16.4.6** (9 November 2026). It was read on 2026-11-17 at <https://nextjs.org/docs>; the pages are dated in their front matter, from 2026-08 to 2026-11.

**What it models:** `'use server'` "tells the compiler to swap the function's implementation in client bundles for a reference (an action ID plus a dispatcher) that POSTs back to the server" (Guides, Server Actions, Security).

- **Action IDs aren't stable:** Next.js creates "encrypted, non-deterministic IDs" that "are periodically recalculated between builds" and "cached for a maximum of 14 days" (Guides, Data Security).
- **Security guidance:**
  - "Treat every action as an untrusted entry point."
  - "Render-time gating … is not a security boundary".
  - Schema validation "only checks the _shape_ of the input" (Server Actions, Security).

**What a compiler can and can't learn** (our analysis, from those pages):

- **It can learn:**
  - which exports are Server Functions, and their names and source locations;
  - parameter and return types;
  - which revalidation and redirect calls they make.
- **It can't learn:**
  - consequences;
  - authorization policy;
  - preconditions on stored state;
  - idempotency;
  - external side effects;
  - a stable identity.

**For us:**

- **Right:**
  - **A binding target:** a Server Action is a good binding, addressed by module and export name, resolved at build time.
  - **The rule:** "verify authentication and authorization inside each one" is the invariant every binding needs.
  - **Effect signals:** revalidation calls are a statically visible signal for inferred effects.
- **Wrong:** an action ID can't be an identity.

### 4.6 OpenAPI and agent tooling

**OpenAPI 3.2.1** (10 September 2026): <https://spec.openapis.org/oas/v3.2.1.html>.

- **`operationId`:** "Unique string used to identify the operation" (§4.10.1).
- **Tags:** 3.2 adds a `parent` and a `kind` to tags (§4.22.1).
- **The Link Object:** "represents a possible design-time link for a response. The presence of a link does not guarantee the caller's ability to successfully invoke it, rather it provides a known relationship and traversal mechanism between responses and other operations" (§4.20). That's the only standardized typed relation between operations in this review.
- **Extensions:** `x-` fields, with reserved prefixes (§5).
- **Behavior:** safety and idempotency come only from the HTTP method.

**The Overlay Specification 1.2.0** (22 September 2026): <https://spec.openapis.org/overlay/v1.2.0.html>.

- **What it does:** it lets a third party change a description with JSONPath-targeted actions, without editing the source.
- **The catch:** applying an overlay produces a merged document, so who said what is lost.

**GPT Actions:** read at <https://developers.openai.com/api/docs/actions/production> (undated). OpenAI is moving custom GPTs to plugins, and their custom actions "need to be rebuilt separately" (<https://developers.openai.com/codex/migrate-custom-gpts>, for Enterprise).

- **`x-openai-isConsequential`:** this field controls whether the client "must always prompt the user for confirmation".
- **Defaults when it's absent:** "If the field isn't present, ChatGPT defaults all GET operations to `false` and all other operations to `true`."
- **Its significance:** a safety default inferred from the method, which our model would record as an inference.

**FastMCP** converts OpenAPI routes to MCP tools, where by default "All routes become tools". Its own documentation says models "achieve significantly better performance with well-designed and curated MCP servers" than with converted ones: <https://gofastmcp.com/integrations/openapi>. That's evidence for a curated capability layer above the binding.

**agents.json** describes "flows" of API calls over OpenAPI, at `/.well-known/agents.json`. It's at version 0.1.0, and dormant, with its last commit on 21 August 2025: <https://github.com/wild-card-ai/agents-json>.

### 4.7 Discovery documents

- **llms.txt v2** (August 2026), <https://llmstxt.org/>:
  - It's a Markdown index at `/llms.txt`, not under `/.well-known`.
  - It uses `rel="alternate" type="text/markdown"` and `rel="describedby"` links.
  - It discloses progressively by links: the file "stays small enough to fit in context".
  - It describes content, not actions.
- **The A2A Agent Card**, A2A 1.0 (release 1.0.1, May 2026), <https://a2a-protocol.org/latest/specification/>:
  - It's served at `/.well-known/agent-card.json` (§8.2).
  - It can be signed with JWS over JCS-canonicalized JSON (§8.4).
  - An authenticated extended card "MAY return different extended card content based on the authenticated client's identity or authorization level" (§13.3).
  - Its skills have no schemas.
- **The AI Catalog**, "a draft document", <https://ai-catalog.io/> (repository `Agent-Card/ai-catalog`):
  - It's a typed JSON container at `/.well-known/ai-catalog.json`, referenced by MCP SEP-2127.
  - Its **Trust Manifest** groups one contributor's claims, signed separately. "A signature over one manifest does not authenticate other manifests or other entry fields", and "Array order does not imply trust or precedence."
  - It's the closest prior art for attributable claims.
- **The MCP Registry** is in preview. It verifies ownership of reverse-DNS namespaces, not behavior: <https://modelcontextprotocol.io/registry/about>.

## 5. Reference matrix

**Adopt** means take the concept as it is. **Modify** means take the idea, changed as noted. **Reject** means leave it out of the IR.

| Concept                                                       | Source                              | Verdict | Reason                                                                                                           |
| ------------------------------------------------------------- | ----------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| Abstract operation separate from its protocol binding         | WoT TD, ALPS, OWL-S, Schema.org     | adopt   | One capability, many bindings: HTTP, Server Action, MCP tool, UI steps. Bindings are explicit, typed objects     |
| Binding inferred from a URI scheme, or HTTP default methods   | WoT TD                              | reject  | Implicit: the binding depends on the `href` scheme (TD 2.0 §8.1.3) and on assumed defaults (§5.4)                |
| Class-level capabilities vs instance-level offers             | Hydra, WoT Thing Models, ALPS       | adopt   | The manifest/projection split                                                                                    |
| Profiles without URLs; the server chooses what appears        | ALPS                                | adopt   | The manifest holds no routes or URLs; the projection decides disclosure                                          |
| `safe` and `idempotent`, false by default                     | WoT TD, RFC 9110 §9.2.1-9.2.2       | modify  | Keep the definitions, on every capability. An absent value is no claim (next row); enforcement reads it as false |
| An absent property means "no claim"                           | WoT TD (`synchronous` only)         | adopt   | Extended to every behavioral property: true, false or unknown. Enforcement treats unknown as the cautious value  |
| One enum for safety (`safe`/`idempotent`/`unsafe`)            | ALPS                                | modify  | Keep the words, as independent properties with an unknown state                                                  |
| Consequence flags (`consequentialHint`, `isConsequential`)    | WebMCP, OpenAPI tooling             | modify  | Declare the finer properties (financial, reversible, external) and derive "consequential" on export              |
| Tool annotations as context-free booleans                     | MCP                                 | modify  | Export to them; import them only as unverified claims                                                            |
| Preconditions and effects over a declared state vocabulary    | PDDL, OWL-S                         | adopt   | Inspectable and evaluable without code                                                                           |
| Conditions as free-form logic in any rule language            | OWL-S                               | reject  | Can't be validated or evaluated generically; hurt adoption                                                       |
| Named, parameterized predicates with `and`/`or`/`not`         | XState                              | adopt   | The serialized shape of a condition                                                                              |
| Guards as closures or scripts                                 | XState, SCXML                       | reject  | Not portable. Such conditions are marked opaque and enforced by the runtime                                      |
| Conditions must have no side effects                          | SCXML §5.9.1, App. B                | adopt   | As SCXML requires of its condition languages; true by construction of a vocabulary without calls                 |
| A condition that errors counts as false                       | SCXML                               | modify  | It's `unknown`, with a reason: never "available"                                                                 |
| The frame rule: unmentioned state persists                    | STRIPS/PDDL                         | adopt   | Makes declared effects checkable against observed ones                                                           |
| Derived "enables" edges (an effect meets a precondition)      | PDDL                                | adopt   | As relations with inferred provenance, distinct from declared ones                                               |
| Feature levels (`:requirements`)                              | PDDL                                | adopt   | Vocabulary profiles a consumer can decline                                                                       |
| "Physics, not advice"                                         | PDDL 2.1                            | adopt   | Availability is physics; recommendation is advice, carried as an attributed claim                                |
| Conditional outcomes, each with its own output and effect     | OWL-S `Result`                      | adopt   | Per-outcome effects (success, failure, partial)                                                                  |
| True vs believed vs recorded                                  | OWL-S §5.2                          | adopt   | The basis of the provenance levels                                                                               |
| Selective advertising                                         | OWL-S §4.1                          | modify  | Discoverability is a separate concept, as an explicit, inspectable policy                                        |
| A non-triggering prerequisite edge                            | Arazzo `dependsOn`                  | adopt   | The meaning of `requires`                                                                                        |
| Ordered steps, `goto`, `retry`, `end`                         | Arazzo, OWL-S                       | reject  | Workflow control. Arazzo is an export target for a chosen path                                                   |
| Lifecycle states named by capabilities                        | SCXML transitions; XState `stateIn` | modify  | As annotations, with no interpreter                                                                              |
| Links as context, type, target and attributes                 | RFC 8288                            | adopt   | The shape of a relation                                                                                          |
| Registered relation tokens plus URI extensions                | RFC 8288                            | adopt   | A small closed core plus namespaced extensions                                                                   |
| Typed link from a response to a next operation                | OpenAPI Link Object                 | modify  | Generalized to `produces`/`requires` over resource types; explicitly not availability                            |
| Absence as the only unavailability signal                     | Siren, HAL, Hydra                   | reject  | Unavailable offers stay visible, with a reason                                                                   |
| JSON Schema for input, output and template variables          | Hyper-Schema, MCP, AI SDK, v0       | adopt   | One schema language, and direct export                                                                           |
| HTML-input-like inputs, the TD `DataSchema`                   | Siren, Schema.org, WoT TD           | reject  | JSON Schema instead                                                                                              |
| Declarative usability over instance data (`templateRequired`) | Hyper-Schema                        | modify  | Generalized into named conditions over resource, caller and authorization                                        |
| "Advisory", "hint", "may be inconsistent" markers             | Hyper-Schema, Hydra, HAL            | modify  | Replaced by explicit provenance on each claim                                                                    |
| Action types as cross-site semantic identity                  | Schema.org                          | modify  | An optional external type IRI on a capability, without JSON-LD processing                                        |
| Domain outcomes (`object`, `result`)                          | Schema.org                          | adopt   | As `operatesOn` and `produces`                                                                                   |
| `actionStatus`                                                | Schema.org                          | modify  | For an invocation's lifecycle, never for availability                                                            |
| A tool list that varies by authorization, not by connection   | MCP                                 | adopt   | Projection is a function of declared context                                                                     |
| Deterministic ordering                                        | MCP                                 | adopt   | Stable projections for caching and comparison. Order isn't a ranking unless the policy declares one              |
| A static manifest as a basis for trust                        | (rejected by MCP SEP-2127, WebMCP)  | reject  | The IR is a declaration. Projection evaluates context; execution re-checks authorization                         |
| Progressive discovery: catalog, then inspect, then execute    | MCP guidance, AI SDK, UI SDK        | adopt   | As a declared discovery policy of the runtime, not a meta-tool                                                   |
| Truncation with an explicit "more" marker                     | UI SDK                              | adopt   | Disclosure states what it left out                                                                               |
| Approval as data with a reason                                | AI SDK                              | adopt   | The runtime's approval decisions are recorded                                                                    |
| Approval policy on the definition (`needsApproval`)           | AI SDK (deprecated)                 | reject  | The IR declares properties; policy derives approval from them                                                    |
| Definition digests (`fingerprintTools`)                       | AI SDK                              | adopt   | Content digests let consumers pin definitions                                                                    |
| Signed, canonicalized documents (JWS over JCS)                | A2A                                 | adopt   | Integrity of a deterministic manifest                                                                            |
| Claims grouped and signed per contributor                     | AI Catalog Trust Manifest           | adopt   | The model for attributable claims                                                                                |
| Third-party changes merged into the description               | OpenAPI Overlay                     | modify  | Keep third-party claims separate, with their author                                                              |
| Effects observed after the fact, with their source            | UI SDK `act`, `subscribe`           | adopt   | As observed evidence, kept separate from declared effects                                                        |
| Actions inferred from method names                            | UI SDK                              | reject  | At most an inferred import, never a declaration                                                                  |
| Rotating, build-scoped handles as identity                    | Next.js action IDs                  | reject  | Identity is the IR's; handles are binding details                                                                |
| Reverse-DNS namespaces with verified ownership                | MCP Registry                        | adopt   | For manifest and capability namespaces                                                                           |
| `Link` header or `describedby` pointing to the manifest       | Hydra, RFC 8288, llms.txt           | adopt   | Discovery without a new well-known path                                                                          |
| RDF, OWL or JSON-LD as the base model                         | Hydra, OWL-S, WoT TD                | reject  | Plain JSON with optional IRIs; a JSON-LD context can be offered later for interop                                |

## 6. Research deliverables

### 6.1 Precedents

- **Machine-readable services are older than agents.** OWL-S (2004) set out to let agents "discover, invoke, compose, and monitor" services, with profiles, processes, groundings, preconditions and effects. That's most of this project's vocabulary, twenty years earlier.
  - **It didn't take hold:** Verborgh et al. 2015 and Bachlechner 2008 cite tools, bindings and complexity (§1.3).
  - **What's different now** is the consumer: language-model agents read descriptions, so a manifest with partial semantics is still useful to them.
  - **What isn't different:** the tooling has to come with the format.
- **Separating meaning from binding** is the most consistent idea across WoT, ALPS, OWL-S and Schema.org.
- **Declared controls that depend on state** come from hypermedia: Siren's actions in the representation, and Hydra's operations per instance.
- **Declarative preconditions and effects** come from planning: STRIPS and PDDL.
- **Untrusted self-description** is the current agent protocols' settled position (MCP, WebMCP, AI SDK).
- **Selective disclosure as a choice architecture** has its precedent in OWL-S's selective advertising (§4.1). Its risks are documented in research on dark patterns for web agents (see [dark-patterns.md](./dark-patterns.md)).

### 6.2 Candidate naming

This section is input for the terminology document, not a decision.

- **Capability.**
  - **Keep it** for the definition. It's what WoT would call an interaction affordance.
  - **Collision:** MCP and A2A use "capabilities" for protocol feature negotiation.
  - **Say so in the docs,** and use `CapabilityDefinition` or `Capability` in types, never a bare `capabilities` field on anything that also speaks MCP.
- **Affordance.**
  - **WoT uses it** for the abstract interaction (§1.1). The project's name already means this, which is a point in its favor.
  - **Avoid a type called `Affordance`,** which would collide with WoT's.
- **Capability kinds.**
  - **The collision:** "action" collides with React (`action`, `useActionState`), Next.js Server Actions, XState actions (side effects) and Schema.org `Action`. "Query" collides with UI SDK's `query()`. "Tool" belongs to AI SDK and MCP.
  - **Low-cost uses:** as a discriminant value (`kind: 'action'`), the collision costs little.
  - **What to avoid:** exported identifiers named `action`, `Action`, `tool`, `query` or `act`.
  - **One option:** `kind: 'query' | 'action' | 'event'`, with types `QueryCapability`, `ActionCapability` and `EventCapability`.
  - **Rejected:** "Operation" belongs to Hydra and OpenAPI, and "command" and "mutation" carry CQRS and GraphQL meanings.
- **Offer.**
  - **Collision:** schema.org's `Offer` is a commercial offer, with `addOn` for bundled extras.
  - **Why it matters:** in a store, "the offer" is ambiguous, and the benchmark's fixtures are a store.
  - **Prefer:** a qualified name, never a bare `Offer`. Queries are offered as well as actions, so `CapabilityOffer` fits better than `ActionOffer`.
- **Effect.**
  - **The good:** PDDL and OWL-S use it in the planning sense, which is right.
  - **Collision:** v0's `effects` lists entity keys for deltas.
  - **Prefer:** keep "effect" for the IR, and document v0's field as "changed entities". Or call the IR's richer structure "consequences" in prose. The two must not be conflated: a v0 effect names state to send back, and an IR effect describes a consequence.
- **Precondition, condition, guard.**
  - **Condition:** "condition" for the declarative IR predicate.
  - **Guard:** "guard" for the opaque, runtime-enforced check. That matches v0's authoring API (`defineAction`'s `guard` function, `packages/core/src/action.ts`) and XState. It doesn't match v0's wire format, where `guard` is the human-readable precondition text (`packages/protocol/spec.md`, the action descriptor). Docs have to say which one they mean.
  - **Precondition:** "precondition" only where a condition gates execution, not applicability.
- **Relation.**
  - **Prefer "relation"** (RFC 8288's "relation type") to "link", which suggests navigation and URLs.
  - **`alternativeTo` against IANA's `alternate`:** the IANA registry describes `alternate` as "Refers to a substitute for this context", read in HTML and Atom as another representation of the same resource, not an alternative action. Name ours so it can't be confused, and never export it as `rel="alternate"`.
- **Claim.**
  - **The fit:** good for attributed statements, and the AI Catalog's trust manifest uses the same idea.
  - **The collision:** JWT "claims" (RFC 7519 §4) in authentication code. Qualify it where both appear (`CapabilityClaim`).
- **Provenance, declared, inferred, imported, observed, verified.**
  - **"Hint":** no source uses these levels, but "hint" is the field's word for an unverified assertion (MCP, WebMCP).
  - **Docs:** describe imported annotations as "hints, recorded as imported claims".
- **Safe, idempotent:** reuse them with RFC 9110's meanings (§9.2.1, §9.2.2). WoT's and ALPS's definitions are compatible with them, though neither cites the RFC.
- **Consequential:** reuse it as the export name for the combined flag, defined from the finer properties.
- **Binding:** prefer it to "grounding" (OWL-S), "form" (WoT, which collides with HTML forms) or "entry point" (Schema.org).
- **Manifest:**
  - **Keep "capability manifest".** WebMCP's README argues against "static manifests", so the docs should say what this manifest is and isn't: a declaration, not an authorization or a live tool list.
- **Profile, domain, context, snapshot:**
  - **Profile:** it means three things across WoT, ALPS and OWL-S. Avoid it.
  - **Domain:** PDDL's sense collides with web domains. Avoid it.
  - **Context:** it collides with React, XState and JSON-LD's `@context`. Qualify it as `DiscoveryContext`.
  - **Snapshot:** it belongs to UI SDK and XState. Avoid it.
- **Identifiers:**
  - **Dotted IDs** (`commerce.cart.addItem`) fit MCP's tool-name guidance (SHOULD be 1-128 characters of `[A-Za-z0-9_.-]`) and WebMCP's normative rule, so a capability ID exports as a tool name unchanged.
  - **A namespace:** a manifest-level namespace, either reverse-DNS as in the MCP Registry or a URI as with RFC 8288 extensions, makes IDs global.

### 6.3 Common primitives

Across the sources, the recurring primitives are:

- **A named operation with a typed input,** usually JSON Schema:
  - WoT `input`;
  - Hydra `expects`;
  - Hyper-Schema `submissionSchema`;
  - Arazzo `inputs`;
  - MCP, WebMCP and AI SDK `inputSchema`;
  - PDDL `:parameters`.
- **An output or result:**
  - WoT `output`;
  - Hydra `returns`;
  - Hyper-Schema `targetSchema`;
  - Schema.org `result`;
  - MCP `outputSchema`;
  - OWL-S `Result`.
- **A binding:** WoT `Form`, the Schema.org `EntryPoint`, the OWL-S grounding, Arazzo `sourceDescriptions`, an MCP tool's transport.
- **A boolean gate:**
  - WoT security;
  - Hyper-Schema `templateRequired`;
  - SCXML `cond`;
  - XState guards;
  - PDDL preconditions;
  - Arazzo criteria.
- **Read-only against mutating:**
  - WoT `safe`;
  - ALPS `type`;
  - MCP `readOnlyHint`;
  - WebMCP `readOnlyHint`;
  - HTTP method semantics.
- **Typed relations:** RFC 8288 links, HAL `_links`, Hydra link properties, OpenAPI Link Objects.
- **A type-level description, instantiated:**
  - WoT Thing Model → Thing Description;
  - Hydra `supportedOperation` → `operation`;
  - ALPS profile → representation;
  - PDDL domain → problem.

### 6.4 Incompatibilities

- **Where the method lives:**
  - **Bound to methods:** Siren and Hydra bind operations to HTTP methods.
  - **Refuses to:** Hyper-Schema (§8.1).
  - **Separate:** Schema.org and WoT keep the method separate.
  - The IR has to keep methods in bindings only.
- **Input description** comes in five forms: HTML5 input types (Siren), RDF classes (Hydra), JSON Schema (Hyper-Schema, MCP, AI SDK), HTML-input-like constraints (Schema.org's `PropertyValueSpecification`) and WoT's `DataSchema`. Import from the non-JSON-Schema forms loses detail.
- **Safety encodings don't map one to one.** ALPS's single enum can't say "unknown". MCP's `destructiveHint` has no counterpart elsewhere. WebMCP has no idempotency hint. Export to each target is lossy, and needs a documented rule per target.
- **Closed world against open world.** PDDL assumes complete, known state, which doesn't hold for web applications. The IR's conditions need a third value.
- **Ordering:**
  - SCXML resolves conflicts by document order.
  - MCP asks for a deterministic order.
  - The IR is unordered JSON, so order must never carry meaning implicitly.
- **Scope of variation:**
  - MCP forbids tool sets that vary per connection.
  - WebMCP and v0 scope tools to a page and a session.
  - An MCP export of a projection has to choose: export per authorization, or keep per-page offers out of the MCP surface.
- **Identity:**
  - Free strings: Siren classes, AI SDK tool names.
  - IRIs: Hydra, Schema.org.
  - Session refs: UI SDK.
  - Rotating build handles: Next.js.
  - Only the IR can carry the stable identity.
- **Trust models:**
  - Per server: MCP.
  - Per origin: WebMCP.
  - Per signed contributor: AI Catalog.
  - Out of band: Gmail.
  - None is per claim. Import has to map each of them into per-claim provenance.
- **"Capability" itself** means feature negotiation in MCP and A2A.

### 6.5 Interoperability

**Export from the IR or a projection:**

- **MCP tools and WebMCP `registerTool`,** with the annotations derived from the IR's behavioral properties:
  - `readOnlyHint` from `safe`;
  - `idempotentHint` from `idempotent`;
  - `destructiveHint` and `consequentialHint` from the financial, reversible and external properties;
  - `untrustedContentHint` for outputs that carry third-party content.
- **AI SDK tool sets:**
  - `inputSchema` through `jsonSchema()`;
  - a default `toolApproval` map derived from declared properties;
  - `deferLoading` for offers the discovery policy hasn't disclosed;
  - `activeTools` from availability.
- **Schema.org `potentialAction`** with an `EntryPoint`, using an Action type where one fits.
- **Hypermedia:** Siren `actions` for available offers, HAL `_links` and RFC 8288 `Link` headers for relations.
- **Arazzo** for a chosen multi-step path, with `sourceDescriptions` pointing to the application's OpenAPI document.
- **XState** configurations made only of named guards, for a resource lifecycle, which existing visualizers can draw.
- **PDDL level 1** from the condition and effect core, so off-the-shelf planners can answer reachability questions in the benchmark.
- **A WoT Thing Description:** capabilities as action, property and event affordances, with `safe` and `idempotent` carried over directly.
- **An ALPS profile:** the schemas are lost.

**Import into the IR**, always with provenance below declared:

- **OpenAPI operations:**
  - `operationId` as a binding, never as identity;
  - method-derived safety as inferred;
  - `x-openai-isConsequential` as an imported claim;
  - overlays kept per author.
- **MCP tools:** annotations as imported claims.
- **Server Actions:** module and export names, types as schemas, revalidation calls as inferred effects. Safety and consequences must be declared.
- **UI SDK:**
  - declared component actions as UI bindings for capabilities;
  - `act` results and `subscribe` events as observed evidence;
  - `data-agent-confirm` generated _from_ declared effects, so the sentence has one source.
- **WebMCP's declarative forms**, if they return to the spec, as inferred capabilities.

**Discovery:**

- a `Link: rel="describedby"` header or element pointing to the manifest;
- an entry in an AI Catalog, with trust manifests for verified claims;
- a manifest signed with JWS over JCS.

### 6.6 What Affordances has to introduce

No reviewed source provides these. Each is a contribution the RFCs have to specify and test.

1. **Availability, discoverability, relevance, salience and publisher preference as separate concepts.**
   - Precedents exist for parts: v0's `available` and `reason`, UI SDK's `disabled`, MCP's authorization-scoped lists, OWL-S's selective advertising.
   - None separates all five, or gives a reason for unavailability alongside "not yet disclosed".
2. **Claims with per-claim provenance.**
   - The levels are declared, inferred, imported, observed and verified.
   - A publisher's recommendation must be structurally distinct from a verified property.
   - The AI Catalog's per-contributor manifests are the nearest model; OWL-S's distinction between belief and truth is the nearest theory.
3. **A small, closed condition vocabulary,** with three-valued evaluation (true, false, unknown) and explicitly opaque conditions that only the runtime enforces. PDDL gives the semantics and XState the serialized shape. Neither gives the open-world third value or the opaque marker.
4. **Declared against observed effects.** PDDL declares and UI SDK observes. No source keeps both and compares them.
5. **Behavioral properties beyond safe and idempotent:**
   - **The properties:** financial, reversible, external, with an unknown default.
   - **What exists:** MCP's SEP-2793 proposes something similar and is an unsponsored draft; WebMCP collapses them all into `consequentialHint`.
6. **Typed relations between capabilities,** with defined semantics: `requires`, `produces`, `enables` (derived or declared, and not "always makes executable"), `alternativeTo`, `contains`, `operatesOn`.
7. **Disclosure policy as a variable separate from the manifest.** Projecting the same definitions under exhaustive, progressive, relevance-ordered or advocated policies is what makes choice architecture measurable. Every reviewed system ties disclosure to its definitions or to host code.
8. **The rule that an offer is never authorization,** stated and tested. WoT ("describe, don't grant"), MCP (SEP-2127) and Next.js ("verify authentication and authorization inside each one") each state part of it.

### 6.7 Assumptions to validate experimentally

These are hypotheses. The benchmark and the prototypes have to test them.

1. Agents use declared preconditions and effects to plan, rather than ignoring them in favor of names and descriptions.
2. An unavailable offer shown with a reason helps more than it distracts. For example, an agent tries to satisfy the condition rather than abandoning the task, or repeatedly retrying.
3. Progressive disclosure cuts tokens and calls without lowering how often agents find the alternative that best fits the stated intent.
4. Agents treat attributed publisher claims differently from properties marked verified. If they don't, provenance has to be enforced by harnesses, not just represented.
5. Agents verify a declared dependency, or at least an `alternativeTo` relation, before following a costly path.
6. Order and recommendation fields change choices among otherwise identical options (the salience effect), and the size of that effect differs by model.
7. A capability ID that's stable across transports lets an agent carry what it learned from one surface (say, HTTP) to another (say, MCP).
8. Inferred semantics from a Next.js compiler, such as revalidation calls as effects, are accurate enough to be worth showing, once labeled as inferred.
9. Export to MCP and WebMCP annotations loses nothing an agent uses in practice, or what it loses can be measured.
10. A small condition vocabulary covers most real guards in existing Affordances applications, and the rest can honestly be marked opaque. A survey of the guards in existing applications is still to be done. The repository audit describes the mechanism and three example guards, not a survey.

## 7. Gaps in this review

- **Harel 1987:** we read the abstract and bibliographic record; the full copies we tried were unavailable. A partial copy is at <https://www.academia.edu/2838085>. Nothing here depends on the paper's text.
- **PDDL 1.2 (1998) and STRIPS (Fikes and Nilsson, 1971):** cited, not read. The PDDL facts come from Fox and Long (2003).
- **JSON Hyper-Schema:** that it's unmaintained isn't confirmed on the current site.
- **GPT Actions:** the page is undated.
- **Resolved since the first draft:**
  - WebMCP's origin trials run in Chrome M149-156, extended to 162, and Edge's expires on 30 March 2027.
  - `createMCPClient` lost its `experimental_` prefix in `@ai-sdk/mcp` 1.0.0-beta.40 (18 December 2025), stable in 1.0.0 (22 December 2025).
  - Next.js documents no public manifest of a build's actions. The only lookup is next-devtools-mcp's `get_server_action_by_id`.
- **Related work on dark patterns and GUI agents** (arXiv:2509.10723, arXiv:2510.11035) is named in [dark-patterns.md](./dark-patterns.md) and not yet read.
