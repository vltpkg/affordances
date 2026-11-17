'use server'

import { revalidatePath } from 'next/cache'
import { defineAction } from '@/lib/affordances'
import { checkedBy } from '@/lib/runtime'
import { ensureSession } from '@/lib/session'
import * as store from '@/lib/store'
import {
  listPlans as listCapability,
  subscribe as subscribeCapability,
  subscribeBundle as bundleCapability,
} from '@/manifest'
import plansState from './state'

export const listPlans = defineAction({
  capability: listCapability,
  name: 'listPlans',
  ...checkedBy,
  run: () => store.planRows(),
})

export const subscribe = defineAction({
  capability: subscribeCapability,
  name: 'subscribe',
  ...checkedBy,
  state: plansState,
  effects: ['project', 'plans'],
  run: async ({ plan, projectId }, ctx) => {
    const sid = ctx.session?.id ?? (await ensureSession())
    const result = store.subscribePlan(sid, projectId, plan)
    revalidatePath('/', 'layout')
    return result
  },
})

export const subscribeBundle = defineAction({
  capability: bundleCapability,
  name: 'subscribeBundle',
  ...checkedBy,
  state: plansState,
  effects: ['project', 'bundles'],
  run: async ({ bundle, projectId }, ctx) => {
    const sid = ctx.session?.id ?? (await ensureSession())
    const result = store.subscribeBundle(sid, projectId, bundle)
    revalidatePath('/', 'layout')
    return result
  },
})
