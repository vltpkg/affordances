# M7f: the six-surface comparison, the plan

**Status:** DRAFT (design, 2026-11-18), updated to intake's ruling (09:20Z). Nothing here has run. This plan, the analysis code and the preflight are committed before any trial. Its method is RFC 0003, as amended, with §12's surfaces and §16's lesson for condition construction.

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
| the outcome                     | one rule per surface, from the trace and the store (§5), labelled by `tasks.ts`'s labeller                                                                                            |

**Information parity, per surface.** Surfaces are expected to differ in what they show first, so that's measured, not refused. The deciding facts must still be _reachable_ on every surface: every plan's price and `bandwidthGb`, the add-ons' prices, and the bundle's price.

- **The check:** before any trial, an oracle walk through each surface's own tools reaches all of them, extending ffb00260's disclosure test to every surface (backend, 09:21Z):
  - **`full` and `progressive`:** ffb00260's walk, every expansion plus inspect;
  - **`v0`:** open every route in the SiteIndex, and read each graph;
  - **MCP and WebMCP:** call every query tool, and read the tool schemas;
  - **`browser`:** visit every page reachable from the start by links, and read each snapshot. This check reads text, so it's weaker: a fact passes only when its value appears in the same element as its label ("Pro" and "100 GB").
  - The preflight prints each surface's found and missing facts, and for each fact found, the element or response it matched, so a near-miss can be audited.
- **On failure:** a surface that can't reach a deciding fact is refused, because its result would measure the gap, not the surface. That's M5's F lesson.

**Three more preflight checks** (backend, 09:21Z):

- **Server instructions:** no MCP server the run starts sends an `instructions` field. Otherwise the server would be prompt text that differs by cell, and the canary wouldn't see it.
- **Tool lists:** each surface's tool list, with its names, descriptions and schemas, is hashed and recorded. The instruction line naming the tools is the only prompt difference allowed.
- **The browser's pages:** the server is the export's own production build, with its `.next` build id recorded, so the pages are pinned too.

**What each surface shows first is recorded and diffed** per cell, as the audit's first-view diff did: the facts present in its first response. It's descriptive only, and never conditioned on in the three contrasts: where the first response depends on the agent's first call, it's post-treatment.

## 3. The surfaces

**The confirmatory four** (intake, 09:20Z), each on the same hosting-lab app:

| id            | surface                           | the agent's tools                                                                                                                                                                                                                                            | approval                                                                                                                                               |
| ------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `full`        | protocol 1, the full graph        | the four tools, policy `exhaustive`, with §6.6's comparison                                                                                                                                                                                                  | the approval token                                                                                                                                     |
| `progressive` | protocol 1, the progressive graph | the four tools, policy `progressive`, with §6.6's comparison                                                                                                                                                                                                 | the approval token                                                                                                                                     |
| `v0`          | Affordances v0                    | packages/mcp's existing v0 tools, `affordances_open` and `affordances_call`, over the app's SiteIndex. Every capability must be a v0 action on a page, which the parity walk checks                                                                          | a `confirm: true` resend                                                                                                                               |
| `browser`     | browser automation                | choice-bench's own small MCP server over Playwright, which is already a devDependency, so nothing new. Its tools are fixed: `open(url)`, `snapshot()` (the accessibility tree as text, with element refs), `click(ref)`, `fill(ref, text)` and `submit(ref)` | none: the app's pages have no confirmation step, so the submit is the purchase. That's part of the surface, and the `browser` contrast is read with it |

**Pilot only:** MCP and WebMCP. They're described, not estimated, and their confirmatory comparison is a later round.

**The browser cell's server:** hosting-lab's production build, from the pinned export, with one server per worker on its own port. Each trial gets a fresh session cookie, since the store is per session. The outcome is read through the trial's own session (`project.read` over the API with its bearer), never through the inspector, which stays off.

**Two questions for intake, before the final form:**

1. **Which MCP?** RFC 0003 §12's surface is one tool per capability, with no relations or claims. RFC 0004 §4's default is the generic four tools, with elicitation by the server. This draft assumes RFC 0004's, since it's the shipped surface.
   - **If it's the per-capability export,** a consequential tool returns the summary and an approval token, and the agent re-calls with `approval`, as the four tools do (backend). Otherwise it would differ in two factors, not one.
   - **Targeted tools** take the target's key in the input (`targetAt`).
2. **The advocated graph** (M5's C) isn't in the ruling. This draft leaves it out of both the pilot and the confirmatory run.

## 4. Budget, and the pilot

- **The models:** Claude only, `claude-sonnet-5-5` and `claude-haiku-5-5`, with ids and the CLI pinned. Codex stays out until its isolation is solved.
- **The pilot:** 6 surfaces (the four, plus MCP and WebMCP) × 2 models × 5 trials = **60**, from the remaining 86. The 26 left are the margin, for retries and refused preflights, capped at 1 retry per trial.
- **What the pilot is for:** harness problems, tokens per trial, the per-surface variance, and whether the parity check holds on real runs. Its results are exploratory, and MCP's and WebMCP's are descriptive only.
- **The confirmatory run:** 4 surfaces × 2 models × **50** = **400**, the ceiling. It's interleaved and rotated as in M5.

## 5. Outcomes and analysis

**Estimation is primary, with no p-values** (intake, 09:20Z).

- **The request event, per surface.** It sets a trial's intended end state: the first request that applies wins (RFC 0003 §5.2).
  - **`full` and `progressive`:** an `execute` that's refused for confirmation, or that runs.
  - **`v0`:** the first consequential call, whether `confirm` is required or the call runs, and its `confirm: true` resend.
  - **`browser`:** a submit. The app's pages have no confirmation step, so a submit is always a completion.
  - **MCP and WebMCP (pilot):** the surface's own consequential call, or its elicited approval.
- **The two measures, on every surface:**
  - **intended:** the intended end state is optimal;
  - **completed:** the end state read from the app's store is optimal.
  - On `browser`, they coincide.
- **The primary outcome, per contrast:** the strongest measure both arms can express. (This is design's proposal, for intake: it's decided before any trial, since the contrasts depend on it.)
  - **`full` against `v0`, and `progressive` against `full`:** intended, as in M5. Both arms have a request event short of completion.
  - **`full` against `browser`:** completed. The browser can only give completed states, and scoring `full` as intended would compare "asked for" with "bought". In M5, A on Haiku was 43/114 intended and 0/114 completed.
  - **The other measure** is reported beside the primary, for every contrast and surface.
  - **The alternative,** completed for all three, would floor Haiku on every API surface, and turn two contrasts into measures of the approval mechanics.
- **The three contrasts, fixed now:**
  1. `full` against `v0`;
  2. `full` against `browser`;
  3. `progressive` against `full`.
- **For each contrast:**
  - the Mantel–Haenszel risk difference across the two models, with its 95% interval (Sato's variance), and per-model risk differences with Newcombe's intervals;
  - heterogeneity between the models is an estimate, not a test: the difference of the two per-model risk differences, with a bootstrap percentile interval (10,000 resamples, a fixed seed). Per-model results lead when it's large.
- **The precision target,** at 50 per cell and near a rate of 0.5:
  - about ±19.6 points for a per-model difference;
  - about ±13.9 for the pooled difference.
  - Rates far from 0.5 give narrower intervals.
- **The cost side, secondary,** per surface and model, each with a 95% interval:
  - median tokens, excluding cache reads, with a bootstrap percentile interval, 10,000 resamples and a fixed seed recorded in the code;
  - tool calls, and latency (wall time per trial), as medians with the same interval;
  - the consequential-error rate, with a Wilson interval. A trial has a consequential error when any request event (above) would produce a state that satisfies no reading of T6, by `tasks.ts`'s readings, or when any call is refused as `unauthorized` (RFC 0003 §6's definition, applied per surface).
    - **How it's read:** the request events come from the trace, and their resulting states from the labeller's dry run, as for the outcome. On `browser`, from the store after each submit.
- **Also descriptive:**
  - the text-stated rate (an upper bound, as in M5's audit);
  - completed purchases;
  - the information path: whether Pro's allowance was seen before the first approval request, and what each surface's first response carried.
- **What isn't claimed:** a mechanism. Any reading of why a surface differs is labelled a hypothesis for a later pre-registered run, as in M5's §4.2.

## 6. Integrity, as in M5

- logins, config dirs, the canary and the email scan;
- the owner's files stamped before and after (intake, 09:03Z);
- interleaved, rotated order;
- 2 trials at once;
- the load gate;
- partial traces moved aside, never deleted.

## 7. Before any trial

1. **Committed first:** this plan in final form, the analysis code, and the preflight. The preflight proves the conditions differ ONLY in the surface (§2): byte-identity outside each surface's tool layer, plus the parity walk.
2. **Agreed with backend (09:21Z):** the browser driver, the v0 tools, the parity oracle and the preflight's checks. Backend builds the drivers and the export after M6, the boundary fixes and M7a, in intake's order. The WebMCP driver is still to agree.
3. **The new export,** with §6.6 built (M7a), named by its commit.
4. **Intake's answers** to §3's two questions.
