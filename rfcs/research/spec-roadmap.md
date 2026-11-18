# Specification roadmap: what a future standard would fix, and what is still open

This document is M8d of the [roadmap](roadmap.md). It looks back over what RFCs 0001 to 0005 built and measured, and asks
two questions: which parts are settled enough for a future specification to standardize, and which parts are still
open. It's a planning document, not a specification. Nothing here changes an accepted RFC.

Each item is graded by its evidence:

- **Built and tested:** implemented, with deterministic tests, and accepted in review.
- **Measured:** also exercised by a pre-registered benchmark run (RFC 0003), with its record committed.
- **Proposed:** written down, not built.

## 1. Candidates for standardization

### 1.1 The capability IR (RFC 0001)

| Part                                        | What a specification would fix                                                                                                              | Evidence                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Resources, capabilities and principals (§2) | The minimal primitive: a typed resource, a capability over it, and the principal attributes a manifest declares                             | Built and tested                                                                              |
| Conditions (§3)                             | The three-valued (Kleene) expression vocabulary, with bounded `some`, `every` and `count`; `unknown` as a first-class result, never coerced | Built and tested; the conformance kit's falsifier keeps cases falsifying (§3, M5 boundary #3) |
| Effects and charges (§4)                    | Declared effects, with amount operands, and the rule that a confirmation summary lists every financial charge                               | Built and tested                                                                              |
| Relations (§5)                              | `alternativeTo`, `enables` and `relatedTo`, and the derived edges                                                                           | Built and tested                                                                              |
| Identity (§6)                               | Capability ids, their stability across releases, and bindings to an implementation                                                          | Built and tested                                                                              |
| Canonical form and digest (§7)              | RFC 8785 canonical JSON, and the manifest digest over it                                                                                    | Built and tested                                                                              |
| Provenance and claims (§8, §9)              | Every fact carries provenance; a claim is an owner's statement, and names the target attributes it cites                                    | Built and tested (citations since M7a)                                                        |

### 1.2 Contextual projection (RFC 0002)

| Part                                       | What a specification would fix                                                                                                                                                                   | Evidence                                                                                                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offers and availability (§4)               | An offer per capability and target, with `available`, `unavailable` or `unknown`, and the reason                                                                                                 | Built and tested                                                                                                                                                                                                                                                 |
| Choice sets (§5)                           | Members of one decision, from the same choice set plus `alternativeTo`                                                                                                                           | Built and tested                                                                                                                                                                                                                                                 |
| Policies and views (§6.1, §6.2)            | A discovery policy decides what a view shows first; expansion and inspection reach the rest                                                                                                      | Built and tested                                                                                                                                                                                                                                                 |
| The disclosure invariant (§6.3)            | Whatever a policy hides stays reachable, and nothing a view omits changes what's true                                                                                                            | Built and tested; a generated invariant test                                                                                                                                                                                                                     |
| A choice set carries its comparison (§6.6) | Every choice set in a view carries a table of its members' differing attributes. No policy can cut it, nor any attribute that a condition, effect, input, citation or confirmation summary reads | Built and tested (M7a). Motivated by a measured failure: in M5, the advocated policy's view left out the one offer carrying the plans' allowances, and agents that never saw it chose worse (`apps/choice-bench/results/M5-REPORT.md`, H2 and its validity note) |
| Execution and approval (§8)                | The effective input (schema defaults applied) is the one value that's approved, summarized and executed. The approval token binds the rendered summary, charges included, and is single-use      | Built and tested                                                                                                                                                                                                                                                 |
| The resolver contract (§2.1)               | A resolver MUST return nothing for a resource its principal can't read. The runtime doesn't check it; the conformance kit does (`resolverConformance`)                                           | Built and tested                                                                                                                                                                                                                                                 |

### 1.3 The wire and its transports (RFC 0004)

| Part                                      | What a specification would fix                                                                                                                                                                                                         | Evidence                                                                                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery (§2.1)                          | The site index's additive `capabilities: { manifest, base }` field, and the manifest served with its digest as its `ETag`                                                                                                              | Built and tested; experimental                                                                                                                                         |
| Endpoints (§2.2, §2.3)                    | `view`, `expand`, `inspect`, `check` and `execute`, and the rules every endpoint keeps: the `Origin` check against the request's own origin, private caching for any credentialed response, and failing closed without an approval key | Built and tested                                                                                                                                                       |
| The generic tool surface (§3)             | The four tools, the same on every transport                                                                                                                                                                                            | Built and tested; measured (M7f)                                                                                                                                       |
| Confirmation on agent transports (§4, §5) | The model never holds an approval token. On MCP the server elicits the person's consent; on WebMCP the page does. No tool channel ever yields an approval                                                                              | Built and tested; on real model runs, no product transport gave a model a token (`apps/choice-bench/results/surfaces/pilot-2026-11-18/README.md`, the security result) |
| v0 compatibility (§1, §8, §9)             | v0's documents stay byte-identical for apps without capabilities                                                                                                                                                                       | Built and tested (a golden comparison with the previous release)                                                                                                       |

### 1.4 Compilation (RFC 0005)

Compilation is a framework concern, not part of a wire specification. What would carry over is its contract: what may be
inferred (§2.1), what must always be declared (§2.2), and the measured limit. On two apps, extraction recovered
bindings, kinds, authorization and confirmation exactly, but not ids, which the developer chooses (RFC 0005 §7,
`rfcs/research/0005-measurement/`).

## 2. What the benchmark says, and doesn't

- **M5 (RFC 0003, T6, two models):**
  - **H1, a steering policy against exhaustive disclosure:** not rejected.
  - **H2, the advocated policy against exhaustive:** rejected, with the advocated policy lower, mostly on one model.
  - **H2's validity note:** it measured the advocated policy as a whole, which narrowed the first view's scope, not the owner's claims alone. §6.6 is the product fix.
- **M7f (the surface comparison, T6 with the person's approval stated on every surface):** a ceiling. All 400 trials were optimal, so T6 doesn't separate full, progressive, v0 and browser for these two models. That isn't evidence that the surfaces are equal in general (`apps/choice-bench/results/surfaces/confirmatory-2026-11-18/README.md`).
- **So neither run supports a normative claim that one disclosure surface leads agents to better choices.** What they do support is narrower:
  - a view that hides the deciding facts leads to worse choices, which §6.6 now prevents;
  - the safety rules held on real runs.

## 3. Open

### 3.1 From the RFCs' own open questions

- **Signing and namespace proof** (RFC 0001 §16, questions 4 and 5; RFC 0004 §10): a detached signature over the canonical bytes is straightforward. Whether manifests are signed, and how a namespace is proved before third-party claims may name it, are distribution decisions.
- **A guard language** (RFC 0001 §16, question 2): guards stay opaque. The guard survey found no case for one yet.
- **Conditional outcomes** (RFC 0001 §16, question 3): post-state conditions on effects.
- **Partial attribute visibility** (RFC 0002 §13, question 2): today an attribute the principal may not see is left out, so conditions on it are `unknown`. Whether a manifest declares per-attribute visibility is open.
- **Events** (RFC 0002 §13, question 3; RFC 0004 §10, question 2): the `event` kind has no wire yet.
- **Approval expiry** (RFC 0002 §13, question 4): the default needs experience.
- **Cross-manifest projections** (RFC 0002 §13, question 5): two principals and two runtimes.
- **Per-capability MCP for authenticated capabilities** (RFC 0004 §10, question 1): today only capabilities with authorization `any` can be per-capability tools. M7c measured that this mode loses most of the declared fields on the reference app.
- **Mixed apps** (RFC 0005 §9, question 2): one namespace holding capabilities from v0 and from the IR.

### 3.2 Found while building

- **View-following WebMCP registration** (RFC 0004 §5): not built. The per-capability option registers a fixed list. The generic mode is the default.
- **In-tool WebMCP consent:** waits for the browser's request for user interaction. Until then, WebMCP fails closed, and the person confirms in the app's own review page (RFC 0004 §5).
- **The resolver contract's enforcement:** a conformance check only. A runtime that enforced read scoping itself would need a principal-aware resource model, which is a larger change.
- **Strict JSON Schema validators** reject unknown fields in the published v0 schemas, against the v0 spec's rule that clients ignore them. The fix, opening the received documents' schemas, is prepared and not released. No release may emit the discovery field before it.

### 3.3 For the benchmark

- **A task that separates the surfaces:** M7f hit a ceiling. A harder pre-registered task, with a pilot headroom gate blind to the contrast, is M8e.
- **Multi-turn users** (RFC 0003 §15, question 3): a trial has no user replies, so an agent that asks the user a question ends its trial.
- **Drivers:** the runs used CLI agents only. One CLI's own global instructions couldn't be isolated, so it was dropped. MCP couldn't complete a confirmation non-interactively, so it's reported on the intended choice only.

## 4. What a first specification could be

A first version could standardize §1.1 to §1.3 as one document: the IR and its canonical form, the projection's
invariants (§6.3 and §6.6) and its execution contract, and the wire with its confirmation rule. Each part is built,
tested and accepted. §3 would be its list of non-goals and future work. The benchmark's results would stay in their own
reports, as evidence for specific rules (§6.6, and the token rule), not as claims about which surface is best.
