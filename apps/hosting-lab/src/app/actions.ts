'use server'

import { revalidatePath } from 'next/cache'
import { defineAction } from '@/lib/affordances'
import { ensureSession } from '@/lib/session'
import * as store from '@/lib/store'
import { cancel as cancelCapability } from '@/manifest'
import overview from './state'

export const cancel = defineAction({
  capability: cancelCapability,
  name: 'cancel',
  state: overview,
  effects: ['project'],
  run: async ({ projectId }, ctx) => {
    const sid = ctx.session?.id ?? (await ensureSession())
    const result = store.cancel(sid, projectId)
    revalidatePath('/', 'layout')
    return result
  },
  message: () => 'The project renews as Hobby at the end of the month',
})
