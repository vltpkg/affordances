# The IR

The capability manifest: a deterministic JSON document that says what an app can do, independently of its pages,
routes, transports and callers. It holds resources, capabilities (queries, actions and events) with their conditions
and effects, relations, attributed claims, bindings, and the provenance of every piece of it. It holds no code and
describes no caller. The specification is [RFC 0001](../0001-semantic-capability-ir.md), as amended. The package is
`@affordances/ir` (private, 0.0.0, unpublished).

What a runtime does with a manifest is in [runtime.md](./runtime.md) and [projection.md](./projection.md). How a
Next.js app's modules become one is in [next.md](./next.md).

## Where it lives

| Concern                                        | Code (`packages/ir/src/`)                      | Tests (`packages/ir/test/`)                        |
| ---------------------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| the types and the JSON Schema                  | `schema.ts`, `json-schema.ts`                  | `schema.test.ts`, `types.test.ts`                  |
| validation and its codes                       | `validate.ts`                                  | `validate.test.ts`, `safety.test.ts`               |
| canonical form, serialization and digest       | `normalize.ts`, `canonical.ts`, `digest.ts`    | `normalize.test.ts`, `digest.test.ts`              |
| conditions and their evaluation                | `evaluate.ts`                                  | `evaluate.test.ts`, `primitives.test.ts`           |
| composition                                    | `compose.ts`                                   | `compose.test.ts`                                  |
| derived edges                                  | `derive.ts`                                    | `validate.test.ts`                                 |
| confirmation summaries and charges             | `summary.ts`                                   | `charges.test.ts`                                  |
| input defaults and checks                      | `input.ts`                                     | `input.test.ts`                                    |
| precondition conformance (safety rule 5's kit) | `falsify.ts`                                   | `falsify-complete.test.ts`, `falsify-none.test.ts` |
| authoring                                      | `author/` (`define.ts`, `when.ts`, `paths.ts`) | `author.test.ts`, `modules.test.ts`                |

The JSON Schema is generated into `packages/ir/schema.json` by `scripts/schema.ts`, and a test fails if it drifts.

## One source for the types

Every type is a zod schema, and the TypeScript types are inferred from them, so the types, the validator and the JSON
Schema can't disagree. `Expr` is the one type written by hand, since it's recursive. Objects are strict: an unknown
field is an error, not ignored.

## The model

The specification is [§1 to §5](../0001-semantic-capability-ir.md#1-the-model-at-a-glance).

- **A manifest** has `schemaVersion: '0.1'`, a `namespace` (an absolute URI), its `sources`, `resources`,
  `capabilities`, and optionally a `principal`, `relations`, `claims`, `bindings` and `extensions`.
- **A resource** has an `id`, a `key`, declared `attributes` (a JSON Schema), what it `contains`, and `alternatives:
  true` when its instances are alternatives to one another.
- **A capability** is a query, an action or an event, with its `input` and `output` (JSON Schemas), a `target`
  resource, `references` to others, `preconditions`, the two execution requirements (`authorization` and
  `confirmation`), and its `effects`. `targetAt` names where in the input the target's key is
  ([§2.2](../0001-semantic-capability-ir.md#22-capabilitydefinition)).
- **Conditions** are declarative expressions, or `guard: true` for an implementation the app supplies. The vocabulary
  is `all`, `any`, `not`, seven comparisons, `exists`, the quantifiers `some` and `every`, and `count`
  ([§3.1](../0001-semantic-capability-ir.md#31-the-expression-vocabulary)). They're evaluated three-valued: a path
  resolves to a value, to absent (`null`, a known no-value) or to missing (unknown), and an unknown never passes.
- **Effects** are state, financial or other. A financial effect is a charge, with its `amount` and, optionally, when it
  `applies` ([§4](../0001-semantic-capability-ir.md#4-effects-question-3)). A compensable effect names what compensates
  it. A confirmation summary renders every charge with its amount, from the effective input.
- **Relations** are `alternativeTo`, `enables` and `relatedTo`. Edges the definitions imply (supports, produces,
  enables, prerequisite) are derived, marked `inferred`, and point at what implies them
  ([§5.5](../0001-semantic-capability-ir.md#55-derived-edges)).
- **Claims** are attributed statements about a definition, a recommendation or an assessment, each with its source,
  and `cites`, the target attributes it relies on ([§9](../0001-semantic-capability-ir.md#9-claims)).
- **Bindings** say where a capability is reached on a transport, such as v0's `{ route, action }`.

The input schema is a plain JSON Schema with no path semantics inside it. Pointers run into it (`targetAt` and a
reference's `at` name where a key sits), never out of it: a capability's input reads no target attribute.

## Identity, composition and the digest

The specification is [§6 and §7](../0001-semantic-capability-ir.md#6-identity-and-composition-question-4).

- **Ids** are at most 128 characters. A reference is an id in this manifest, or `URI#id` in another.
- **Composition** (`compose`) unites modules by id. Two definitions with one id must be byte-equal once their
  provenance is made explicit, or it's `E_CONFLICT`. It also unites `title` and `extensions`, and reports a namespace or
  format-version mismatch as `E_CONFLICT`.
- **The canonical form** (`normalize`) sorts every set by its key, with ties broken on canonical bytes, removes exact
  duplicates, completes a query to `safe: true` and `effects: []`, writes `alternativeTo` lesser end first, and drops
  defaults, empty arrays and empty `extensions` ([§7.2](../0001-semantic-capability-ir.md#72-canonical-form)). `all`
  and `any` arguments are sets wherever an expression sits: in conditions, in a state effect's `establishes`, in a
  charge's `applies` (since e0aebba5) and in a claim's `applies`.
- **Serialization** is RFC 8785, and **the digest** is `sha256-` and base64url of the canonical bytes, by Web Crypto.
  A test pins RFC 0001 §11's example digest.

## Validation

The specification is [§7.3](../0001-semantic-capability-ir.md#73-normalization-and-validation).

`validate` maps every schema issue to a code. An `E_` code makes a manifest invalid, and a `W_` code is a warning.

- **Errors:** `E_SCHEMA`, `E_DUPLICATE_ID`, `E_UNRESOLVED`, `E_KEY`, `E_PATH`, `E_TYPE`, `E_DEPTH`,
  `E_ENFORCEMENT_CLAIM`, `E_SOURCE`, `E_BASIS` and `E_KIND`, plus `compose`'s `E_CONFLICT`.
- **Warnings:** `W_OPAQUE`, `W_EFFECTS_UNKNOWN`, `W_NO_AMOUNT`, `W_UNCONFIRMED_ENABLES` and `W_PATH_UNCHECKED`, the
  last for a path into a schema too open to check.
- **Module codes** come from `fromModules`, which RFC 0005 uses: `E_CAPABILITY_DUPLICATE`, `E_CAPABILITY_MANIFEST`,
  `E_CLAIMS_NO_OWNER` and `W_NO_OWNER`.

## The safety rules

The specification is [§8.2](../0001-semantic-capability-ir.md#82-the-rules).

| Rule                                    | How it's held                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. An offer is never authorization      | there's no grant field, strict objects reject one, and authorization is only `any` or `authenticated`                                                                                             |
| 2. Annotations never loosen enforcement | a claim about `kind`, `safe`, `idempotent`, `authorization`, `confirmation`, `effects` or `preconditions` is `E_ENFORCEMENT_CLAIM`, and confirmation has no "not required" value                  |
| 3. A basis needs a matching source      | declared needs the owner, inferred, imported and observed need a tool, verified needs a third party, and the last three need evidence (`E_BASIS`, `E_SOURCE`); only the configured owner declares |
| 4. No confidence numbers                | structural: the only numbers in the schema are a claim quantity's value and a charge's amount, and a test holds that                                                                              |
| 5. Preconditions are enforced           | this package has the manifest half, the conformance kit in `falsify.ts`; enforcement is the runtime's ([runtime.md](./runtime.md#execution))                                                      |

The v0 boundaries ([§8.3](../0001-semantic-capability-ir.md#83-v0-boundaries-the-ir-must-not-paper-over)) are the
runtime's and v0's to keep, so this package has no code for them.

## Authoring

The specification is [§12](../0001-semantic-capability-ir.md#12-authoring-and-the-package-affordancesir-m2).

`defineResource`, `defineCapability`, `definePrincipal`, `defineClaims`, `defineRelations` and `defineManifest`, with
`when` and `guard` for conditions. Paths are checked at the type level against the capability's roots, and a
Standard Schema input is converted to JSON Schema and recorded as `inferred`. `defineManifest` throws on any `E_` code.

## Not built, and divergences

- **Not built:** manifest diffing across releases ([§6.2](../0001-semantic-capability-ir.md#62-stability-across-releases):
  a changed kind, or an id removed without deprecation); a guard language, conditional `outcomes`, namespace ownership
  and signing (all open questions in RFC 0001); full RFC 3986 checking of URIs, which are checked by a regular
  expression only; I-JSON's duplicate-member and lone-surrogate checks.
- **Divergences:** §12.2 describes one invalid fixture per error code, and the invalid cases are inline in
  `validate.test.ts` instead. §13's `Claim` type omits `cites`, which §9 and the code have. Rule 3's `observed` is held as
  a tool source with evidence; the code doesn't check that a runtime made the observation.
