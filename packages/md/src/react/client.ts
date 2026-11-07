import { useRef } from 'react'
import { mdPath } from '../path.ts'

export { mdPath }

export type PageMarkdownOptions = {
  // the fetch's credentials; 'same-origin' by default, so what gets copied is the page as the person sees it (and a
  // protected preview's cookie is sent). 'omit' copies the public page an agent reading the url would get
  credentials?: RequestCredentials
}

// the twin is this site's page: //evil.test/x or https://evil.test/x would copy another site's response as if it
// were the page. outside a browser, any origin stands in for the page's
const sameOrigin = (url: string) => {
  const origin = globalThis.location?.origin ?? 'https://same.invalid'
  try {
    return new URL(url, origin).origin === origin
  } catch {
    return false
  }
}

// a page's markdown twin, for a Copy Page button. call preload on hover and focus, so a click only awaits an
// already-settled promise: Safari drops clipboard writes that happen too long after the click. a failed fetch
// is forgotten, so the next hover or click retries instead of reusing it
export const usePageMarkdown = (
  path: string,
  { credentials = 'same-origin' }: PageMarkdownOptions = {},
) => {
  const cached = useRef<{ path: string; markdown: Promise<string> } | null>(null)
  const load = (): Promise<string> => {
    if (cached.current?.path === path) return cached.current.markdown
    const url = mdPath(path)
    const markdown = (
      sameOrigin(url)
        ? fetch(url, { credentials })
        : Promise.reject(new Error(`${url}: not this site's page`))
    )
      .then((response) => {
        if (!response.ok) throw new Error(`${url}: ${response.status}`)
        // a login page or a file passed through is not the page's markdown
        if (!response.headers.get('content-type')?.includes('text/markdown'))
          throw new Error(`${url}: not markdown`)
        return response.text()
      })
      .catch((error: unknown) => {
        if (cached.current?.markdown === markdown) cached.current = null
        throw error
      })
    cached.current = { path, markdown }
    return markdown
  }
  // the click reports a failure; a failed preload has nobody to tell
  const preload = () => void load().catch(() => {})
  return { load, preload }
}

// claude-cli://open caps q at 5,000 characters; the web apps take long ones, but a prompt that links the
// markdown twin instead of pasting it stays short anyway
export const OPEN_IN_MAX = 5000

// cut at the cap, but never inside a surrogate pair, which encodeURIComponent would throw on
const capped = (prompt: string) => prompt.slice(0, OPEN_IN_MAX).replace(/[\uD800-\uDBFF]$/, '')

// "Open in" links that start a chat with a prompt. claudeCode gets its own prompt when given: claude-cli://open
// starts in the home directory, so it may need to ask which project to work in
export const openInHrefs = ({
  prompt,
  claudeCode = prompt,
}: {
  prompt: string
  claudeCode?: string
}) => ({
  claude: `https://claude.ai/new?q=${encodeURIComponent(prompt)}`,
  chatgpt: `https://chatgpt.com/?hints=search&q=${encodeURIComponent(prompt)}`,
  claudeCode: `claude-cli://open?q=${encodeURIComponent(capped(claudeCode))}`,
})
