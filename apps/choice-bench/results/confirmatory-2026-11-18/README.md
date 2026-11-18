# M5 confirmatory run, 2026-11-18

The pre-registered test of RFC 0003 §7.1's two hypotheses:

- **H1:** S, structure including position, against A;
- **H2:** C, advocacy shown up front, against A.

Both run on T6, with `claude-sonnet-5-5` and `claude-haiku-5-5`, 114 trials per cell, 684 in all. The plan is [`PLAN.md`](PLAN.md):

- registered in xzy and 06e6368f;
- amended to an interleaved order in 1e55d366, before any trial;
- with the analysis code and its two method rules in d699a0d4, before any outcome was read.

## The run

- **One invocation,** 2026-11-18 05:18:05Z to 07:24:09Z, exit 0. **684 scored, 0 failed, 0 capped, 0 aborted.** There were no retries, so the 35-failure rule wasn't reached and there was no second invocation.
- **Pins:**
  - runner `run-confirmatory.ts` sha256 `e4e0332b0068b4377bae67541875a9b3c36c23b91b221dc057ce7a27c20cbeab`, recorded in `report.json`'s `run.runner`;
  - export `c81eeeb1a61e0330be34ce170169c8d9a77292cc`;
  - loaded-files digest equal to calibration's;
  - the launch script's sha256 and the gate, in [`launch-1.json`](launch-1.json).
- **The gate:** a 1-minute load under 32, under intake's rule with the arms interleaved. It waited 1710 s and started at a load of 31.54. Trial start loads ranged from 5.1 to 63.4, with a median of 40.9.
- **Isolation and integrity:**
  - both canaries passed against the v2 baseline (0 written, 0 different);
  - both logins were valid before and after;
  - no watched global config changed;
  - 0 trials were flagged for a config-dir footprint;
  - the credential scan found nothing;
  - the email scan found the address 0 times, so the archive is unredacted.

## Results (pre-registered)

The results come from the committed `analyze.py`, run on the traces:

```
git show d699a0d4:apps/choice-bench/results/confirmatory-2026-11-18/analyze.py | python3 -I - <trials dir>
```

Its output is [`analysis.json`](analysis.json). The outcome is the optimal rate, intent to treat. With 0 capped trials, the capped-excluded analysis is identical.

### H1, S vs A: not rejected

| model  | S       | A       | risk difference | Newcombe 95%  | Fisher p |
| ------ | ------- | ------- | --------------- | ------------- | -------- |
| Sonnet | 101/114 | 101/114 | 0.0 points      | −8.5 to +8.5  | 1.0      |
| Haiku  | 46/114  | 43/114  | +2.6 points     | −9.9 to +15.0 | 0.786    |

- **The primary test:** CMH, continuity-corrected, chi² 0.052, p 0.820 (uncorrected p 0.733). Holm-adjusted p 0.820.
- **The headline effect:** the Mantel–Haenszel risk difference, +1.3 points, with a 95% CI (Sato) of −6.2 to +8.9.
- **Homogeneity:** Breslow–Day p 0.824.

### H2, C vs A: rejected, with C lower

The effect differs between the models (Breslow–Day chi² 53.3, p 2.9e-13), so it's reported per model first:

| model  | C      | A       | risk difference | Newcombe 95%   | Fisher p |
| ------ | ------ | ------- | --------------- | -------------- | -------- |
| Sonnet | 17/114 | 101/114 | −73.7 points    | −80.8 to −63.2 | 3.3e-31  |
| Haiku  | 34/114 | 43/114  | −7.9 points     | −19.8 to +4.3  | 0.263    |

- **The primary test:** CMH, continuity-corrected, chi² 78.1, p 9.9e-19 (uncorrected 4.2e-19). Holm-adjusted p 2.0e-18.
- **The pooled figure, secondary given the heterogeneity:** the Mantel–Haenszel risk difference is −40.8 points, with a 95% CI (Sato) of −49.4 to −32.1.

### By load tercile (secondary)

Optimal over trials, by start load (cuts at 31.75 and 43.45):

| arm | low   | middle | high  |
| --- | ----- | ------ | ----- |
| A   | 47/76 | 52/74  | 45/78 |
| C   | 16/75 | 17/75  | 18/78 |
| S   | 52/77 | 46/77  | 49/74 |

## Descriptive

- **Business, the option the owner's claim advocates, was chosen in 0 of the 684 trials.**
- **Mechanism: held.** Intake holds any claim about why C is lower until a post-hoc audit of the traces is in. That audit is under `audit/`, labelled post hoc and descriptive, and it changes no number above.

## Files

| file                               | what                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `PLAN.md`                          | the pre-registration, its amendment and its addendum                                                |
| `run-confirmatory.ts`, `launch.sh` | the runner and its launcher, as committed before the run                                            |
| `analyze.py`                       | the pre-registered analysis, committed before any outcome was read                                  |
| `report.json`                      | the runner's report, as written: the run's preflight, canaries, health, scans and per-trial results |
| `launch-1.json`                    | the gate's record for invocation 1                                                                  |
| `analysis.json`                    | `analyze.py`'s output on the traces                                                                 |
| `traces.tar.gz`                    | the raw traces: 684 trial traces, the canary records, and each trial's working directory; unedited  |
| `review-check/`                    | review's byte-equality check of the runner against the export's own harness                         |
