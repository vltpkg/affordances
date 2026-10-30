import { Fragment } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { createHighlighter } from 'shiki'
import { CodeCard } from '@affordances/ui/components/code-card'

// anything else renders as plain text
const langs = ['ts', 'tsx', 'js', 'json', 'bash', 'markdown']
const themes = { light: 'github-light', dark: 'vesper' }
// one highlighter per server process; highlighting happens here, so no shiki ships to the browser
const highlighter = createHighlighter({ themes: Object.values(themes), langs })

export type CodeSource = {
  code: string
  lang?: string
  title?: string
}

// a tab for CodeCard: the code without its trailing newline, and shiki's tokens for it. `properties` go on
// the <code> (hast names: { dataPm: 'npm' } renders data-pm="npm")
export const highlight = async (
  { code: raw, lang = 'text', title }: CodeSource,
  properties: Record<string, string> = {},
) => {
  const code = raw.replace(/\n$/, '')
  const shiki = await highlighter
  // no default colour: tokens carry --shiki-light / --shiki-dark, CodeCard picks one per theme
  const [pre] = shiki.codeToHast(code, {
    lang: shiki.getLoadedLanguages().includes(lang) ? lang : 'text',
    themes,
    defaultColor: false,
  }).children
  // the language rides on <code> as language-*, the html convention markdown converters (@affordances/md) read
  for (const child of pre?.type === 'element' ? pre.children : [])
    if (child.type === 'element' && child.tagName === 'code')
      Object.assign(child.properties, properties, {
        className: [...[child.properties.className ?? []].flat(), `language-${lang}`] as string[],
      })
  // CodeCard owns the <pre>; keep shiki's <code> and its token spans
  const content = toJsxRuntime(
    { type: 'root', children: pre?.type === 'element' ? pre.children : [] },
    { Fragment, jsx, jsxs },
  )
  return { code, lang, title, content }
}

// shiki's tokenizer reads Date.now(), which cacheComponents rejects in an uncached prerender, hence "use cache"
export const CodeBlock = async ({
  children,
  className,
  ...source
}: Omit<CodeSource, 'code'> & { children: string; className?: string }) => {
  'use cache'
  return <CodeCard tabs={[await highlight({ code: children, ...source })]} className={className} />
}

// several blocks as one card, one tab each
export const CodeTabs = async ({ tabs }: { tabs: CodeSource[] }) => {
  'use cache'
  return <CodeCard tabs={await Promise.all(tabs.map((tab) => highlight(tab)))} />
}
