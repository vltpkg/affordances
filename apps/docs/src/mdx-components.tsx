import { isValidElement } from 'react'
import Link from 'next/link'
import type { MDXComponents } from 'mdx/types'
import { cn } from 'cn'
import { CodeBlock } from '@affordances/ui/components/code-block'
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@affordances/ui/components/table'
import { Heading } from '@/components/heading'
import { TypeTable } from '@/components/type-table'
import { BenchHistory, BenchResults } from '@/components/bench-results'
import { Install, Run } from '@/components/command'
import { SetupPrompt } from '@/components/setup-prompt'

type Children = { children?: React.ReactNode }
// a fence arrives as <pre><code className="language-x" title?>text</code></pre> (see rehypeCodeMeta in lib/source.ts)
type FenceProps = { children?: string; className?: string; title?: string }

const Pre = ({ children }: Children) => {
  const {
    children: code = '',
    className,
    title,
  }: FenceProps = isValidElement(children) ? (children.props as FenceProps) : {}
  return (
    <CodeBlock lang={className?.replace('language-', '')} title={title} className="w-full">
      {code}
    </CodeBlock>
  )
}

export const components: MDXComponents = {
  pre: Pre,
  // content links are absolute; in-site ones navigate client-side
  a: ({ ref: _ref, href = '', children, ...props }) =>
    href.startsWith('/') ? (
      <Link href={href} {...props}>
        {children}
      </Link>
    ) : (
      <a href={href} {...props}>
        {children}
      </a>
    ),
  // the page renders its title; an included file's own h1 (spec.md) would repeat it
  h1: () => null,
  h2: ({ ref: _ref, ...props }) => <Heading as="h2" {...props} />,
  h3: ({ ref: _ref, ...props }) => <Heading as="h3" {...props} />,
  h4: ({ ref: _ref, ...props }) => <Heading as="h4" {...props} />,
  table: ({ ref: _ref, ...props }) => <TypeTable {...props} />,
  thead: TableHeader,
  tbody: TableBody,
  tr: ({ ref: _ref, className, ...props }) => (
    <TableRow className={cn('hover:bg-transparent', className)} {...props} />
  ),
  th: ({ ref: _ref, className, ...props }) => (
    <TableHead className={cn('px-3 text-xs font-medium', className)} {...props} />
  ),
  // docs cells hold sentences, so they wrap (ui/table assumes one-line data) and rows top-align;
  // inline code reads worse broken than scrolled, and the last (description) column keeps some width
  td: ({ ref: _ref, className, ...props }) => (
    <TableCell
      className={cn(
        'px-3 py-2.5 align-top text-[0.8125rem] leading-relaxed whitespace-normal last:min-w-48 [&_code]:whitespace-nowrap',
        className,
      )}
      {...props}
    />
  ),
  BenchHistory,
  BenchResults,
  Install,
  Run,
  SetupPrompt,
}
