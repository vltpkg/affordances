import { pageMarkdown, source } from '@/lib/source'

export const GET = async () =>
  new Response((await Promise.all(source.getPages().map(pageMarkdown))).join('\n\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
