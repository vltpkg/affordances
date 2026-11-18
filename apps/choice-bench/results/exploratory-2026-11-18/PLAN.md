# M5 exploratory run: the plan, committed before any trial

**EXPLORATORY.** It reports estimates with 95% intervals, and no p-values. It changes nothing in the confirmatory run's pre-registered results ([`../confirmatory-2026-11-18/`](../confirmatory-2026-11-18/README.md)).

It comes from intake's rulings (queue row `qitem-20261118073546-90250bb8…`, created 2026-11-18 07:35:46Z by the queue's clock) and the planner's rulings that followed. This plan's commit precedes the first trial's `startedAt`.

## Why

The confirmatory run's C differed from A in two ways: the owner's claims, with their recommendation order and relevance basis, and the advocated policy's scope (neighborhood depth 1). That scope left `hosting.plan.list`, the only offer carrying the plans' allowances, out of the first view (H2's validity note; [`audit/`](../confirmatory-2026-11-18/audit/README.md)). These cells separate the two factors.

## The cells (final, after the canaries)

| cell           | models        | n per model | what it is                                                                                                  |
| -------------- | ------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `C-full-scope` | Sonnet, Haiku | 50          | **C minus its scope:** C's claims, recommendation order and relevance basis, over A's exhaustive scope      |
| `A-scope`      | Sonnet, Haiku | 50          | **A with only its scope changed:** A's policy over the advocated scope, the start's neighborhood at depth 1 |
| `A`            | Opus          | 25          | the confirmatory control, unchanged                                                                         |
| `C-full-scope` | Opus          | 25          | as above                                                                                                    |

- **250 trials in all,** all on T6, through `claude -p` (Claude Code 2.1.311): `claude-sonnet-5-5`, `claude-haiku-5-5` and `claude-opus-5-5`.
- **The margin is 86** of the remaining 336.
- **Codex is dropped this round.** Its canary (`codex-cli` 0.159.0, `gpt-6.1-terra`) answered `agentsMd: true`, and all 20 of its `otherInstructions` were lines of the owner's global `~/.codex/AGENTS.md`. The driver's `project_doc_max_bytes=0` keeps project docs out, but not the global file. Its 50 trials went to the margin, and nothing is reallocated after any trial.
- **`C-full-scope` is not "claims only".** A plus the claims' text alone, without the order, is D's question, and is deferred.

## The condition definitions, as diffs

Against C (`advocated`: scope `neighborhood`, depth 1, order by recommendation claim, relevance `basic`, claims `shown`):

- `C-full-scope` is `{ ...advocated, id: 'advocated-exhaustive', scope: 'exhaustive', depth: undefined }`. That changes the scope only.

Against A (`exhaustive-claims-omitted`: scope `exhaustive`, order `canonical`, claims `omitted`):

- `A-scope` is `{ ...neutral, id: 'neighborhood-claims-omitted', scope: 'neighborhood', depth: 1 }`. That changes the scope only.

Each is tested to differ from its source in scope alone (`apps/choice-bench/test/offerset.test.ts`).

## What runs

- **The export:** c81eeeb1a61e0330be34ce170169c8d9a77292cc, the confirmatory run's, unpatched. Its loaded-files digest must equal calibration's (`7e6da386…`), so the runtime, the fixture, the tools and the scoring are c81eeeb1's. That's why A here and the confirmatory A compare.
- **The patch:** [`conditions.patch`](conditions.patch), sha256 `983d94d39f8c97ab8c574a230c1d17ce93798c6a6adae50d73ddc2165c4102b7`.
  - It changes exactly two files: `apps/choice-bench/src/conditions.ts` (each condition's `manipulates` declaration, the `Factor` type and the two new cells) and `apps/choice-bench/src/offerset.ts` (new: the offer-set check).
  - It's built from c81eeeb1's own `conditions.ts`, so none of the later runtime or fixture work (the effective input, the per-add-on charges) is in it.
  - The patched export's loaded-files digest is `99d61cd76b89163f79be3073e9faa1d4e0ff75eb7053f3fb2e1d0e2d1bd04d55`.
- **The runner:** [`run-exploratory.ts`](run-exploratory.ts), sha256 `f6c0b7ff0799064020b225e5c58099da27ca85ab0295d55be37431a888ed288e`.
  - It patches a copy of the export beside it, and re-checks that copy on every invocation.
  - Every trial is the patched export's own `runTrial`.
  - It refuses unless all of these hold:
    - the export is c81eeeb1, and digests to calibration's unpatched;
    - its own sha256 and the patch's are the ones above;
    - the patched copy differs from the export in exactly the two declared files;
    - the offer-set check and both equalities below pass;
    - each model's v2 baseline has the sha256 below.
- **The launcher:** [`launch.sh`](launch.sh). It checks the runner and patch copies beside the export byte for byte against these files, and reads the runner's sha256 from this plan's runner line. It records the gate in `launch-<n>.json`.

### The offer-set preflight (intake's ruling 3, and its two equalities)

- **The general check:** before any canary, every cell's first view, as the agent's `project` tool returns it, is reduced to its offer ids and compared with its control's.
  - The control is A, or, for a cell that declares a scope change, A's policy with only that scope put in. So declaring scope excuses only that scope change.
  - Any other difference refuses.
- **Intake's two equalities, asserted explicitly at run time** (and tested on T3, T6 and T7):
  - **C-full-scope's first-view offer set EQUALS A's.** It includes `hosting.plan.list`.
  - **A-scope's first-view offer set EQUALS C's.** It omits `hosting.plan.list`.
- **Checked on the patched export:** C and D refuse, each missing `hosting.plan.list`. Every other condition passes, and both equalities hold, on T3, T6 and T7.

### The canary baselines (no re-baseline)

| model             | v2 baseline sha256                                                 | where it came from                                                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| claude-sonnet-5-5 | `b644c9e280a1b9dbcfc6d7bb07c8641db010a97adb5294e833a4685379fcf649` | calibration                                                                                                                                                                                                                                                                                  |
| claude-haiku-5-5  | `be51c572c2eae609939ed496a92b2d73fad9bae2dccef215d96a3a48b9605b12` | calibration                                                                                                                                                                                                                                                                                  |
| claude-opus-5-5   | `c82ebd6a62f3bab9becd05bf2dc0ef84e515e8f0aa5d3705e2830cb891f87290` | its first, written 2026-11-18 07:50:41Z after intake's approval and the planner's sign-off. Its canary: the six booleans false, `accountContext` true, and one `otherInstructions` entry, the allow-list's account-context passage. Both logins were valid, and the owner's files unchanged. |

Each run's canary must match its baseline (0 written, 0 different), or the run doesn't start.

## Order, caps and isolation

- **Interleaved order:** by index (0 to 49), with each index's specs side by side.
  - Sonnet and Haiku alternate first place by index, and so do `C-full-scope` and `A-scope` within each model.
  - For indexes 0 to 24, Opus's pair alternates its two conditions and sits first, in the middle or last by index mod 3.
  - Two workers take the next specs from that one queue.
  - Tested in `apps/choice-bench/test/exploratory.test.ts`.
- **Counterbalancing:** each trial's plan-id order is its index's, as before (RFC 0003 §4). With 50 per cell (8 × 6 + 2) and 25 (4 × 6 + 1), the six orders aren't exactly balanced. That's reported, not corrected.
- **Caps, concurrency and isolation:** the confirmatory run's.
  - 30 tool calls, 40 turns, 10 minutes and 150,000 tokens per trial; concurrency 2.
  - Real config directories, and the watched-global-config stop.
  - Logins checked before and after, the credential scan and the email scan.
- **The gate:** a 1-minute load under 32 at start, recorded in `launch-<n>.json`. Load is recorded per trial.

## Stopping and re-runs

The confirmatory operating rules apply:

- **Scoring:** 250 scored trials, one per spec, and the run stops there. A capped trial is never retried.
- **Retries:** a driver failure is retried once with the same spec, by a second invocation of the same command (a resume).
  - The resume reruns only specs with no complete trace, and partials are kept in `interrupted/`.
  - The command runs at most twice, each run with its own recorded preflight.
  - If more than 13 specs (5%) failed in the first run, the second doesn't start, and intake is told first.
  - A spec that fails twice is scored 'failed', and isn't optimal under intent to treat.

## Outcomes and analysis (exploratory)

- **Primary outcome, as the confirmatory run's:** the optimal rate, where the choice is the intended end state (RFC 0003 §5.2), intent to treat.
- **Secondary, descriptive:**
  - **The text-stated optimum:** optimal, or coded (b) by the audit's committed rule (`audit/code.py` at aa8071b0, unchanged). Review's re-derivation found (b) over-counts (a), so it's an upper bound.
  - **The information path:** whether Pro's allowance appeared in a tool result before the first approval request, by the same rule.
- **The contrasts,** each a risk difference per model with Newcombe's 95% hybrid score interval:
  - **E1:** `C-full-scope` against the confirmatory `A`: the advocacy package over A's scope.
  - **E2:** `A-scope` against the confirmatory `A`: the advocated scope alone.
  - **E3:** the confirmatory `C` against `A-scope`: the advocacy package within the advocated scope.
  - **E4:** the confirmatory `C` against `C-full-scope`: the advocated scope within the advocacy package.
  - **E5, Opus, within this run:** `C-full-scope` against `A`.
- **How they're read:**
  - E1 to E4 compare across runs: the same runtime, fixture and isolation, but a different stretch of time, so interleaving doesn't cover them. That's stated beside every one.
  - There are no p-values, no Holm correction and no pooling across models.
- **The code:** [`analyze_exploratory.py`](analyze_exploratory.py), committed with this plan, before any outcome is read.
  - It imports Newcombe's interval from the confirmatory `analyze.py` (d699a0d4), and the trial reader and coding from `audit/code.py` (aa8071b0), both unchanged.
  - Its self-test is `python3 -I analyze_exploratory.py --selftest`.

## After the run

- **The record:** logins, config dirs, the credential and email scans, and the archive (`archive.ts` from the export).
- **The commit,** by file id: the report, a README with every contrast's interval and its cross-run caveat, the analysis output and the traces.
- **Then:** intake writes the M5 report.
