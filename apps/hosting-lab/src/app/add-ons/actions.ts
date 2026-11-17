'use server'

import { revalidatePath } from 'next/cache'
import { defineAction } from '@/lib/affordances'
import { checkedBy } from '@/lib/runtime'
import { ensureSession } from '@/lib/session'
import * as store from '@/lib/store'
import { addAddOn as addCapability, removeAddOn as removeCapability } from '@/manifest'
import addOnsState from './state'

export const addAddOn = defineAction({
  capability: addCapability,
  name: 'addAddOn',
  ...checkedBy,
  state: addOnsState,
  effects: ['addOns'],
  run: async ({ projectId, addOn }, ctx) => {
    const sid = ctx.session?.id ?? (await ensureSession())
    const result = store.addAddOn(sid, projectId, addOn)
    revalidatePath('/', 'layout')
    return result
  },
})

export const removeAddOn = defineAction({
  capability: removeCapability,
  name: 'removeAddOn',
  ...checkedBy,
  state: addOnsState,
  effects: ['addOns'],
  run: async ({ projectId, addOn }, ctx) => {
    const sid = ctx.session?.id ?? (await ensureSession())
    const result = store.removeAddOn(sid, projectId, addOn)
    revalidatePath('/', 'layout')
    return result
  },
})
