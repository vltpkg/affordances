# M5 confirmatory: the post-hoc audit's coding rule

**POST HOC and DESCRIPTIVE** (intake's audit packet, in queue row `qitem-20261118072815-57e3ca33…`, created 2026-11-18 07:28:15Z by the queue's clock; the packet's own heading says 07:35Z). `code.py`'s header carries the packet's label, and is left as committed, since it's the rule. Nothing here changes a pre-registered number.

This rule was committed before it was applied to any trace. [`code.py`](code.py) is the rule, and this file states it in prose.

- **The same rule in all three arms:** A, C and S, both models.
- **Its inputs** are the trace's calls and its final text, with no model judge.

## (1) Every non-optimal trial, one primary category

Trials are coded by the pre-registered `optimal`. The first rule that holds sets the primary category:

1. **(d) none:** the scored choice is `none`.
2. **(c) another plan:** the scored choice's plan isn't Pro (Hobby, Business, the Pro Plus bundle).
3. **(b) recommended the optimum, but requested a partial approval.** All three hold:
   - the choice is Pro without the extra-bandwidth add-on;
   - the final text names the add-on (`extra bandwidth`, or `bandwidth add-on`) and asks (`approve`, `confirm`, `would you like`, `want me to`, `go ahead`, `let me know` and the like);
   - no approval was ever requested for the add-on.
4. **(a) believed Pro's bandwidth unknown or enough.** The choice is Pro without the add-on, and the final text says either:
   - Pro's bandwidth is unknown (`not listed`, `isn't shown`, `couldn't confirm` and the like, near `bandwidth` or `allowance`); or
   - what Pro has is enough (`should cover`, `is enough`, near `Pro` or `100 GB`).
5. **(e) other:** anything else, including a Pro trial with the add-on that still isn't optimal.

**The flags:** each trial also carries the three text flags behind (a) and (b), whatever its category: `a_unknown`, `a_enough` and `b_namesAddOnAndAsks`. Overlaps can be read from them. The precedence (b before a) is fixed here, before any coding.

## (2) The information path

A trial **saw Pro's allowance** if a tool result before its first approval request carries it. The allowance is a JSON object with `slug: "pro"` and a numeric `bandwidthGb`, as the fixture states it. The first approval request is the first call whose response is `confirmation_required`.

- Prose such as "Pro has 100 GB" doesn't count.
- Another plan's allowance doesn't count either.

It's reported per arm and model, with the optimal rate for trials that saw it and for trials that didn't.

## (3) The first-view diff

For one seed (index 0, Sonnet), the first `project` result of A and of C are compared byte for byte, with each trial's random project key replaced by `proj_X`. It reports:

- what differs in attributes, claims and order;
- whether the options and their facts are identical.

## (4) The text-stated optimum (secondary)

A trial is **text-optimal** if it's optimal, or if it's coded (b). It's reported beside the pre-registered rate, never in its place.

## Review

Review re-derives at least the coding on a 20% random sample with a fixed seed, reading each sampled trial's final text and calls by hand.
