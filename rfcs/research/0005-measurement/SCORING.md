# RFC 0005 §7: measuring assumption 8, the scoring rule

**SPIKE:** measurement for assumption 8, not product code.

This rule is written down and committed before the extractor runs on either app, so the scoring can't be fitted to what it finds.

- **Fixed before any run:** the references, the v0 rewrite, the scoring script (`score.py`) and this rule. None of them is edited after the extractor's output is seen.
- **If a rule proves wrong:** the fix is a new, dated section here, and both results are reported.

## 1. What runs

- **The pipeline:** M6's extractor, `extract(root)` from `@affordances/next` (packages/next/src/extract.ts), on a clean export of the tip, as RFC 0005 §2 wires it.
- **Which tip:** one that includes backend's fix for the M5 boundary review's #4, since its lossy-input detection changes what extraction outputs (intake, 2026-11-18). The run waits for #4's accepted commit, and the results name it, and the exact tip they ran on.
- **Two apps:**
  - **apps/example,** a plain v0 app;
  - **hosting-lab's v0 rewrite** (§3), a copy of apps/hosting-lab inside the export, with its actions files replaced by the rewrite.
- **Two stages per app, both mechanical:**
  - **A, as written:** `extract` over the app as it is;
  - **B, after the codemod:** the existing id codemod (`writeIds`, RFC 0005 §3's zero-configuration path) writes its suggested ids, then `extract` runs.
  - **Why two:** an action without an `id` literal is skipped with `W_NO_ID`, so stage A measures "ids only where written". Stage B measures what the rest of extraction recovers once ids exist, the way RFC 0005 says an app gets them.

## 2. The references

- **apps/example:** `example-reference.json`, as committed in 3c1e4146, before any extractor existed.
- **apps/hosting-lab:** `hosting-lab-reference.json`, made by `reference.ts` from hosting-lab's hand-written manifest (`src/app/capabilities.ts`, the manifest the benchmark pins by digest).
  - **What it holds:** each capability's fields in `example-reference.json`'s form.
  - **Bindings:** each capability's binding (route, action) comes from the real hosting-lab's bound actions, as the extractor reports them (`extract(...).bound`). It's mechanical, not written by hand.
  - **When it's made:** generated and committed before stage A runs.

## 3. hosting-lab's v0 rewrite (`hosting-lab-v0/`)

The form an app has before it adopts capabilities (RFC 0005 §7). Each bound `defineAction({ capability, ... })` becomes a v0 `defineAction` by these rules, applied to every action alike.

- **Kept as written:** `name`, `run`, `state`, `effects` (v0's delta keys) and `message`.
- **No `id`:** the app hasn't adopted capabilities. Stage B's codemod supplies suggestions.
- **`description`:** the capability's `description`, verbatim.
- **`input`:** the capability's input schema, as the same zod expression, inline.
- **`expose`,** from the capability:
  - `confirm` if it requires confirmation;
  - otherwise `public` for `authorization.principal: 'any'`;
  - otherwise `session`.
- **`readOnly: true`** for a capability of kind `query`.
- **`requires`:** the capability's preconditions' descriptions, joined with ", and ", when it has any.
- **`guard`:** present when the capability has preconditions. It's a v0 guard function, so it's opaque to extraction (W_OPAQUE). Its body returns `true`, since extraction never runs it.
- **`summary`:** for a `confirm` action, a v0 function returning the capability's summary text. v0's summary is a function, so extraction gives a generic one (W_SUMMARY_GENERIC).

## 4. Matching

- **The unit:** a capability, matched between extraction and reference by its **binding**, (route, action). Never by id, since id is a scored field.
- **Unmatched capabilities:** an extracted one with no reference binding counts against binding precision, and a reference one that wasn't extracted counts against binding recall. Neither is scored on any other field.

## 5. Fields, and when a value matches

For each field:

- **TP:** both have a value, and it matches by the rule below;
- **FP:** extraction has a value, and the reference has none or a different one;
- **FN:** the reference has a value, and extraction has none or a different one.

So a mismatch counts as both an FP and an FN. Precision is TP / (TP + FP), and recall is TP / (TP + FN), each computed over matched capabilities, per app and stage.

| Field                   | A value                                            | Matches when                                                                                                                       |
| ----------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| binding                 | (route, action)                                    | equal. Scored over all capabilities, as §4 says                                                                                    |
| id                      | the capability id                                  | equal strings                                                                                                                      |
| kind                    | `query` or `action`                                | equal                                                                                                                              |
| input                   | the input JSON Schema                              | equal RFC 8785 bytes, after removing `$schema`. There is no other normalization, so any other difference is reported with its diff |
| authorization           | `authorization.principal`                          | equal                                                                                                                              |
| confirmation            | whether confirmation is required                   | equal booleans. The summary text is reported, not scored: v0's is generic by design (E6)                                           |
| target                  | the target resource id                             | equal strings                                                                                                                      |
| resource types and keys | each (id, key) pair in `resources`                 | equal pairs, as sets, per app. A key that matches under a different id is reported separately, not counted                         |
| effects                 | each reference effect                              | none is extracted, by design (§2.2), so recall is counted, and precision is reported as n/a when nothing is extracted              |
| preconditions           | each reference **declarative** precondition, by id | equal ids, declarative on both sides. Extracted guard preconditions, which are opaque, are counted and reported, not scored        |
| claims                  | each reference claim                               | as effects                                                                                                                         |
| relations               | each reference relation                            | as effects                                                                                                                         |

## 6. What's reported

- **Precision and recall per field,** per app and stage, with the TP, FP and FN counts behind each.
- **Every mismatch,** with both values.
- **Every diagnostic** the extractor gave, by code and count.
- **What can't be inferred:** fields at zero recall by design, against fields at zero recall that §2's rules expected to recover. The second kind is a defect.
- **The rule from RFC 0005 §7:** a precision below 1 on any extracted field is a defect in a rule, not an expected loss. Each one is named.
