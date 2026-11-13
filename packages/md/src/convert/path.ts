// which converter a page takes. md-core (./core) by default; the tree pipeline (hast) for custom handlers and a
// function extract, and for any page md-core declines, before it writes anything. internal: for the tests and the
// bench, never an option or an environment variable a deployment could set
export type Path = 'hast' | 'core' | 'strict'

// 'core' converts as the default does; 'strict' does too, but a decline throws instead of taking the tree pipeline,
// unless it's one of the declines allowed
let forced: Path | undefined
let allowed = new Set<string>()
export const forcePath = (path: Path | undefined, allow: string[] = []) => {
  forced = path
  allowed = new Set(allow)
}
export const forcedPath = () => forced

// how many pages md-core declined, by why, since the last reset
export const declines = new Map<string, number>()

// md-core can't write this page as the tree pipeline would
export class Declined extends Error {
  readonly why: string
  constructor(why: string) {
    super(`md-core declined the page (${why})`)
    this.name = 'Declined'
    this.why = why
  }
}
export const declined = (why: string) => {
  declines.set(why, (declines.get(why) ?? 0) + 1)
  if (forced === 'strict' && !allowed.has(why)) throw new Declined(why)
}
