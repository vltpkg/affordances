import type { Metadata } from 'next'
import { Fragment, Suspense } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AgentMain, AgentSkip } from '@affordances/md/react'
import { mdAlternate } from '@affordances/md/next'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@affordances/ui/components/breadcrumb'
import { breadcrumbs, source } from '@/lib/source'
import { description as siteDescription } from '@/lib/site-url'
import { components } from '@/mdx-components'
import { Toc, TocBar } from '@/components/toc'
import { PageNav } from '@/components/page-nav'
import { CopyPage } from '@/components/copy-page'
import { TextSelection } from '@/components/text-selection'
import { ScrollToTop } from '@/components/scroll-to-top'

export const generateStaticParams = () => source.generateParams()

export const generateMetadata = async ({
  params,
}: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> => {
  const page = source.getPage((await params).slug)
  if (!page) notFound()
  const { title } = page.data
  const description = page.data.description ?? siteDescription
  const image = { url: `/og${page.url}`, width: 1200, height: 630, alt: title }
  return {
    title,
    description,
    // the markdown twin at /<page>.md, served by @affordances/md
    alternates: { canonical: page.url, ...mdAlternate(page.url) },
    openGraph: { type: 'article', url: page.url, title, description, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  }
}

// the protocol page includes spec.md, so that's the file to edit; the API reference is generated from the
// packages' source by scripts/typedoc.mts, so its pages have no file to edit
const editUrl = (path: string) =>
  path.startsWith('reference/api-reference/')
    ? undefined
    : `https://github.com/affordances/affordances/edit/main/${path === 'reference/protocol.mdx' ? 'packages/protocol/spec.md' : `apps/docs/content/${path}`}`

// the layout's navbar and sidebar paint at once; the slug read sits behind Suspense and the page streams in
const Page = ({ params }: PageProps<'/docs/[[...slug]]'>) => (
  <Suspense>
    <DocPage params={params} />
  </Suspense>
)

const DocPage = async ({ params }: Pick<PageProps<'/docs/[[...slug]]'>, 'params'>) => {
  const page = source.getPage((await params).slug)
  if (!page) notFound()

  const MDX = page.data.body
  const trail = breadcrumbs(page.url)
  // the rail pins to the right edge; the article centres in whatever space is left of it
  return (
    <div className="grid gap-x-16 xl:grid-cols-[minmax(0,1fr)_auto]">
      {/* the wrapper is the toc bar's sticky range; --toc-bar takes the bar's h-12 off the column's min-height */}
      <div className="min-w-0 max-xl:has-[[data-toc-bar]]:[--toc-bar:--spacing(12)]">
        <AgentSkip>
          <TocBar toc={page.data.toc} />
        </AgentSkip>
        <div aria-hidden className="page-fade page-fade-top" />
        {/* at least one screen tall, so on short pages the pagination sits at the bottom of the viewport */}
        <div className="mx-auto flex min-h-[calc(100svh-var(--header-height)-4rem-var(--toc-bar,0px))] w-full max-w-[37em] min-w-0 flex-col md:min-h-[calc(100svh-var(--header-height)-6rem-var(--toc-bar,0px))]">
          {trail.length > 1 && (
            <Breadcrumb className="mb-8 font-pixel">
              <BreadcrumbList>
                {trail.map((item, i) => (
                  <Fragment key={i}>
                    {i > 0 && <BreadcrumbSeparator>/</BreadcrumbSeparator>}
                    <BreadcrumbItem>
                      {i === trail.length - 1 ? (
                        <BreadcrumbPage>{item.name}</BreadcrumbPage>
                      ) : item.url ? (
                        <BreadcrumbLink render={<Link href={item.url} />}>
                          {item.name}
                        </BreadcrumbLink>
                      ) : (
                        item.name
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          )}
          {/* the markdown twin is the article: title, description, and body, without the page's chrome */}
          <AgentMain>
            <article className="typeset typeset-docs">
              <div className="flex items-start justify-between gap-4">
                <h1 className="min-w-0 [overflow-wrap:anywhere]">{page.data.title}</h1>
                <AgentSkip>
                  <CopyPage url={page.url} />
                </AgentSkip>
              </div>
              {page.data.description && (
                <p className="mt-4 text-base leading-[1.6] text-muted-foreground">
                  {page.data.description}
                </p>
              )}
              <MDX components={components} />
            </article>
          </AgentMain>
          {/* pt-16 keeps the old minimum gap on long pages */}
          <div className="mt-auto pt-16">
            <AgentSkip>
              <PageNav url={page.url} />
            </AgentSkip>
          </div>
        </div>
        <div aria-hidden className="page-fade page-fade-bottom" />
      </div>
      <TextSelection />
      {/* under the sticky navbar, and under the toc bar (h-12) below xl */}
      <ScrollToTop className="top-[calc(var(--header-height)+4rem)] z-30 xl:top-[calc(var(--header-height)+1rem)]" />
      <div className="hidden xl:block">
        <AgentSkip>
          <Toc toc={page.data.toc} editUrl={editUrl(page.path)} />
        </AgentSkip>
      </div>
    </div>
  )
}

export default Page
