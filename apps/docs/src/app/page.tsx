import type { Metadata } from 'next'
import Link from 'next/link'
import { AffordProvider } from '@afford/react'
import { Button } from '@afford/ui/components/button'
import { CodeBlock } from '@afford/ui/components/code-block'
import { Wordmark } from '@afford/ui/components/wordmark'
import { CommandCopy } from '@/components/command-copy'
import { Navbar } from '@/components/navbar'
import { TwoViews } from '@/components/two-views'
import { benchResults } from '@/lib/bench'
import { description, siteUrl } from '@/lib/site-url'

export const metadata: Metadata = {
  title: { absolute: 'Afford: make every page agent-operable' },
  description,
  alternates: { canonical: '/' },
}

const action = `'use server'

import { z } from 'zod'
import { defineAction } from '@/lib/afford'
import { inStock } from '@/lib/catalog'
import * as cart from '@/lib/cart'
import product from './state'

export const addToCart = defineAction({
  name: 'addToCart',
  description: 'Add a product variant to the cart',
  input: z.object({
    sku: z.string(),
    quantity: z.number().int().min(1).optional(),
  }),
  state: product,
  expose: 'session',
  requires: 'The variant is in stock',
  guard: ({ input, state }) =>
    !input || inStock(state.product, input.sku) || 'Sold out',
  effects: ['cart'],
  run: (input, ctx) => cart.add(ctx.session!.id, input),
  message: ({ input }) => \`Added \${input.sku} to your cart\`,
})`

const concepts = [
  {
    term: 'Actions',
    body: (
      <>
        <code>defineAction</code> in a route’s <code>actions.ts</code> names something a person can
        do on the page, with a schema for its input. The export is a server action your components
        call as usual.
      </>
    ),
  },
  {
    term: 'State',
    body: (
      <>
        <code>state.ts</code> returns what the page shows, as entities. It loads with the caller’s
        session, so a graph never holds more than the HTML would show the same person.
      </>
    ),
  },
  {
    term: 'Deltas',
    body: (
      <>
        Calling an action answers with what changed: the entities in its <code>effects</code>, its
        output, actions that became available or went away, and where to go next.
      </>
    ),
  },
  {
    term: 'Expose',
    body: (
      <>
        Nothing is reachable by agents until an action sets <code>expose</code> to{' '}
        <code>public</code>, <code>session</code>, or <code>confirm</code>.
      </>
    ),
  },
]

const surfaces = [
  {
    term: 'Server action',
    detail: 'For your UI',
    body: (
      <>
        The function <code>defineAction</code> returns. Forms, buttons, and{' '}
        <code>useActionState</code> call it directly.
      </>
    ),
  },
  {
    term: 'HTTP',
    detail: 'For headless agents',
    body: (
      <>
        <code>GET</code> the page with <code>Accept: application/vnd.afford+json</code> for its
        graph; <code>POST</code> to call an action.
      </>
    ),
  },
  {
    term: 'WebMCP',
    detail: 'For browser agents',
    body: (
      <>
        <code>AffordProvider</code> registers the page’s available actions as tools. They POST to
        the same endpoint, so they pass the same checks.
      </>
    ),
  },
  {
    term: 'MCP',
    detail: 'For Claude, Cursor, and others',
    body: (
      <>
        <code>npx @afford/mcp &lt;url&gt;</code> serves any Afford site as two tools: open a page,
        call an action.
      </>
    ),
  },
]

const security = [
  {
    term: 'Default deny',
    body: (
      <>
        An action without <code>expose</code> isn’t in any graph, and calling it answers{' '}
        <code>not_found</code>.
      </>
    ),
  },
  {
    term: 'Confirm',
    body: (
      <>
        <code>confirm</code> actions answer with a summary first, and run only when the call is
        repeated with <code>confirm: true</code>.
      </>
    ),
  },
  {
    term: 'Origin',
    body: 'A call that carries cookies must come from the site’s own Origin. Bearer tokens are exempt.',
  },
  {
    term: 'Order',
    body: 'Every agent call is validated, then guarded, then run. The action never sees invalid input.',
  },
]

const Section = ({
  title,
  href,
  children,
}: {
  title: string
  href?: string
  children: React.ReactNode
}) => (
  <section className="grid gap-x-12 gap-y-6 border-t py-16 md:grid-cols-[12rem_minmax(0,1fr)] md:py-20">
    <div>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {href && (
        <Link
          href={href}
          className="mt-1 inline-block text-sm text-muted-foreground underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline"
        >
          Read more
        </Link>
      )}
    </div>
    <div className="max-w-[65ch]">{children}</div>
  </section>
)

const List = ({ items }: { items: { term: string; detail?: string; body: React.ReactNode }[] }) => (
  <dl className="grid gap-x-8 gap-y-8 sm:grid-cols-2">
    {items.map(({ term, detail, body }) => (
      <div key={term}>
        <dt className="font-medium">
          {term}
          {detail && <span className="ml-2 font-normal text-muted-foreground">{detail}</span>}
        </dt>
        <dd className="mt-2 text-sm leading-relaxed text-pretty text-muted-foreground [&_code]:font-mono [&_code]:text-[0.9em] [&_code]:text-foreground">
          {body}
        </dd>
      </div>
    ))}
  </dl>
)

const Home = () => {
  const bench = benchResults()
  return (
    // the docs root has a graph of its own: searchDocs and getPage, registered as WebMCP tools here
    <AffordProvider path="/">
      <Navbar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 md:px-8">
        <section className="pt-12 pb-10 md:pt-16">
          <h1 className="text-4xl font-semibold tracking-tighter text-balance sm:text-5xl sm:leading-[1.05]">
            Make every page agent-operable
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-pretty text-muted-foreground">
            Afford gives each page of a Next.js app a JSON view for agents, at the same URL and with
            the same session. Define an action once, and it runs as a server action, an HTTP
            endpoint, a WebMCP tool, and an MCP tool.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button
              render={<Link href="/quickstart" />}
              nativeButton={false}
              className="h-9 px-4 text-sm"
            >
              Quickstart
            </Button>
            <CommandCopy command="npx @afford/next init" />
          </div>
        </section>

        <section className="grid items-start gap-4 pb-16 md:pb-24 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <CodeBlock lang="ts" title="app/products/[slug]/actions.ts">
            {action}
          </CodeBlock>
          {/* on phones the live demo leads; the code it runs follows */}
          <div className="max-lg:order-first">
            <TwoViews />
          </div>
        </section>

        <Section title="How it works" href="/concepts/actions">
          <List items={concepts} />
        </Section>

        <Section title="Four surfaces, one definition" href="/react">
          <p className="mb-8 text-pretty text-muted-foreground">
            The same export reaches every kind of caller. Agents all go through one handler, so they
            get the same validation, guards, and confirmation.
          </p>
          <List items={surfaces} />
        </Section>

        <Section title="Security" href="/security">
          <List items={security} />
        </Section>

        <Section title="Quickstart" href="/quickstart">
          <p className="mb-6 text-pretty text-muted-foreground">
            In a Next.js 16 app, install the packages and run{' '}
            <code className="font-mono text-[0.9em] text-foreground">init</code>. It writes the
            route handler, wraps your config, and generates the manifest. Then add an{' '}
            <code className="font-mono text-[0.9em] text-foreground">actions.ts</code> next to a
            page.
          </p>
          <CodeBlock lang="bash">
            {'npm install @afford/next @afford/react zod\nnpx @afford/next init'}
          </CodeBlock>
          <p className="mt-8 mb-6 text-pretty text-muted-foreground">
            This site runs on Afford too. Ask it for its own graph:
          </p>
          <CodeBlock lang="bash">
            {`curl -H 'Accept: application/vnd.afford+json' ${siteUrl.href}`}
          </CodeBlock>
        </Section>

        <Section title="Bench" href="/bench">
          <p className="text-pretty text-muted-foreground">
            {bench.length
              ? `${bench.length} committed bench runs compare a screenshot-driven agent with an Afford agent on the same tasks.`
              : 'Results will appear here after the first bench run is committed.'}
          </p>
        </Section>
      </main>
      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 border-t px-4 py-8 text-sm text-muted-foreground md:px-8">
        <Wordmark className="text-foreground" />
        <Link href="/why" className="transition-colors duration-150 hover:text-foreground">
          Docs
        </Link>
        <Link href="/protocol" className="transition-colors duration-150 hover:text-foreground">
          Protocol
        </Link>
        <Link
          href="/llms.txt"
          prefetch={false}
          className="transition-colors duration-150 hover:text-foreground"
        >
          llms.txt
        </Link>
      </footer>
    </AffordProvider>
  )
}

export default Home
