# M5 calibration, 2026-11-18

RFC 0003 §8's calibration: 70 trials, run by `node src/run.ts calibration` from a pinned, git-free export of `ejkorol/semantic-capabilities` at **c81eeeb1a61e0330be34ce170169c8d9a77292cc** (checked against the export's `.export-sha`), two at a time.

## The primary task: T6

Chosen under §8's rule, fixed before any calibration trial: the candidate whose **A** optimal rate is nearest the middle of about 30% to 80%, judged on A's rate only. C's and S's results were not read before this was recorded.

| A, optimal | Sonnet | Haiku | pooled          | 95% Wilson interval | variance |
| ---------- | ------ | ----- | --------------- | ------------------- | -------- |
| **T6**     | 4/5    | 2/5   | **6/10 (0.60)** | 0.313 to 0.832      | 0.267    |
| T7         | 4/5    | 0/5   | 4/10 (0.40)     | 0.168 to 0.687      | 0.267    |
| T3         | 5/5    | 5/5   | 10/10 (1.00)    | 0.722 to 1          | 0        |

- **Both candidates are in the band.** T6's 0.60 is 0.05 from its middle (0.55), and T7's 0.40 is 0.15 from it, so the primary is **T6**.
- **A's variance on T6 is 0.267**, the sample variance of the optimal indicator over its 10 trials. That's the input for sizing the confirmatory run (intake).
- **Per model,** A on T6 is 0.80 for Sonnet (interval 0.376 to 0.964) and 0.40 for Haiku (0.118 to 0.769).
- **T3's ceiling holds under isolation:** 10 of 10, Pro Plus each time. The add-on's price was disclosed by then (hosting-lab's 3333ce84), so the pilot's ceiling didn't come from the price gap.

## The run

- **When:** trials from 03:15:47Z (the preflight's start) to 03:26:01Z.
- **Load** (1-minute average): 6.32 at the start, 1.54 at the end, recorded per trial. The start gate was a load under 8 (the planner, 03:00Z).
- **CLI:** claude 2.1.311 (Claude Code). Each model resolved to its requested id: claude-sonnet-5-5 and claude-haiku-5-5.
- **Outcome:** 70 of 70 scored; 0 failed, 0 cap hits, 0 aborted, 0 trace mismatches.
- **Isolation:**
  - 0 trials flagged, and no Claude files under any trial's own config key;
  - no watched global config changed, and the run never stopped;
  - logins valid before and after.
- **Scans:** no credential string in the results. The user's email: scanned, found nowhere (0 files, 0 occurrences), so nothing in the archive is redacted.

## The fixture

- **Amounts are declared,** unlike the pilot's fixture: design's 4563783d gives every financial effect its amount (the target's price, monthly on the renewals). So inspect's definitions show what each charge costs. It's identical across A, C and S.
- **Summaries don't list charges yet.** At c81eeeb1 the runtime doesn't render them; that comes later, in dbc947e0, which isn't in this export.
- **T6 and T7 carry the confirmatory claim edit:** the owner's recommendation is on Business (RFC 0003 §3.1).

## The context canary and its baseline

- **Three refused preflights first,** at 03:06:09Z, 03:07:18Z and 03:07:46Z, from an export of 045de7ac, before any trial:
  - **Why:** each time, Haiku passed all six checks and quoted the allowed account-context passage, against a v1 baseline that held none.
  - **The fix:** review's, in c81eeeb1. The baseline compares the CLI version and the allow-list's identity, and records the quotes.
  - **The records** are kept, in `canary-refused-*` inside the traces.
- **This run's canary passed for both models:**
  - the six checks (AGENTS.md, CLAUDE.md, user instructions, memory index, memory instructions, git information) were all false;
  - account context was true, its named exclusion;
  - Sonnet quoted nothing. Haiku quoted the two account-context sentences, both on Claude Code 2.1.311's allow-list.
- **The v2 baseline was written once,** by this passing canary, under intake's one-time approval (intake, 03:08Z): `claude-cli__claude-sonnet-5-5.v2.json` and `claude-cli__claude-haiku-5-5.v2.json`.
  - The allow-list's sha256: `5e7d57bd6dfa362858f0eb61ab24c8417fe2706437922bf6a1c9a8925e044446`.
  - The v1 files are untouched.
  - Any later re-baseline needs intake's approval again.
- **The two allowed passages,** for Claude Code 2.1.311: `untrusted-downloads` (the CLI's guidance on downloaded files), and `account-context` (the guidance that comes with the injected account context, never the address).

## Files, and what's sealed

C's and S's calibration outcomes were **sealed** until the confirmatory run's results were in (intake, 2026-11-18). The seal was lifted after 7ceb1ae6 committed them, and the held files are committed unedited, with their sha256s matching the ones recorded here. They're reported afterwards as calibration-only (n=5 per model), and never pooled with the confirmatory run.

| file               | what                                                                                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report.json`      | Only A's cells and A's condition row, the run's health fields (preflight, canaries, baseline, logins, scans, load) and the task choice. C's and S's cells and rows aren't in it                                                                     |
| `report.full.json` | The full report, every cell. Held back unopened until the confirmatory results were in (7ceb1ae6), then committed unedited: sha256 `b3c4d200fb1acdb912931a2a20a9c68e3d7133af7987e3f7039bf7a1e747ad78`, as recorded above before the seal was lifted |
| `traces.tar.gz`    | The raw traces, unedited, with the canary records and the refused preflights. Held back the same way, then committed unedited: sha256 `f98f6800706afdb440d543106aecc690ab6b6fb849a1da9161ce217260a2fbf8`, as recorded                               |
