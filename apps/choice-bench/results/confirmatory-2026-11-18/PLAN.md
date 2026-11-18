# M5 confirmatory run: the plan, pre-registered

This plan is committed before any confirmatory trial. Its commit's timestamp precedes the first trial's `startedAt`. Intake approved it at 2026-11-18 03:27Z, with the planner's additions at 03:28Z.

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
- **The test:** each contrast is a difference in optimal share, in percentage points, against A. Both are two-sided, at α = 0.05, with **Holm's** correction across the two.
- **Pooling:** models are reported separately and pooled.
- **Calibration's C and S results stay sealed** until this run's results are in. They're reported afterwards as calibration-only (n=5 per model), and are never pooled into this run.

## What runs

- **The fixture is c81eeeb1a61e0330be34ce170169c8d9a77292cc,** calibration's: its pinned, git-free export is the only code a trial runs.
- **The runner is `run-confirmatory.ts`, committed with this plan:** sha256 `557df5c4d863064d93b516e081d809272ecdc33142a1f3d56397c88fbd659c04`. It's copied byte-identical beside the export, and it imports the export's own modules: the harness, drivers, canary and isolation. So every trial is c81eeeb1's own `runTrial`, and the runner only selects and schedules the 684. It refuses to start unless:
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

## Stopping and re-runs

- **The run stops at exactly 684 trials.**
- **A re-run happens only after an infrastructure interruption** (the harness, the host or the CLI process, never the agent's own outcome). It uses the same pre-assigned spec (condition, task, model, index, and so the plan-id order). The partial traces move to `interrupted/` and are never deleted. Every re-run is listed in the report.
- **A trial that fails** for any other reason is reported as failed, and isn't re-run without intake's OK.

## After the run

- **Checks:** logins before and after; the config-dir footprint (flagged trials listed, and a stop on any global write); the credential scan; and the email scan, with any hit redacted, marked, in the committed archive.
- **The commit,** by file id: the report, the README, and the trace archive.
