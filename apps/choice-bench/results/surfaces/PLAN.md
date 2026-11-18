# M7f: the six-surface comparison, the plan

**Status:** DRAFT (design, 2026-11-18). It's for intake and backend. Nothing here has run, and the plan is committed in final form before any trial. Its method is RFC 0003, as amended, with §12's surfaces and §16's lesson for condition construction.

## 1. The question

Through which surface does an agent most often reach the user's optimal end state on one task, and at what cost? The task, fixture, models and isolation are held fixed. As RFC 0003 §12 says, this reports when each surface helps and what it costs, not a winner.

## 2. What's held fixed, and checked mechanically

**§16's rule:** a condition differs from its control only in the factor it manipulates. Here that factor is the surface: the tools the agent is given, and what they return.

Everything else is byte-identical across the six, and the preflight refuses a run otherwise:

| held fixed                      | how the preflight checks it                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the fixture                     | one pinned export, at a commit after M7a, named in every trace. It is never pooled with c81eeeb1                                                                                      |
| the catalog and the manifest    | the manifest's digest, and the catalog's bytes, are the same in every cell                                                                                                            |
| the task                        | T6, with the same prompt bytes in every cell (RFC 0003 §2.2), plus the instruction line naming the surface's tools. That line is the only prompt text that differs, and it's recorded |
| the owner's claims              | the confirmatory claim edit (Business recommended), identical in the manifest every surface reads                                                                                     |
| models, CLI, caps and isolation | RFC 0003 §5 and §8's pins, and the context canary, as in M5                                                                                                                           |
| the simulated user              | approves on every surface, as §12 says: the four tools' approval, v0's `confirm: true` resend, the browser's final submit                                                             |
| the outcome                     | the intended end state, labelled by `tasks.ts`, read from the app's own store, whatever the surface                                                                                   |

**Information parity, per surface.** Surfaces are expected to differ in what they show first, so that's measured, not refused. The deciding facts must still be _reachable_ on every surface: every plan's price and `bandwidthGb`, the add-ons' prices, and the bundle's price.

- **The check:** before any trial, an oracle walk through each surface's own tools reaches all of them, and it extends ffb00260's disclosure test to every surface.
- **On failure:** a surface that can't reach a deciding fact is refused, because its result would measure the gap, not the surface. That's M5's F lesson.

**What each surface shows first is recorded and diffed** per cell, as the audit's first-view diff did: the facts present in its first response. That's descriptive, and the analysis conditions on it (§5).

## 3. The surfaces

From RFC 0003 §12, each on the same hosting-lab app:

| id         | surface                      | the agent's tools                                       | notes                                                                                              |
| ---------- | ---------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `browser`  | browser automation           | a browser driver over the app's pages                   | the harness part to agree with backend: which driver, and the justification for any new dependency |
| `v0`       | Affordances v0               | v0's page graph and call, through the M7 adapter        | the approval is a `confirm: true` resend                                                           |
| `mcp-flat` | MCP, one tool per capability | RFC 0001 §6.1's export, with no relations and no claims | the input schemas as tool schemas                                                                  |
| `graph-A`  | the full graph, exhaustive   | the four tools, policy `exhaustive`                     | M5's A, on the new runtime                                                                         |
| `graph-B`  | the progressive graph        | the four tools, policy `progressive`                    | M5's B                                                                                             |
| `graph-C`  | the graph with advocacy      | the four tools, policy `advocated`                      | M5's C, now with §6.6's comparison on every view                                                   |

**One thing M5 makes explicit:** on the amended runtime, `graph-C`'s first view carries the plans' comparison, so the confound that voided H2's reading as advocacy is removed for this study. That's why M7f waits for M7a.

## 4. Budget, and the pilot

- **The models:** Claude only, `claude-sonnet-5-5` and `claude-haiku-5-5`, with ids and the CLI pinned. Codex stays out until its isolation is solved.
- **The pilot:** 6 surfaces × 2 models × 5 trials = **60**, from the remaining 86. The 26 left are the margin, for retries and refused preflights, capped at 1 retry per trial.
- **What the pilot is for:** the variance per surface, tokens per trial, harness problems, and whether the parity check holds on real runs. Its results are exploratory, whatever they show.
- **The confirmatory size** goes to intake with the pilot's variance, under a ceiling of 400 trials unless intake approves more.
  - **What 400 buys:** split 12 ways, it's about 33 per cell. Near 0.5, that's a ±17-point interval for one cell, and about ±24 for a difference between two: estimation, not detection.
  - **So the choice for intake is between:**
    - (a) one model, 6 × 66, at about ±12 per cell and ±17 per difference;
    - (b) fewer surfaces;
    - (c) both models at 33 per cell.
  - The plan's final form fixes one before any confirmatory trial.

## 5. Outcomes and analysis

- **Primary:** the optimal rate, intent to treat, per surface and model, with Wilson 95% intervals.
- **The contrasts:** each surface against `graph-A`, as risk differences with Newcombe intervals.
  - If intake wants tests, they're pre-registered here with Holm's correction across the five.
  - Otherwise this is estimation only, and says so.
- **Secondary** (descriptive):
  - the text-stated rate (an upper bound, as in the audit);
  - completed purchases;
  - tokens (excluding cache reads), tool calls and wall time;
  - consequential errors;
  - the information path: whether Pro's allowance was seen before the first approval request, and what each surface's first response carried.
- **What isn't claimed:** a mechanism. Any reading of why a surface differs is labelled a hypothesis for a later pre-registered run, as in M5's §4.2.

## 6. Integrity, as in M5

- logins, config dirs, the canary and the email scan;
- the owner's files stamped before and after (intake, 09:03Z);
- interleaved, rotated order;
- 2 trials at once;
- the load gate;
- partial traces moved aside, never deleted.

## 7. Open, for agreement before the final form

1. **With backend:**
   - the harness parts: the browser driver, the v0 adapter and the flat MCP export;
   - the parity oracle;
   - the preflight's checks in §2.
2. **With intake:** the confirmatory shape, (a), (b) or (c) in §4, and whether §5's contrasts are tested or only estimated.
3. **The run waits for M7a's comparison,** and for the fixture export that carries it.
