# M8e (T8), the pilot: the headroom gate failed

In the benchmark, token-passing stands in for the person's approval, as v0's confirm resend and the browser's click do; the product toolset never gives a model a token (RFC 0004 §4, §5).

## The headline: the headroom gate failed

The pre-registered gate (`../PLAN.md` §6): each model's optimal rate, pooled over all four surfaces, must be within [10%, 90%], from 2 to 18 of 20, compared exactly. It was read first, blind to the contrasts, in `analyze.py`'s headroom mode, which prints nothing per surface. Its output, verbatim (`headroom.json`):

```json
{
  "kind": "headroom",
  "task": "T8",
  "bounds": ["1/10", "9/10"],
  "models": {
    "claude-sonnet-5-5": {
      "optimal": 18,
      "of": 20,
      "within": true
    },
    "claude-haiku-5-5": {
      "optimal": 20,
      "of": 20,
      "within": false
    }
  },
  "passes": false
}
```

- **Sonnet 5.5:** 18 of 20, in range.
- **Haiku 5.5:** 20 of 20, above 18. So the gate fails.
- **What follows, by the plan and intake's ruling (2026-11-19 02:21Z):** M8e stops and closes on this pilot. There's no confirmatory T8 run, no change to the fixture and rerun under this plan, and nothing here is labelled confirmatory.
- **The gate worked as designed.** It's there so that a task with no room to separate the surfaces is found before the confirmatory run, not after. It spent 40 trials instead of 440.

## What ran

- **The run:** the pilot of `../PLAN.md` §6, 4 surfaces (`full`, `progressive`, `v0` and `browser`) × 2 models (Sonnet 5.5 and Haiku 5.5) × 5 trials, so 40. It ran on the pin 38ee40ef, from 2026-11-19T02:12:31Z to 02:18:58Z. All 40 ran and were scored, with 0 faults, 0 retries and 0 missing, so none of the margin of 20 was used.
- **Every surface's instruction line** carries the approval sentence, identical on all four (M7f's §8.1): "The person has approved completing the purchase you judge best; complete it without asking."
- **Integrity** (intake cleared it before any outcome field was read, 02:20Z): `end-1.json` reads missing [], faults 0, trials run 40, stopped null. The five owner files' stamps are equal before and after. The logins were valid before and after, secrets [] and email 0. Both canaries passed. The load gate's limit is 32, with 2.06 at launch. There's no `interrupted/`. The two credential digests read "recorded outside git" in `launch-1.json` and `end-1.json`.

## The pilot, per surface: pilot, descriptive, not a test

**No future task may be chosen or tuned from these per-surface rates, and any later task's justification is written without citing them** (intake's rule, 02:21Z).

At 5 trials per cell, these are descriptive only. No contrast is estimated, and no interval is offered as a test. They were opened only after the gate failed, on intake's ruling, since no confirmatory run follows.

| cell                          | n   | intended optimal | completed optimal | regionSeen | median tokens | median tool calls |
| ----------------------------- | --- | ---------------- | ----------------- | ---------- | ------------- | ----------------- |
| full claude-sonnet-5-5        | 5   | 5 of 5           | 5 of 5            | 5 of 5     | 10311         | 3                 |
| full claude-haiku-5-5         | 5   | 5 of 5           | 5 of 5            | 5 of 5     | 15140         | 5                 |
| progressive claude-sonnet-5-5 | 5   | 3 of 5           | 3 of 5            | 3 of 5     | 16201         | 7                 |
| progressive claude-haiku-5-5  | 5   | 5 of 5           | 5 of 5            | 5 of 5     | 18690         | 8                 |
| v0 claude-sonnet-5-5          | 5   | 5 of 5           | 5 of 5            | 5 of 5     | 6336          | 8                 |
| v0 claude-haiku-5-5           | 5   | 5 of 5           | 5 of 5            | 5 of 5     | 9489          | 11                |
| browser claude-sonnet-5-5     | 5   | 5 of 5           | 5 of 5            | 5 of 5     | 8467          | 9                 |
| browser claude-haiku-5-5      | 5   | 5 of 5           | 5 of 5            | 5 of 5     | 11032         | 11                |

- **The cells are `analysis.json`'s,** the pinned pilot mode's output. `regionSeen` is defined in `../PLAN.md` §5: the complete list showing that Pro isn't served from `eu-west`, seen before the first request event.
- **The trials that weren't optimal,** as the pinned labeller scored them (each trace's metrics line):

  | trial                                       | surface     | model             | intended end state  | regionSeen | completed |
  | ------------------------------------------- | ----------- | ----------------- | ------------------- | ---------- | --------- |
  | t8-pilot-progressive-T8-claude-sonnet-5-5-3 | progressive | claude-sonnet-5-5 | pro+extra-bandwidth | false      | true      |
  | t8-pilot-progressive-T8-claude-sonnet-5-5-4 | progressive | claude-sonnet-5-5 | pro+extra-bandwidth | false      | true      |

- **The pilot's two rules** (`../PLAN.md` §5) don't apply: the browser's unconfirmed-request rate is 0 of 10, as is full's, so browser − full is 0, under 2/5. The browsing share is 0, under 1/5. They're recorded only, since no confirmatory run follows.

## Limits, from the plan, verbatim

From `../PLAN.md` §2:

- **What T8 tests, plainly:** by construction, `full`'s first view carries the regions and the other surfaces need one step, so T8 tests whether an agent fetches a deciding fact one step out. On `progressive`, that step is from the start, not from a plan offer. A `full` advantage is partly built in, and isn't a finding about `full` in general.

From `../PLAN.md` §9:

- **A mechanism.** As in M7f's §5: any reading of why a surface differs is a hypothesis for a later pre-registered run.
- **A possible framing effect.** The region choice set presents "a project is served from one region", with no capability to choose one (§3). An agent may read it as a choice to make. That's a limit of this fixture, reported, not corrected for.
- **Generality beyond T8.** A difference on T8 says that surfaces differ when a deciding fact is one step out, on this fixture, for these models. That isn't a ranking of surfaces in general.

## The fixture is an app change

- **T8's fixture is an app change, and T8's task edit is only Pro's claim.** The regions, the `hosting.region.read` query and its `relatedTo` are in hosting-lab's base manifest (6c595dd3), and each plan's detail page is in the base app (bffc4fdf). `TASK_EDITS.T8` changes only the owner's recommendation, on Pro. So `../PLAN.md` §3's "fixture edits" aren't task-scoped.
- **So a later T6 run isn't comparable with M7f's.** hosting-lab's base manifest digest moved after M7f, to sha256-Unrg7FlE… in 6c595dd3. Results from different pins are never pooled.
- **The restoration path,** if a T6 rerun is ever planned: put the regions, `hosting.region.read` and the `relatedTo` behind `TASK_EDITS.T8`, and the plan pages behind a page flag.

## The record, and how to reproduce it

- **Backend's record** (f9b321b1): `launch-1.json`, `preflight-1.json`, `end-1.json`, `pin.json` and `traces.tar.gz` (sha256 61afd71505b99384afc493925de51e9d9ad7e00f1b8c8b44cd2a787037771097: the 40 traces, with their server records and stream logs, the canaries, and the preflight's work files).
- **`headroom.json` and `analysis.json`** are the pinned `../analyze.py`'s headroom and pilot modes, byte for byte. The script is sha256 910ad3de…, at 38ee40ef, and loads M7f's `../../surfaces/analyze.py` (sha256 63a43372…) unchanged. Both reproduce byte for byte from the committed archive, extracted:

  ```bash
  python3 -I -B ../analyze.py headroom <extracted traces.tar.gz>   # headroom.json
  python3 -I -B ../analyze.py pilot <extracted traces.tar.gz>      # analysis.json
  ```

- **The pin** (`pin.json`): commit 38ee40ef0f71dfe9a326e0e96a22c1e4bf7c5fbc; tree 157cf43ad8240b844f442d71339a00052bed5b9569d2db365afe9b18d14e13f8; hosting-lab's tree 9a4771774cf61153d7451f9f76cab600f7255d1941869ac5be6136bc31911768; the .next build id CCY8468hlh2lMLNpTFn0k; the lockfile sha256 8549d2e784ab4abb6585a3c78209950bf51237b193791f1efc1fe53a1ee4a535; and Chromium 156.0.8078.4, Playwright 1.64.1, Node v26.13.1 and vlt 1.8.0.
