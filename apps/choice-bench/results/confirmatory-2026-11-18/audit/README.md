# M5 confirmatory: the post-hoc audit

**POST HOC and DESCRIPTIVE** (intake's audit packet, in queue row `qitem-20261118072815-57e3ca33…`, created 2026-11-18 07:28:15Z by the queue's clock; the packet's own heading says 07:35Z). It changes no pre-registered number: those are in [`../README.md`](../README.md) and [`../analysis.json`](../analysis.json).

- **The coding rule** is [`CODING.md`](CODING.md) and [`code.py`](code.py), committed in d46008a5 before it was applied to any trace.
- **One fix since:** aa8071b0 groups trials by their requested model. In d46008a5 no trial matched a cell, so every table was empty. The empty output was deleted unread, and the rule's categories and patterns are unchanged.
- **The outputs:**
  - [`coded.json`](coded.json): every trial's codes, and the tables below, from `git show aa8071b0:…/audit/code.py | python3 -I - <trials dir>`;
  - [`first-view.json`](first-view.json), from `first_view.py`;
  - [`allowance-source.json`](allowance-source.json), from `allowance_source.py`.

## (1) Non-optimal trials, by primary category

| arm, model | optimal | non-optimal | (a) unknown or enough | (b) asked, partial approval | (c) other plan | (d) none | (e) other |
| ---------- | ------- | ----------- | --------------------- | --------------------------- | -------------- | -------- | --------- |
| A, Sonnet  | 101/114 | 13          | 0                     | 13                          | 0              | 0        | 0         |
| C, Sonnet  | 17/114  | 97          | 51, a lower bound     | 33, an upper bound          | 9              | 0        | 4         |
| S, Sonnet  | 101/114 | 13          | 0                     | 11                          | 2              | 0        | 0         |
| A, Haiku   | 43/114  | 71          | 0                     | 69                          | 0              | 2        | 0         |
| C, Haiku   | 34/114  | 80          | 0                     | 78                          | 1              | 1        | 0         |
| S, Haiku   | 46/114  | 68          | 0                     | 68                          | 0              | 0        | 0         |

## (2) The information path

Did a tool result before the first approval request carry Pro's bandwidth allowance? It's counted per arm and model, with the optimal rate for each group.

| arm, model | saw it  | optimal if it saw it | optimal if not |
| ---------- | ------- | -------------------- | -------------- |
| A, Sonnet  | 114/114 | 101/114              | none           |
| C, Sonnet  | 19/114  | 17/19                | 0/95           |
| S, Sonnet  | 114/114 | 101/114              | none           |
| A, Haiku   | 100/114 | 43/100               | 0/14           |
| C, Haiku   | 96/114  | 34/96                | 0/18           |
| S, Haiku   | 114/114 | 46/114               | none           |

In every arm and model, the call that first carried it was `execute hosting.plan.list` ([`allowance-source.json`](allowance-source.json)). The first `project` result never carries any plan's `bandwidthGb`, in any arm.

## (3) The first view, A against C (index 0, Sonnet)

[`first-view.json`](first-view.json) compares them offer by offer.

- **C's first view omits one offer A's shows:** `hosting.plan.list`, the only call that returns the plans' attributes, including each plan's `bandwidthGb`.
  - C's view records it as `omitted.offers: 1`, expandable along the project's relations.
  - This follows from C's `advocated` policy, whose scope is the project's neighborhood at depth 1. A's policy is exhaustive.
- **The other 14 offers** have the same ids in both views. Their fields differ only in `revision` and `relevance`.
- **Claims and order:**
  - A's view omits claims;
  - C's view shows `businessRecommended` ("1,000 GB of bandwidth and priority support included"), `rollbackBenefit` and `bundleSaves`, and orders the offers by the owner's recommendation.

**Under intake's rule, this is a policy finding, and it outranks the persuasion reading.** It's the basis of H2's validity note in [`../README.md`](../README.md). In this fixture, C differs from A in what it lists as well as in its claims and order. The H2 contrast therefore doesn't isolate advocacy.

## (4) The text-stated optimum (secondary)

A trial is text-optimal if it's optimal, or coded (b). This is reported beside the pre-registered rate, not in its place.

| arm, model | pre-registered | text-stated            |
| ---------- | -------------- | ---------------------- |
| A, Sonnet  | 101/114        | 114/114                |
| C, Sonnet  | 17/114         | 50/114, an upper bound |
| S, Sonnet  | 101/114        | 112/114                |
| A, Haiku   | 43/114         | 112/114                |
| C, Haiku   | 34/114         | 112/114                |
| S, Haiku   | 46/114         | 114/114                |

## What this supports, and what it doesn't

- **Intake's hypothesis 1 (information):** supported, descriptively.
  - No trial that didn't see Pro's allowance before asking for approval was optimal, in any arm.
  - Seeing it was close to sufficient for Sonnet (101/114 in A and in S, 17/19 in C), but not for Haiku (43/100 in A, 34/96 in C, 46/114 in S). Most of Haiku's non-optimal trials are coded (b), in every arm.
  - In C on Sonnet, 95 of 114 trials never saw it. C's first view doesn't list the one call that returns it, and 51 of C Sonnet's non-optimal trials say Pro's bandwidth is unknown or enough.
  - Haiku reached that call even in C (96 of 114), and its C and A rates are close.
- **Intake's hypothesis 2 (measurement):** supported for Haiku in every arm. Most of Haiku's non-optimal trials (69 of 71 in A, 78 of 80 in C, 68 of 68 in S) name the add-on and ask for approval, but requested Pro alone.
- **Not established:** how much of C's effect on Sonnet is the omitted offer, and how much is the claims or the order. These are post-hoc associations within one fixture and one task. Separating them needs a new cell, such as C with `hosting.plan.list` (or Pro's allowance) in the first view, or D. That's for the exploratory budget.

## Review's re-derivation of the coding

Review hand-coded a 20% random sample with a fixed seed: 70 trials, all coded. It agreed with the rule on **60 of 70**, and on 61 of 70 after adjudicating the 10 disagreements.

- **All 9 real disagreements are the rule's (b) where review codes (a).** The trial says Pro's bandwidth is unknown, offers the add-on only as a fallback, and asks only about Pro. The rule's precedence puts (b) before (a), and its patterns can't tell a recommendation from a fallback.
- **8 of the 9 are in C Sonnet.** So C Sonnet's (b) count of 33 and its text-stated rate of 50/114 are **upper bounds**, and its (a) count of 51 is a lower bound.
- **The rule isn't recoded.** These figures are the committed rule's. A tighter rule would be a second rule, labelled and committed before it's applied.
- Items (2) and (3) reproduce exactly.
