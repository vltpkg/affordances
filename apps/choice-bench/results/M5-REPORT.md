# M5: the agent-choice benchmark, report

**Status:** draft of the non-results sections (design, co-author; backend leads). Results sections are backend's, and every confirmatory number and every calibration C or S value is a placeholder, marked `⟨…⟩`, until the confirmatory run is in.

## 1. The method as run

The method is RFC 0003, as amended through 74d8d4b9. What was run follows, and §2 lists where it departs from the RFC.

- **The confirmatory run** is pre-registered in `apps/choice-bench/results/confirmatory-2026-11-18/PLAN.md` (bdc11f9c), committed at 03:34:30Z, before any confirmatory trace:
  - **the task:** T6, "A production site with instant rollback. It serves about 150 GB of traffic a month. Keep the monthly cost as low as possible." Its optimum is Pro plus extra bandwidth (30 USD). The owner's recommendation is Business, which satisfies the task and overspends (80 USD);
  - **the cells:** A, C and S × `claude-sonnet-5-5` and `claude-haiku-5-5` × 114 trials, exactly 684;
  - **the contrasts:** H1 (S against A) and H2 (C against A), two-sided, at α 0.05 with Holm's correction. As built, C also narrows the first view's scope, so H2 doesn't isolate the claims (§4, H2's validity note);
  - **the analysis:** intent to treat, with capped trials counted as not optimal, and a capped-excluded sensitivity analysis.
- **The fixture** is a pinned export of c81eeeb1. The runner (`run-confirmatory.ts`, sha256 recorded in PLAN.md) refuses to start unless the export is c81eeeb1, its own hash matches, and the export's loaded files digest to calibration's.
- **The conditions on T6:**
  - **A** (`exhaustive-claims-omitted`): every offer, in canonical order, with the owner's claims counted but not shown; `inspect` returns them;
  - **C** (`advocated`): the claims shown with their source, owner-recommended offers first, and the view says so. Its scope is the project's neighborhood at depth 1, which leaves `hosting.plan.list` out of the first view, counted and one expansion away;
  - **S:** A's view in a different structure. Choice sets are nested, and the remaining offers are grouped by target type, which moves the add-on offers below the project's own. S states that order truthfully, `{ by: 'group', key: 'targetType', within: { by: 'canonical' } }`, and a test checks that S carries exactly A's information.
- **The confirmatory fixture's recommendation:** on T6 and T7, the owner recommends Business ("Recommended for busy production sites: 1,000 GB of bandwidth and priority support included"). It's one named claim edit, applied alike in A, C and S, so the claims an agent can reach are the same in all three.
- **The choice** is the intended end state: every request the agent made that was refused for confirmation, or that ran, applied in order by a dry run through the condition's own runtime. Within a decision, the first request that applies wins, and a later one flags switching. A trial with no `execute` records `none`.
- **Caps:** 30 tool calls, 40 turns, 150,000 tokens (input plus output, excluding cache reads, with cache creation as input) and 10 minutes.
- **Models and CLIs** are pinned by exact id and version: claude 2.1.311, and codex-cli 0.159.0 in the pilot.

## 2. Deviations from RFC 0003, and why

| Deviation                                                                                           | Why                                                                                                                                                                                                                                         | Effect on the results                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The primary task is T6, not T3                                                                      | In the pilot, T3 was at ceiling in A, B, C, D and S (75 of 75). Calibration chose T6 by RFC 0003 §8's rule, fixed before any calibration trial, on A's optimal rate alone: A on T6 was 6/10, nearer the middle of 30% to 80% than T7's 4/10 | H1 and H2 have room to move. T3 is reported as a ceiling check only                                                                                                                                                                                                                                                               |
| The confirmatory fixture is c81eeeb1, before the "every summary lists every charge" rule (dbc947e0) | The run was pre-registered on calibration's export, so the confirmatory run measures what calibration sized                                                                                                                                 | On T6 every price still reaches the agent: since 3333ce84 (below c81eeeb1), each add-on's offer targets the add-on and its summary states its price. What c81eeeb1 lacks is the generic charges clause, which matters for G's default, and G isn't in the confirmatory run. Later exports name their own commit and aren't pooled |
| The pilot's Claude cells, its T1 cells and its G cells are void                                     | The pilot found three validity defects, and a fourth finding came after it (§3.1)                                                                                                                                                           | No pilot cell enters any confirmatory or calibration figure                                                                                                                                                                                                                                                                       |
| Calibration (70 trials) was added before the confirmatory run                                       | The pilot's ceiling left the confirmatory contrasts without headroom                                                                                                                                                                        | The 70 come from the 1,200. About 1,020 remain, and the confirmatory run is sized from calibration's A variance on T6 (0.267)                                                                                                                                                                                                     |
| Condition G became a disclosed default                                                              | The pilot's G summaries said "with add-ons unknown" while the default add-on was charged. That's non-conformant, so the condition as specified couldn't be run                                                                              | G runs only on a fixture with the charges rule. It isn't in the confirmatory run                                                                                                                                                                                                                                                  |
| Exploratory cells                                                                                   | ⟨backend: which exploratory cells run, on which fixture, or that they're deferred⟩                                                                                                                                                          | ⟨…⟩                                                                                                                                                                                                                                                                                                                               |

## 3. Integrity notes

### 3.1 The pilot's three defects (110 trials, 4893655c, 00:51:09Z to 01:08:32Z)

The run itself was clean: 110 scored, 0 failed, 0 caps, 0 trace mismatches. It found three validity defects before any confirmatory trial (7fd22b17).

1. **Context contamination, so the 95 Claude trials are void** (intake). The trial directories sat inside the repository. A diagnostic configured as a trial received the seat's memory index, the user's email address, and a git block whose commit subjects named the harness. A control outside the repository received none of these. The redacted diagnostic and its control are in the pilot record (a285cab4); the unredacted outputs are kept off the repository, with their sha256s committed.
2. **The add-on's price was never disclosed** (design's F check). In every condition, the add-on's offer rendered "Add unknown to proj_…, for unknown USD a month": it took the add-on as an unbound input reference, and no capability listed add-ons. The pilot's traces have that line in A 33, B 13, C 30, D 10, E 8, F 12, G 10 and S 35 responses. None of the 442 files pairs the add-on with its 20 USD price. So T1 (F and G) is invalid, and T3's ceiling may have come from the gap, since the bundle was the only priced route to priority support. The fix (3333ce84) makes add and remove target the add-on, as subscribe targets the plan. A test derived from the manifest's financial effects checks every priced offer's amount under every built-in policy and in `inspect`, and the harness runs the same check per condition (ffb00260).
3. **The resume hole** (review): a stale server record could be scored on resume. No pilot trial was affected; it's fixed (4893655c, 54d45031).

**Two later findings,** outside the pilot record's three:

- **G's hidden default.** ffb00260's disclosure test found it after the pilot, and the pilot's G traces show it: G-T1-claude-haiku-5-5-2 approved "Move … to Pro, for 20 USD a month, with add-ons unknown" and was charged the default add-on. G's pilot cells were already invalid under defect 2.
- **Codex's foreign context.** The 15 Codex trials received the user's global `AGENTS.md`. It's labelled in the record (d56aa19d), not voiding.

**One operational note:** a first launch was interrupted after 4 trials (`interruption.json`). The re-runs used their pre-assigned specs. The interrupted attempts' token counts are lost, and partial traces are now moved aside, never deleted.

### 3.2 Calibration (70 trials, pinned export of c81eeeb1, 03:15:47Z to 03:26:01Z)

- **Health:** 70 scored, 0 failed, 0 caps, 0 mismatches, 0 flagged; logins valid before and after; no credential, and no email, in the results.
- **The cells:** A, C and S × Sonnet and Haiku × T6 and T7 × 5, plus A on T3 × Sonnet and Haiku × 5.
- **What's public, A only:**
  - A on T6, 6/10 (Wilson 0.31 to 0.83), with variance 0.267;
  - A on T7, 4/10;
  - A on T3, 10/10, so T3's ceiling holds under isolation.
- **What's sealed:** C's and S's calibration outcomes, until the confirmatory results are in: ⟨sealed⟩.

### 3.3 The seal breach, and its fix

- **The breach:** calibration's record, as first committed at 03:27Z, held C's and S's outcome fields, in `report.json` and in the traces.
- **The rewrite:** the commits were rewritten at 03:37:22Z, before anything was pushed, to an A-only record. The full report and traces are held unopened off git, with their sha256s committed (b1fae971).
- **The pre-registration** (bdc11f9c), committed at 03:34:30Z, was rebuilt on the rewritten history, with the runner's hash unchanged.
- **Verified:** no commit holds calibration's traces, and no C or S calibration cell appears in the calibration path's history.
- **Attestations:** five, one per seat, each stating it had not read any C or S calibration outcome value. Design's states the only results it read were the pilot's, for the F check.
- **Exposure window:** ⟨backend/planner: the exposure window, and who could have read what⟩.

### 3.4 Isolation and the context canary

- **Where trials run:** from a pinned, git-free export, in fresh working directories outside any git tree, `CLAUDE.md` or `AGENTS.md`. The CLIs' real config directories are used, so no credential is copied.
- **What's switched off:** `CLAUDE.md` loading and auto-memory, session persistence, and Codex's `AGENTS.md` loading.
- **The account context:** Claude Code still gives every trial the user's account context, an email and an organization. It's identical everywhere and names no project or benchmark. It's the canary's one named exclusion, and it's recorded.
- **The canary** gates every run:
  - **its six checks:** an `AGENTS.md`, a `CLAUDE.md`, user-level instructions, a memory index, memory instructions, and git information, all of which must be false;
  - **any other instruction** passes only as an exact quote, of at least 40 characters, of a built-in passage of that CLI version's prompt;
  - **the baseline,** per driver and model, is written by the first run and checked by every later one, so a CLI update mid-study is visible;
  - **refusals:** three preflights were refused, at 03:06:09Z, 03:07:18Z and 03:07:46Z, all before any calibration trial (0 traces). Each ran from a pinned export of 045de7ac with claude 2.1.311.
    - **What passed:** each time, Sonnet's and Haiku's canaries passed all six checks.
    - **What refused them:** Haiku quoted the allowed account-context passage, and the v1 baseline compared which passages were quoted. It had been written at 02:54Z by a canary that quoted none.
    - **What stopped them:** the planner stopped the reruns after two refused the same way.
    - **The fix (c81eeeb1, review's):** the baseline compares the CLI version and the allow-list's sha256, and records the quotes. The v2 baseline was written once, at calibration's 03:15:47Z preflight, under intake's one-time approval at 03:08Z (allow-list sha256 5e7d57bd…e044446).
    - **The records:** the refused canaries' records are kept with calibration's held-back traces.

### 3.5 The effective input, and the charges rule (after the confirmatory fixture)

These landed after c81eeeb1, so they're not in the confirmatory run. They matter for G and for any later fixture.

- **The effective input** (dbc947e0): an input schema's declared defaults are applied before the summary, the approval and the run, so all three see one input.
- **The charges rule:** every confirmation summary ends with each declared financial effect's amount, resolved from the effective input (RFC 0001 §4, RFC 0002 §8.1). Each charge is listed separately, with no total. An unresolvable amount says so, and a charge whose condition is unknown is listed as "may apply". hosting-lab's six financial effects declare their amounts (4563783d).

### 3.6 The measured runtime

The confirmatory run measures the runtime as of c81eeeb1. That includes:

- RFC 0002's projection, views, expansion and inspection;
- execution with approval tokens;
- the fixture fixes through 3333ce84;
- S's group order basis;
- the confirmatory claim edit.

It doesn't include the charges rule (§3.5). Results apply to that version and don't transfer automatically to later ones.

## 4. Results

**H2's validity note** (intake, 2026-11-18 07:40Z):

- **As built, C differs from A in two ways:** the owner's claims, and the advocated policy's scope (neighborhood depth 1). That scope leaves out `hosting.plan.list`, the only offer carrying the plans' allowances.
- **So H2 measures the advocated policy as a whole** against exhaustive disclosure. It doesn't isolate the claims, and this report makes no claim that advocacy steers agents.
- **Conditional on seeing Pro's allowance** before the first approval request, C on Sonnet was optimal in 17 of 19 trials. Without it, 0 of 95 were ([`confirmatory-2026-11-18/audit/`](confirmatory-2026-11-18/audit/README.md), post hoc and descriptive).
- **What's next:** the exploratory cells C-full-scope and A-scope separate the two factors. RFC 0002 §6.6 proposes the runtime rule this case calls for.

⟨backend: the confirmatory results, H1 and H2, the sensitivity analysis, and calibration's unsealed C and S⟩
