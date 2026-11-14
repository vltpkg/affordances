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
  fired.push(why)
  if (forced === 'strict' && !allowed.has(why)) throw new Declined(why)
}

// the declines that only keep md-core's markdown byte for byte the tree pipeline's: what md-core writes there instead
// shows nothing hidden, no value, no fill, no marker. if the tree pipeline then throws on the page, md-core's own
// markdown is the answer. every other reason (and any new one, until it's tagged here) keeps the tree pipeline's error
export const PARITY = new Set(['strikethrough and list', 'text split in a nobr'])
// and the rest, each tagged: what md-core declines there guards hidden text, values, fills, markers or the flight
// check, or can't be shown not to. a test fails on any reason in neither list
export const SECURITY = new Set([
  'streamed',
  'streamed boundary in svg',
  'streamed segment in svg',
  'streamed segment md-core keeps no text in',
  'streamed instruction in svg',
  'streamed segment holds its own template',
  'main inside what prune changes',
  'form in a link or strikethrough',
  'form in a table cell',
  'selector tag name',
  'slot inside <a>',
  "slot inside an element md-core can't judge",
  'slot holding a value',
  'slot inside <table>',
  'slot inside a tablist',
  'main marker inside what prune changes',
  'shown panel inside what prune changes',
  'shown panel prune changes',
  "shown panel headed by a tab md-core can't place",
])
// the reasons md-core declined the page being read, as they fire
let fired: string[] = []
export const takeFired = () => {
  const was = fired
  fired = []
  return was
}
// whether every reason a page was declined for is parity's alone
export const parityOnly = (reasons: string[]) =>
  reasons.length > 0 && reasons.every((why) => PARITY.has(why))
