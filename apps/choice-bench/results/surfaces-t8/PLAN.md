# M8e: a deeper surface task, T8, the plan

**Status:** DRAFT (design, 2026-11-18), for review and then intake. Nothing here runs until intake approves it, and it's committed before any trial. Its method is M7f's (`../surfaces/PLAN.md`) and RFC 0003's, as amended, with §16's lessons. Where this plan says nothing, M7f's plan holds.

In the benchmark, token-passing stands in for the person's approval, as v0's confirm resend and the browser's click do; the product toolset never gives a model a token (RFC 0004 §4, §5).

## 1. The question

M7f's question, on a task built so that the surfaces differ where they're designed to differ. Through which surface does an agent most often reach the user's optimal end state, and at what cost, when the fact that decides the choice isn't in the first response?

## 2. Why this task

**The choice is made from the surfaces' design, not from any trial's result.**

- **What the surfaces differ in:** what each shows first, and what it takes to reach the rest (RFC 0002 §6.3: progressive disclosure "changes what is shown first. It never changes what can be found"). `full` shows everything in its first view. `progressive` shows the start and one step of relations. `v0` and `browser` show one page at a time.
- **Where T6's deciding facts sit, by construction:** every plan's price, bandwidth and rollback are attributes of `hosting.plan`, the target of the plan choice set. RFC 0002 §6.6 puts a choice set's comparison, every member's attributes, in any view that shows the set, under every policy. And the add-ons' and bundle's prices are attributes of offers one step from the project. So on `full` and `progressive` alike, every deciding fact is in the first view, and on `v0` and `browser`, on the first plans and add-ons pages. A task built that way gives the surfaces no room to differ in what they're for.
- **So T8 puts one deciding fact one step further out:** on a region, read through its own capability, not on the plan. §6.6's comparison doesn't carry it. `full`'s first view does. `progressive` reaches it with one expansion, and `v0` and `browser` with one more page. That's intake's "a constraint whose deciding fact sits behind one expand".
- **What T8 tests, plainly:** by construction, `full`'s first view carries the regions and the other surfaces need one step, so T8 tests whether an agent fetches a deciding fact one step out. A `full` advantage is partly built in, and isn't a finding about `full` in general.
- **And the owner's recommendation is wrong only on that fact:** intake's "an advocated option wrong only on an attribute at depth >1". An agent that reads only what's shown first can see nothing wrong with it.
- **What's rejected, and why:**
  - **More options or add-ons, alone:** that lengthens what every surface shows first. It doesn't move any fact behind a step.
  - **Withholding the approval sentence on one surface** (dropped by intake): it's a confound by design, a difference in prompt, not in surface.
- **What doesn't change:** the approval sentence, byte for byte on every surface (§8.1 of M7f's plan), and every other prompt byte but the surface's tool sentence.

## 3. T8

**The user's words:** "A production site with instant rollback, for customers in the EU, so it must be served from an EU region. It serves about 150 GB of traffic a month. Keep the monthly cost as low as possible."

**T8's fixture edits,** applied identically in every cell, as M7f's claim edit was:

- **The catalog:** two regions, as data in `catalog.ts`, each listing the plans it serves: `us-east` ("US East", jurisdiction `US`) serves Hobby, Pro and Business, and `eu-west` ("EU West", jurisdiction `EU`) serves Business only. Nothing else in the catalog changes, prices and add-ons included.
- **The manifest,** exactly:
  - **the resource:** `hosting.region`, key `slug`, attributes `slug`, `name`, `jurisdiction` and `plans` (the slugs of the plans it serves). The fact lives on the region, since IR relations are between definitions, not instances (RFC 0001 §5.3), so no relation can say which regions one plan has;
  - **the capability:** `hosting.region.read`, of kind `query` (RFC 0001 §2.2), as `hosting.project.read` is. Its target is `hosting.region`, its input `{ region }` with `targetAt: 'region'`, and its authorization `authenticated`, with no conditions. Its resolver lists both regions, so there's one offer per region. It's not an `alternatives` type, so it adds no choice set, and it charges nothing, so it can't change `purchaseMade` or the ground truth;
  - **the relation:** `relatedTo`, from `hosting.plan.subscribe` to `hosting.region.read`, described "Where a plan is served from". That puts the region offers one `relations` expansion from any plan offer;
  - **why not a plan attribute:** on purpose, for the benchmark, so that §6.6's comparison doesn't carry it. It also marks a real product limit: §6.6 covers a member's own attributes only, so a deciding fact on a related resource is in no comparison. That's recorded as open in M8d.
- **The owner's claim:** the recommendation is on Pro, "Recommended for production sites: instant rollback, and extra bandwidth whenever you need it". Every word is true. It cites `rollback` (RFC 0001 §9).
- **The pages,** for `v0` and `browser`: the plans page is unchanged. Each plan gets a detail page, `/plans/<slug>`, linked from its card, which lists its regions. That's the pages' one step, as an expansion is the graph's.
- **The ground truth,** in `tasks.ts`, as data: a requirement `region: 'eu-west'`, beside T6's `rollback` and `minBandwidthGb: 150`. A test checks the derived sets against the hand-written ones, as for T1 to T7.

**What that gives:**

| end state                 | USD a month | why                                                        |
| ------------------------- | ----------- | ---------------------------------------------------------- |
| Business                  | 80          | **optimal:** the only plan served from the EU              |
| Business with any add-ons | 85 to 115   | overspends                                                 |
| Pro with extra bandwidth  | 30          | fails: served from `us-east` only. It's the favored option |
| everything else           | —           | fails                                                      |

- **The favored option** is Pro with extra bandwidth, the recommendation's, and the cheapest state that meets every requirement shown first. It fails only on the region, the deciding fact behind one step.
- **The trap is one fact, not a trick:** the user names the requirement in words. An agent that checks it gets it right on every surface.
- **The names:** "T7" is RFC 0003's existing task (Pro Plus with extra bandwidth). So this task is T8, and `tasks.ts` gains it beside the others.

## 4. Checked before any trial

Everything M7f's preflight checks (`../surfaces/PLAN.md` §2) holds, with T8's prompt and fixture. Plus:

- **The depth check,** per surface, mechanical, recorded, and refusing the run on failure:
  - `full`: both region offers, with their `plans`, are in the first view;
  - `progressive`: no region offer is in the first view (the region capability is two steps from the start, through `hosting.plan.subscribe`), and one expansion `along: 'relations'` from a plan offer returns both region offers, with their `plans`;
  - `v0` and `browser`: no plan's regions are on the first page opened, and one link from the plans page reaches them;
  - **if any of that fails,** T8's fixture is redesigned and goes back to review and intake. No trial runs on a fixture whose depth isn't as stated.
- **Information parity:** M7f's walk, extended with the regions, by the same matchers. On `full` and `progressive`, a region's fact is found when one region object holds its slug and its whole `plans` list. On `v0` and `browser`, it's found when each plan's detail page lists exactly its regions, by the browser's label-and-value rule. So that Pro isn't served from `eu-west` is reachable as a complete list, not as an absence. A surface that can't reach a deciding fact is refused.
- **The ground-truth test:** `groundTruth(T8)` derives exactly the table above.

## 5. Surfaces, models and contrasts

- **The surfaces:** M7f's confirmatory four, `full`, `progressive`, `v0` and `browser`, built as in M7f's §3. MCP and WebMCP stay out.
- **The models:** `claude-sonnet-5-5` and `claude-haiku-5-5`, pinned, with the CLI pinned.
- **The three contrasts, fixed now:** `full` against `v0`, `full` against `browser`, and `progressive` against `full`, each estimated as M7f's §5 estimates it: the Mantel–Haenszel risk difference across the two models (Sato's variance), per-model Newcombe intervals, heterogeneity by bootstrap (10,000 resamples, a fixed seed), and the missing-as-not-optimal sensitivity. Estimation only, with no p-values and no multiplicity correction, as in M7f.
- **The primary outcome:** the intended end state is optimal, on every contrast. Completed is beside it, by M7f's one store rule (`purchaseMade`).
- **The fallback:** M7f's fallback check, applied as pre-registered there but **directional**, as its motivation is: it applies only if browser − full ≥ 0.40 on the unconfirmed-request rate (a request event but no completed purchase, over the trials run, pooled over both models per arm), compared exactly, as a fraction. A difference the other way never applies it. Then `full` against `browser` takes completed as its primary. The browsing-load rule (0.20) is M7f's, unchanged.
- **The cost side and the descriptive measures:** as M7f's §5, with one addition: whether the deciding fact was seen before the first request event (`regionSeen`), by the parity walk's matcher, per surface, beside `proAllowanceSeen`. It's descriptive, and never conditioned on.
- **The analysis code:** M7f's `analyze.py`, extended for T8 only where it must be (the task id, `regionSeen`, the directional fallback), with a selftest at exactly the threshold, and committed before the pilot.

## 6. The pilot and its gates

- **The size:** 4 surfaces × 2 models × 5 = **40**, plus a margin of 20 for retries and refused preflights: **60 at most.** The cap is M7f's: one retry per trial.
- **What it's for:** harness problems, the depth check on real runs, the per-surface variance, the two rules the confirmatory run takes from it (the fallback and the browsing rule), and the headroom gate.
- **The headroom gate, blind to the contrasts:**
  - **The measure:** for each model, the pooled optimal rate (intended) across ALL four surfaces: 20 trials per model.
  - **It passes when** both models' rates are within [10%, 90%]: from 2 to 18 of 20 optimal, inclusive, compared exactly.
  - **Blind to the contrasts:** the gate is computed and read before any per-surface rate is opened. Design runs the analysis code's headroom mode, which prints only the two pooled rates and the pass or fail, and nothing per surface, and reports those to intake. No seat opens a per-surface rate until intake rules on the gate.
  - **If it fails** (either model under 2 or over 18): back to intake before any pin. T8 isn't changed and rerun under this plan, and nothing is labelled confirmatory.
- **The no-request check:** M7f's §8.3, carried over as a pilot check, not a gate: "no request made" in at most 1 of 10 per surface, pooled over both models. If any surface exceeds it, back to intake.
- **Harness faults:** as M7f's §5, with the pause at more than 2 in the pilot.

## 7. The confirmatory run

- **The size, for intake to approve:** 4 surfaces × 2 models × **50** = **400**, interleaved and rotated as in M5. At 50 per cell and near a rate of 0.5, that's about ±19.6 points for a per-model difference and about ±13.9 pooled (M7f's §5), and narrower away from 0.5. A larger run, at intake's choice, narrows them in proportion to 1/√n: four times the trials halves each interval.
- **It runs only** after the pilot passes the headroom gate and the no-request check, on a new pin, with the pilot's two rules fixed and on intake's word.
- **Each results README** carries the approval sentence at its top, verbatim, as M7f's §7 item 5 requires.

## 8. Integrity, as in M7f

All of M7f's rules hold, unchanged:

- logins, config dirs, the canary and the email scan;
- the owner's five files stamped before and after;
- interleaved, rotated order, 2 trials at once, and the load gate;
- a fresh server per trial from the one pinned build, with the outcome from `lab.endState`, cross-checked against `project.read`;
- harness faults (stalls and outcome disagreements) excluded, rerun and counted per cell, at most two attempts per spec, and the final attempt's class deciding: a harness fault is missing, a CLI crash or a 529 is failed, and an authentication failure stops the run;
- partial traces moved aside, never deleted;
- blinding: no outcome field read until intake clears the integrity report, and a status-only liveness check;
- a quiet window for each run, announced by the planner;
- the pin: an export named by its commit, with the tree, hosting-lab's tree, the build id, the lockfile and the tools recorded.

## 9. What isn't claimed

- **A mechanism.** As in M7f's §5: any reading of why a surface differs is a hypothesis for a later pre-registered run.
- **Generality beyond T8.** A difference on T8 says that surfaces differ when a deciding fact is one step out, on this fixture, for these models. That isn't a ranking of surfaces in general.

## 10. Built after approval, by whom

- **design:** the catalog's regions, the region resource, its query capability and the `relatedTo` relation, the claim edit, the plan detail pages, `tasks.ts`'s T8 and its tests, and `analyze.py`'s extension;
- **backend:** the harness for T8, the depth check and the parity walk's extension in the preflight, the new pin, the rehearsal and the runs (M8e-run), after B1-backend is accepted.
