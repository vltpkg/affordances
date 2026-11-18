import { describe, expect, test } from 'vitest'
import { mountWebMcp } from '../src/components/webmcp.tsx'

// #7 (intake's code review): when the page's start changes while the root layout stays mounted, the tools must
// follow it, which a module-level flag prevented. The context below behaves as Chromium 156's measurably
// does (design's probe, 2026-11-18): a second registerTool under a live name rejects with "Duplicate tool name" and
// leaves the first, and aborting the signal a tool was registered with unregisters it, so the name can be reused

type Tool = { name: string; execute: (args: Record<string, unknown>) => Promise<unknown> }
const chromiumLike = () => {
  const live = new Map<string, Tool>()
  return {
    live,
    registerTool: (tool: Tool, options?: { signal?: AbortSignal }) => {
      if (live.has(tool.name))
        return Promise.reject(new DOMException('Duplicate tool name', 'InvalidStateError'))
      live.set(tool.name, tool)
      options?.signal?.addEventListener('abort', () => {
        if (live.get(tool.name) === tool) live.delete(tool.name)
      })
      return Promise.resolve()
    },
  }
}

// the view request a tool sends, as the projection route would receive it
const recorder = () => {
  const urls: string[] = []
  const fetcher = (async (url: string) => {
    urls.push(url)
    return new Response(
      JSON.stringify({
        revision: 'r1',
        policy: 'exhaustive',
        offers: [],
        choiceSets: [],
        order: { by: 'canonical' },
        omitted: { offers: 0, choiceSets: 0, claims: 0, expand: [] },
      }),
      { headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch
  return { urls, fetcher }
}

const preview = { type: 'hosting.project', key: 'proj_preview' }
const made = { type: 'hosting.project', key: 'proj_0123' }

describe("WebMCP's registration follows the page's start", () => {
  test('a changed start re-registers the tools, and they view from the new start', async () => {
    const context = chromiumLike()
    const { urls, fetcher } = recorder()
    // React's order when a prop the effect depends on changes: the effect, its cleanup, the effect again
    const cleanup = mountWebMcp(preview, { context, fetcher })
    cleanup()
    mountWebMcp(made, { context, fetcher })
    await context.live.get('project')!.execute({})
    expect(urls.at(-1)).toContain(`start=${encodeURIComponent('hosting.project:proj_0123')}`)
  })

  test("development mode's doubled effect leaves one live set of tools, from the same start", async () => {
    const context = chromiumLike()
    const { urls, fetcher } = recorder()
    mountWebMcp(made, { context, fetcher })()
    mountWebMcp(made, { context, fetcher })
    expect([...context.live.keys()].toSorted()).toEqual(
      ['execute', 'expand', 'inspect', 'project'].toSorted(),
    )
    await context.live.get('project')!.execute({})
    expect(urls.at(-1)).toContain(`start=${encodeURIComponent('hosting.project:proj_0123')}`)
  })
})
