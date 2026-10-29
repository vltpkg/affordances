import { Effect } from 'effect'
import { createClient } from '@affordances/mcp'
import type { Delta, Graph } from '@affordances/protocol'
import { BadInput, NoGraph, Unreachable } from './errors.ts'

// ponytail: ~4 characters per token, a rule of thumb across Claude and GPT tokenizers; count with a real
// tokenizer if budgets need to be exact
export const estimateTokens = (text: string) => Math.ceil(text.length / 4)

// a page url → the site's origin and the path an agent asks for
const target = (url: string) => {
  const parsed = new URL(url.includes('://') ? url : `http://${url}`)
  return { site: parsed.origin, page: `${parsed.pathname}${parsed.search}` }
}

// a fetch that failed outright (refused, dns) is Unreachable; anything the site answered is about the graph
const reach = <A>(url: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) => {
      const cause = (error as { cause?: { code?: string } }).cause
      return error instanceof TypeError && cause?.code
        ? new Unreachable({ url, reason: cause.code })
        : new NoGraph({ url, reason: (error as Error).message })
    },
  })

// what an agent sees at a url: the graph, and roughly what it costs to read
export const open = (url: string, token?: string) =>
  Effect.gen(function* () {
    const { site, page } = target(url)
    const graph: Graph = yield* reach(url, () => createClient(site, { token }).open(page))
    return { url, graph, tokens: estimateTokens(JSON.stringify(graph)) }
  })

// call an action the way an agent does: same endpoint, same checks, a delta back
export const call = (
  url: string,
  action: string,
  options: { input?: string; confirm?: boolean; token?: string },
) =>
  Effect.gen(function* () {
    const { site, page } = target(url)
    const input =
      options.input === undefined
        ? undefined
        : yield* Effect.try({
            try: () => JSON.parse(options.input!) as unknown,
            catch: (error) => new BadInput({ reason: (error as Error).message }),
          })
    const delta: Delta = yield* reach(url, () =>
      createClient(site, { token: options.token }).call(page, action, input, options.confirm),
    )
    return { url, action, delta }
  })
