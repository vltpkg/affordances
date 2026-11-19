import { GET as get, POST as post } from '@affordances/next/route'
import { countingErrors } from '@/lib/server-errors'

export const GET = countingErrors('/api/affordances/graph', get)
export const POST = countingErrors('/api/affordances/graph', post)
