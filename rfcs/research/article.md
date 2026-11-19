# Telling an agent what it can do, and measuring whether it helps

**Status:** DRAFT (2026-11-19): design's draft, with backend's text for §2, the harness half of §3 and §7's boundary. For backend as lead, then review and intake. Every claim below has a row in the
claim-and-trace table at the end, which names the committed file and the commit that holds it.

## 1. The problem

An agent that acts on a web application sees it through one of a few surfaces: the rendered page, a page-level graph of
actions, or a tool list. None of them says, in one place, what the agent may do on a resource right now, what each option
costs, and what an option it isn't shown would have offered.

This work builds a semantic capability layer for that gap, and measures, with pre-registered trials, whether the way the
capabilities are disclosed changes which option an agent chooses.

## 2. What was built

Four layers, each specified by an RFC and described, file by file, in `rfcs/architecture/`.

**The IR (RFC 0001).** An app's capability manifest is one deterministic JSON document: its resources, the
capabilities on them (queries, actions and events) with their conditions and effects, the relations between them,
attributed claims, and the bindings that say where each capability is reached on a transport. It holds no code and
describes no caller. Every type is a zod schema, the TypeScript types are
inferred from them, and the generated JSON Schema, whose refinements are mirrored by hand, is tested to agree with the
validator; a test also fails if the schema file drifts [C2.1]. A manifest's canonical form sorts every set and drops
what says nothing, and its digest is `sha256-` and the base64url of SHA-256 over the canonical form's RFC 8785 bytes
[C2.2].

**The projection (RFC 0002).** A runtime turns a manifest and a principal into offers: a capability on a resource, with
what it costs and the claims made about it. A policy decides how much of that one view shows. The built-in policies are
exhaustive, resource, progressive and advocated [C2.3]. Whatever a view leaves out, it says how to reach. The disclosure
invariant, tested by construction over generated manifests, is that the first view and every expansion from it reach
every offer the principal may see, with whole choice sets, and every alternative one listed expansion away [C2.4].
§6.6's comparison puts a choice set's members side by side on the attributes that tell them apart, in the view itself
[C2.5].

**The v1 wire and its transports (RFC 0004).** Version 1 is served beside v0, which stays as it is, and a golden tool, run by hand at each wire change, found
the example app's v0 documents byte-identical before and after (for example at ec7e80d1 and a60bd872) [C2.6]. Over HTTP, a projection route serves `view`,
`inspect`, `expand`, `check` and `execute`, every response as `application/vnd.affordances+json; version=1`, and a refusal the route makes before the
runtime has the runtime's shape, `{ status: 'refused', code, detail }`; the runtime's own refusals pass through whole
[C2.7]. MCP and WebMCP share one tool core: the four
generic tools, `project`, `expand`, `inspect` and `execute`, over an adapter for HTTP or for an in-process runtime [C2.8].
MCP also has a per-capability mode, one tool per capability. What that mode loses is measured field by field, and on
the reference app, of 136 fields across its 10 capabilities, it carries 2, 1 more at the call, and loses 133, 127
of them on the 9 capabilities it doesn't export as tools at all [C2.9].

**Next.js compilation (RFC 0005).** At build time, an app's `capabilities.ts` modules, with v0's actions, become one
canonical manifest, with its digest and diagnostics written beside it. An input schema is evaluated, never parsed by
hand: the compiler takes a slice of the module, only the consts and imports the schema needs, and runs it twice in a
child process under Node's permission model, which can read only the slice's folder and `node_modules`, with an empty
environment. A construct outside the slice's rule, such as a computed key or a
dynamic import, makes the input opaque, with a diagnostic, instead of being run [C2.10].

## 3. How it's measured

The method is RFC 0003's: a fictional hosting provider (hosting-lab) with fixed plans, add-ons and a bundle; tasks whose
optimal end state is derived from the catalog before any trial; and agents run through command-line drivers, scored on
the end state they ask the person to approve (the intended end state) and on what they completed.

- **Pre-registration:** each study's plan, analysis code and its decision rules are committed before any trial.
- **Gates:** a pilot fixes the rules the confirmatory run takes from it. M8e's plan adds a headroom gate, read blind to
  the contrasts, that stops the study if a task leaves no room to separate the conditions.
- **Blinding and integrity:** no outcome field is read until intake clears the run's integrity report.

The measurement code has rules of its own, each checked mechanically.

- **Every committed trace re-scores.** Any change to the harness must leave every committed trace's metrics line
  byte-identical when it's scored again through the new code, and must reproduce M7f's confirmatory analysis byte for
  byte, in a clean export of the commit. Since the B1 round, the check also rebuilds each surface trace's replay records
  from its server record and compares them with the committed bytes. The committed archives hold 1630 traces, 516 of
  them from the surface studies [C3.3].
- **A surface study's run comes from a pin.** M7f's and T8's runs were launched from an export of one commit, built
  once and then made read-only, whose `pin.json` records the commit, a hash of the whole built tree, the build id, the lockfile's hash and the browser's version. Every
  launch and every resume checks the tree against the pin before it runs anything [C3.4]. M5's run had no pin.
- **Information parity before any trial.** The preflight walks each surface through its own tools, as an agent gets
  them, and must reach every deciding fact by the surface's own matcher, or the surface is refused. A surface that
  couldn't reach a fact would measure the gap, not the surface. For T8, a depth check also confirms the deciding fact is
  exactly one step out on each surface: in full's first view, behind progressive's one relations expansion, and one
  link away on v0's and the browser's pages [C3.5].
- **Integrity and blinding.** At launch and at the end, the run records its login checks, its canaries and a stamp of
  each file the run must not change; the end record adds a scan of every result for secrets and the operator's email.
  The credential files' digests are kept outside the repository [C3.6]. While a run is live and until intake clears
  that record, the harness reports only non-outcome fields, from a fixed list, so no rate is seen before the gate [C3.7].
- **Faults are the harness's, never scored.** A 5xx from the app, a disagreement between the two reads of the end
  state, or a stall the surface's server records sets the attempt aside, kept whole, and reruns it once. Past the pause
  rule, the run stops [C3.8].

## 4. M5: does how capabilities are disclosed change the choice?

M5's confirmatory run had 684 scored trials on task T6, with two models, Sonnet 5.5 and Haiku 5.5, and three
conditions: A (exhaustive disclosure), S (a structural order) and C (the advocated policy, with the owner's claims).

- **H1, S against A: not rejected.** On Sonnet, both were 101 of 114. On Haiku, S was 46 of 114 and A 43 of 114. The
  Mantel–Haenszel risk difference is +1.3 points (−6.2 to +8.9), and the Holm-adjusted p is 0.820.
- **H2, C against A: rejected, with C lower,** mostly on Sonnet. Sonnet's C was 17 of 114 against A's 101, −73.7 points
  (−80.8 to −63.2). Haiku's was 34 against 43, −7.9 (−19.8 to +4.3), which isn't significant on its own. The Holm-adjusted
  p is 2.0e-18, and the models differ (Breslow–Day p 2.9e-13).
- **H2's validity note.** As built, C differed from A in two ways: the owner's claims, and the advocated policy's
  narrower scope, which left out the only offer carrying the plans' allowances. So H2 measures the advocated policy as a
  whole against exhaustive disclosure. It doesn't isolate the claims, and no claim is made that advocacy steers agents.
- **What the mechanism might be: post hoc and descriptive.** On Sonnet, C was optimal in 17 of 19 trials that saw Pro's
  allowance before the first approval request, and in 0 of 95 that didn't. The exploratory run separated the two
  factors: the narrow scope alone was associated with a 38.6-point lower rate on Sonnet (−52.7 to −23.5), and the advocacy package over the full scope showed no detectable difference (−4.6, −17.9 to +5.9). These are exploratory, cross-run estimates, and no
  mechanism is claimed as established.

### The product fix

Whichever reading holds, finding the deciding fact shouldn't depend on exploring. RFC 0002 §6.6 now requires every choice
set a view shows to carry its comparison: each member's declared attributes, side by side, under every policy, cut only
by the request's own facts limit, and never the columns a shown claim cites or the capability reads.

## 5. M7f: does the surface change the choice?

M7f compared four surfaces on T6: `full` and `progressive` (version 1's graph, under two policies), `v0` (the page graph)
and `browser` (browser automation), with the person's approval stated on every surface's instruction line.

- **A ceiling.** All 400 confirmatory trials were optimal, intended and completed, on every surface and both models. So
  every contrast is 0, with Newcombe's interval of about ±7.1 points per model, and the pooled interval is degenerate.
- **The reading, in intake's words:** a CEILING. With approval stated, T6 doesn't separate full, progressive, v0 and
  browser for Sonnet 5.5 or Haiku 5.5. All three registered contrasts are 0, each model's Newcombe interval is about ±7.1
  points, and the pooled interval is degenerate. That's not evidence the surfaces are equal in general. The
  pilot-to-confirmatory change is attributed to the approval sentence, the one agent-side change, which review checked.

## 6. M8e: a deciding fact one step out

T8 put the one fact that decides the choice, where a plan is served from, one step out: `full`'s first view carries it,
and the other surfaces need one expansion or one more page. The owner's recommendation was wrong only on that fact. The
plan was pre-registered with a headroom gate: each model's optimal rate, pooled over the four surfaces, had to fall
between 10% and 90% in the pilot, or the study stops.

- **The result, in intake's words:** T8's headroom gate failed on Haiku 5.5 (20 of 20 optimal). Sonnet 5.5 was 18 of 20;
  its 2 misses were both on progressive, each buying the owner's favored option (Pro with extra bandwidth) with the
  deciding fact unseen (pilot, n=5 per cell, descriptive, not a test).
- **So M8e stopped on the pilot.** There was no confirmatory run, and nothing was changed and rerun.
- **The gate worked as designed.** It found a task with too little room before the confirmatory run, spending 40 trials
  instead of 440.
- **No task is chosen from this.** No future task may be chosen or tuned from these per-surface rates, and any later
  task's justification is written without citing them.

## 7. Security: no product transport gave a model a token

In the benchmark, token-passing stands in for the person's approval, as v0's confirm resend and the browser's click do;
the product toolset never gives a model a token (RFC 0004 §4, §5).

- **Measured on real runs:** in M7f's pilot, a scan of every trace and CLI stream log for token-shaped strings found none
  on MCP or WebMCP, the product toolsets. Every token-shaped string was on `full` and `progressive`, the benchmark's
  simulated approval.
- **The boundary:** every tool result on the product toolset reaches the model through one function, the runtime's
  `toModel`, which removes every `approval` field at any depth and replaces any token-shaped text. The tests drive every
  mode, answer and outcome and find no token in any result, and MCP's boundary test does the same through the server
  [C7.2].

## 8. Runnable evidence

`apps/capability-demo` runs one capability, hosting-lab's plan subscription, through v0, version 1 over HTTP, MCP and
WebMCP. Each is refused for confirmation, the person confirms in the app's own review page, and the store reads back
the purchase. It runs from a clean checkout with one command, after the install and a one-time Chromium install. Headless, it exits 0 only if all 20 of
its checks pass. The demo never lets an agent approve: v0 would run a call on the agent's own
`confirm: true` resend, so the demo never sends it, and MCP and WebMCP return no token.

## 9. Limitations

- **The models:** two Claude models, Sonnet 5.5 and Haiku 5.5, in every confirmatory run. No study's results generalize
  beyond them.
- **The drivers:** agents ran through command-line drivers, not the hosts people use, so a host's own behaviour isn't
  measured.
- **Codex:** in M5's pilot only, and out of every later study until the harness can keep the owner's global
  instructions out of its trials: M5's pilot record labels its 15 Codex trials as having received them (M5-REPORT.md
  §3.1, d56aa19d).
- **MCP:** intended-only. Run non-interactively, the CLI answered every elicitation with `cancel` (15 of 15 in M7f's
  pilot), so MCP's completion isn't measured.
- **WebMCP:** in-tool consent is pending. In the Chromium build measured (156.0.8078.4, headless, flagged),
  `requestUserInteraction` wasn't available, so a call that needs
  confirmation returns its refusal, and the person confirms in the app.
- **Pins:** results from different pins are never pooled. hosting-lab's base manifest changed after M7f, for T8.

## 10. Future work, specified and not run

- **A progressive-surface hypothesis:** whether an agent on a progressive surface fetches a deciding fact that sits one
  expansion out. It would need its own pre-registered run, with the method above; no estimate is offered here.
- **A harder task or weaker models,** where the headroom gate could pass. These are specified in the specification
  roadmap, and not run.

## Claim-and-trace table

| #     | Claim                                                                                                          | File                                                                                                            | Commit                                      |
| ----- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| C2.1  | The IR's types are zod schemas; the JSON Schema is tested to agree with the validator, and fails on drift      | `packages/ir/src/schema.ts`, `packages/ir/test/schema.test.ts`                                                  | def4b5d1                                    |
| C2.2  | The canonical form and the digest: `sha256-` and base64url of SHA-256 over the RFC 8785 bytes                  | `packages/ir/src/normalize.ts`, `packages/ir/src/digest.ts`                                                     | 875f7cd8                                    |
| C2.3  | The built-in policies: exhaustive, resource, progressive and advocated                                         | `packages/runtime/src/views.ts`                                                                                 | 875f7cd8                                    |
| C2.4  | The disclosure invariant, tested by construction over generated manifests                                      | `packages/runtime/test/disclosure.test.ts`                                                                      | c2ee930c                                    |
| C2.5  | §6.6's comparison of a choice set's members                                                                    | `packages/runtime/src/comparison.ts`, `packages/runtime/test/comparison.test.ts`                                | dd3a28ea                                    |
| C2.6  | v0 stays; a hand-run golden tool found its documents byte-identical across wire changes (ec7e80d1, a60bd872)   | `apps/example/scripts/v0-golden/`                                                                               | 06b96776                                    |
| C2.7  | The projection route: five endpoints, the v1 media type, the runtime's refusal shape before the runtime        | `packages/next/src/projection.ts`, `packages/next/test/projection.test.ts`                                      | 62f674c6                                    |
| C2.8  | One tool core for MCP and WebMCP, the four generic tools, over an HTTP or in-process adapter                   | `packages/runtime/src/agent.ts`, `packages/mcp-v1/src/server.ts`                                                | 875f7cd8                                    |
| C2.9  | Per-capability MCP: of 136 fields over 10 capabilities, 2 carried, 1 at the call, 133 lost (127 unexported)    | `packages/mcp-v1/loss/hosting-lab.json`                                                                         | 095bb65c                                    |
| C2.10 | Input schemas are evaluated in a sliced child under Node's permission model, run twice, opaque when refused    | `packages/next/src/slice.ts`, `packages/next/src/evaluator.ts`                                                  | 875f7cd8                                    |
| C3.1  | The method: fixture, tasks with derived ground truth, CLI drivers, intended and completed outcomes             | `rfcs/0003-choice-benchmark-method.md`                                                                          | 638c2d06                                    |
| C3.2  | M8e's headroom gate, read blind to the contrasts                                                               | `apps/choice-bench/results/surfaces-t8/PLAN.md` §6                                                              | 850efbac                                    |
| C3.3  | The standing check: every committed trace re-scored byte-identical, M7f reproduced, replays rebuilt (the rule) | `apps/choice-bench/src/rescore.ts`, `apps/choice-bench/scripts/standing-check.sh`                               | 8a278903                                    |
| C3.4  | A surface study's run comes from a pinned export; every launch and resume checks the tree against the pin      | `apps/choice-bench/src/pin.ts`                                                                                  | 4141181a                                    |
| C3.5  | The preflight's parity check, and T8's depth check                                                             | `apps/choice-bench/src/oracle.ts`, `apps/choice-bench/src/preflight.ts`                                         | 8a278903                                    |
| C3.6  | Logins, canaries, owner-file stamps, the secrets and email scan; credential digests outside git                | `apps/choice-bench/src/integrity.ts`, `src/drivers/isolation.ts`, `src/canary.ts`                               | 38ee40ef; 1ad3fd35                          |
| C3.7  | Status reports only a fixed list of non-outcome fields                                                         | `apps/choice-bench/src/status.ts`                                                                               | 4ef0d23f                                    |
| C3.8  | Harness faults are set aside, kept whole and rerun once, never scored; the pause rule                          | `apps/choice-bench/src/surface.ts`, `src/surface-adapters.ts`, `src/harness.ts`                                 | fb93943e                                    |
| C4.1  | M5's confirmatory run: 684 scored, T6, Sonnet 5.5 and Haiku 5.5, conditions A, S and C                         | `apps/choice-bench/results/M5-REPORT.md` §4.1                                                                   | 6c1f27c7                                    |
| C4.2  | H1 not rejected: the figures above                                                                             | `apps/choice-bench/results/confirmatory-2026-11-18/README.md`; `M5-REPORT.md` §4.1                              | e815f273                                    |
| C4.3  | H2 rejected, C lower, mostly on Sonnet: the figures above                                                      | `apps/choice-bench/results/confirmatory-2026-11-18/README.md`; `M5-REPORT.md` §4.1                              | e815f273                                    |
| C4.4  | H2's validity note                                                                                             | `apps/choice-bench/results/M5-REPORT.md` §4.1                                                                   | 6c1f27c7                                    |
| C4.5  | 17 of 19 against 0 of 95, post hoc and descriptive                                                             | `apps/choice-bench/results/confirmatory-2026-11-18/audit/README.md`                                             | 14a5a346                                    |
| C4.6  | The exploratory estimates (E1, E2), cross-run                                                                  | `apps/choice-bench/results/exploratory-2026-11-18/README.md`                                                    | 3f958191                                    |
| C4.7  | §6.6: every choice set carries its comparison                                                                  | `rfcs/0002-contextual-projection.md` §6.6; `packages/runtime/test/comparison.test.ts`                           | c2ee930c                                    |
| C5.1  | M7f: 400 of 400 optimal, every contrast 0, ±7.1 per model, pooled interval degenerate                          | `apps/choice-bench/results/surfaces/confirmatory-2026-11-18/analysis.json`                                      | 9cbc48ee                                    |
| C5.2  | M7f's reading, intake's words verbatim                                                                         | `apps/choice-bench/results/surfaces/confirmatory-2026-11-18/README.md`                                          | 36062197                                    |
| C6.1  | T8's gate: Sonnet 18 of 20, Haiku 20 of 20, fail                                                               | `apps/choice-bench/results/surfaces-t8/pilot-2026-11-19/headroom.json`                                          | 98e5b090                                    |
| C6.2  | T8's result, intake's line verbatim; no confirmatory run; 40 trials, not 440; the forking guard                | `apps/choice-bench/results/surfaces-t8/pilot-2026-11-19/README.md`                                              | 59b7c4a3                                    |
| C7.1  | No token-shaped string on MCP or WebMCP in M7f's pilot                                                         | `apps/choice-bench/results/surfaces/pilot-2026-11-18/README.md`                                                 | 6f878aa0                                    |
| C7.2  | `toModel` removes every approval field and token-shaped text; no tool result in any mode carries a token       | `packages/runtime/src/agent.ts`, `packages/runtime/test/agent.test.ts`, `packages/mcp-v1/test/boundary.test.ts` | 6191b65b                                    |
| C8.1  | The demo: four transports, refused, confirmed in the review page, read back; 20 checks, exit 0                 | `apps/capability-demo/README.md`, `demo.ts`                                                                     | 3c901eb8                                    |
| C9.1  | The two models                                                                                                 | `apps/choice-bench/results/surfaces/PLAN.md` §4                                                                 | 0b0851e0                                    |
| C9.2  | Codex in M5's pilot only (15 trials), and out until the harness can isolate the owner's global instructions    | `apps/choice-bench/results/M5-REPORT.md` §3.1; `surfaces/PLAN.md` §4                                            | 6c1f27c7; 0b0851e0                          |
| C9.3  | MCP's elicitation answered `cancel`, 15 of 15                                                                  | `apps/choice-bench/results/surfaces/pilot-2026-11-18/README.md` §2                                              | 6f878aa0                                    |
| C9.4  | In the Chromium build measured, `requestUserInteraction` wasn't available; RFC 0004 §5 fails closed            | `rfcs/research/0004-webmcp/SPIKE.md`; `rfcs/0004-protocol-evolution.md` §5                                      | fa080a6a (SPIKE.md); 9eeb8fd3 (RFC 0004 §5) |
| C9.5  | Never pooled across pins; the base manifest moved for T8                                                       | `apps/choice-bench/results/surfaces-t8/pilot-2026-11-19/README.md`                                              | 59b7c4a3                                    |
