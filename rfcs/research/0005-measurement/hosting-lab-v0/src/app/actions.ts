'use server'

// RFC 0005 §7's v0 rewrite of apps/hosting-lab/src/app/actions.ts, by SCORING.md §3's rules. SPIKE: measurement input
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { defineAction } from '@/lib/affordances'
import { messages } from '@/lib/messages'
import { ensureSession } from '@/lib/session'
import * as store from '@/lib/store'
import overview from './state'

export const cancel = defineAction({
  name: 'cancel',
  description:
    "Move the project back to Hobby at the end of the month. Stops the paid plan's renewal; nothing already charged is refunded",
  input: z.object({ projectId: z.string() }),
  expose: 'session',
  requires: 'The project renews on a paid plan',
  guard: () => true,
  state: overview,
  effects: ['project'],
  run: async ({ projectId }, ctx) => {
    const sid = ctx.session?.id ?? (await ensureSession())
    const result = store.cancel(store.account(sid).id, projectId)
    revalidatePath('/', 'layout')
    return result
  },
  message: messages.cancelled,
})
