import { notFound } from 'next/navigation'
import { source } from '@/lib/source'
import { ogImage } from '@/lib/og'

// opengraph-image.tsx can't sit under the docs catch-all, so page images live here: /og/docs/<page>
export const generateStaticParams = () => source.generateParams()

export const GET = async (_request: Request, { params }: RouteContext<'/og/docs/[[...slug]]'>) => {
  const page = source.getPage((await params).slug)
  if (!page) notFound()
  return ogImage(page.data.title)
}
