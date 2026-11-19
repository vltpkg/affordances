import { AffordancesError } from '@affordances/core'
import { defineState } from '@/lib/affordances'
import { planPage } from './plan.ts'

export default defineState(
  ({ params }) => {
    const page = planPage(String(params.slug))
    if (!page) throw new AffordancesError('not_found', `No plan at ${params.slug}`)
    return page
  },
  {
    description: 'One plan: its price and limits, and every region it is served from',
    nav: () => [{ to: '/plans', label: 'Plans' }],
  },
)
