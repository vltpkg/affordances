import { Delta, Graph, MEDIA_TYPE, SiteIndex, WELL_KNOWN_PATH } from '@afford/protocol'

export type ClientOptions = {
  // sent as Authorization: Bearer; without one, the client keeps the site's cookies like a browser would
  token?: string
  fetch?: typeof fetch
}

// an agent's view of one Afford site: open a page for its graph, call an action for a delta
export const createClient = (site: string | URL, options: ClientOptions = {}) => {
  const base = new URL(site)
  const fetcher = options.fetch ?? fetch
  const cookies = new Map<string, string>()

  const request = async (path: string, init: RequestInit = {}) => {
    const url = new URL(path, base)
    if (url.origin !== base.origin) throw new Error(`${url.href} is not on ${base.origin}`)
    const headers = new Headers(init.headers)
    headers.set('accept', MEDIA_TYPE)
    if (options.token) headers.set('authorization', `Bearer ${options.token}`)
    else if (cookies.size) {
      headers.set('cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '))
      // cookie-authenticated calls must name the site as their origin
      headers.set('origin', base.origin)
    }
    const response = await fetcher(url, { ...init, headers, redirect: 'manual' })
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const [pair = ''] = line.split(';')
      const at = pair.indexOf('=')
      if (at > 0) cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim())
    }
    return { url, response }
  }

  return {
    index: async () => SiteIndex.parse(await (await request(WELL_KNOWN_PATH)).response.json()),

    open: async (path: string) => {
      const { url, response } = await request(path)
      if (!response.headers.get('content-type')?.includes(MEDIA_TYPE))
        throw new Error(`${url.pathname} has no Afford graph (${response.status})`)
      const body = await response.json()
      // an error delta (e.g. not_found) instead of a graph
      if ('ok' in body)
        throw new Error(Delta.parse(body).error?.message ?? `${url.pathname} failed`)
      return Graph.parse(body)
    },

    call: async (path: string, action: string, input?: unknown, confirm?: boolean) => {
      const { response } = await request(path, {
        method: 'POST',
        headers: { 'content-type': MEDIA_TYPE },
        body: JSON.stringify({ action, input, ...(confirm && { confirm: true }) }),
      })
      return Delta.parse(await response.json())
    },
  }
}

export type AffordClient = ReturnType<typeof createClient>
