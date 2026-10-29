import { search } from '@/lib/source'

// ?query=… → fumadocs' sorted results: each page, then its matching headings and text
export const GET = async (request: Request) => {
  const query = new URL(request.url).searchParams.get('query')
  return Response.json(query ? await search(query) : [])
}
