import { createElement, type ReactNode } from 'react'

// every marker is <afford-md>: a custom element is valid in phrasing and flow content, and display: contents
// keeps it out of layout. server-safe (no hooks, no 'use client'), so it ships no client JS
const marker = (mode: string, props: Record<string, unknown>, children: ReactNode) =>
  createElement(
    'afford-md',
    { 'data-mode': mode, style: { display: 'contents' }, ...props },
    children,
  )

// left out of the markdown: promos, chrome inside main, third-party widgets
export const AgentSkip = ({ children }: { children?: ReactNode }) => marker('skip', {}, children)

// when present, only these subtrees (in document order) become the markdown
export const AgentMain = ({ children }: { children?: ReactNode }) => marker('main', {}, children)

// in the markdown, hidden from people. it must say what the page already shows people: not for cloaking
export const AgentOnly = ({ children }: { children?: ReactNode }) =>
  // hidden, not display: contents, which would override it and show it
  createElement('afford-md', { 'data-mode': 'only', hidden: true }, children)

// people see children; the markdown gets `md`, verbatim (inline, or as its own block with `block`)
export const AgentText = ({
  md,
  block,
  children,
}: {
  md: string
  block?: boolean
  children?: ReactNode
}) => marker('text', { 'data-md': md, ...(block && { 'data-block': '' }) }, children)
