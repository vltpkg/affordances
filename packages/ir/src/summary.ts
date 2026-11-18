import { canonicalJson } from './canonical.ts'
import { evaluate, resolvePath, type Context } from './evaluate.ts'
import type { Effect, FinancialEffect } from './schema.ts'

// RFC 0001 §3.2: a confirmation summary's template, filled from a context. Strings as written, other values as their
// RFC 8785 text, an unresolved path as `unknown`, and {{ }} for literal braces. A path resolves as conditions resolve
// it, own keys only; a key holding null renders null. One renderer, so a runtime and an authoring layer show a person
// the same sentence
export const renderSummary = (template: string, context: Context): string =>
  template.replaceAll(/\{\{|\}\}|\{([^{}]*)\}/g, (whole, path: string | undefined) => {
    if (path === undefined) return whole[0]!
    const resolved = resolvePath(path, context)
    if (resolved.kind === 'value')
      return typeof resolved.value === 'string' ? resolved.value : canonicalJson(resolved.value)
    return resolved.kind === 'absent' && resolved.null ? 'null' : 'unknown'
  })

// the paths a summary's template renders, as renderSummary reads them: {path}, never a {{ }} literal (RFC 0002 §6.6
// keeps every target attribute a summary renders in a choice set's comparison)
export const summaryPaths = (template: string): string[] =>
  [...template.matchAll(/\{\{|\}\}|\{([^{}]*)\}/g)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  )

// RFC 0001 §3.2 and §4: a summary ends by listing every charge its financial effects make, each
// with its amount, in declaration order and never totalled. A charge whose applies is false isn't made, so it isn't
// listed; one whose applies is unknown is listed as one that may apply, since a charge is never hidden. An amount that
// can't be resolved says so
const chargeOf = (e: FinancialEffect, context: Context): string | undefined => {
  const applies = e.applies === undefined ? true : evaluate(e.applies, context)
  if (applies === false) return
  let amount = 'amount unknown'
  if (e.amount) {
    const v =
      typeof e.amount.value === 'number'
        ? { kind: 'value' as const, value: e.amount.value }
        : resolvePath(e.amount.value, context)
    if (v.kind === 'value' && typeof v.value === 'number' && Number.isFinite(v.value))
      amount = `${canonicalJson(v.value)} ${e.amount.currency}`
  }
  const when = e.amount?.per === 'month' ? ' a month' : ' now'
  const terms =
    e.reversibility === 'irreversible' && e.amount?.per !== 'month'
      ? ', not refunded'
      : e.reversibility === 'compensable'
        ? ', until undone'
        : ''
  return `${amount === 'amount unknown' ? amount : amount + when}${terms}${applies === true ? '' : ' (may apply)'}`
}

/** Every charge the financial effects make, each with its amount, in declaration order: what a summary lists. */
export const chargesOf = (effects: readonly Effect[] | undefined, context: Context): string[] =>
  (effects ?? [])
    .filter((e): e is FinancialEffect => e.category === 'financial')
    .flatMap((e) => chargeOf(e, context) ?? [])

export const renderConfirmation = (
  template: string,
  effects: readonly Effect[] | undefined,
  context: Context,
): string => {
  const summary = renderSummary(template, context)
  const charges = chargesOf(effects, context)
  return charges.length ? `${summary.replace(/\.$/, '')}. Charges: ${charges.join('; ')}` : summary
}
