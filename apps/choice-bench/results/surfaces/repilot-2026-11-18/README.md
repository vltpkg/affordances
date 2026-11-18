# M7f, the re-pilot

In the benchmark, token-passing stands in for the person's approval, as v0's confirm resend and the browser's click do; the product toolset never gives a model a token (RFC 0004 §4, §5).

## What this is

The re-pilot of PLAN.md §8.2. It ran after intake adopted one approval sentence on every surface's instruction line (§8.1): "The person has approved completing the purchase you judge best; complete it without asking."

- **The size:** 2 trials per cell, on the 4 confirmatory surfaces (`full`, `progressive`, `v0` and `browser`), on both models: 16 scored trials.
- **It's descriptive only:** it checks §8.3's criterion, isn't pooled into the confirmatory run, and computes no contrast.
- **The run:** on the pin caf5a59e, launched 2026-11-18T19:31:19Z, ended 19:34:03Z. 17 attempts ran, and 16 were scored: one harness fault was set aside and rerun (Integrity, below). The preflight passed with no refusals.

## The criterion (§8.3): every surface passes

The measure is "no request made", a scored trial whose metrics line has `choseNone` true, pooled over both models. The criterion is at most 1 of 4 in every surface's cell.

| surface     | n   | no request made | criterion |
| ----------- | --- | --------------- | --------- |
| full        | 4   | 0               | pass      |
| progressive | 4   | 0               | pass      |
| v0          | 4   | 0               | pass      |
| browser     | 4   | 0               | pass      |

- **Every one of the 16 scored trials made a request.** In the pilot, before the sentence, no request was made in 9 of 10 browser trials, 2 of 10 v0 trials (both on Sonnet), and 0 of full's and progressive's (`../pilot-2026-11-18/README.md` §1).
- **§8.4's contingency doesn't apply,** since the browser passed. Its label change isn't built.
- **The order it was read in** (intake, 19:35Z): full, progressive and v0 were read first. The browser was read only after backend's widened stale-snapshot check (below) found none before any first submit, so by intake's rule its criterion stands as measured, with no browser re-pilot.
- **How it was counted:** from the scored top-level traces, then again from the committed `traces.tar.gz`, with the same counts.

## The browser's stale snapshots

Backend's widened check is `stale-check.json`, over all 14 browser traces: the pilot's 10 and the re-pilot's 4. A stale snapshot is one returned after a navigating action, before the page had settled.

- **Before any trial's first purchase submit:** 0 of 14.
- **After Confirm:** 7, all in the re-pilot's 4 browser traces (2, 1, 2 and 2).
- **Stale refs then used** in any scored trace: 0.
- **The fix:** backend's settle-wait goes into the confirmatory pin, the only change to the pin intake allows, and its commit is named in the confirmatory record.

## Integrity

- **The record** (`end-1.json`): 17 attempts run, 16 scored, 0 missing. The owner's files are unchanged, the logins were valid before and after, there are 0 secrets, and the email check found 0.
- **The one harness fault** (`end-1.json`'s `faultsByCell`, browser on Haiku):
  - **The attempt:** `repilot-browser-T6-claude-haiku-5-5-1`, attempt 1, at 2026-11-18T19:33:16.764Z.
  - **The fault:** a stall: "a ref from the preceding snapshot didn't resolve: submit f6e16". There were no server errors.
  - **Its cause:** the click tool's snapshot raced the Confirm's client-side redirect. Backend diagnosed that from the set-aside attempt's record, which is unscored and disclosed.
  - **What happened to it:** it's set aside whole under `traces.tar.gz`'s `interrupted/`, and was rerun and scored on attempt 2. That's PLAN.md §5's handling: excluded and rerun, counted per cell.
- **The margin** (§8.2): 26, less the 17 attempts run (16 and 1 retry), leaves 9. §8.4's 4-trial browser re-pilot would have left 5. It isn't needed.

## The pin

`pin.json`:

- **commit:** caf5a59e1dfadc59912b7df19c89b46f29fcbb9d
- **tree:** 9e385a08bf783fb28fecc3dbe33022d2303da31ee12b54f79829402219e713d3
- **hosting-lab's tree:** f4b9d3d7f82fb758c9f597eb877bead4463eaab241b17bb71b6b1854d73a57da
- **the .next build id:** GrUbmOOPTblzqURgwEjki
- **the lockfile:** sha256 97e6dbbadbce71f324723797fd860c8ac1ed707b5b8f116ae3c59482a7e524c9
- **the tools:** Chromium 156.0.8078.4, Playwright 1.64.1, Node v26.13.1 and vlt 1.8.0.

`launch-1.json`, `preflight-1.json`, `end-1.json` and `stale-check.json` are the run's own records, committed by backend in d077f632.
