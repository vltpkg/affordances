# Survey: do real guards fit RFC 0001's condition vocabulary?

**Status:** research input to RFC 0001 (open question 2) and to M2e. **Commit surveyed:** `8dec7e9b`.

RFC 0001 §3.1 defines a small, closed, three-valued vocabulary for declarative conditions. Anything it can't express becomes an opaque guard that only the runtime evaluates. That design rests on an assumption the prior-art review lists as untested (prior art §6.7, assumption 10): that a small vocabulary covers most real guards, and the rest can honestly be marked opaque.

This survey tests it against every guard in this repository. Every claim cites `path:line` at the commit above.

## Summary

- **There are 11 guard functions** in the repository's apps, examples, docs and tests. They contain **19 distinct checks**.
- **By check:**
  - **12 fit the vocabulary (63%):** 4 directly, and 8 once the looked-up item is modelled as a resource that the capability references from its input (RFC 0001 §2.2, `references`).
  - **3 fit only through a derived attribute** that the application computes, such as an array's length.
  - **4 don't fit:** 3 need a quantifier over an array, and 1 needs subtraction.
- **By whole guard:**
  - 5 of 11 are expressible completely, and 3 more only with derived attributes.
  - **None of the example store's 4 guards** fits completely as written. That store is the only real application here.
  - **Every guard has at least one declarative check,** so every capability can state part of its precondition declaratively and keep the rest as a guard. That's what RFC 0001's own example does (§11).
- **What the vocabulary lacks:** the four checks that don't fit and the three derived ones share two missing forms:
  - a quantifier over an array attribute ("some line item has this SKU", "every item is in stock");
  - an array's length.
    A bounded `some`/`every` and a count would move 5 of those 7 checks into the vocabulary. The two that need subtraction (9a and 9c) would remain.
- **The sample is small.** It has 11 guards, of which only 4 belong to an application, and five docs guards repeat the store's `addToCart`. The percentages describe this repository, not real applications in general.

## Method

- **What was searched:** every `guard:` function in `apps/`, `packages/*/test`, the docs content and `README.md` at the commit (`git grep`).
  - `packages/md` and `packages/md-core` were excluded; they have no actions.
  - Strings that only _name_ a guard in a descriptor, such as the marketing page's `"guard": "owners invite admins"` (`apps/docs/src/components/marketing/hero-stage.tsx:92`), aren't functions, so they aren't counted.
- **How guards were split:** each guard was split into its checks, one per condition it tests. The v0 branch for a graph with no input (`!input ||`, or `if (!input)`) isn't a check; it's v0's convention for building a graph (`packages/core/src/action.ts:38`). In the IR, an input path with no value evaluates to `unknown`, which is what "needs input" means (terminology §3.4).
- **The four classes:**

| Class         | Meaning                                                                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Direct**    | A comparison or `exists` over the target's attributes, the input or the principal, as RFC 0001 §3.1 stands                                                                             |
| **Reference** | Direct, once the item the guard looks up by an input key is declared as a resource and referenced from the input (`references[].at`, RFC 0001 §2.2): a variant by its SKU, for example |
| **Derived**   | Expressible only if the application exposes a computed attribute, such as a count or a list of SKUs. The logic then lives in the state loader instead of the guard                     |
| **Opaque**    | Needs something the vocabulary leaves out on purpose: a quantifier over an array, or arithmetic                                                                                        |

**A derived attribute doesn't count as fitting.** It moves the logic into application code that the IR can't see, so it is a relabelled guard. It is still more inspectable: the attribute's value appears in a projection, and the condition over it is declarative.

## Every guard

| #   | Guard                       | Where                                                   | Its checks                                                                                                                                                                                           | Class                                  |
| --- | --------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1   | `addToCart` (README)        | `README.md:27-30`                                       | the variant with the input's SKU has stock                                                                                                                                                           | Reference                              |
| 2   | `addToCart` (docs, actions) | `apps/docs/content/concepts/actions.mdx:23-26`          | the same                                                                                                                                                                                             | Reference                              |
| 3   | `placeOrder` (docs, expose) | `apps/docs/content/concepts/expose.mdx:54`              | the cart's count is above 0                                                                                                                                                                          | Direct                                 |
| 4   | `addToCart` (docs, guards)  | `apps/docs/content/concepts/guards.mdx:13-17`           | (a) some variant has stock, with no input; (b) a variant with the SKU exists; (c) it has stock                                                                                                       | (a) Opaque; (b), (c) Reference         |
| 5   | `addToCart` (marketing)     | `apps/docs/src/components/marketing/how.tsx:17-18`      | the SKU is in stock, through a helper, `inStock`                                                                                                                                                     | Reference (by what the helper means)   |
| 6   | `updateQuantity` (store)    | `apps/example/src/app/cart/actions.ts:16-21`            | (a) the cart's count is above 0, with no input; (b) the SKU is in the cart; (c) the input's quantity is at most the variant's stock                                                                  | (a) Direct; (b) Derived; (c) Reference |
| 7   | `removeItem` (store)        | `apps/example/src/app/cart/actions.ts:42-47`            | (a) the cart's count is above 0, with no input; (b) the SKU is in the cart                                                                                                                           | (a) Direct; (b) Derived                |
| 8   | `placeOrder` (store)        | `apps/example/src/app/checkout/actions.ts:18-23`        | (a) the cart's count is above 0; (b) every item's quantity is at most its stock                                                                                                                      | (a) Direct; (b) Opaque                 |
| 9   | `addToCart` (store)         | `apps/example/src/app/products/[slug]/actions.ts:21-33` | (a) some variant has stock left after what's in the cart, with no input; (b) the SKU is a variant of this product; (c) stock minus the quantity already in the cart is at least the input's quantity | (a) Opaque; (b) Reference; (c) Opaque  |
| 10  | `addToCart` (core test)     | `packages/core/test/handler.test.ts:51-54`              | the input's size has stock                                                                                                                                                                           | Reference                              |
| 11  | `placeOrder` (core test)    | `packages/core/test/handler.test.ts:79`                 | the cart has items (`items.length > 0`)                                                                                                                                                              | Derived                                |

**Counts:**

| Class     | Checks                         | Share |
| --------- | ------------------------------ | ----- |
| Direct    | 4: 3, 6a, 7a, 8a               | 21%   |
| Reference | 8: 1, 2, 4b, 4c, 5, 6c, 9b, 10 | 42%   |
| Derived   | 3: 6b, 7b, 11                  | 16%   |
| Opaque    | 4: 4a, 8b, 9a, 9c              | 21%   |
| **Total** | **19**                         |       |

**Whole guards:**

- **Expressible completely:** guards 1, 2, 3, 5 and 10.
- **With derived attributes too:** guards 6, 7 and 11.
- **Need a guard for part of the check:** 4, 8 and 9.

## What the cases show

### The reference form carries most of the weight

Eight of the twelve checks that fit do so only through a reference. In each, the guard looks up an item by a key from the input: a variant by SKU, a size in a stock map. With the item declared as a resource and referenced from the input, the check becomes a plain comparison:

```json
{ "gt": [{ "path": "variant.stock" }, { "value": 0 }] }
{ "le": [{ "path": "input.quantity" }, { "path": "variant.stock" }] }
{ "eq": [{ "path": "variant.product" }, { "path": "product.slug" }] }
```

**What this needs:**

- **More resource definitions.** The store would declare `commerce.variant`, keyed by SKU, and RFC 0001 §11's example doesn't. That's modelling work, done once per domain, not per guard.
- **For guard 9, a reference resolved from the route** (`/products/[slug]`), not from the input. RFC 0001 §2.2's `references[].at` points into the input. A v0 binding's route parameters are a binding detail, so the v0 adapter (M2h) has to map them into input, or `references` needs a route source.

### Quantifiers are the real gap

The checks that don't fit share a shape:

- **"Some element satisfies"** (4a, 9a): is any variant in stock? 9a also needs a subtraction: it asks whether any variant has stock _left after the cart_, `remaining(v) > 0`, and `remaining` is `stock - inCart` (`apps/example/src/app/products/[slug]/state.ts:34`).
- **"Every element satisfies"** (8b): is every cart item within its stock?
- **"An element with this key exists"** (6b, 7b): is the SKU in the cart?
- **"The array isn't empty"** (11): `items.length > 0`.

RFC 0001 §3.1 leaves quantifiers out on purpose, so that every declarative condition stays cheap and checkable against a schema. These cases are the cost of that choice. Three of the store's four capabilities need a quantifier somewhere.

**A bounded form would cover five of the seven** (4a, 6b, 7b, 8b and 11):

```json
{ "some": { "of": "target.items", "where": { "eq": [{ "path": "item.sku" }, { "path": "input.sku" }] } } }
{ "every": { "of": "target.items", "where": { "le": [{ "path": "item.quantity" }, { "path": "item.stock" }] } } }
```

**What it would cost:**

- **Paths:** a new root (`item`) for the current element, and an element schema that paths are checked against (`items` in the attribute's JSON Schema).
- **Three-valued rules over arrays:**
  - `some` is `true` if any element is, else `unknown` if any is `unknown`, else `false`;
  - `every` is the dual;
  - an empty array is `false` for `some` and `true` for `every`;
  - an array that is `missing` or `absent` is `unknown`.
- **Evaluation cost** linear in the array's length.
- **The nesting limit:** quantifiers can nest, so the vocabulary needs a stated depth limit.

That is a real change to RFC 0001 §3.1, and this survey doesn't make it. It's a decision for the RFC (see Next steps).

### Arithmetic stays opaque

Check 9c compares the stock _left after the cart_ with the input's quantity: `stock - inCart >= quantity` (`apps/example/src/app/products/[slug]/actions.ts:27-28`, with `remaining` at `apps/example/src/app/products/[slug]/state.ts:34`). There are two honest options:

- **A derived attribute:** the state exposes `remaining` per variant, as a computed value, and the condition compares it.
- **A guard.**

Adding arithmetic to the vocabulary would cover one check in this repository, so the survey gives no reason to.

### Reasons are richer than descriptions

The store's guards return specific reasons:

- "Only `${left}` left of `${what}`";
- "`${sku}` is not a SKU of `${name}`" (`apps/example/src/app/products/[slug]/actions.ts:25`, `:32`).

A declarative condition has one fixed `description`. RFC 0001 rule 5 already allows a runtime `detail` on a refusal (§8.2), so the specific reason survives for guards. For declarative conditions, the detail would be generated from the failing atom ("`input.quantity` 3 is greater than `variant.stock` 2"), which RFC 0002's refusal shape should allow.

## Next steps

- **This survey doesn't change RFC 0001.** It supplies the evidence that RFC 0001's open question 2 waits for, and M2e's tests use these cases as fixtures.
- **For the decision on quantifiers,** there were two options, to be decided before M2e. The second was taken: RFC 0001 §3.1 now has bounded `some` and `every`, and `count`.
  1. **Keep §3.1 as it is.** Model lookups as references, and accept that "some/every/length" checks are guards or derived attributes. Three of the store's four capabilities then keep a guard.
  2. **Amend §3.1 with bounded `some` and `every`** over array-typed attribute paths, and a `count` (or non-empty) test. That covers 5 of the 7 checks that don't fit now. The two that need subtraction, 9a and 9c, stay guards or derived attributes, and arithmetic stays out.
- **Either way, RFC 0002 should specify** how a refusal's `detail` is formed for a declarative condition.
