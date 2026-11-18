// RFC 0001 §7.2's canonical order: by UTF-16 code unit, as ir's canonical.ts sorts, never by locale, so the same
// sources give the same bytes on every machine. Its own module, so the evaluator's child can use it without codegen
export const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
