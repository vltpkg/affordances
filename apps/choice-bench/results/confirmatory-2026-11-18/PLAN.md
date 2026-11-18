# M5 confirmatory run: the plan, pre-registered

This plan is committed before any confirmatory trial. Its commit's timestamp precedes the first trial's `startedAt`. Intake approved it at 2026-11-18 03:27Z, with the planner's additions at 03:28Z.

## Amendment: the order of running (intake, 2026-11-18 04:28Z), before any trial

- **What changed:** the runner ran the 684 in **blocks**: model, then condition, then index. It now runs them **interleaved and rotated**.
  - **The order:** by index i = 0..113, with each i's six specs side by side.
  - **Models alternate:** Sonnet first when i is even, Haiku first when it's odd.
  - **Conditions rotate** within each model (i mod 3: A C S, C S A, S A C), so each condition leads 38 indexes.
  - **The two workers** take the next specs from this one ordered queue.
  - **What didn't change:** the specs, their ids and their plan-id orders.
- **Why:** blocks confound every arm with time. Each arm's trials would run in a different stretch of the run's hours, so a drift in host load, the provider's latency or the model's behaviour would fall on one arm, and the stratified test couldn't separate it from the condition. Interleaving puts every arm at the same moments.
- **When:** in this plan's amendment commit, whose time is recorded in git.
- **No trial had run.** The first invocation waited at its load gate from 03:56Z, and was stopped by its PID at 04:28Z before it started:
  - its wrapper log holds no START line;
  - its results directory (`…/trials/confirmatory-2026-11-18`) was never created;
  - so 0 trials and 0 traces.
- **The runner:** its sha256 was `557df5c4d863064d93b516e081d809272ecdc33142a1f3d56397c88fbd659c04`, and is now `e4e0332b0068b4377bae67541875a9b3c36c23b91b221dc057ce7a27c20cbeab`.
  - **Order tests** (`apps/choice-bench/test/confirmatory.test.ts`): the order is a permutation of the 684 specs, with their ids and indexes unchanged; each index's six specs are adjacent, with both rotations; each condition leads a third of the indexes.
  - **The fake-driver equivalence check, redone** on the same 24-spec sample: 0 of 24 unequal against c81eeeb1's own `runTrial`, and 0 of 24 between two reference runs (248 lines). The manifest and base digests are single-valued and equal across all three runs (`sha256-4ei29Au…`, `sha256-5wGv2c…`).
- **The load gate,** under intake's (a)-and-(b) rule (04:27Z): with the arms interleaved, (a) holds, and (b) holds, since the longest calibration trial used 3.7% of the time cap. So the gate is a 1-minute load under 32 (2× cores). Load is recorded per trial, and the optimal rate by load tercile is reported as a secondary check.

## The calibration seal, and its breach

- **The breach:** calibration's C and S outcomes are sealed until this run's results are in (intake). The calibration record's first commit (732c40d4) was made at 03:27Z, before the sealing instruction of 03:28Z, and held C's and S's per-cell values and the full traces.
- **The fix:** it was rewritten before anything was pushed (intake's remedy, 03:36Z). The record is now b1fae971, committed at 2026-11-18T03:37:22Z, and carries only A's cells, the run's health fields and the task choice.
- **What's held back:** the full report and traces, unedited and unopened, in the seat's on-disk export, with their sha256s in the calibration README. They're committed and hash-checked once this run's results are in.
- **Verified:** `git log -p` over e9645ab4..tip carries no C or S calibration cell or condition row (counted by name only, never by value). The matches it finds are the pilot's void cells.
- **Attestations,** that no C or S calibration outcome value was read, all on 2026-11-18:
  - backend, 03:36Z;
  - design, 03:36Z;
  - intake, 03:36Z;
  - review, 03:36Z. At 03:35Z review read structure only, to establish the breach: top-level keys, cell and condition names, one cell's field names and one boolean, no values. It never opened calibration's traces;
  - the planner, 03:35Z.
- **What was read, and is out of scope:** intake read the pilot's C and S cells, which are void and contaminated, not calibration's; design read only the pilot's results.
- **The pre-registration and the trials:** this plan's first commit was made at 2026-11-18T03:34:30Z, when no confirmatory trace existed; its rebuild on the rewritten record changes only this section. No confirmatory trial has run before this plan's commit.

## Design

- **Task:** T6, the primary chosen in calibration under RFC 0003 §8's rule, on A's optimal rate alone (A on T6 was 6/10; `results/calibration-2026-11-18/`).
- **Cells:** A, C and S × `claude-sonnet-5-5` and `claude-haiku-5-5` × **114 trials each** = **exactly 684 trials**, through `claude -p` (Claude Code 2.1.311).
- **Counterbalancing:** each cell's trials take the six plan-id orders in turn, by trial index (RFC 0003 §4).
- **Concurrency:** at most 2.
- **Caps** (RFC 0003 §5.2):
  - 30 tool calls, 40 turns and 10 minutes per trial;
  - 150,000 tokens, counted as input plus output plus cache writes, with cache reads excluded.
  - A capped trial is recorded as capped.

## Hypotheses and analysis

- **H1:** S against A, structure including position (RFC 0003 §7.1).
- **H2:** C against A, advocacy shown up front against advocacy available on request (§7.1).
- **The outcome:** the share of trials whose choice is optimal, where the choice is the intended end state (§5.2). It's **intent to treat**: a capped trial isn't optimal. The capped-excluded share is the sensitivity analysis.
- **The primary test** (intake, 2026-11-18 03:54Z), for each of H1 (S vs A) and H2 (C vs A): a **Cochran–Mantel–Haenszel test** of the optimal rate, **stratified by model** (claude-sonnet-5-5, claude-haiku-5-5), two-sided, with **Holm's** correction across H1 and H2 at a family-wise α of 0.05, intent to treat (a capped trial isn't optimal).
- **The headline effect** is the **Mantel–Haenszel risk difference** with its 95% confidence interval, not the p-value alone.
- **Secondary, not confirmatory:**
  - each model's Fisher exact test, and its risk difference with a Newcombe interval;
  - a Breslow–Day test of homogeneity across the two models;
  - the capped-excluded sensitivity analysis.
- **Addendum: two method rules** (intake, 2026-11-18 06:52Z; written 2026-11-18T06:53:16Z). These were written before any confirmatory outcome was read.
  - **The primary CMH test is continuity-corrected.** The uncorrected statistic is reported beside it. If the two disagree on significance, the corrected one governs. Holm's correction and the family (H1, H2) stay as pre-registered, applied to the corrected p-values.
  - **The Mantel–Haenszel risk difference's 95% CI uses Sato's (1989) variance.**
  - **The code** is `analyze.py`, beside this plan: standard-library Python, run as `python3 -I analyze.py <trace dir>`.
    - Its self-test, `python3 -I analyze.py --selftest`, checks Fisher's tea-tasting table (two-sided 0.4857), Newcombe's 1998 example (56/70 vs 48/80: 0.2000, 0.0524 to 0.3339), and the single-stratum reductions: the MH chi-square against Pearson's, its corrected form, and Sato's variance against Wald's. It also checks the chi-square tail, Breslow–Day on identical strata, Holm's correction, and that Holm runs on the corrected p.
    - **The other methods in the code:**
      - Fisher's two-sided p sums the tables no likelier than the one observed;
      - Newcombe's interval is the hybrid score (method 10);
      - Breslow–Day carries Tarone's correction;
      - the capped-excluded analysis takes `optimalChoice` over trials that ended final;
      - load terciles are cut over the trials' start loads.
- **Calibration's C and S results stay sealed** until this run's results are in. They're reported afterwards as calibration-only (n=5 per model), and are never pooled into this run.

## What runs

- **The fixture is c81eeeb1a61e0330be34ce170169c8d9a77292cc,** calibration's: its pinned, git-free export is the only code a trial runs.
- **The runner is `run-confirmatory.ts`, committed with this plan:** sha256 `e4e0332b0068b4377bae67541875a9b3c36c23b91b221dc057ce7a27c20cbeab`. It's copied byte-identical beside the export, and it imports the export's own modules: the harness, drivers, canary and isolation. So every trial is c81eeeb1's own `runTrial`, and the runner only selects and schedules the 684. It refuses to start unless:
  - the export's `.export-sha` is c81eeeb1;
  - its own sha256 is this one;
  - the export's loaded files digest to calibration's (`7e6da386b85f5c05328e22194177d756289039bbace41281f3104135fedb5b35`).
- **The review check** (intake): a fake-driver run of the runner, over a sample of 24 of the 684 specs (in each cell, indexes 0, 1, 57 and 113), against c81eeeb1's own `runTrial` on the same specs.
  - **The result:** byte-equal per-trial records, 248 lines, once what the harness itself varies run to run is normalized.
  - **What's normalized:** the fresh random account, so its project key and every revision digest over it; approval tokens; times, durations and load; and the output directory.
  - **The control:** the harness run twice against itself differs in exactly those fields.
- **The runtime is c81eeeb1's,** before the "summaries list every charge" rule (dbc947e0). T6's plan and add-on summaries state their own prices. Exploratory runs on a later export name their own commit, and nothing is pooled across the two.
- **The fixture's claim edit:** on T6 the owner's recommendation is on Business (§3.1), identically in A, C and S.
- **Isolation and the canary** (RFC 0003 §14):
  - a pinned, git-free export, outside the repo and /tmp, with its `.export-sha` asserted;
  - the context canary must pass against the existing v2 baseline (Claude Code 2.1.311, allow-list sha256 `5e7d57bd6dfa362858f0eb61ab24c8417fe2706437922bf6a1c9a8925e044446`), with no re-baseline.

## Which runs count

- **A run counts only if its `preflight.json` records `runner` as `e4e0332b0068b4377bae67541875a9b3c36c23b91b221dc057ce7a27c20cbeab`**, this plan's runner (review of bdc11f9c). A file can't hold its own hash, so the runner's self-check holds only when the operator passes the pre-registered sha256. An edited runner given its own sha256 would run, and would record a different one. Such a run doesn't count.

## Stopping and re-runs (intake, 2026-11-18 03:54Z)

- **684 scored trials, one per spec.**
- **A driver failure is retried once,** with the same spec (condition, task, model, index, and so the plan-id order).
  - **Both attempts are kept,** and the retry is an extra attempt against the exploratory budget.
  - **If both fail,** the spec is scored "failed": not optimal under intent to treat, and reported.
  - **Capped trials are never retried.**
- **If more than 5% of specs (35) need a retry,** the run pauses and intake is told before it continues, since that indicates a systematic infrastructure problem rather than chance.
- **The operating rules** (the planner, 03:55Z; they're operating rules, not code): Retry = a second invocation of the same command (resume): it reruns only specs with no complete trace, with the same pre-assigned specs, and partials are kept in interrupted/. The command runs at most twice, each run with its own recorded preflight. After the first run, if more than 35 specs (5%) are failed, the second run does NOT start; intake is told first.
- **A capped trial has a complete trace,** so no invocation ever re-runs it.

## After the run

- **Checks:** logins before and after; the config-dir footprint (flagged trials listed, and a stop on any global write); the credential scan; and the email scan, with any hit redacted, marked, in the committed archive.
- **The commit,** by file id: the report, the README, and the trace archive.
