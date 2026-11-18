# Specification roadmap: what a future standard would fix, and what is still open

This document is M8d of the [roadmap](roadmap.md). It looks back over what RFCs 0001 to 0005 built and measured, and asks
two questions: which parts are settled enough for a future specification to standardize, and which parts are still
open. It's a planning document, not a specification, and changes no RFC. All five RFCs are accepted, each with its
amendments since, as their Status lines record.

Each item is graded by its evidence:

- **Built and tested:** implemented, with deterministic tests, and accepted in review.
- **Measured:** also exercised by a pre-registered benchmark run (RFC 0003), with its record committed.
- **Proposed:** written down, not built.

## 1. Candidates for standardization

### 1.1 The capability IR (RFC 0001)

| Part                                        | What a specification would fix                                                                                                              | Evidence                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Resources, capabilities and principals (§2) | The minimal primitive: a typed resource, a capability over it, and the principal attributes a manifest declares                             | Built and tested                                                                                                     |
| Conditions (§3)                             | The three-valued (Kleene) expression vocabulary, with bounded `some`, `every` and `count`; `unknown` as a first-class result, never coerced | Built and tested; the conformance kit's falsifier keeps each case falsifying, or fails it with the reason (3cfbac54) |
| Effects and charges (§4)                    | Declared effects, with amount operands, and the rule that a confirmation summary lists every financial charge                               | Built and tested                                                                                                     |
| Relations (§5)                              | `alternativeTo`, `enables` and `relatedTo`, and the derived edges                                                                           | Built and tested                                                                                                     |
| Identity (§6)                               | Capability ids, their stability across releases, and bindings to an implementation                                                          | Built and tested                                                                                                     |
| Canonical form and digest (§7)              | RFC 8785 canonical JSON, and the manifest digest over it                                                                                    | Built and tested                                                                                                     |
| Provenance and claims (§8, §9)              | Every fact carries provenance; a claim is a statement from an owner, a tool or a third party, and names the target attributes it cites      | Built and tested (citations since 900f4db4)                                                                          |

### 1.2 Contextual projection (RFC 0002)

| Part                                                         | What a specification would fix                                                                                                                                                                   | Evidence                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offers and availability (§4)                                 | An offer per capability and target, with one of five availability statuses (`available`, `unavailable`, `unknown`, `needs-input` and `needs-authorization`), and the reason                      | Built and tested                                                                                                                                                                                                                                                                                                        |
| Choice sets (§5)                                             | The members of one decision. (`alternativeTo` between capabilities is a separate rule, §6.3, not a choice set)                                                                                   | Built and tested                                                                                                                                                                                                                                                                                                        |
| Policies, views, expansion and inspection (§6.1, §6.2, §6.5) | A discovery policy decides what a view shows first; expansion and inspection reach the rest                                                                                                      | Built and tested                                                                                                                                                                                                                                                                                                        |
| The disclosure invariant (§6.3)                              | Whatever a policy hides stays reachable, and nothing a view omits changes what's true                                                                                                            | Built and tested; a generated invariant test                                                                                                                                                                                                                                                                            |
| A choice set carries its comparison (§6.6)                   | Every choice set in a view carries a table of its members' differing attributes. No policy can cut it, nor any attribute that a condition, effect, input, citation or confirmation summary reads | Built and tested (c2ee930c). Motivated by M5: the advocated policy's view left out the one offer carrying the plans' allowances, and agents that never saw it chose worse. That split is post hoc and descriptive, and M5 establishes no mechanism (`apps/choice-bench/results/M5-REPORT.md`, H2 and its validity note) |
| Execution and approval (§8)                                  | The effective input (schema defaults applied) is the one value that's approved, summarized and executed. The approval token binds the rendered summary, charges included, and is single-use      | Built and tested                                                                                                                                                                                                                                                                                                        |
| The resolver contract (§2.1)                                 | A resolver MUST return nothing for a resource its principal can't read. The runtime doesn't check it; the conformance kit does (`resolverConformance`)                                           | Built and tested                                                                                                                                                                                                                                                                                                        |

### 1.3 The wire and its transports (RFC 0004)

| Part                                      | What a specification would fix                                                                                                                                                                                                                                                                                            | Evidence                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery (§2.1)                          | The site index's additive `capabilities: { manifest, base }` field, and the manifest served with its digest as its `ETag`                                                                                                                                                                                                 | Built and tested; experimental                                                                                                                                         |
| Endpoints (§2.2, §2.3)                    | `view`, `expand`, `inspect`, `check` and `execute`, and the rules they keep: the `Origin` check against the request's own origin for cookie-authenticated POSTs (bearer calls are exempt), private caching for any credentialed response, and, in the Next.js route, failing closed without an approval key (RFC 0005 §5) | Built and tested                                                                                                                                                       |
| The generic tool surface (§3)             | The four tools, the same on every transport                                                                                                                                                                                                                                                                               | Built and tested; measured (M7f)                                                                                                                                       |
| Confirmation on agent transports (§4, §5) | The model never holds an approval token. On MCP the server elicits the person's consent; on WebMCP the page does. No tool channel ever yields an approval                                                                                                                                                                 | Built and tested; on real model runs, no product transport gave a model a token (`apps/choice-bench/results/surfaces/pilot-2026-11-18/README.md`, the security result) |
| v0 compatibility (§1, §8, §9)             | v0's documents stay byte-identical for apps without capabilities                                                                                                                                                                                                                                                          | Built and tested: the new route's site index is byte for byte v0's at the same commit (`packages/next/test/discovery.test.ts`)                                         |

### 1.4 Compilation (RFC 0005)

Compilation is a framework concern, not part of a wire specification. What would carry over is its contract: what may be
inferred (§2.1), what must always be declared (§2.2), and the measured limit. On two apps, after the id codemod (as
written, neither app had ids, so nothing was extracted), extraction recovered bindings, kinds, authorization and
confirmation exactly, but not the ids themselves, which the developer chooses (RFC 0005 §7,
`rfcs/research/0005-measurement/`).

## 2. What the benchmark says, and doesn't

- **M5 (RFC 0003, T6, two models):**
  - **H1, a steering policy against exhaustive disclosure:** not rejected.
  - **H2, the advocated policy against exhaustive:** rejected, with the advocated policy lower, mostly on one model.
  - **H2's validity note:** it measured the advocated policy as a whole, which narrowed the first view's scope, not the owner's claims alone. §6.6 is the product fix.
- **M7f (the surface comparison, T6 with the person's approval stated on every surface):** a ceiling. All 400 trials were optimal, so T6 doesn't separate full, progressive, v0 and browser for these two models. That isn't evidence that the surfaces are equal in general (`apps/choice-bench/results/surfaces/confirmatory-2026-11-18/README.md`).
- **So neither run supports a normative claim that one disclosure surface leads agents to better choices.** What they do support is narrower:
  - in M5, agents under the advocated scope that never saw the deciding fact chose worse. That's post hoc and descriptive, with no mechanism established. §6.6 now keeps such a fact on every view of the set;
  - on real model runs, no product transport gave a model an approval token.

## 3. Open

### 3.1 From the RFCs' own open questions

- **Signing and namespace proof** (RFC 0001 §16, questions 4 and 5; RFC 0004 §10): a detached signature over the canonical bytes is straightforward. Whether manifests are signed, and how a namespace is proved before third-party claims may name it, are distribution decisions.
- **A guard language** (RFC 0001 §16, question 2): guards stay opaque. The guard survey found no case for one yet.
- **Conditional outcomes** (RFC 0001 §16, question 3): post-state conditions on effects.
- **Partial attribute visibility** (RFC 0002 §13, question 2): today an attribute the principal may not see is left out, so conditions on it are `unknown`. Whether a manifest declares per-attribute visibility is open.
- **Events** (RFC 0002 §13, question 3; RFC 0004 §10, question 2): the `event` kind has no wire yet.
- **Approval expiry** (RFC 0002 §13, question 4): the default needs experience.
- **Cross-manifest projections** (RFC 0002 §13, question 5): two principals and two runtimes.
- **Per-capability MCP for authenticated capabilities** (RFC 0004 §10, question 1): today only capabilities with authorization `any` can be per-capability tools, and M7c measured that this mode loses most of the declared fields on the reference app.
- **Mixed apps** (RFC 0005 §9, question 2): one namespace holding capabilities from v0 and from the IR.

### 3.2 Found while building

- **View-following WebMCP registration** (RFC 0004 §5): not built. The per-capability option registers a fixed list. The generic mode is the default.
- **In-tool WebMCP consent:** waits for the browser's request for user interaction. Until then, WebMCP fails closed, and the person confirms in the app's own review page (RFC 0004 §5).
- **The resolver contract's enforcement:** a conformance check only. A runtime that enforced read scoping itself would need a principal-aware resource model, which in the planner's estimate is a larger change.
- **§6.6 covers attributes, not relations:** a deciding fact reached through a relation, such as the regions a plan is served from, isn't in a choice set's comparison. Whether the comparison should follow declared relations is open; a later benchmark packet's task, T8, is built on exactly this case.
- **Reference-sourced parameters** (RFC 0005 §4): not built. Compilation doesn't yet derive a route parameter from a resource reference.
- **Strict JSON Schema validators** reject unknown fields in the published v0 schemas, against the v0 spec's rule that clients ignore them. The fix, opening the received documents' schemas, is prepared and not released. A release that emits the discovery field should ship that fix with it or before it.

- **Two open optimizations,** recorded rather than changed (M8's simplification pass):
  - the stateless HTTP `inspect` and `expand` re-project on every call; offer-scoped inspection would avoid it;
  - a checked v0 call projects twice.

### 3.3 For the benchmark

- **A task that separates the surfaces:** M7f hit a ceiling. A harder pre-registered task, with a pilot headroom gate blind to the contrast, is a later packet.
- **Multi-turn users** (RFC 0003 §15, question 3): a trial has no user replies, so an agent that asks the user a question ends its trial.
- **Drivers:** the runs used CLI agents only. One CLI's own global instructions couldn't be isolated, so it was dropped. MCP couldn't complete a confirmation non-interactively, so it's reported on the intended choice only.

## 4. What a first specification could be

A first version could standardize §1.1 to §1.3 as one document: the IR and its canonical form, the projection's
invariants (§6.3 and §6.6) and its execution contract, and the wire with its confirmation rule. Each part is built,
tested and accepted. §3 would be its list of non-goals and future work. The benchmark's results would stay in their own
reports: as §6.6's motivation, and as evidence for the token rule, not as claims about which surface is best.
