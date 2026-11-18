// RFC 0005 §3's diagnostics: one catalog the capability compiler reports from and the authoring side documents, so a
// code, its meaning and its fix are written once. Each names what to declare, and where

/** @experimental A diagnostic's code (RFC 0005 §3). */
export type DiagnosticCode = keyof typeof CATALOG

/** @experimental One reported diagnostic: the code, and where it was found. */
export type Diagnostic = {
  // a catalog code, or one relayed from the IR's validate (E_PATH, E_SCHEMA …), which `format` renders by its message
  code: DiagnosticCode | `E_${string}` | `W_${string}`
  // a relayed code's own message; a catalog code's meaning comes from the catalog
  message?: string
  file: string
  line?: number
  // what it's about: the action, capability, construct or field it names
  subject?: string
  // what to do here, after the catalog's general fix: for W_NO_NAMESPACE, the line to paste
  detail?: string
}

type Entry = {
  // warnings don't fail a build; errors do. A warning marked strict is an error in strict mode
  severity: 'warning' | 'error'
  strict?: true
  means: string
  fix: string
}

/** @experimental Every diagnostic RFC 0005 defines, with what it means and how to fix it. */
export const CATALOG = {
  W_NO_ID: {
    severity: 'warning',
    strict: true,
    means: 'An action has no `id` literal and no `capability`, so it has no capability id',
    fix: 'Write the suggested `id` on its defineAction, or run the id codemod to write every suggestion in',
  },
  W_INPUT_OPAQUE: {
    severity: 'warning',
    strict: true,
    means:
      "The input schema reaches beyond schema-library imports and consts, so it can't be read without running the app",
    fix: 'Bind the action to a capability in capabilities.ts, whose input schema is declared',
  },
  W_INPUT_LOSSY: {
    severity: 'warning',
    strict: true,
    means:
      "The input schema converts, but a refinement or transform can't be expressed in JSON Schema, so the runtime would validate it more loosely than the app does",
    fix: 'Declare the input in a capability, or express the rule as a declarative precondition',
  },
  W_SUMMARY_GENERIC: {
    severity: 'warning',
    means: "A confirm action's summary is a function, so its confirmation summary is generic",
    fix: 'Declare `confirmation.summary` as a template on its capability',
  },
  W_OPAQUE: {
    severity: 'warning',
    means: "A v0 guard is code, so what it checks can't be evaluated outside the app",
    fix: 'Declare what it checks as preconditions with `when.*`, and keep the guard for anything only code can check',
  },
  W_EFFECTS_UNKNOWN: {
    severity: 'warning',
    means: "No effects are declared, so an agent can't tell what the action changes or charges",
    fix: "Declare the capability's effects: what it changes, and what it charges",
  },
  W_NO_AMOUNT: {
    severity: 'warning',
    means: 'A financial effect has no amount, so confirmation summaries say "amount unknown"',
    fix: "Give the effect an `amount`, such as `{ value: 'target.priceUsd', currency: 'USD' }`",
  },
  W_ATTRIBUTES_UNKNOWN: {
    severity: 'warning',
    means: 'A resource type was inferred from a route segment, with no attributes declared',
    fix: 'Declare it with defineResource, under the same id, with its attributes',
  },
  W_NO_NAMESPACE: {
    severity: 'warning',
    means:
      "No namespace is configured, so no capability manifest is written. A v0 app's own manifest is unaffected",
    fix: 'Pass `namespace`, an absolute URI such as `https://acme.example/capabilities`, to withAffordances',
  },
  W_NO_OWNER: {
    severity: 'warning',
    means: 'No owner is configured, so no field can be `declared`',
    fix: 'Pass `owner: { id, name }` to withAffordances',
  },
  W_NOT_LITERAL: {
    severity: 'warning',
    means:
      "A field an extraction rule reads isn't a literal, so it's read as absent, never guessed; a non-literal `name` skips the action",
    fix: 'Write the field as a string or boolean literal, or bind the action to a capability',
  },
  W_SEGMENT_CONFLICT: {
    severity: 'warning',
    means:
      'Two routes infer one resource type from their segments with different keys, so neither key is used and none of their actions gets that target',
    fix: 'Use one parameter name for the segment in every route, or declare the resource with defineResource',
  },
  E_CAPABILITY_IMPORT: {
    severity: 'error',
    means: 'A capability module imports application code',
    fix: 'Import only the IR, a schema library and other capability modules; move what it needs into one of those',
  },
  E_CAPABILITY_SYNTAX: {
    severity: 'error',
    means:
      "A capability module or input slice uses syntax Node can't erase, such as an enum or a namespace",
    fix: 'Use a const object and `z.enum` in place of an enum, and plain modules in place of a namespace',
  },
  E_CAPABILITY_AMBIENT: {
    severity: 'error',
    means:
      "A capability module uses import(), require, process, Date, Math.random, crypto, fetch or a timer, so the manifest would depend on the machine or the moment it's built on",
    fix: 'Write the value as a literal; a capability module is data',
  },
  E_CAPABILITY_NONDETERMINISTIC: {
    severity: 'error',
    means:
      'Two evaluations, in fresh processes with an empty environment, gave different manifests',
    fix: 'Find what varies between runs (the first difference is shown) and write it as a literal',
  },
  E_CAPABILITY_DUPLICATE: {
    severity: 'error',
    means: 'Two capability modules define one id differently',
    fix: 'Keep one definition, and import it where the other module needs it',
  },
  E_CAPABILITY_MANIFEST: {
    severity: 'error',
    means:
      "A defineManifest export is used whole, and a definition exported beside it isn't in it, so it would be left out",
    fix: 'Add it to the defineManifest, or drop the defineManifest and export each definition',
  },
  E_CLAIMS_NO_OWNER: {
    severity: 'error',
    means:
      "A capability module makes claims, and no owner is configured; a claim is the owner's assertion",
    fix: 'Pass `owner: { id, name }` to withAffordances',
  },
  E_BOUND_REDEFINES: {
    severity: 'error',
    means: 'A capability-bound action also sets a v0 field its capability defines',
    fix: 'Remove the field from defineAction; the capability is the one place it lives',
  },
} as const satisfies Record<string, Entry>

// a code the catalog doesn't hold, relayed from the IR: its prefix says its severity, and its own message says the rest
const entryOf = (code: Diagnostic['code']): Entry =>
  Object.hasOwn(CATALOG, code)
    ? CATALOG[code as DiagnosticCode]
    : { severity: code.startsWith('E_') ? 'error' : 'warning', means: '', fix: '' }

/** @experimental Whether a diagnostic fails the build: an error always, a strict warning in strict mode. */
export const fails = (code: Diagnostic['code'], strict = false): boolean => {
  const entry = entryOf(code)
  return entry.severity === 'error' || (strict && entry.strict === true)
}

/** @experimental One diagnostic as a line: where, the code, what it means and how to fix it. */
export const format = (d: Diagnostic, strict = false): string => {
  const entry = entryOf(d.code)
  const where = d.line === undefined ? d.file : `${d.file}:${d.line}`
  const level = fails(d.code, strict) ? 'error' : 'warning'
  const means = entry.means || d.message || 'No description'
  const fix = entry.fix ? ` Fix: ${entry.fix}.` : ''
  return `${where} ${level} ${d.code}${d.subject ? ` (${d.subject})` : ''}: ${means}.${fix}${d.detail ? ` Here: ${d.detail}.` : ''}`
}
