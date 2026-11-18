# M7f, the pilot run

In the benchmark, token-passing stands in for the person's approval, as v0's confirm resend and the browser's click do; the product toolset never gives a model a token (RFC 0004 §4, §5).

| cell                          | n   | intended optimal | completed optimal | median tokens | harness faults | missing |
| ----------------------------- | --- | ---------------- | ----------------- | ------------- | -------------- | ------- |
| full claude-sonnet-5-5        | 5   | 100.0            | 100.0             | 11475         | 0              | 0       |
| full claude-haiku-5-5         | 5   | 40.0             | 0.0               | 15646         | 0              | 0       |
| progressive claude-sonnet-5-5 | 5   | 100.0            | 100.0             | 13767         | 0              | 0       |
| progressive claude-haiku-5-5  | 5   | 40.0             | 0.0               | 15031         | 0              | 0       |
| v0 claude-sonnet-5-5          | 5   | 0.0              | 0.0               | 4540          | 0              | 0       |
| v0 claude-haiku-5-5           | 5   | 80.0             | 0.0               | 7612          | 0              | 0       |
| browser claude-sonnet-5-5     | 5   | 0.0              | 0.0               | 3675          | 0              | 0       |
| browser claude-haiku-5-5      | 5   | 0.0              | 0.0               | 5295          | 0              | 0       |
| mcp claude-sonnet-5-5         | 5   | 100.0            | 0.0               | 7898          | 0              | 0       |
| mcp claude-haiku-5-5          | 5   | 0.0              | 0.0               | 10932         | 0              | 0       |
| webmcp claude-sonnet-5-5      | 5   | 60.0             | 60.0              | 7800          | 0              | 0       |
| webmcp claude-haiku-5-5       | 5   | 80.0             | 80.0              | 11525         | 0              | 0       |

Harness faults, excluded and rerun: 0.

## What this is

The M7f pilot: 6 surfaces × 2 models × 5 trials = 60, run on the pinned export, under the final plan (`../PLAN.md`), analysed by `../analyze.py`'s pilot mode with no change. **It's descriptive only.** At n = 5 per cell, it makes no contrast estimate and no finding about which surface helps. Its jobs are the plan's: harness problems, tokens per trial, the per-surface variance, whether the parity check holds on real runs, and the two rules the confirmatory run takes from it. MCP's and WebMCP's cells are descriptive in any case (§3).

- **The run:** 58535950 pinned, launched 2026-11-18T18:07:53Z, ended 18:15:21Z, exit 0. 60 of 60 scored, 0 harness faults, 0 missing.
- **`analysis.json`:** the analysis's whole output, with seed 20261118 and 10,000 resamples.

## 1. Per surface and model, descriptive

The rates are counts of 5, with their Wilson 95% intervals in percent. The medians have bootstrap 95% intervals.

| cell                          | intended optimal | completed optimal | Pro's allowance seen first | consequential error | no request made | median tokens       | median calls | median seconds   |
| ----------------------------- | ---------------- | ----------------- | -------------------------- | ------------------- | --------------- | ------------------- | ------------ | ---------------- |
| full claude-sonnet-5-5        | 5/5 (57–100)     | 5/5 (57–100)      | 5/5                        | 0/5                 | 0/5             | 11475 (11281–14151) | 5 (5–5)      | 16.3 (13.6–16.8) |
| full claude-haiku-5-5         | 2/5 (12–77)      | 0/5 (0–43)        | 5/5                        | 3/5                 | 0/5             | 15646 (12224–18384) | 5 (4–6)      | 13.3 (13.0–15.6) |
| progressive claude-sonnet-5-5 | 5/5 (57–100)     | 5/5 (57–100)      | 5/5                        | 0/5                 | 0/5             | 13767 (13472–18294) | 6 (6–7)      | 17.0 (15.4–18.3) |
| progressive claude-haiku-5-5  | 2/5 (12–77)      | 0/5 (0–43)        | 5/5                        | 3/5                 | 0/5             | 15031 (12766–18218) | 5 (4–8)      | 14.6 (13.8–17.3) |
| v0 claude-sonnet-5-5          | 0/5 (0–43)       | 0/5 (0–43)        | 5/5                        | 3/5                 | 2/5             | 4540 (3634–7217)    | 5 (3–5)      | 11.1 (7.9–13.4)  |
| v0 claude-haiku-5-5           | 4/5 (38–96)      | 0/5 (0–43)        | 5/5                        | 1/5                 | 0/5             | 7612 (6632–11130)   | 7 (6–7)      | 14.2 (12.4–15.7) |
| browser claude-sonnet-5-5     | 0/5 (0–43)       | 0/5 (0–43)        | 5/5                        | 1/5                 | 4/5             | 3675 (2696–8802)    | 2 (2–6)      | 9.1 (7.5–12.9)   |
| browser claude-haiku-5-5      | 0/5 (0–43)       | 0/5 (0–43)        | 5/5                        | 0/5                 | 5/5             | 5295 (4489–9180)    | 5 (4–5)      | 12.4 (11.4–12.9) |
| mcp claude-sonnet-5-5         | 5/5 (57–100)     | 0/5 (0–43)        | 5/5                        | 0/5                 | 0/5             | 7898 (7632–10254)   | 3 (3–3)      | 9.2 (8.4–9.8)    |
| mcp claude-haiku-5-5          | 0/5 (0–43)       | 0/5 (0–43)        | 5/5                        | 5/5                 | 0/5             | 10932 (9820–14470)  | 4 (3–4)      | 12.0 (10.8–12.8) |
| webmcp claude-sonnet-5-5      | 3/5 (23–88)      | 3/5 (23–88)       | 5/5                        | 2/5                 | 0/5             | 7800 (7198–7832)    | 3 (2–3)      | 11.0 (9.3–12.2)  |
| webmcp claude-haiku-5-5       | 4/5 (38–96)      | 4/5 (38–96)       | 5/5                        | 0/5                 | 1/5             | 11525 (10632–12465) | 5 (3–5)      | 15.3 (12.5–17.3) |

- **"No request made"** counts trials with no request event at all (`metrics.choseNone`). It's read from each trace's metrics line outside `analyze.py`, to explain the zeros beside it, and isn't an analysis output.
- **The first view, from the preflight** (`preflight-1.json`): full: project, progressive: project, mcp: project, webmcp: project, v0: pages, browser: pages. Every surface's oracle walk reached all 10 deciding facts, with none missing. In every trial, Pro's allowance was seen before the first request (`proAllowanceSeen`, 60 of 60).
- **Observed, not measured** (from reading the traces, and not a coded rate): where agents made no request, their final text named an option and stopped to ask the user. Browser-on-Sonnet's five final texts each named Pro plus the extra-bandwidth add-on, at $30 a month. On `full`, Haiku made its refused request, then asked the user instead of resending with the approval token, in all 5 trials. So it never completed, and in 3 of 5 its request covered only the plan.

## 2. MCP's elicitation under `claude -p`

Claude Code 2.1.311 declares elicitation support (`form` and `url`) in every MCP trial. Run non-interactively, it answered every elicitation `cancel`: 15 of 15 consequential `execute` calls. The model read that as the person declining ("you declined both"). So MCP can't complete under `claude -p`, and its completed rate is 0 by the harness, not by the surface. That's the harness limit §3 anticipated, and MCP reports the intended measure only.

## 3. The browser's browsing rate, against the 0.20 rule

Browsing loads were in 0% of the browser's 10 trials, against a threshold of 20%. **The confirm-click rule doesn't apply**, so the browser's request event stays the first review-page load carrying a selection (§5).

## 4. The confirm page's distortion check, against its threshold

The unconfirmed-request rate is a request event with no completed purchase, as a share of the trials that ran, pooled over both models: browser 1/10, full 5/10. The difference is -0.40, against a threshold of 0.40 either way, compared exactly. **The fallback applies, by the pinned rule:** in the confirmatory run, `full` against `browser` takes completed as its primary, and the other two contrasts stay on intended.

- **For intake, without reinterpreting the rule:** it triggered on full's rate exceeding the browser's, not the other way round. Full's 5 of 10 are Haiku making a refused request and not resending. The browser's 1 of 10 is low because its agents mostly made no request at all (9 of 10). The plan motivates the fallback as the review page distorting the browser arm, which isn't what this shows. The mechanical rule is pinned and applies as written.

## 5. The observed variance

- **The intervals at n = 5 are wide:** a 3 of 5 cell's Wilson interval runs about 23 to 88%.
- **The cells sit at the extremes:** 7 of the 12 intended-optimal cells are 0 or 5 of 5, and the models split widely on the same surface (full, intended: Sonnet 5 of 5, Haiku 2 of 5).
- **The per-model results lead:** the models' heterogeneity is the larger effect in this pilot, as §5 says it should be when it's large.
- **Cost varies about twofold:** median tokens range from 3675 to 15646, and the calls from 2 to 7.

## 6. The confirmatory sizing, against 50 per cell

At 50 per cell, the expected 95% half-widths from the pilot's own rates are:

| contrast            | primary           | per model (Sonnet, Haiku) | pooled |
| ------------------- | ----------------- | ------------------------- | ------ |
| full vs v0          | intended optimal  | ±0.0, ±17.5               | ±8.8   |
| full vs browser     | completed optimal | ±0.0, ±0.0                | ±0.0   |
| progressive vs full | intended optimal  | ±0.0, ±19.2               | ±9.6   |

- **The pilot's 0 and 5 of 5 cells give zero variance,** which understates it: the true rates at n = 5 are too uncertain to size from.
- **The plan's worst case, at a rate of 0.5,** is ±19.6 per model and ±13.9 pooled. Every pilot-rate half-width is at or below it, so **50 per cell meets the plan's precision target.**
- **The budget:** 400 confirmatory trials, unchanged.

## A security result: no product transport gave a model a token

On real model runs, no product transport ever gave a model an approval token. This is RFC 0004's "the product toolset never gives a model a token" (§4, §5), measured on real runs.

- **The method:** a scan of every trace (`pilot-*.jsonl`) and every CLI stream log (`claude-*/stdout.jsonl`, mapped to its trial by its `mcp.json`) in the committed `traces.tar.gz`, for token-shaped strings. The pattern is the runtime's own, `TOKEN` from `@affordances/runtime/agent`.

| surface     | in the traces | in the stream logs | trials with any |
| ----------- | ------------- | ------------------ | --------------- |
| full        | 81            | 54                 | 10 of 10        |
| progressive | 81            | 54                 | 10 of 10        |
| v0          | 0             | 0                  | 0 of 10         |
| browser     | 0             | 0                  | 0 of 10         |
| MCP         | 0             | 0                  | 0 of 10         |
| WebMCP      | 0             | 0                  | 0 of 10         |

- **Every token-shaped string is on full or progressive:** that's the benchmark's simulated approval, the four tools' `userApproved` token, as above.
- **MCP and WebMCP, the product toolsets** (mcp-v1 and webmcp), **have none:** neither the model's inputs nor its outputs carried one.
- **v0 and the browser have none either,** since neither has a token.
- **The two canary logs** have none.
- **Review found the same counts in the traces,** accepting 673222d1 (18:22Z). Design's rerun on the committed archive gives the same figures, and adds the stream logs.

## Integrity

- **The record** (`end-1.json`): 60 of 60 scored, 0 faults, 0 missing. The owner's files are unchanged, the logins were valid before and after, there are 0 secrets, and the email check found 0.
- **The disclosure** (intake, 18:17Z): At 18:09Z, during a mid-run liveness check, backend printed the choice and completed fields of the first ten traces, alongside their resolved model, end, calls, duration and tokens. Nothing else was read; no metric was computed or shared. Intake judged the impact nil, the pilot being descriptive. The plan and the analysis were already pinned and fixed. Backend corrected its report of the check at 18:17Z.
- **The committed records differ from the run's in one way** (the planner, 18:20Z): in `launch-1.json` and `end-1.json`, and in their copies inside `traces.tar.gz`, the two credential files' sha256 are replaced with "recorded outside git", their mtimes kept. The originals stay outside git. Otherwise they're as the run wrote them (673222d1).
- **Intake's note, not a fault:** `~/.codex/auth.json`'s mtime is 13:50:25Z, before and outside this run, most likely the Codex CLI's own refresh during a login check. What ran it is unknown, and nothing in backend's session ran at that time.

## The pin

`pin.json`:

- **commit:** 5853595051977c6a55b6c6b1b91c257e15d92ba3
- **tree:** 00d2fc54e49b85a4c09444be17893face59fc7f2fd459baaad223f27a02439c4
- **hosting-lab's tree:** dd7624d7ff4c41ae0f73261228014f534bf253123bce38b8c9194f7350d2b457
- **the .next build id:** o8JOxr05D1nTIU7ncWtXg
- **the lockfile:** sha256 97e6dbbadbce71f324723797fd860c8ac1ed707b5b8f116ae3c59482a7e524c9
- **the tools:** Chromium 156.0.8078.4, Playwright 1.64.1, Node v26.13.1 and vlt 1.8.0.

`launch-1.json`, `preflight-1.json` and `end-1.json` are the run's own records. The preflight passed with no refusals. `traces.tar.gz` holds the 60 traces as `harness.ts` writes them, archived by backend, with the email scan as in M5.
