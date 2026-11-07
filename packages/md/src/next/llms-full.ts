import { createLlmsFullHandler } from './index.ts'

// app/llms-full.txt/route.ts: export { GET } from '@affordances/md/next/llms-full'. every page that needs no params
export const GET = /* @__PURE__ */ createLlmsFullHandler()
