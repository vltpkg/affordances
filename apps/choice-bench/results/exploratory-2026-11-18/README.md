# M5 exploratory run, 2026-11-18

**EXPLORATORY.** It reports estimates with 95% intervals, and no p-values. It changes nothing in the confirmatory run's pre-registered results.

It decomposes the confirmatory run's C into the two factors H2 confounded (H2's validity note, [`../confirmatory-2026-11-18/`](../confirmatory-2026-11-18/README.md)):

- **`C-full-scope`** is C minus its scope: C's claims, recommendation order and relevance over A's exhaustive scope;
- **`A-scope`** is A with only the advocated scope.

The plan is [`PLAN.md`](PLAN.md): 88627423, with review's fixes in ca181eb3, both before any trial.

## The run

- **One invocation,** 2026-11-18 08:11:23Z to 09:01:35Z, exit 0. **250 scored, 0 failed, 0 capped, 0 aborted.** There were no retries, and no second invocation.
- **The pins** (in `report.json`'s `run`):
  - runner sha256 `5b811ca5…`;
  - the c81eeeb1 export plus `conditions.patch` (`983d94d3…`);
  - the unpatched loaded files equal calibration's (`7e6da386…`), and the patched copy's are pinned (`99d61cd7…`).
- **The offer sets:** the check found no problems, and intake's two equalities held. `C-full-scope`'s first view offers exactly A's offers, and `A-scope`'s exactly C's.
- **The gate:** a 1-minute load under 32 ([`launch-1.json`](launch-1.json)). It started at 23.93, and trial start loads ran from 1.3 to 18.5, with a median of 6.3.
- **Isolation and integrity:**
  - the canaries for Opus, Sonnet and Haiku passed against their v2 baselines (0 written, 0 different);
  - both logins were valid before and after;
  - no watched global config changed;
  - 0 trials were flagged for a config-dir footprint;
  - the credential scan found nothing;
  - the email scan found the address 0 times, so the archive is unredacted.
- **The owner's files,** checked by mtime and sha256 before (08:11:22Z) and after the run:
  - four were unchanged: `~/.config/claude/settings.json`, `~/.codex/AGENTS.md`, `~/.codex/config.toml` and `~/.codex/auth.json`;
  - **`~/.config/claude/.credentials.json` changed once, at 08:33:17Z.**
    - The write is consistent with an access-token refresh: the previous write was at 00:38:15Z. Intake reads it as the Claude CLI's own refresh (09:03Z).
    - The run uses the real config directory by design. About 23 `claude` processes on the host share it, this rig's Claude seats among them, so the mtime can't identify the writer.
    - The login is valid after the run, nothing copied, moved or edited the file, and the traces' credential scan is clean.
  - From now on, every run stamps the owner's files before and after, as this one did (intake, 09:03Z).

## Results (exploratory)

The results come from [`analyze_exploratory.py`](analyze_exploratory.py), run with `python3 -I` on this run's traces and the confirmatory run's. Its output is [`analysis.json`](analysis.json).

- **The method:** it reuses Newcombe's interval from the confirmatory `analyze.py` (d699a0d4), and the trial reader and coding from `audit/code.py` (aa8071b0), unchanged.
- **The outcome:** optimal, intent to treat, with the intended end state as the choice. The text-stated rate is an upper bound.

A descriptive decomposition of every cell the contrasts use (`completed` is `metrics.completed`, a purchase actually made):

| run          | cell           | model  | optimal (ITT) | text-stated | saw Pro's allowance first | completed |
| ------------ | -------------- | ------ | ------------- | ----------- | ------------------------- | --------- |
| exploratory  | `C-full-scope` | Sonnet | 42/50         | 49/50       | 50/50                     | 44/50     |
| exploratory  | `C-full-scope` | Haiku  | 23/50         | 50/50       | 45/50                     | 0/50      |
| exploratory  | `C-full-scope` | Opus   | 18/25         | 25/25       | 25/25                     | 7/25      |
| exploratory  | `A-scope`      | Sonnet | 25/50         | 47/50       | 49/50                     | 26/50     |
| exploratory  | `A-scope`      | Haiku  | 17/50         | 50/50       | 46/50                     | 1/50      |
| exploratory  | `A`            | Opus   | 14/25         | 25/25       | 25/25                     | 8/25      |
| confirmatory | `A`            | Sonnet | 101/114       | 114/114     | 114/114                   | 102/114   |
| confirmatory | `A`            | Haiku  | 43/114        | 112/114     | 100/114                   | 0/114     |
| confirmatory | `C`            | Sonnet | 17/114        | 50/114      | 19/114                    | 93/114    |
| confirmatory | `C`            | Haiku  | 34/114        | 112/114     | 96/114                    | 1/114     |

The text-stated rate is an upper bound (the audit's re-derivation). The optimal rate counts the intended end state, not a completed purchase.

### The contrasts

Each is a risk difference in points, with Newcombe's 95% interval. **E1 to E4 are cross-run:** they compare with confirmatory cells, on the same runtime, fixture and isolation, but from a different stretch of time, which interleaving doesn't cover.

| contrast                                                                 | Sonnet                 | Haiku                 |
| ------------------------------------------------------------------------ | ---------------------- | --------------------- |
| E1: the advocacy package over A's scope, `C-full-scope` vs A (cross-run) | −4.6 (−17.9 to +5.9)   | +8.3 (−7.6 to +24.2)  |
| E2: the advocated scope alone, `A-scope` vs A (cross-run)                | −38.6 (−52.7 to −23.5) | −3.7 (−18.5 to +12.5) |
| E3: the package within the advocated scope, C vs `A-scope` (cross-run)   | −35.1 (−49.5 to −19.7) | −4.2 (−20.0 to +10.4) |
| E4: the scope within the package, C vs `C-full-scope` (cross-run)        | −69.1 (−78.5 to −54.4) | −16.2 (−31.8 to −0.4) |

**E5, on Opus and within this run:** `C-full-scope` vs A, +16.0 (−10.1 to +39.4).

### Descriptive

- **For Sonnet:**
  - E1's interval includes 0.
  - E2, E3 and E4's intervals exclude 0.
- **For Haiku,** every interval includes 0 except E4's, which only just excludes it.
- **Mechanism:** none is claimed here. These are cross-run estimates, and the reading is intake's.

## Files

| file                              | what                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `PLAN.md`                         | the plan, committed before any trial                                                              |
| `run-exploratory.ts`, `launch.sh` | the runner and its launcher, as committed before the run                                          |
| `conditions.patch`                | the one patch to the c81eeeb1 export                                                              |
| `analyze_exploratory.py`          | the exploratory analysis, committed before any outcome was read                                   |
| `report.json`                     | the runner's report, as written                                                                   |
| `launch-1.json`                   | the gate's record                                                                                 |
| `analysis.json`                   | `analyze_exploratory.py`'s output                                                                 |
| `traces.tar.gz`                   | the raw traces: 250 trial traces, the canary records and each trial's working directory; unedited |
| `review-check/`                   | review's byte-equality check of the runner against the patched export's own harness               |
