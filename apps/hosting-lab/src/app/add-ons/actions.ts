'use server'

import { revalidatePath } from 'next/cache'
import { defineAction } from '@/lib/affordances'
import { checkedBy } from '@/lib/runtime'
import { ensureSession } from '@/lib/session'
import * as store from '@/lib/store'
import { addAddOn as addCapability, removeAddOn as removeCapability } from '@/app/capabilities'
import addOnsState from './state'

export const addAddOn = defineAction({
  capability: addCapability,
  name: 'addAddOn',
  ...checkedBy,
  state: addOnsState,
  effects: ['addOns'],
  run: async ({ projectId, addOn }, ctx) => {
    const sid = ctx.session?.id ?? (await ensureSession())
    const result = store.addAddOn(store.account(sid).id, projectId, addOn)
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
    const result = store.removeAddOn(store.account(sid).id, projectId, addOn)
    revalidatePath('/', 'layout')
    return result
  },
})
