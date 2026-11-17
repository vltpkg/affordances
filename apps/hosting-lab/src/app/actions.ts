'use server'

import { revalidatePath } from 'next/cache'
import { defineAction } from '@/lib/affordances'
import { messages } from '@/lib/messages'
import { checkedBy } from '@/lib/runtime'
import { ensureSession } from '@/lib/session'
import * as store from '@/lib/store'
import { cancel as cancelCapability } from '@/manifest'
import overview from './state'

export const cancel = defineAction({
  capability: cancelCapability,
  name: 'cancel',
  ...checkedBy,
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
