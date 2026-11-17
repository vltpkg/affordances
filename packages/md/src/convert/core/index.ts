import { emit } from './emit.ts'
import { parse } from './parse.ts'
import type { Options, Result } from './types.ts'

export type { Document, Element, Head, Node, Options, Result } from './types.ts'
export { emit } from './emit.ts'
export { parse } from './parse.ts'

// html to markdown in two passes over the page and none over a generic tree: a skip-scanning parser that builds only
// what can be content, and an emitter that writes markdown straight from that. the output aims to be
// @affordances/md's, byte for byte
export const htmlToMarkdown = (html: string, options: Options = {}): Result =>
  emit(parse(html), options)
