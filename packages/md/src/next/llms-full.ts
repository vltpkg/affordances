import { createLlmsFullHandler } from './index.ts'

// app/llms-full.txt/route.ts: export { GET } from '@affordances/md/next/llms-full'. every route the site index lists
export const GET = createLlmsFullHandler()
