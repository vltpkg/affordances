# Roadmap: from the semantic capability IR to a measured choice benchmark

## Goals

This roadmap plans the work that follows [RFC 0001](../0001-semantic-capability-ir.md). The project has three
contributions, and each milestone serves at least one of them:

1. **Semantic compilation.** `@affordances/ir`: a portable, deterministic manifest that describes an application's
   capabilities and is not itself executable.
2. **Contextual projection.** `@affordances/runtime`: from a manifest and a context, a graph of capability offers that
   an agent can discover progressively.
3. **Agent choice architecture.** A reproducible benchmark that measures how the way capabilities are disclosed changes
   what agents choose, while the options themselves stay fixed.

Every milestone ends with tested artifacts, an independent review, and an explicit decision about what to do next.
v0 keeps working throughout (see [the repository audit](repo-audit.md), §6).

## Roles

- **Backend engineer:** the IR, the runtime, execution, adapters, the compiler and the benchmark harness.
- **Design engineer:** developer-facing APIs and their ergonomics, React and WebMCP, the experimental application's UI,
  the inspector, documentation and the demonstration.
- **Reviewer:** reviews every packet for correctness, tests and evidence. Every claim about a spec cites the spec, and
  every claim about the code cites the code.
- **Planner:** splits each milestone into packets, owns the interface contracts between packets, and keeps the record.
- **Intake:** accepts each milestone and decides what comes next. It approves the size of any benchmark run that spends
  model time.

One owner per packet. When two packets share an interface, the planner fixes the contract before either starts.

## Dependencies at a glance

```
M1 (research, RFC 0001) ──> M2 (@affordances/ir)
M2 ──> M3 (@affordances/runtime; needs RFC 0002)
M2 ──> M4 (experimental app; starts once M2's types are fixed, wired to M3)
M3 + M4 ──> M5 (benchmark; needs RFC 0003)
M3 ──> M6 (Next.js compilation)
M3 ──> M7 (protocol interop; needs RFC 0004)
M5 + M7b + M7c ──> M7f (comparison with existing approaches; reuses M5's harness)
M5 + M6 + M7 ──> M8 (demonstration and publication)
```

- **Can run in parallel:**
  - M4's domain model and UI, once M2's types are fixed (before M3 ships);
  - RFC 0002 during M2, RFC 0003 during M3, and RFC 0004 during M5;
  - M6 and M7 once M3 is accepted;
  - the benchmark's driver interface (M5a) during M3.
- **Can't start early:**
  - M2 code waits for RFC 0001 to be accepted;
  - M3 code waits for RFC 0002;
  - M5's full run waits for its pilot and intake's approval of its size.

## M2: `@affordances/ir`

The package RFC 0001 §12 specifies. It proves the manifest is portable, with no Next.js and no live application.

| Packet                                | Owner                  | Done means                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M2a: types and schema                 | backend                | RFC 0001 §13's types and §14's JSON Schema, both from one zod source, as `@affordances/protocol` does (`packages/protocol/src/schema.ts:3`).                                                                                                                                                                                                                                          |
| M2b: validate and normalize           | backend                | Every error code in RFC 0001 has a fixture that triggers it. Normalization is idempotent.                                                                                                                                                                                                                                                                                             |
| M2c: canonical form and digest        | backend                | RFC 8785 bytes plus set sorting. The manifest digest (RFC 0001 §7.1) is stable across platforms, and the round trips are tested.                                                                                                                                                                                                                                                      |
| M2d: compose and derive               | backend                | Union with `E_CONFLICT`, never an override. Commutativity and associativity are tested over generated fragments. The §5.5 derived edges are computed, not stored.                                                                                                                                                                                                                     |
| M2e: the safety rules                 | backend                | One test per rule in RFC 0001 §8.2. Rule 5's manifest half: for each declarative precondition, the state that makes it false.                                                                                                                                                                                                                                                         |
| M2f: authoring                        | design                 | RFC 0001 §12.1's data-first authoring: `defineResource` and `defineCapability` as data, and `defineAction({ capability })` binding the code, so a compiler reads declarations without importing application code. Type tests show that `defineAction` takes exactly one implementation per guard its capability declares, and that condition paths are typed against the schemas.     |
| M2g: RFC 0002, the projection runtime | design (lead), backend | Written during M2. Covers the projection request, principal attributes (RFC 0001 open question 1), offers, expansion, revisions and execution. It answers how context is represented and how discovery policies work.                                                                                                                                                                 |
| M2h: v0 import                        | backend                | Suggested ids and a codemod, so an existing v0 application yields capabilities rather than none (RFC 0001 §10.1).                                                                                                                                                                                                                                                                     |
| M2i: a survey of real guards          | backend                | Every guard in this repository's apps and examples is classified as expressible in RFC 0001 §3.1's condition vocabulary or as opaque, with the counts. It tests prior art §6.7's assumption 10 before M3 builds on the vocabulary. If most guards don't fit, RFC 0001's condition design is revisited before M3. It also supplies the survey that RFC 0001 open question 2 waits for. |

**Done:**

- the package is private and has no runtime dependency beyond its schema library;
- root checks pass;
- review accepts;
- RFC 0002 is accepted, which gates M3.

## M3: `@affordances/runtime`

Many contextual graphs from one manifest.

| Packet                                    | Owner   | Done means                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M3a: the projection API                   | backend | Manifest plus context gives a projection. The same manifest under different principals and states gives different graphs, each deterministic for its input.                                                                                                                                                                                                                |
| M3b: availability                         | backend | Kleene evaluation of conditions against context. Opaque guards run at projection time with no input, as v0's do, unless they're marked `executionOnly`, which leaves them `unknown` until execution (RFC 0002 §4.2). An unavailable offer carries its reason.                                                                                                              |
| M3c: progressive disclosure and expansion | backend | An agent-directed expansion that never hides an `alternativeTo` sibling (an alternative stays reachable). A projection's revision (as RFC 0002 names it, distinct from the manifest's digest in RFC 0001 §7.1) changes exactly when the projection's inputs do.                                                                                                            |
| M3d: execution                            | backend | An offer is never authorization: every execution re-checks authorization and preconditions, and confirmation can't be skipped by an annotation. Rule 5's conformance kit runs against a real handler. It removes M2f's interim refusal on the v0 agent path and its dev warning, with a test that the same capability becomes available once its conditions evaluate true. |
| M3e: state-aware updates                  | backend | After an action, the projection updates. The update names the changed offers and the new projection revision.                                                                                                                                                                                                                                                              |
| M3f: the inspector                        | design  | A developer view of a manifest and its projections: offers, reasons, relations and provenance.                                                                                                                                                                                                                                                                             |
| M5a: benchmark drivers                    | backend | The pluggable driver interface, with `claude -p` and `codex exec` drivers. A driver for an AI SDK provider plugs in when API keys exist.                                                                                                                                                                                                                                   |

**Done:**

- the safety invariants are tested at execution, not just stated;
- review accepts;
- RFC 0003 (the benchmark method) is drafted during M3. Besides the disclosure conditions, it includes a structure-only control: the same semantic information with only its structure or order changed. That separates choice-architecture effects from differences in what information is available.

## M4: the experimental application

A controlled storefront or hosting application, under `apps/`, with several legitimate choices for the same intent.

| Packet                           | Owner                  | Done means                                                                                                            |
| -------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| M4a: the domain and its manifest | backend                | Real capability definitions with alternatives that differ in price, reversibility and effects, all honestly declared. |
| M4b: the application             | design                 | Executable actions with observable consequences, served through the runtime.                                          |
| M4c: projections in the app      | backend (lead), design | The app serves projections (M3), and the inspector (M3f) shows them.                                                  |

The domain model and UI can start once M2's types are fixed. Wiring the projections needs M3.

## M5: agent-choice research

The experiment the project exists to run. The method is fixed in RFC 0003 before any trial runs.

| Packet                   | Owner                  | Done means                                                                                                                          |
| ------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| M5b: disclosure policies | backend                | The seven conditions, from neutral to bundled default, as projection policies over the same M4 manifest, so only disclosure varies. |
| M5c: the harness         | backend                | Repeated trials, per-trial traces, outcome metrics and confounds controlled (see [dark patterns](dark-patterns.md), §8).            |
| M5d: the pilot           | backend                | About 5 trials per condition per model. Its variance sizes the full run, and the trial counts and token totals are recorded.        |
| M5e: the full run        | backend                | Only at the size intake approves. Confidence intervals throughout, with exploratory results labeled exploratory.                    |
| M5f: the report          | backend (lead), design | Findings, limits and the traces, reproducible from the committed harness.                                                           |

**The assumptions M5 must test.** They come from [prior art](prior-art.md) §6.7 and [dark patterns](dark-patterns.md) §10:

1. **Preconditions and effects:** agents use declared preconditions and effects to plan, rather than names and
   descriptions alone.
2. **Unavailable offers:** an unavailable offer with a reason helps more than it distracts.
3. **Progressive disclosure:** it cuts tokens and calls without lowering how often the best-fitting alternative is found.
4. **Provenance:** attributed publisher claims are weighed differently from verified properties. If they aren't,
   provenance has to be enforced by harnesses.
5. **Declared dependencies:** agents check them before following a costly path, or they don't.
6. **Salience:** order and recommendation shift choices among identical options without a visual layer, and the size of
   the effect differs by model.
7. **Exploration:** agents that explore more of the graph are harder or easier to steer.
8. **Conditions:** they compound across a graph as dark patterns compound on a page.

## M6: Next.js compilation

| Packet               | Owner   | Done means                                                                                                                                                                 |
| -------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M6a: extraction      | backend | Semantics extracted from existing definitions, each labeled with its basis. An inference is never `declared` or `verified`.                                                |
| M6b: enrichment      | design  | The explicit API for what can't be inferred: one obvious way, types that infer, safe by default. Accepted by review against that bar, with a type test per inference rule. |
| M6c: diagnostics     | backend | Compiler diagnostics for missing or conflicting semantics.                                                                                                                 |
| M6d: portable output | backend | A manifest with no executable imports, unlike v0's generated manifest.                                                                                                     |

M6 also measures prior art §6.7's assumption 8: whether inferred semantics are accurate enough to show.

## M7: protocol interoperability

| Packet                                   | Owner   | Done means                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M7a: RFC 0004, protocol evolution        | backend | Which v0 wire concepts remain, and what a future version needs. Written during M5.                                                                                                                                                                                                                                                                                                                                                                                        |
| M7b: the v0 adapter                      | backend | Both directions, with compatibility tests. v0's wire documents and authoring API keep working ([repo audit](repo-audit.md) §6).                                                                                                                                                                                                                                                                                                                                           |
| M7c: MCP                                 | backend | Capabilities exposed through MCP with their identity kept. What's lost in translation is measured (prior art §6.7, assumption 9), not assumed. The trials also measure whether an agent carries what it learned over HTTP to MCP through the stable capability id (assumption 7).                                                                                                                                                                                         |
| M7d: WebMCP and UI SDK                   | design  | WebMCP registration from projections. UI SDK integration where it's feasible, with the limits written down.                                                                                                                                                                                                                                                                                                                                                               |
| M7e: fidelity documentation              | design  | What each transport keeps and loses.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| M7f: comparison with existing approaches | backend | The same M4 domain and tasks through six surfaces: browser automation over the app's UI; Affordances v0 through the M7b adapter; MCP tools with no graph relations; the full semantic graph, exhaustive; the progressively disclosed graph; and the graph with transparent advocacy. It reuses M5's harness, drivers and metrics. A pilot comes first, and intake approves the run's size. The result is when each surface helps and what it costs, not a ranking to win. |

## M8: demonstration and publication

| Packet                          | Owner                  | Done means                                                                                                                         |
| ------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| M8a: the demonstration          | design                 | Polished and runnable from a clean checkout.                                                                                       |
| M8b: architecture documentation | backend (lead), design | Updated from the accepted RFCs.                                                                                                    |
| M8c: the technical article      | backend (lead), design | The benchmark results and the M7f comparison, the limitations and the open problems, with every claim traced to a trace or a test. |
| M8d: the specification roadmap  | planner                | What a future specification would standardize, and what remains open.                                                              |

## At each milestone's end

- Root checks on a clean export, and review's acceptance.
- At M3, M5 and M8: a code review and a simplification pass over the whole branch.
- A report:
  - what was built;
  - what was learned;
  - what changed from the plan;
  - what's uncertain;
  - what comes next.
- Intake's decision on what to pursue next. Any change to this roadmap is recorded with its reason.
