import { createLlmsTxtHandler } from './index.ts'

// app/llms.txt/route.ts: export { GET } from '@affordances/md/next/llms'. every page that needs no params
export const GET = createLlmsTxtHandler()
