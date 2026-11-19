# Telling an agent what it can do, and measuring whether it helps

**Status:** DRAFT (design, 2026-11-19), for backend as lead, then review and intake. Every claim below has a row in the
claim-and-trace table at the end, which names the committed file and the commit that holds it.

## 1. The problem

An agent that acts on a web application sees it through one of a few surfaces: the rendered page, a page-level graph of
actions, or a tool list. None of them says, in one place, what the agent may do on a resource right now, what each option
costs, and what an option it isn't shown would have offered.

This work builds a semantic capability layer for that gap, and measures, with pre-registered trials, whether the way the
capabilities are disclosed changes which option an agent chooses.

## 2. What was built

_Backend's section: stub, for backend's text as input._

- the IR and its digest (RFC 0001) — _rows: C2.1 to C2.n_
- the projection: offers, policies, views, the disclosure invariant, and §6.6's comparison (RFC 0002)
- the v1 wire and its transports, HTTP, MCP and WebMCP, with v0 beside them (RFC 0004)
- Next.js compilation (RFC 0005)

## 3. How it's measured

The method is RFC 0003's: a fictional hosting provider (hosting-lab) with fixed plans, add-ons and a bundle; tasks whose
optimal end state is derived from the catalog before any trial; and agents run through command-line drivers, scored on
the end state they ask the person to approve (the intended end state) and on what they completed.

- **Pre-registration:** each study's plan, analysis code and its decision rules are committed before any trial.
- **Gates:** a pilot fixes the rules the confirmatory run takes from it. M8e's plan adds a headroom gate, read blind to
  the contrasts, that stops the study if a task leaves no room to separate the conditions.
- **Blinding and integrity:** no outcome field is read until intake clears the run's integrity report.

_The harness half of this section is backend's: stub, for backend's text as input (the standing check, the pin and
export checks, the preflight's parity and depth checks, and the integrity record)._

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
  factors: the narrow scope alone lowered Sonnet's rate by 38.6 points (−52.7 to −23.5), and the advocacy package over the
  full scope showed no detectable effect (−4.6, −17.9 to +5.9). These are exploratory, cross-run estimates, and no
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
- **The boundary:** _backend's row: the runtime's `toModel`, and its tests._

## 8. Runnable evidence

`apps/capability-demo` runs one capability, hosting-lab's plan subscription, through v0, version 1 over HTTP, MCP and
WebMCP. Each is refused for confirmation, the person confirms in the app's own review page, and the store reads back
the purchase. It runs from a clean checkout with one command, after the install and a one-time Chromium install. Headless, it exits 0 only if all 20 of
its checks pass, and no transport gives an agent a way to approve.

## 9. Limitations

- **The models:** two Claude models, Sonnet 5.5 and Haiku 5.5, in every confirmatory run. No study's results generalize
  beyond them.
- **The drivers:** agents ran through command-line drivers, not the hosts people use, so a host's own behaviour isn't
  measured.
- **Codex:** in M5's pilot only, and out of every later study until its isolation is solved.
- **MCP:** intended-only. Run non-interactively, the CLI answered every elicitation with `cancel` (15 of 15 in M7f's
  pilot), so MCP's completion isn't measured.
- **WebMCP:** in-tool consent is pending. No browser build offered `requestUserInteraction`, so a call that needs
  confirmation returns its refusal, and the person confirms in the app.
- **Pins:** results from different pins are never pooled. hosting-lab's base manifest changed after M7f, for T8.

## 10. Future work, specified and not run

- **A progressive-surface hypothesis:** whether an agent on a progressive surface fetches a deciding fact that sits one
  expansion out. It would need its own pre-registered run, with the method above; no estimate is offered here.
- **A harder task or weaker models,** where the headroom gate could pass. These are specified in the specification
  roadmap, and not run.

## Claim-and-trace table

| #    | Claim                                                                                              | File                                                                                  | Commit             |
| ---- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------ |
| C2.x | _backend's rows for §2_                                                                            |                                                                                       |                    |
| C3.1 | The method: fixture, tasks with derived ground truth, CLI drivers, intended and completed outcomes | `rfcs/0003-choice-benchmark-method.md`                                                | 638c2d06           |
| C3.2 | M8e's headroom gate, read blind to the contrasts                                                   | `apps/choice-bench/results/surfaces-t8/PLAN.md` §6                                    | 850efbac           |
| C3.x | _backend's rows for the harness half of §3_                                                        |                                                                                       |                    |
| C4.1 | M5's confirmatory run: 684 scored, T6, Sonnet 5.5 and Haiku 5.5, conditions A, S and C             | `apps/choice-bench/results/M5-REPORT.md` §4.1                                         | 6c1f27c7           |
| C4.2 | H1 not rejected: the figures above                                                                 | `apps/choice-bench/results/confirmatory-2026-11-18/README.md`; `M5-REPORT.md` §4.1    | e815f273           |
| C4.3 | H2 rejected, C lower, mostly on Sonnet: the figures above                                          | `apps/choice-bench/results/confirmatory-2026-11-18/README.md`; `M5-REPORT.md` §4.1    | e815f273           |
| C4.4 | H2's validity note                                                                                 | `apps/choice-bench/results/M5-REPORT.md` §4.1                                         | 6c1f27c7           |
| C4.5 | 17 of 19 against 0 of 95, post hoc and descriptive                                                 | `apps/choice-bench/results/confirmatory-2026-11-18/audit/README.md`                   | 14a5a346           |
| C4.6 | The exploratory estimates (E1, E2), cross-run                                                      | `apps/choice-bench/results/exploratory-2026-11-18/README.md`                          | 3f958191           |
| C4.7 | §6.6: every choice set carries its comparison                                                      | `rfcs/0002-contextual-projection.md` §6.6; `packages/runtime/test/comparison.test.ts` | c2ee930c           |
| C5.1 | M7f: 400 of 400 optimal, every contrast 0, ±7.1 per model, pooled interval degenerate              | `apps/choice-bench/results/surfaces/confirmatory-2026-11-18/analysis.json`            | 9cbc48ee           |
| C5.2 | M7f's reading, intake's words verbatim                                                             | `apps/choice-bench/results/surfaces/confirmatory-2026-11-18/README.md`                | 36062197           |
| C6.1 | T8's gate: Sonnet 18 of 20, Haiku 20 of 20, fail                                                   | `apps/choice-bench/results/surfaces-t8/pilot-2026-11-19/headroom.json`                | 98e5b090           |
| C6.2 | T8's result, intake's line verbatim; no confirmatory run; 40 trials, not 440; the forking guard    | `apps/choice-bench/results/surfaces-t8/pilot-2026-11-19/README.md`                    | 59b7c4a3           |
| C7.1 | No token-shaped string on MCP or WebMCP in M7f's pilot                                             | `apps/choice-bench/results/surfaces/pilot-2026-11-18/README.md`                       | 6f878aa0           |
| C7.2 | _backend's row: `toModel` and its tests_                                                           |                                                                                       |                    |
| C8.1 | The demo: four transports, refused, confirmed in the review page, read back; 20 checks, exit 0     | `apps/capability-demo/README.md`, `demo.ts`                                           | 3c901eb8           |
| C9.1 | The two models                                                                                     | `apps/choice-bench/results/surfaces/PLAN.md` §4                                       | 0b0851e0           |
| C9.2 | Codex in M5's pilot only (15 trials), and out until its isolation is solved                        | `apps/choice-bench/results/M5-REPORT.md` §3.1; `surfaces/PLAN.md` §4                  | 6c1f27c7; 0b0851e0 |
| C9.3 | MCP's elicitation answered `cancel`, 15 of 15                                                      | `apps/choice-bench/results/surfaces/pilot-2026-11-18/README.md` §2                    | 6f878aa0           |
| C9.4 | WebMCP's in-tool consent not offered by the browser                                                | `rfcs/research/0004-webmcp/SPIKE.md`; `rfcs/0004-protocol-evolution.md` §5            | fa080a6a           |
| C9.5 | Never pooled across pins; the base manifest moved for T8                                           | `apps/choice-bench/results/surfaces-t8/pilot-2026-11-19/README.md`                    | 59b7c4a3           |
