import type { MetadataRoute } from 'next'
import { source } from '@/lib/source'
import { siteUrl } from '@/lib/site-url'

const sitemap = (): MetadataRoute.Sitemap =>
  ['/', ...source.getPages().map((page) => page.url)].map((url) => ({
    url: new URL(url, siteUrl).href,
  }))

export default sitemap
