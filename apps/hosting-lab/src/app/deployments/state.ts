import { defineState } from '@/lib/affordances'
import { accountFor, summary } from '@/lib/view'

export default defineState(
  ({ ctx }) => {
    const a = accountFor(ctx.session?.id)
    return {
      buildMinutes: summary(a).buildMinutes,
      rollback: summary(a).rollback,
      deployments: a.project.deployments,
    }
  },
  { description: "The project's deployments, newest first, and this month's build minutes" },
)
