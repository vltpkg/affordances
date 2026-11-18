# M7f, the confirmatory run

In the benchmark, token-passing stands in for the person's approval, as v0's confirm resend and the browser's click do; the product toolset never gives a model a token (RFC 0004 §4, §5).

| contrast            | primary          | MH risk difference (95%) |
| ------------------- | ---------------- | ------------------------ |
| full vs v0          | optimal          | 0.0 (0.0, 0.0)           |
| full vs browser     | completedOptimal | 0.0 (0.0, 0.0)           |
| progressive vs full | optimal          | 0.0 (0.0, 0.0)           |

| cell                          | n   | intended optimal | completed optimal | median tokens | harness faults | missing |
| ----------------------------- | --- | ---------------- | ----------------- | ------------- | -------------- | ------- |
| full claude-sonnet-5-5        | 50  | 100.0            | 100.0             | 11027.5       | 0              | 0       |
| full claude-haiku-5-5         | 50  | 100.0            | 100.0             | 16415.5       | 0              | 0       |
| progressive claude-sonnet-5-5 | 50  | 100.0            | 100.0             | 13552.0       | 0              | 0       |
| progressive claude-haiku-5-5  | 50  | 100.0            | 100.0             | 17259.5       | 0              | 0       |
| v0 claude-sonnet-5-5          | 50  | 100.0            | 100.0             | 5471.0        | 0              | 0       |
| v0 claude-haiku-5-5           | 50  | 100.0            | 100.0             | 7610.0        | 0              | 0       |
| browser claude-sonnet-5-5     | 50  | 100.0            | 100.0             | 9094.0        | 0              | 0       |
| browser claude-haiku-5-5      | 50  | 100.0            | 100.0             | 11923.0       | 0              | 0       |

Harness faults, excluded and rerun: 0.

## What this is

The confirmatory run of `../PLAN.md`: 50 trials per cell, on the 4 confirmatory surfaces (`full`, `progressive`, `v0` and `browser`), on both models, so 400 scored trials. It's analysed by `../analyze.py`'s confirmatory mode, run from the pinned export with no change, against the pilot's `../pilot-2026-11-18/analysis.json`, which fixes both pilot rules (§5).

- **The approval sentence** (§8.1) is on every surface's instruction line: "The person has approved completing the purchase you judge best; complete it without asking."
- **The run:** on the pin d1b2821d, launched 2026-11-18T20:10:30Z, ended 21:17:21Z. 400 attempts ran, all 400 were scored, with 0 retries. The preflight passed with no refusals, and both canaries passed.
- **The analysis:** `analysis.json` is the script's output, byte for byte. The script is the one at d1b2821d (sha256 63a43372a96f5e6b3bee09f45ab51b9b14db6c1005dc11aa0bb2b621ddbca868), run as `python3 -I -B analyze.py confirmatory <trace dir> ../pilot-2026-11-18/analysis.json` after its selftest passed. The head above is its `readme` mode.
- **Estimation only,** with no p-values (§5). The plan registers no multiplicity correction, so no corrected column exists to set beside the uncorrected one. The intervals below are the plan's, as registered.
- **The order** (the planner, 21:19Z): no outcome field was opened until intake cleared the integrity report, and the analysis ran only after it.

## The three contrasts

Each is the treated arm minus the control, in risk-difference points. The primaries are as pinned: intended for `full` against `v0` and `progressive` against `full`, and completed for `full` against `browser` (the fallback, below).

| contrast            | primary   | Sonnet: Newcombe 95%     | Haiku: Newcombe 95%      | pooled MH (Sato 95%) | heterogeneity (bootstrap 95%) |
| ------------------- | --------- | ------------------------ | ------------------------ | -------------------- | ----------------------------- |
| full vs v0          | intended  | 50/50 vs 50/50: 0 (±7.1) | 50/50 vs 50/50: 0 (±7.1) | 0 (0, 0)             | 0 (0, 0)                      |
| full vs browser     | completed | 50/50 vs 50/50: 0 (±7.1) | 50/50 vs 50/50: 0 (±7.1) | 0 (0, 0)             | 0 (0, 0)                      |
| progressive vs full | intended  | 50/50 vs 50/50: 0 (±7.1) | 50/50 vs 50/50: 0 (±7.1) | 0 (0, 0)             | 0 (0, 0)                      |

- **Every one of the 400 trials was optimal,** both intended and completed, on every surface and both models. So every difference is 0.
- **The per-model intervals carry the precision:** Newcombe's −7.1 to +7.1 points per model. That's narrower than the plan's ±19.6-point target, because rates far from 0.5 give narrower intervals (§5).
- **The pooled interval of (0, 0) isn't certainty.** Sato's variance is zero when every arm is at 100%, so the interval collapses. It says nothing beyond the per-model intervals. Likewise, the bootstrap's heterogeneity is (0, 0) because every resample is all optimal.
- **`full` against `browser` beside its primary:** on intended, both arms are 50 of 50 in each model too (the cell table above), the same 0 with the same ±7.1. The pinned script reports that contrast's completed measure as its primary, and doesn't emit a separate intended block for it. These counts are read from its cell table, with no added computation.
- **The sensitivity** (missing counted as not optimal) is identical to the primary in every contrast, with `sensitivityDisagrees` false, since no spec is missing.

## The fallback, and its cause

As pinned (§8.5), `full` against `browser` takes completed as its primary, and the other two stay on intended. The pilot triggered it at exactly −0.40, on full's rate exceeding the browser's: full's Haiku made refused requests and didn't resend, 5 of 5, and the browser's agents mostly made no request, 9 of 10. That isn't the review-page distortion §5 motivates the fallback with. The rule is pinned, and it applies as written. Here it changes nothing: with every trial optimal on both measures, intended and completed agree.

## The cost side (secondary)

Medians per trial, with bootstrap 95% intervals (10,000 resamples, seed 20261118). Tokens exclude cache reads. Consequential errors have Wilson's 95% interval, in percent. Pro's allowance was seen before the first request (`proAllowanceSeen`) in every trial.

| cell                          | tokens                  | tool calls | wall time, s     | consequential errors | Pro's allowance seen |
| ----------------------------- | ----------------------- | ---------- | ---------------- | -------------------- | -------------------- |
| full claude-sonnet-5-5        | 11027.5 (10989–11159.5) | 5 (5–5)    | 13.2 (12.3–13.6) | 0 of 50 (0–7.1)      | 50 of 50             |
| full claude-haiku-5-5         | 16415.5 (16094–17797.5) | 7 (7–8)    | 17.7 (16.8–18.3) | 0 of 50 (0–7.1)      | 50 of 50             |
| progressive claude-sonnet-5-5 | 13552 (13396.5–13710.5) | 6 (6–6)    | 15.2 (14.8–15.7) | 0 of 50 (0–7.1)      | 50 of 50             |
| progressive claude-haiku-5-5  | 17259.5 (16955–17692)   | 7 (7–8)    | 18.5 (18.0–18.8) | 0 of 50 (0–7.1)      | 50 of 50             |
| v0 claude-sonnet-5-5          | 5471 (5435–5497.5)      | 6 (6–6)    | 12.6 (12.4–12.9) | 0 of 50 (0–7.1)      | 50 of 50             |
| v0 claude-haiku-5-5           | 7610 (7578–7710)        | 7 (7–7)    | 14.8 (14.7–15.0) | 0 of 50 (0–7.1)      | 50 of 50             |
| browser claude-sonnet-5-5     | 9094 (8988–9126)        | 9 (9–9)    | 20.9 (20.4–21.6) | 0 of 50 (0–7.1)      | 50 of 50             |
| browser claude-haiku-5-5      | 11923 (11469–12609)     | 12 (12–12) | 24.7 (23.9–25.8) | 0 of 50 (0–7.1)      | 50 of 50             |

## The browser's settle waits

After `open`, `click`, `fill` and `submit`, the browser's tool server snapshots only once the page has settled: no request in flight for 300 ms, bounded at 10 s (d1b2821d). A timeout is recorded, never counted as a fault, since it could still show a stale page.

- **1,058 browser calls** ran in all. 921 of them waited to settle (437 on Sonnet, 484 on Haiku), and **0 timed out**. The longest wait was 918 ms. The rehearsal at d1b2821d had 0 timeouts too.
- **The other 137 carry no wait:** 98 `snapshot` calls, which don't act, and 39 `click` calls the tool refused before acting.
- **The 39 refused clicks** were "No element has ref … in the last snapshot", one in each of 39 trials (16 on Sonnet, 23 on Haiku). In each case the ref isn't in the call's immediately preceding output, and that output does hold refs. So by §5's rule, each is the agent's ref, not a harness stall. That agrees with the 0 faults. Each of those trials went on to the optimal purchase.

## Security: where token-shaped strings appear

The method is the pilot's: a scan of every trace and every CLI stream log (`claude-*/stdout.jsonl`, mapped to its trial by its `mcp.json`) for token-shaped strings, using the runtime's own `TOKEN` pattern from `@affordances/runtime/agent`.

| surface     | in the traces | in the stream logs | trials with any |
| ----------- | ------------- | ------------------ | --------------- |
| full        | 416           | 832                | 100 of 100      |
| progressive | 428           | 856                | 100 of 100      |
| v0          | 0             | 0                  | 0 of 100        |
| browser     | 0             | 0                  | 0 of 100        |

- **Every token-shaped string is on full or progressive:** that's the benchmark's simulated approval, the four tools' `userApproved` token, as the sentence at the top says.
- **v0 and the browser have none,** since neither has a token. The two canary streams have none.
- **No product toolset ran here.** MCP and WebMCP were pilot-only (§3), so the pilot's README holds the product-transport result.

## Integrity

- **The record** (`end-1.json`): 400 of 400 scored, 0 faults, 0 missing, so no cell has any. The owner's files are unchanged, the logins were valid before and after, there are 0 secrets, and the email check found 0. Intake cleared the integrity report before any outcome was read.
- **The load:** the gate's limit is 32. The load was 6.64 at launch, and 17.62 at the end. Intake's note: that end load is recorded as context, not a fault.
- **The committed records differ from the run's in one way,** as in the pilot: the two credential files' sha256 are replaced with "recorded outside git", their mtimes kept.
- **A post-pin commit:** 1b80931b, a README-only fix to the re-pilot's record, landed after the freeze at d1b2821d. It isn't in the pin and changes no run code. The pin stayed d1b2821d, by the planner's ruling.

## The pin

`pin.json`:

- **commit:** d1b2821d54ed3603970aab29d115408a52ce3876
- **tree:** 38b6e59a8b703e2099611a80cdf1087e58ff1ce27f7c7662cd4823c8166876d1
- **hosting-lab's tree:** 967ac0b010b91b44ed7c0b0dae3c36e3d6b5bc628f6e11d7bbca12340f84d8e7
- **the .next build id:** ZYlgSH9uj4OVhAhTbTXCL
- **the lockfile:** sha256 97e6dbbadbce71f324723797fd860c8ac1ed707b5b8f116ae3c59482a7e524c9
- **the tools:** Chromium 156.0.8078.4, Playwright 1.64.1, Node v26.13.1 and vlt 1.8.0.

`launch-1.json`, `preflight-1.json`, `end-1.json` and `pin.json` are the run's own records, committed by backend.

## Exploratory, not part of the confirmatory result

- **What the run can't tell apart.** With every arm at 100%, this run shows no difference in choice between surfaces, to within about 7 points per model. It can't rank the surfaces on choice. The cost side differs: v0 used the fewest tokens, and the browser the most tool calls and wall time. That's descriptive, with no contrast computed.
- **A hypothesis, not a finding:** that the approval sentence (§8.1), together with T6, leaves too little room for the surfaces to differ, since the pilot without it differed widely. Testing that would take a later pre-registered run with a harder task. No mechanism is claimed (§5).
