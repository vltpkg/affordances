# RFC 0005 §7: assumption 8, the results

**SPIKE:** measurement for assumption 8, not product code.

## What ran

- **The commit:** a clean on-disk export of **1a434b5e**, under the rig's root-check lock. It includes backend's boundary fix #4 (a8fd2bfc and 61f96c97), and predates any change to hosting-lab's manifest.
- **The runtime:** node 26.13.1 (`results/RUN.txt`).
- **Fixed before the run:**
  - the scoring rule, ae54614f (`SCORING.md`), with its pre-run additions in ac15d7a9;
  - the inputs, ac15d7a9: `hosting-lab-reference.json`, the v0 rewrite `hosting-lab-v0/`, `measure.ts` and `score.py`;
  - the hand check of hosting-lab's bindings, 3ca5a365 (`BINDINGS.md`);
  - apps/example's reference, 3c1e4146, written before any extractor existed.
    None was edited after the run.
- **The output:** `results/{example,hosting-lab}-{A,B}.json` and `results/scores.json`. Stage A is the app as written; stage B is after the id codemod.

## The results (precision / recall, scored by SCORING.md)

| field                       | example A  | example B   | hosting-lab A | hosting-lab B |
| --------------------------- | ---------- | ----------- | ------------- | ------------- |
| binding                     | n/a / 0.00 | 1.00 / 1.00 | n/a / 0.00    | 1.00 / 1.00   |
| id                          | n/a        | 0.00 / 0.00 | n/a           | 0.00 / 0.00   |
| kind                        | n/a        | 1.00 / 1.00 | n/a           | 1.00 / 1.00   |
| input                       | n/a        | 0.00 / 0.00 | n/a           | 1.00 / 1.00   |
| authorization               | n/a        | 1.00 / 1.00 | n/a           | 1.00 / 1.00   |
| confirmation                | n/a        | 1.00 / 1.00 | n/a           | 1.00 / 1.00   |
| target                      | n/a        | 0.00 / 0.00 | n/a           | n/a / 0.00    |
| preconditions (declarative) | n/a        | n/a / 0.00  | n/a           | n/a / 0.00    |
| effects                     | n/a        | n/a / 0.00  | n/a           | n/a / 0.00    |
| claims                      | n/a        | n/a         | n/a           | n/a / 0.00    |
| relations                   | n/a        | n/a         | n/a           | n/a / 0.00    |
| resource types and keys     | n/a / 0.00 | 0.00 / 0.00 | n/a / 0.00    | n/a / 0.00    |

## The diagnostics

|                       | stage A     | stage B                                                                              |
| --------------------- | ----------- | ------------------------------------------------------------------------------------ |
| apps/example          | `W_NO_ID` 5 | `W_ATTRIBUTES_UNKNOWN` 1, `W_EFFECTS_UNKNOWN` 4, `W_OPAQUE` 4, `W_SUMMARY_GENERIC` 1 |
| hosting-lab's rewrite | `W_NO_ID` 8 | `W_EFFECTS_UNKNOWN` 7, `W_OPAQUE` 7, `W_SUMMARY_GENERIC` 3                           |

## Reading it, mechanically

- **Stage A extracts nothing, by design.** Every action lacks an `id` literal, so each is skipped with `W_NO_ID` (E1). "ids only where written", as RFC 0005 §7 expected.
- **Recovered completely at stage B:** binding, kind, authorization and confirmation, all at 1.00 / 1.00 in both apps, as §7 expected for literals.
- **Confirmation summaries:** extraction gives v0's generic one ("Run placeOrder"), by design (E6, `W_SUMMARY_GENERIC`). That's reported, not scored.
- **Zero by design:** effects, declarative preconditions, claims and relations. Extraction recovered 4 opaque guard preconditions (apps/example) and 7 (hosting-lab), as `W_OPAQUE`. They're counted and not scored, since a guard isn't a declarative precondition.

**Each precision below 1 on an extracted field is a defect (RFC 0005 §7), named here:**

1. **id (0.00 in both apps):** a rule defect.
   - **What happened:** stage B's ids are the codemod's suggestions (`cart.updateQuantity`, `plans.subscribe`), with no namespace prefix. RFC 0005 §1 says suggested ids take the prefix inferred from the app's name (`idPrefix`), but `writeIds` doesn't read it. That's the boundary review's #11, "computed but unread".
   - **Even with a prefix,** route-derived suggestions wouldn't reproduce hand-chosen ids (`acme.cart.setQuantity` for `updateQuantity`). Ids stay a developer's to write, as §7 expected.
2. **input (0.00 on apps/example; 1.00 on hosting-lab):** a reference defect, not an extractor one.
   - **The check (post hoc, and not a change to the scored numbers):** all 5 mismatches differ only by `additionalProperties: false`, which the hand-written example reference asserts, and which zod's `z.object` doesn't imply. It strips unknown keys rather than refusing them. Without that one key, all 5 match.
   - **hosting-lab's reference** was generated from its IR, and matches 1.00 / 1.00.
3. **target and resource types (0.00):** the decided E9 rule, against a reference that predates it.
   - **What happened:** apps/example's `/products/[slug]` gives `products` with key `slug` (a key-only match), where the reference says `acme.product`. E9 takes the segment as written, never singularized (5f0c2703), and the reference (3c1e4146) was written before that ruling.
   - **Recall:** targets without a route segment (the cart, hosting-lab's plans and add-ons) can't be inferred, so recall is 0. hosting-lab's routes have no segments at all.

## Assumption 8

**Partly holds.**

- **Once ids exist,** an app's own code determines its bindings, kinds, authorization, confirmation requirement and, where the schema slice holds, its input schemas, all exactly.
- **What a developer has to add:**
  - ids (in practice, choosing them);
  - targets and resource types beyond route segments;
  - effects;
  - declarative preconditions in place of opaque guards;
  - claims and relations;
  - a summary template in place of v0's generic one.
- **So it's enrichment, not a rewrite:** nothing extracted had to be thrown away, and every precision below 1 traces to a named rule or reference cause above, not to wrong extracted content.
