# M5 pilot, 2026-11-18

RFC 0003 §8's pilot: 110 trials, run by `node src/run.ts pilot` at `ejkorol/semantic-capabilities` 4893655c, two at a time.

## Status

**The pilot has no clean measurement cells.** It found 3 validity defects before any confirmatory trial:

1. **Context contamination:** the Claude trials are void (below).
2. **The add-on's price was never disclosed,** in every cell and on every model, the 15 Codex cells included. No tool response gave it: `hosting.addOn.add` and `.remove` took the add-on as an unbound input reference, so their summary read "unknown", and nothing listed add-on prices.
   - **T1 (F, G):** invalid in full.
   - **T3:** Pro Plus against Pro with the add-on could be priced only from the bundle's saving claim, so T3's ceiling may have come from the price gap.
   - **What follows:** re-run after hosting-lab's fix.
3. **The resume hole** (review of 4893655c): a stale server record could have been scored on a rerun. No trial was affected, and the fix goes to review.

- **The 95 Claude trials are void** (intake, 2026-11-18 01:13Z), because their context may have been contaminated. That's every Sonnet, Haiku and Opus cell. See "Context contamination" below.
- **The 15 Codex trials stand on contamination,** but carry the price-gap label: gpt-6.1-terra on A, C and S, task T3, 5 each.
- `report.json`'s per-condition rows pool both drivers, so they're void too. Use the Codex cells.

## Files

| file                | what                                                                                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report.json`       | The report: per cell (condition, task, model), and per condition. Void cells are marked `void`, with the reason. `traces` gives the raw traces' sha256                                                   |
| `interruption.json` | The first launch's interruption, the resume, the resume hole review found, and the mid-run memory write                                                                                                  |
| `traces.tar.gz`     | The raw traces, unedited: each trial's `.jsonl` trace (RFC 0003 §9), `.config.json`, `.server.json`, and the CLI's raw output. sha256 `b11d89db73c598fada89ff3fac99fcb3f44458e8e2119f44de13fb766afadf4d` |

## The run

- **When:** 00:51:09Z to 01:08:32Z. A first launch at 00:49:10Z completed 4 trials; see `interruption.json`.
- **Load** (1-minute average): 2.53 at the start, 4.04 at the end, recorded per trial.
- **CLIs:** claude 2.1.311 and codex-cli 0.159.0.
- **Models:** each resolved to its requested id: claude-sonnet-5-5, claude-haiku-5-5, claude-opus-5-5, and gpt-6.1-terra (Codex's default, pinned with `-m`).
- **Outcome:** 110 of 110 scored. 0 failed, 0 cap hits, 0 aborts, 0 trace mismatches, and 0 Codex sub-agent spawns.
- **Token cap:** input + output + cache writes, with cache reads excluded, at 150,000.
- **Code identity:** the 60 files the trials load had the same sha256 hashes, git status and mtimes at 00:55Z and at the end. The first launch's 4 trials ran on the same child code, since 4893655c changed only the parent's `run.ts`.

## Context contamination

A diagnostic `claude -p` call, configured exactly as a trial, was asked to quote whatever it was given besides the prompt. It wasn't a trial and wasn't scored. Its cwd was under `results/` in the repo, and it used `--setting-sources ''`.

- **What it received:** the seat's auto-memory index (`MEMORY.md`) and the memory-system instructions. It also got a git block: the branch, the git user, and the five latest commit subjects, which named the benchmark's harness.
- **What it didn't:** any `CLAUDE.md`.
- **A control from an empty directory outside the repo** received only the memory instructions, with an empty memory directory: no index, no git block.

The git block tells an agent it's in a benchmark, a demand characteristic. So the Claude cells are void, whether or not the effect is consistent across conditions. Codex loads `AGENTS.md`, and the repo has none, so its trials stand.

The memory index also changed mid-run, at 00:52:35Z, when the seat added one line. 17 Claude trials started before that and 78 after.

**From calibration on, trials run isolated:**

- from a git-free export of a reviewed commit, outside the repo;
- with a throwaway HOME per trial;
- after a preflight context canary, which refuses to start if the agent reports a memory index, a git block, or a `CLAUDE.md` or `AGENTS.md`.

## What the standing cells show

The Codex cells (gpt-6.1-terra, T3), from `report.json`:

| cell | optimal | median tokens | median turns | median latency |
| ---- | ------- | ------------- | ------------ | -------------- |
| A    | 5/5     | 15,055        | 10           | 24.8 s         |
| C    | 5/5     | 17,376        | 11           | 22.7 s         |
| S    | 5/5     | 12,993        | 9            | 19.8 s         |

All 15 trials chose Pro Plus, the optimum, and none completed an approved re-execution. T3 is at ceiling for this model, which may have come from the price gap.
