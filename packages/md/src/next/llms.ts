import { createLlmsTxtHandler } from './index.ts'

// app/llms.txt/route.ts: export { GET } from '@affordances/md/next/llms'. every route the site index lists
export const GET = createLlmsTxtHandler()
